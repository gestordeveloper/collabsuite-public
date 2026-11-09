from __future__ import annotations
from typing import Any

from backend.transitions import TRANSITIONS

# Every subtitle template is a complete style (see backend/subtitles.py DEFAULT_STYLE).
# Sizes are in reference pixels: the video's short side counts as 1080.
def _sub(**overrides: Any) -> dict[str, Any]:
    from backend.subtitles import DEFAULT_STYLE
    return {**DEFAULT_STYLE, **overrides}


SUBTITLE_TEMPLATES = [
    {
        "id": "tiktok_bold",
        "name": "TikTok / Reels Viral",
        "category": "Social",
        "description": "2 palavras em caixa alta, impacto visual máximo com contorno preto grosso e margem segura.",
        "preview_badge": "🔥 VIRAL",
        "style": _sub(
            font_family="Anton", font_weight=400, font_size=96, uppercase=True, words_per_cue=2,
            text_color="#FFFFFF", highlight_color="#FFE600",
            outline_color="#000000", outline_width=8, position_y=0.68,
        ),
    },
    {
        "id": "karaoke_pop",
        "name": "Karaokê Neon Pulse",
        "category": "Social",
        "description": "Destaca cada palavra falada com cor neon brilhante em tempo real.",
        "preview_badge": "⚡ KARAOKÊ",
        "style": _sub(
            font_family="Montserrat", font_weight=800, font_size=74, uppercase=True, words_per_cue=3,
            text_color="#FFFFFF", highlight_color="#00FFCC",
            outline_color="#000000", outline_width=6, shadow_distance=4, shadow_opacity=0.7,
            position_y=0.7,
        ),
    },
    {
        "id": "minimal_clean",
        "name": "Minimalista Clean",
        "category": "Editorial",
        "description": "Estilo documental/Netflix com fundo semi-transparente e tipografia suave.",
        "preview_badge": "🎬 CLEAN",
        "style": _sub(
            font_family="Inter", font_weight=500, font_size=54, uppercase=False, words_per_cue=5,
            text_color="#FFFFFF", highlight_enabled=False,
            border_style="box", box_color="#000000", box_opacity=0.55, box_padding=14,
            position_y=0.78,
        ),
    },
    {
        "id": "cyber_neon",
        "name": "Cyberpunk Neon",
        "category": "Estilizado",
        "description": "Texto em ciano elétrico com contorno magenta brilhante para canais tech e gaming.",
        "preview_badge": "🤖 TECH",
        "style": _sub(
            font_family="Orbitron", font_weight=700, font_size=66, uppercase=True, words_per_cue=2,
            text_color="#00FFFF", highlight_color="#FFFFFF",
            outline_color="#FF007F", outline_width=5, shadow_distance=5, shadow_color="#FF007F",
            shadow_opacity=0.5, position_y=0.7,
        ),
    },
    {
        "id": "cinematic_serif",
        "name": "Cinema Clássico",
        "category": "Cinema",
        "description": "Elegância com fonte serifada e espaçamento refinado.",
        "preview_badge": "🎞️ CINEMA",
        "style": _sub(
            font_family="Playfair Display", font_weight=600, italic=True, font_size=60, uppercase=False,
            words_per_cue=4, text_color="#FFF8E7", highlight_color="#FFD79A",
            outline_color="#000000", outline_width=4, shadow_distance=3, position_y=0.8,
        ),
    },
    {
        "id": "yellow_box",
        "name": "Caixa Amarela",
        "category": "Social",
        "description": "Texto preto sobre caixa amarela sólida: leitura garantida em qualquer fundo.",
        "preview_badge": "🟨 CAIXA",
        "style": _sub(
            font_family="Poppins", font_weight=800, font_size=64, uppercase=True, words_per_cue=3,
            text_color="#111111", highlight_enabled=False,
            border_style="box", box_color="#FFE600", box_opacity=1.0, box_padding=16,
            position_y=0.72,
        ),
    },
    {
        "id": "stack_focus",
        "name": "Frase em Pilha",
        "category": "Editorial",
        "description": "A frase aparece inteira, em linhas, com uma palavra enorme no meio. Alinhe à esquerda, centro ou direita.",
        "preview_badge": "📚 PILHA",
        "style": _sub(
            font_family="Inter", font_weight=800, font_size=52, uppercase=False, words_per_cue=6,
            letter_spacing=-1.5, text_color="#FFFFFF", highlight_enabled=False,
            border_style="none", shadow_distance=3, shadow_opacity=0.55, position_y=0.55,
            layout="stack", emphasis="keyword", emphasis_scale=2.6, text_align="center", reveal="word",
        ),
    },
    {
        "id": "marker_hand",
        "name": "Marcador Manuscrito",
        "category": "Estilizado",
        "description": "Letra de marcador feita à mão, com contorno preto, para um tom descontraído.",
        "preview_badge": "✍️ MANUAL",
        "style": _sub(
            font_family="Permanent Marker", font_weight=400, font_size=78, uppercase=False,
            words_per_cue=3, text_color="#FFFFFF", highlight_color="#FF5A00",
            outline_color="#000000", outline_width=7, position_y=0.7,
        ),
    },
]

