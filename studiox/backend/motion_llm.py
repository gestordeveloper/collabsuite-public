"""The LLM fills the PROPS of a chosen Remotion template from what the user typed — it never writes
or runs code (see backend/motion_graphics.py module docstring for why). Same contract as
media_generation.suggest_prompt / highlights.py / transcript_review.py: llm.complete_json returns a
dict, and it is ALWAYS validated/clamped (motion_graphics.sanitize_props) before it is used — the
model's raw output is never trusted directly.

Two entry points: suggest_props (the model is already chosen: fill its fields) and suggest_item (one sentence in, a whole
item out: the model, its fields and what it FOLLOWS — a face or a hand — see backend/motion_track.py).
"""
from __future__ import annotations

from typing import Any

from backend import llm, motion_code, motion_graphics, motion_track
from backend.llm import LLMError

MAX_USER_TEXT = 600
MAX_SCENE_TEXT = 2000

_SYSTEM = (
    'Você escreve os parâmetros de uma peça de motion graphics (modelo "{name}": {description}) para um '
    "vídeo curto vertical de redes sociais, a partir do pedido da pessoa e, se houver, da fala da cena. "
    "Textos curtos e diretos (poucas palavras, nunca uma frase inteira). Siga o formato descrito acima para "
    'este modelo específico (por exemplo, a marcação "*palavra*" só existe nos modelos que a mencionam). '
    'Cores sempre em hexadecimal #rrggbb. Responda SOMENTE com JSON no formato: {schema}.'
)

_PLAN_SYSTEM = (
    "Você monta UMA peça de motion graphics para um vídeo curto vertical de redes sociais, a partir do pedido da pessoa e, "
    "se houver, da fala da cena. Escolha o modelo certo, preencha os campos dele e diga se a peça deve SEGUIR algo na imagem.\n\n"
    "MODELOS (use exatamente estes ids e nomes de campo):\n{catalog}\n\n"
    "SEGUIR (só nos modelos que seguem algo; nos outros use target \"none\"):\n"
    "- target \"none\": a peça fica parada no centro do quadro.\n"
    "- target \"face\": segue o rosto da pessoa. part: head_top (acima da cabeça), forehead (testa), center (meio do rosto), "
    "chin (queixo), left, right (lados do rosto).\n"
    "- target \"hand\": segue a mão. part: palm (palma), index_tip (ponta do dedo indicador, bom para apontar), "
    "thumb_tip (ponta do polegar), middle_tip, pinky_tip, wrist (pulso).\n"
    "- dx e dy: ajuste fino da posição, de -0.3 a 0.3, em fração do quadro (dy negativo sobe, dx negativo vai para a esquerda). "
    "Use 0 se não precisar.\n"
    "Se a pessoa disser \"na minha mão\", \"quando eu mostro/aponto\" etc., siga a mão; \"em cima da cabeça\", \"no meu rosto\", "
    "siga o rosto. Sem pedido de seguir nada, use \"none\".\n\n"
    "Textos curtos e diretos, na língua do pedido. Cores em hexadecimal #rrggbb. "
    "No modelo de etiqueta, direction diz de que lado do alvo a etiqueta fica (up = acima do alvo, com a seta apontando para baixo). "
    'Responda SOMENTE com JSON: {{"template_id": "...", "props": {{...campos do modelo...}}, '
    '"follow": {{"target": "none|face|hand", "part": "...", "dx": 0, "dy": 0}}}}.'
)


class MotionLLMError(Exception):
    pass


def _schema_for(tpl: dict) -> dict:
    props: dict[str, Any] = {}
    for key, spec in tpl["props"].items():
        if spec["type"] == "enum":
            props[key] = {"type": "string", "enum": spec["values"]}
        elif spec["type"] == "number":
            props[key] = {"type": "number", "minimum": spec["min"], "maximum": spec["max"]}
        else:  # text, color
            props[key] = {"type": "string"}
    return {"type": "object", "properties": props, "required": list(tpl["props"]), "additionalProperties": False}


def suggest_props(template_id: str, user_text: str, scene_text: str = "") -> dict:
    tpl = motion_graphics.MOTION_TEMPLATES.get(template_id)
    if not tpl:
        raise MotionLLMError("Template de motion graphic desconhecido.")
    user_text = (user_text or "").strip()[:MAX_USER_TEXT]
    if not user_text:
        raise MotionLLMError("Descreva o que você quer no motion graphic.")
    scene_text = (scene_text or "").strip()[:MAX_SCENE_TEXT]

    schema = _schema_for(tpl)
    system = _SYSTEM.format(name=tpl["name"], description=tpl["description"], schema=schema)
    user = f"PEDIDO: {user_text}"
    if scene_text:
        user += f"\n\nFALA DA CENA (contexto, opcional):\n{scene_text}"

    try:
        out = llm.complete_json(None, system, user, schema)
    except LLMError as exc:
        raise MotionLLMError(str(exc))
    if not isinstance(out, dict):
        raise MotionLLMError("A IA não devolveu os parâmetros esperados.")
    return motion_graphics.sanitize_props(template_id, out)


