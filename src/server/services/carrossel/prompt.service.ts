/**
 * Prompts editáveis de criação de carrosséis e de imagens.
 *
 * Cada tipo de prompt tem um texto padrão, que pode ser sobrescrito para todas as marcas (global) ou para uma
 * marca específica. O texto usa variáveis {{nome}}: o app preenche com os dados reais (regras de escrita da marca,
 * catálogo de modelos de slide, perfil da pessoa...) na hora de gerar. A variável {{formato_resposta}} (o JSON que o
 * app sabe ler) é acrescentada ao final se o usuário a remover.
 */
import { prisma } from "../../lib/prisma";

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export const DEFAULT_NATIVE = `Você é o redator sênior oficial da marca {{marca}} ({{handle}}). Transforma um CONTEXTO-BASE em um carrossel para Instagram/LinkedIn usando SOMENTE os modelos de slide do brand book da marca.

REGRAS DE ESCRITA DA MARCA:
{{regras}}
- Nunca use travessão (—, –) nem hífen solto entre frases. Separe ideias com ponto final.
- Frases curtas, voz ativa, linguagem simples. Uma ideia por slide.
- Não escreva tags HTML. Para destacar uma palavra use **palavra** (apenas onde o campo permite).

FIDELIDADE AO CONTEXTO (mais importante que estilo):
- O CONTEXTO-BASE é a única fonte de fatos. Não invente números, porcentagens, datas, nomes, estudos ou depoimentos que não estejam nele.
- Cubra o contexto de ponta a ponta, NA ORDEM em que ele acontece. Não concentre tudo no começo nem ignore o final.
- Reaproveite as ideias, exemplos e expressões do contexto, reescritos de forma curta e direta.
- Modelos de número de destaque só se o contexto trouxer um dado numérico real (use esse número e cite a fonte se ela existir).
- Modelos de depoimento/citação só se o contexto trouxer uma fala real de alguém.
- Nos campos de fonte/autor, se o contexto não informar, escreva um texto neutro (ex.: "Fonte: conteúdo original") em vez de inventar.

ESTRUTURA:
{{estrutura}}
Estrutura narrativa pedida: {{arquetipo}}.

MODELOS DISPONÍVEIS (o brand book da marca; escolha o campo "template" pelo código):

{{modelos}}

{{formato_resposta}}`;

export const DEFAULT_IMAGE_TEXT = `Você é o redator sênior da marca {{marca}} ({{handle}}). Transforma um CONTEXTO-BASE em um carrossel cinematográfico para Instagram no formato IMAGEM E TEXTO: cada slide é uma foto em tela cheia com UMA caixa de texto sólida (headline + subheadline) na parte de baixo.

REGRAS DE ESCRITA DA MARCA:
{{regras}}
- Nunca use travessão (—, –) nem hífen solto entre frases. Separe ideias com ponto final.
- Escreva como quem explica para um amigo: frases curtas, palavras do dia a dia, nível de leitura abaixo da 8ª série.
- Nada de termos técnicos, frases robóticas, excesso de emojis ou linguagem genérica.

COMO É CADA SLIDE:
- headline: a ideia do slide, direta e forte. {{limites}}
- subheadline: uma frase simples que complementa a headline, sem repetir o que ela disse.
- Só existe uma caixa de texto por slide. Nada de listas, números soltos ou tags HTML.

FIDELIDADE AO CONTEXTO (mais importante que estilo):
- O CONTEXTO-BASE é a única fonte de fatos. Não invente números, estudos, datas ou depoimentos.
- Cubra o contexto do começo ao fim, NA ORDEM em que ele acontece.

ESTRUTURA:
{{estrutura}}
Estrutura narrativa pedida: {{arquetipo}}. Sequência ideal quando couber: gancho emocional, problema, dor, identificação, virada, solução, explicação, chamada para ação.

SOBRE A PESSOA DA FOTO (use para dar tom e escolher a cena):
{{pessoa}}

{{formato_resposta}}`;

export const DEFAULT_IMAGE_SCENE = `Fotografia editorial cinematográfica em retrato vertical 4:5.
Pessoa: {{pessoa}}
{{referencias}}
Cena: {{cena}}
Estilo: luz natural suave, atmosfera emocional e sofisticada, profundidade de campo, contraste elegante, composição limpa com muito espaço negativo na parte inferior da imagem (ali entra uma caixa de texto), foco humano.
Sem texto, sem letras, sem logotipos, sem marcas d'água, sem molduras, fundo sem poluição visual.
{{evitar}}`;

type VarSpec = Record<string, [string, boolean]>; // nome -> [descrição, obrigatória]