# Every headline template is a complete style (see backend/headlines.py DEFAULT_STYLE).
# Sizes are in reference pixels: the video's short side counts as 1080. In the texts,
# a line break is a real newline and *asterisks* mark the words drawn in the highlight colour.
def _hl(**overrides: Any) -> dict[str, Any]:
    from backend.headlines import DEFAULT_STYLE
    return {**DEFAULT_STYLE, **overrides}


HEADLINE_TEMPLATES = [
    {
        "id": "top_hook_banner",
        "name": "Banner Superior de Retenção",
        "category": "Hooks",
        "description": "Faixa larga no topo, com tag e borda laranja, para segurar a atenção nos primeiros segundos.",
        "preview_badge": "🎯 HOOK",
        "default_text": "COMO EU FIZ ISSO EM\n*10 MINUTOS* 🚀",
        "default_tag": "TUTORIAL",
        "style": _hl(
            font_family="Montserrat", font_weight=800, font_size=58, uppercase=True, text_align="left",
            text_color="#FFFFFF", highlight_color="#FF8A3D",
            box_color="#0F172A", box_opacity=0.92, box_padding_x=44, box_padding_y=34, box_radius=28,
            border_width=4, border_color="#FF5A00",
            tag_size=28, tag_bg_color="#FF5A00", tag_text_color="#FFFFFF", tag_radius=12,
            shadow_distance=8, shadow_blur=28, shadow_opacity=0.45,
            width_mode="full", max_width=0.9, position_y=0.13, animation="slide_down", anim_duration=0.45,
        ),
    },
    {
        "id": "pill_badge",
        "name": "Pill Badge Flutuante",
        "category": "Moderno",
        "description": "Etiqueta arredondada e translúcida, discreta, para dicas rápidas e chamadas leves.",
        "preview_badge": "💊 PILL",
        "default_text": "Dica essencial de edição 💡",
        "default_tag": "PRO TIP",
        "style": _hl(
            font_family="Poppins", font_weight=600, font_size=46, uppercase=False, text_align="center",
            text_color="#FFFFFF", highlight_color="#FFD9B8",
            box_color="#FF5A00", box_opacity=0.32, box_padding_x=52, box_padding_y=28, box_radius=999,
            border_width=2, border_color="#FF8C42",
            tag_size=24, tag_bg_color="#FF8C42", tag_text_color="#1A0F05", tag_radius=999,
            shadow_distance=6, shadow_blur=22, shadow_opacity=0.35,
            width_mode="fit", max_width=0.86, position_y=0.12, animation="fade", anim_duration=0.4,
        ),
    },
    {
        "id": "kinetic_title",
        "name": "Título Cinético com Barra",
        "category": "Impacto",
        "description": "Título grande e condensado com barra lateral ciano vibrante e slide lateral.",
        "preview_badge": "⚡ IMPACTO",
        "default_text": "O SEGREDO QUE\n*NINGUÉM* CONTA",
        "default_tag": "EXCLUSIVO",
        "style": _hl(
            font_family="Oswald", font_weight=700, font_size=88, uppercase=True, text_align="left",
            line_height=1.08, text_color="#FFFFFF", highlight_color="#00FFCC",
            box_color="#000000", box_opacity=0.8, box_padding_x=40, box_padding_y=30, box_radius=6,
            border_width=0, accent_style="bar", accent_color="#00FFCC", accent_width=16,
            tag_size=28, tag_bg_color="#00FFCC", tag_text_color="#00231B", tag_radius=6,
            shadow_distance=6, shadow_blur=24, shadow_opacity=0.5,
            width_mode="fit", max_width=0.9, position_y=0.4, animation="slide_left", anim_duration=0.4,
        ),
    },
    {
        "id": "lower_third",
        "name": "Lower Third Elegante",
        "category": "Estúdio",
        "description": "Crachá informativo com barra azul para nome, cargo ou apoio, no terço inferior.",
        "preview_badge": "🎙️ NOME",
        "default_text": "Seu Nome Aqui\nCriador de Conteúdo",
        "default_tag": "APRESENTADOR",
        "style": _hl(
            font_family="Inter", font_weight=600, font_size=44, uppercase=False, text_align="left",
            line_height=1.25, text_color="#FFFFFF", highlight_color="#60A5FA",
            box_color="#121216", box_opacity=0.86, box_padding_x=36, box_padding_y=26, box_radius=14,
            border_width=2, border_color="#3A3A44", accent_style="bar", accent_color="#3B82F6", accent_width=12,
            tag_size=22, tag_bg_color="#3B82F6", tag_text_color="#FFFFFF", tag_radius=8,
            shadow_distance=6, shadow_blur=20, shadow_opacity=0.4,
            width_mode="fit", max_width=0.8, position_y=0.58, animation="slide_right", anim_duration=0.45,
        ),
    },
    {
        "id": "question_hook",
        "name": "Pergunta Provocativa",
        "category": "Engajamento",
        "description": "Pergunta aberta em caixa preta com borda amarela fluorescente, centralizada.",
        "preview_badge": "❓ PERGUNTA",
        "default_text": "VOCÊ JÁ PASSOU\nPOR *ISSO*? 😱",
        "default_tag": "RESPONDA",
        "style": _hl(
            font_family="Anton", font_weight=400, font_size=92, uppercase=True, text_align="center",
            line_height=1.12, text_color="#FFFFFF", highlight_color="#FFE600",
            box_color="#000000", box_opacity=0.86, box_padding_x=52, box_padding_y=36, box_radius=24,
            border_width=5, border_color="#FFE600",
            tag_size=28, tag_bg_color="#FFE600", tag_text_color="#111111", tag_radius=10,
            shadow_distance=8, shadow_blur=26, shadow_opacity=0.5,
            width_mode="fit", max_width=0.9, position_y=0.3, animation="slide_up", anim_duration=0.4,
        ),
    },
    {
        "id": "viral_outline",
        "name": "Impacto Viral (Contorno)",
        "category": "Social",
        "description": "Sem caixa: letras gigantes brancas com contorno preto grosso e palavra em destaque.",
        "preview_badge": "🔥 VIRAL",
        "default_text": "PARE DE *PERDER*\nTEMPO EDITANDO",
        "default_tag": "",
        "style": _hl(
            font_family="Anton", font_weight=400, font_size=124, uppercase=True, text_align="center",
            line_height=1.05, text_color="#FFFFFF", highlight_color="#FFE600",
            outline_width=11, outline_color="#000000",
            box_enabled=False, box_padding_x=10, box_padding_y=10,
            shadow_distance=7, shadow_blur=6, shadow_opacity=0.6,
            width_mode="fit", max_width=0.94, position_y=0.2, animation="fade", anim_duration=0.35,
        ),
    },
    {
        "id": "yellow_slab",
        "name": "Caixa Amarela",
        "category": "Social",
        "description": "Texto preto sobre caixa amarela sólida: leitura garantida em qualquer fundo.",
        "preview_badge": "🟨 CAIXA",
        "default_text": "3 ERROS QUE TODO\n*INICIANTE* COMETE",
        "default_tag": "ATENÇÃO",
        "style": _hl(
            font_family="Poppins", font_weight=800, font_size=60, uppercase=True, text_align="center",
            text_color="#111111", highlight_color="#D6001C",
            box_color="#FFE600", box_opacity=1.0, box_padding_x=44, box_padding_y=30, box_radius=14,
            border_width=0,
            tag_size=24, tag_bg_color="#111111", tag_text_color="#FFE600", tag_radius=8,
            shadow_distance=8, shadow_blur=0, shadow_opacity=0.35,
            width_mode="fit", max_width=0.9, position_y=0.16, animation="slide_down", anim_duration=0.4,
        ),
    },
    {
        "id": "neon_tech",
        "name": "Neon Tech",
        "category": "Estilizado",
        "description": "Moldura ciano com brilho neon e destaque magenta para canais tech e gaming.",
        "preview_badge": "🤖 TECH",
        "default_text": "O FUTURO DA IA\nJÁ *CHEGOU*",
        "default_tag": "TECH",
        "style": _hl(
            font_family="Orbitron", font_weight=700, font_size=56, uppercase=True, text_align="center",
            text_color="#00FFFF", highlight_color="#FF007F",
            box_color="#05070F", box_opacity=0.78, box_padding_x=46, box_padding_y=30, box_radius=10,
            border_width=3, border_color="#00FFFF",
            tag_size=24, tag_bg_color="#FF007F", tag_text_color="#FFFFFF", tag_radius=6,
            shadow_distance=0, shadow_blur=34, shadow_color="#00FFFF", shadow_opacity=0.7,
            width_mode="fit", max_width=0.9, position_y=0.14, animation="fade", anim_duration=0.4,
        ),
    },
    {
        "id": "editorial_serif",
        "name": "Editorial Serifado",
        "category": "Cinema",
        "description": "Serifa itálica elegante, sem caixa, com sublinhado dourado. Ideal para storytelling.",
        "preview_badge": "🎞️ EDITORIAL",
        "default_text": "A arte de contar\n*histórias* que prendem",
        "default_tag": "",
        "style": _hl(
            font_family="Playfair Display", font_weight=700, italic=True, font_size=76, uppercase=False,
            text_align="center", line_height=1.18, text_color="#FFF8E7", highlight_color="#FFD79A",
            box_enabled=False, box_padding_x=14, box_padding_y=14,
            accent_style="underline", accent_color="#FFD79A", accent_width=6,
            shadow_distance=4, shadow_blur=22, shadow_opacity=0.7,
            width_mode="fit", max_width=0.9, position_y=0.18, animation="fade", anim_duration=0.5,
        ),
    },
]