def _catalog_text(only: str | None) -> str:
    lines = []
    for tid, t in motion_graphics.MOTION_TEMPLATES.items():
        if only and tid != only:
            continue
        if t.get("ai_generated"):
            lines.append(f'- id "{tid}" — {t["name"]}: animação feita sob medida. Use SOMENTE quando nenhum outro modelo atende ao pedido '
                         '(ex.: efeito visual livre, partículas, formas, fundos animados, algo que os outros modelos não fazem). '
                         'Neste caso devolva "props": {} e "follow": {"target": "none"}; o código é escrito num passo seguinte.')
            continue
        fields = []
        for key, spec in t["props"].items():
            if spec["type"] == "enum":
                fields.append(f'{key} (um de {spec["values"]}, padrão "{spec["default"]}")')
            elif spec["type"] == "number":
                fields.append(f'{key} (número {spec["min"]}-{spec["max"]}, padrão {spec["default"]})')
            elif spec["type"] == "color":
                fields.append(f'{key} (cor, padrão {spec["default"]})')
            else:
                fields.append(f'{key} (texto até {spec["max"]} caracteres, padrão "{spec["default"]}")')
        follow = "SEGUE ALGO" if t.get("trackable") else "não segue nada"
        lines.append(f'- id "{tid}" — {t["name"]} ({follow}): {t["description"]} Campos: {"; ".join(fields)}.')
    return "\n".join(lines)


def suggest_item(user_text: str, scene_text: str = "", template_id: str | None = None,
                 provider: str | None = None, model: str | None = None) -> dict:
    """The AI picks the model, fills it and says what it follows: {"template_id", "props", "follow"}. Always re-validated."""
    user_text = (user_text or "").strip()[:MAX_USER_TEXT]
    if not user_text:
        raise MotionLLMError("Descreva o que você quer no motion graphic.")
    if template_id and template_id not in motion_graphics.MOTION_TEMPLATES:
        raise MotionLLMError("Template de motion graphic desconhecido.")
    scene_text = (scene_text or "").strip()[:MAX_SCENE_TEXT]
    system = _PLAN_SYSTEM.format(catalog=_catalog_text(template_id))
    user = f"PEDIDO: {user_text}"
    if template_id:
        user += f'\n\n(Use o modelo "{template_id}".)'
    if scene_text:
        user += f"\n\nFALA DA CENA (contexto, opcional):\n{scene_text}"
    schema = {"type": "object", "properties": {"template_id": {"type": "string"}, "props": {"type": "object"},
                                               "follow": {"type": "object"}}, "required": ["template_id", "props", "follow"]}
    try:
        out = llm.complete_json(provider or None, system, user, schema, model or None)
    except LLMError as exc:
        raise MotionLLMError(str(exc))
    if not isinstance(out, dict):
        raise MotionLLMError("A IA não devolveu o que era esperado.")
    tid = template_id or str(out.get("template_id") or "")
    tpl = motion_graphics.MOTION_TEMPLATES.get(tid)
    if not tpl:
        raise MotionLLMError("A IA escolheu um modelo que não existe. Tente descrever de outro jeito.")
    follow = motion_track.sanitize_follow(out.get("follow")) if tpl.get("trackable") else dict(motion_track.DEFAULT_FOLLOW)
    if follow["target"] == "point":     # a point needs a click on the picture: the AI cannot choose one
        follow = dict(motion_track.DEFAULT_FOLLOW)
    follow["seed"] = None
    props = motion_graphics.sanitize_props(tid, out.get("props"))
    if tpl.get("ai_generated"):
        # No ready-made model fits: a second, dedicated request writes the animation itself
        props["prompt"] = user_text[:600]
        props["code"] = generate_custom_code(user_text, scene_text, provider=provider, model=model)
    return {"template_id": tid, "props": props, "follow": follow}