export const KINDS: Record<string, { label: string; description: string; default: string; variables: VarSpec }> = {
  native: {
    label: "Carrossel com modelos do brand book",
    description: "Prompt de sistema usado quando a IA escreve o carrossel escolhendo entre os modelos de slide do brand book.",
    default: DEFAULT_NATIVE,
    variables: {
      marca: ["Nome da marca", false],
      handle: ["@ da marca", false],
      regras: ["Regras de escrita do brand book (uma por linha)", false],
      estrutura: ["Quantidade de slides e papel de cada um (capa, miolo, CTA), calculado na hora", false],
      arquetipo: ["Estrutura narrativa escolhida (educativo, narrativa, lista...)", false],
      modelos: ["Catálogo real dos modelos de slide do brand book, com campos e limites de caracteres", true],
      formato_resposta: ["O JSON que o app sabe ler. Se você tirar, ele é acrescentado ao final", false],
    },
  },
  image_text: {
    label: "Carrossel Imagem e Texto",
    description: "Prompt de sistema do carrossel de foto em tela cheia com headline e subheadline.",
    default: DEFAULT_IMAGE_TEXT,
    variables: {
      marca: ["Nome da marca", false],
      handle: ["@ da marca", false],
      regras: ["Regras de escrita do brand book (uma por linha)", false],
      estrutura: ["Quantidade de slides e papel de cada um, calculado na hora", false],
      arquetipo: ["Estrutura narrativa escolhida", false],
      limites: ["Limite de caracteres de headline e subheadline do modelo", false],
      pessoa: ["Mapa da pessoa escolhida (aparência, estilo, cenários, tom)", false],
      formato_resposta: ["O JSON que o app sabe ler. Se você tirar, ele é acrescentado ao final", false],
    },
  },
  image_scene: {
    label: "Imagem da pessoa (geração de foto)",
    description: "Prompt enviado ao gerador de imagens junto com as fotos de referência da pessoa.",
    default: DEFAULT_IMAGE_SCENE,
    variables: {
      pessoa: ["Mapa da pessoa montado a partir do perfil (aparência, estilo, expressão)", true],
      referencias: ["Instrução para manter o rosto quando há fotos de referência (vazio se não houver)", false],
      cena: ["A cena pedida (digitada por você ou sugerida pela IA no carrossel)", true],
      evitar: ["O que evitar, vindo do campo 'Evitar' da pessoa", false],
    },
  },
};

interface PromptEntry { global?: string | null; brandbooks?: Record<string, string> }
type PromptStore = Record<string, PromptEntry>;

export class PromptError extends Error {}

async function load(userId: number): Promise<PromptStore> {
  const row = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "prompts" } });
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

async function persist(userId: number, data: PromptStore): Promise<void> {
  const existing = await prisma.carouselSetting.findFirst({ where: { user_id: userId, key: "prompts" } });
  const value = JSON.stringify(data);
  if (existing) await prisma.carouselSetting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.carouselSetting.create({ data: { user_id: userId, key: "prompts", value } });
}

export async function resolvePrompt(userId: number, kind: string, brandbookId?: string | null): Promise<{ text: string; source: string }> {
  const entry = (await load(userId))[kind] || {};
  if (brandbookId && entry.brandbooks?.[brandbookId]) return { text: entry.brandbooks[brandbookId], source: "brandbook" };
  if (entry.global) return { text: entry.global, source: "global" };
  return { text: KINDS[kind].default, source: "default" };
}

export function variablesInfo(kind: string) {
  return Object.entries(KINDS[kind].variables).map(([name, [description, required]]) => ({ name, description, required }));
}

export async function overview(userId: number) {
  const data = await load(userId);
  const out: Record<string, any> = {};
  for (const [kind, meta] of Object.entries(KINDS)) {
    const entry = data[kind] || {};
    out[kind] = {
      label: meta.label, description: meta.description, default: meta.default, variables: variablesInfo(kind),
      global: entry.global ?? null, brandbooks: entry.brandbooks || {},
    };
  }
  return out;
}

/** Devolve avisos; lança PromptError se o texto não pode ser salvo. */
export function validatePrompt(kind: string, text: string): string[] {
  const names = [...text.matchAll(VAR_RE)].map((m) => m[1]);
  const known = KINDS[kind].variables;
  const unknown = [...new Set(names.filter((n) => !(n in known)))].sort();
  if (unknown.length) {
    throw new PromptError(`Variáveis desconhecidas: ${unknown.map((n) => `{{${n}}}`).join(", ")}. Use só as variáveis listadas ao lado.`);
  }
  const missing = Object.entries(known).filter(([n, [, req]]) => req && !names.includes(n)).map(([n]) => n);
  if (missing.length) throw new PromptError(`O prompt precisa conter: ${missing.map((n) => `{{${n}}}`).join(", ")}.`);
  if (text.trim().length < 40) throw new PromptError("O prompt está curto demais.");
  const warnings: string[] = [];
  if ("formato_resposta" in known && !names.includes("formato_resposta")) {
    warnings.push("{{formato_resposta}} não está no texto: o app vai acrescentar o formato JSON ao final.");
  }
  return warnings;
}

/** scope: 'global' ou id da marca. text vazio = volta ao padrão daquele escopo. */
export async function savePrompt(userId: number, kind: string, scope: string, text?: string | null): Promise<string[]> {
  if (!KINDS[kind]) throw new PromptError("Tipo de prompt desconhecido.");
  const clean = (text || "").trim() || null;
  const warnings = clean ? validatePrompt(kind, clean) : [];
  const data = await load(userId);
  const entry = (data[kind] = data[kind] || {});
  if (scope === "global") entry.global = clean;
  else {
    entry.brandbooks = entry.brandbooks || {};
    if (clean) entry.brandbooks[scope] = clean;
    else delete entry.brandbooks[scope];
  }
  await persist(userId, data);
  return warnings;
}

/** Preenche as variáveis do prompt (em uso, ou o `text` informado, para pré-visualização). */
export async function renderPrompt(
  userId: number, kind: string, brandbookId: string | null, values: Record<string, string>, text?: string | null,
): Promise<string> {
  let body = text ?? (await resolvePrompt(userId, kind, brandbookId)).text;
  const has = [...body.matchAll(VAR_RE)].some((m) => m[1] === "formato_resposta");
  if ("formato_resposta" in KINDS[kind].variables && !has) body = `${body.trimEnd()}\n\n{{formato_resposta}}`;
  return body.replace(VAR_RE, (_m, name) => String(values[name] ?? ""));
}