# The transitions between cuts (and the effects that make them) are defined in backend/transitions.py
TRANSITION_TEMPLATES = TRANSITIONS

COLOR_GRADE_PRESETS = [
    {
        "id": "warm_cinematic",
        "name": "Warm Cinematic (StudioX)",
        "description": "+12% contraste, sombras quentes, altas luzes frias sutis e curva fílmica.",
        "ffmpeg_filter": "eq=contrast=1.12:brightness=-0.02:saturation=0.88,colorbalance=rs=0.02:gs=0.0:bs=-0.03:rm=0.04:gm=0.01:bm=-0.02:rh=0.08:gh=0.02:bh=-0.05,curves=master='0/0 0.25/0.22 0.75/0.78 1/1'",
        "css_filter": "contrast(1.12) brightness(0.98) saturate(0.88) sepia(0.08)"
    },
    {
        "id": "neutral_punch",
        "name": "Neutral Punch",
        "description": "Contraste equilibrado com leve curva S, mantendo tons de pele naturais.",
        "ffmpeg_filter": "eq=contrast=1.06:brightness=0.0:saturation=1.0,curves=master='0/0 0.25/0.23 0.75/0.77 1/1'",
        "css_filter": "contrast(1.06) brightness(1.0) saturate(1.05)"
    },
    {
        "id": "clean_bright",
        "name": "Clean & Vibrant",
        "description": "Cores vivas e iluminação clara, excelente para vídeos corporativos e redes sociais.",
        "ffmpeg_filter": "eq=contrast=1.08:brightness=0.04:saturation=1.15",
        "css_filter": "contrast(1.08) brightness(1.04) saturate(1.15)"
    },
    {
        "id": "cyberpunk_teal_orange",
        "name": "Teal & Orange Punch",
        "description": "Efeito moderno de contraste de cores complementares.",
        "ffmpeg_filter": "eq=contrast=1.15:saturation=1.1,colorbalance=rs=-0.05:gs=0.02:bs=0.08:rh=0.08:gh=0.0:bh=-0.08",
        "css_filter": "contrast(1.15) saturate(1.1) hue-rotate(-5deg)"
    },
    {
        "id": "bw_dramatic",
        "name": "Preto & Branco Dramático",
        "description": "Monocromático de alto contraste com textura dramática.",
        "ffmpeg_filter": "hue=s=0,eq=contrast=1.2:brightness=-0.02",
        "css_filter": "grayscale(100%) contrast(1.2) brightness(0.98)"
    },
    {
        "id": "auto",
        "name": "Auto Grade (Inteligente)",
        "description": "O StudioX calcula os níveis de exposição e contraste da cena e faz micro-ajustes.",
        "ffmpeg_filter": "__AUTO__",
        "css_filter": "contrast(1.03) saturate(0.98)"
    },
    {
        "id": "none",
        "name": "Original (Sem Grade)",
        "description": "Preserva exatamente as cores da câmera sem alterações.",
        "ffmpeg_filter": "",
        "css_filter": "none"
    }
]