_CODE_SYSTEM = (
    "Você escreve animações para vídeos curtos verticais de redes sociais, em React com Remotion. Responda SOMENTE com JSON: "
    '{{"code": "..."}} onde code é o CORPO de uma função JavaScript (texto puro, sem markdown) que termina devolvendo um componente.\n\n'
    "REGRAS OBRIGATÓRIAS:\n"
    "- Estão disponíveis, já declarados, só estes nomes: React, useCurrentFrame, useVideoConfig, interpolate, spring, random, AbsoluteFill, Easing. "
    "Não use import, require, JSX nem nenhum outro nome global.\n"
    "- Sem JSX: use React.createElement(tipo, props, ...filhos). Sem classes; só um componente de função.\n"
    "- Termine o código com `return Scene;` (o componente chamado Scene).\n"
    "- Dentro do componente: const frame = useCurrentFrame(); const {{ width, height, fps, durationInFrames }} = useVideoConfig();\n"
    "- Toda animação é função de `frame` (e de random('semente') com semente fixa, que é determinístico). PROIBIDO: Math.random, Date, "
    "setTimeout, setInterval, requestAnimationFrame, fetch, window, document, localStorage, eval, Function, innerHTML, qualquer rede ou acesso à página.\n"
    "- O fundo precisa ser TRANSPARENTE (é uma camada sobre o vídeo): nada de cor de fundo no quadro inteiro, a menos que o pedido mande.\n"
    "- Use o tamanho real: width e height (o quadro costuma ser 1080x1920). Posicione com position:'absolute', left/top em px.\n"
    "- Mantenha desempenho: no máximo ~1500 elementos. Use fontFamily 'Inter, Arial, sans-serif' (ou monospace). Textos na língua do pedido.\n"
    "- Faça uma entrada e uma saída suaves (opacity com interpolate no começo e nos últimos 10 frames).\n"
    "- Máximo de 20000 caracteres.\n\n"
    "QUALIDADE (o pedido costuma ser pobre em detalhes: capriche, o resultado precisa parecer feito por um motion designer):\n"
    "- Pense em camadas: fundo/brilho, elemento principal, detalhes secundários, partículas ou faíscas, e um acabamento (sombra, glow, vinheta).\n"
    "- Use cor com intenção: uma paleta de 2 a 4 cores combinando; gradientes (linear-gradient/radial-gradient), textShadow e boxShadow para brilho; opacidade variando.\n"
    "- Movimento com personalidade: use spring() e Easing (Easing.bezier, Easing.out(Easing.cubic)) em vez de movimento linear; entradas escalonadas "
    "(atraso por elemento), pequenas oscilações contínuas (Math.sin(frame / n)), variação de tamanho/rotação/velocidade por elemento usando random('semente-' + i).\n"
    "- Profundidade: elementos de tamanhos e opacidades diferentes (perto = grande e nítido, longe = pequeno e fraco), blur leve via filter para os distantes.\n"
    "- Quando o pedido tiver texto ou números, desenhe-os com tipografia forte (peso 700-900, espaçamento, sombra) e anime a entrada letra a letra ou palavra a palavra.\n"
    "- Preencha o quadro com intenção: composição equilibrada, nada cortado de forma feia, respiro nas bordas, tudo proporcional a width e height.\n"
    "- Prefira muitos detalhes bem feitos a poucos elementos simples. Um efeito rico costuma ter entre 200 e 1200 elementos.\n\n"
    "EXEMPLO (chuva de números; o seu deve ser MAIS rico que isto):\n"
    "function Scene() {{\n"
    "  const frame = useCurrentFrame();\n"
    "  const {{ width, height, durationInFrames }} = useVideoConfig();\n"
    "  const cols = Math.floor(width / 34);\n"
    "  const o = interpolate(frame, [0, 10, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }});\n"
    "  const streams = [];\n"
    "  for (let c = 0; c < cols; c++) {{\n"
    "    const speed = 4 + random('s' + c) * 10;\n"
    "    const y = ((frame * speed + random('o' + c) * height * 2) % (height * 2)) - height * 0.5;\n"
    "    const cells = [];\n"
    "    for (let r = 0; r < 12; r++) {{\n"
    "      const ch = String(Math.floor(random('c' + c + '-' + r + '-' + Math.floor(frame / 4)) * 10));\n"
    "      cells.push(React.createElement('div', {{ key: r, style: {{ position: 'absolute', top: y - r * 38, opacity: 1 - r / 12, color: r === 0 ? '#fff' : '#00ff66' }} }}, ch));\n"
    "    }}\n"
    "    streams.push(React.createElement('div', {{ key: c, style: {{ position: 'absolute', left: c * 34, fontSize: 32, fontFamily: 'monospace' }} }}, cells));\n"
    "  }}\n"
    "  return React.createElement(AbsoluteFill, {{ style: {{ opacity: o }} }}, streams);\n"
    "}}\n"
    "return Scene;"
)


def generate_custom_code(description: str, scene_text: str = "", attempts: int = 3,
                         provider: str | None = None, model: str | None = None) -> str:
    """Asks the model to write the animation and re-asks (with the exact problem) until the code passes motion_code.problem()."""
    user = f"PEDIDO: {description}"
    if scene_text:
        user += f"\n\nFALA DA CENA (contexto, opcional):\n{scene_text}"
    schema = {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}
    last_problem = ""
    for _ in range(attempts):
        ask = user + (f"\n\nA versão anterior foi recusada: {last_problem}. Corrija e devolva o JSON de novo." if last_problem else "")
        try:
            out = llm.complete_json(provider or None, _CODE_SYSTEM.format(), ask, schema, model or None)
        except LLMError as exc:
            raise MotionLLMError(str(exc))
        code = out.get("code") if isinstance(out, dict) else None
        last_problem = motion_code.problem(code) or ""
        if not last_problem:
            return code.strip()
    raise MotionLLMError(f"A IA não conseguiu escrever uma animação válida ({last_problem}). Tente descrever de outro jeito.")