# Fine adjustments on top of a grade preset (the sliders of the editor and of the template screen).
# The same maths runs in the browser preview (frontend/js/grade.js, an SVG colour matrix) and in the render.
GRADE_ADJUST_RANGES: dict[str, tuple[float, float]] = {
    "brightness": (-0.3, 0.3),     # added to every channel, 0 = unchanged
    "contrast": (0.6, 1.6),        # around mid grey, 1 = unchanged
    "saturation": (0.0, 2.0),      # 1 = unchanged, 0 = grey
    "temperature": (-1.0, 1.0),    # -1 cool (blue) .. +1 warm (orange)
    "tint": (-1.0, 1.0),           # -1 green .. +1 magenta
}
GRADE_ADJUST_DEFAULT: dict[str, float] = {"brightness": 0.0, "contrast": 1.0, "saturation": 1.0, "temperature": 0.0, "tint": 0.0}


def sanitize_grade_adjust(raw: Any) -> dict[str, float]:
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, float] = {}
    for key, (lo, hi) in GRADE_ADJUST_RANGES.items():
        try:
            v = float(raw.get(key, GRADE_ADJUST_DEFAULT[key]))
        except (TypeError, ValueError):
            v = GRADE_ADJUST_DEFAULT[key]
        if v != v:  # NaN
            v = GRADE_ADJUST_DEFAULT[key]
        out[key] = round(min(hi, max(lo, v)), 3)
    return out


def grade_adjust_is_neutral(adjust: Any) -> bool:
    a = sanitize_grade_adjust(adjust)
    return all(abs(a[k] - GRADE_ADJUST_DEFAULT[k]) < 1e-3 for k in a)


def grade_adjust_filter(adjust: Any) -> str:
    """ffmpeg filters for the fine adjustments ("" when nothing was changed)."""
    a = sanitize_grade_adjust(adjust)
    parts: list[str] = []
    if abs(a["brightness"]) > 1e-3 or abs(a["contrast"] - 1) > 1e-3 or abs(a["saturation"] - 1) > 1e-3:
        parts.append(f"eq=brightness={a['brightness']:.3f}:contrast={a['contrast']:.3f}:saturation={a['saturation']:.3f}")
    t, tint = a["temperature"], a["tint"]
    if abs(t) > 1e-3 or abs(tint) > 1e-3:
        rr, gg, bb = 1 + 0.15 * t + 0.05 * tint, 1 - 0.10 * tint, 1 - 0.15 * t + 0.05 * tint
        parts.append(f"colorchannelmixer=rr={rr:.3f}:gg={gg:.3f}:bb={bb:.3f}")
    return ",".join(parts)


def grade_to_edl(grade_id: str | None) -> str:
    """Value for the EDL's `grade` field. render.py only knows a few preset names, so the
    catalog's other grades (clean_bright, bw_dramatic...) go in as their raw ffmpeg filter."""
    if not grade_id or grade_id == "none":
        return "none"
    if grade_id == "auto":
        return "auto"
    for g in COLOR_GRADE_PRESETS:
        if g["id"] == grade_id and g["ffmpeg_filter"] and g["ffmpeg_filter"] != "__AUTO__":
            return g["ffmpeg_filter"]
    return "none"


def get_template_catalog() -> dict[str, Any]:
    from backend import looks
    from backend import transitions as tr_mod
    return {
        "subtitles": SUBTITLE_TEMPLATES,
        "headlines": HEADLINE_TEMPLATES,
        "transitions": tr_mod.all_transitions(),   # the ready-made ones + the user's own
        "color_grades": COLOR_GRADE_PRESETS,
        # constants the preview shares with the render (js/fx.js draws the same curves as backend/looks.py)
        "looks": looks.shared_constants(),
    }
