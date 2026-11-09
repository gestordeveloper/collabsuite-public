/**
 * Números por extenso em português do Brasil, para o texto que vai à locução.
 *
 * A legenda do vídeo mantém o texto como foi escrito ("R$ 1.500,50", "30%"); só a narração recebe `speak()`, que troca
 * os números por palavras: dinheiro ganha "reais" (e "centavos"), percentuais ganham "por cento", horas ganham "horas".
 */
const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
  "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
const SCALES: [number, string, string][] = [[1e9, "bilhão", "bilhões"], [1e6, "milhão", "milhões"]];
const FEMININE = new Set(["hora", "horas", "vez", "vezes", "pessoa", "pessoas", "semana", "semanas", "mulher", "mulheres", "casa", "casas",
  "empresa", "empresas", "cliente", "clientes", "venda", "vendas", "conta", "contas", "mensagem", "mensagens", "parcela", "parcelas",
  "noite", "noites", "foto", "fotos", "ligação", "ligações", "página", "páginas", "loja", "lojas", "história", "histórias", "mil"]);
const ORDINALS_M = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];
const ORDINALS_F = ["", "primeira", "segunda", "terceira", "quarta", "quinta", "sexta", "sétima", "oitava", "nona", "décima"];

function below1000(n: number, fem = false): string {
  if (n < 20) return fem && (n === 1 || n === 2) ? (n === 1 ? "uma" : "duas") : UNITS[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return TENS[t] + (u ? ` e ${below1000(u, fem)}` : "");
  }
  if (n === 100) return "cem";
  const h = Math.floor(n / 100);
  const r = n % 100;
  let word = HUNDREDS[h];
  if (fem && h >= 2) word = `${word.slice(0, -2)}as`;
  return word + (r ? ` e ${below1000(r, fem)}` : "");
}

export function cardinal(n: number, fem = false): string {
  if (n === 0) return "zero";
  const parts: [number, string][] = [];
  let rest = n;
  for (const [size, sing, plur] of SCALES) {
    const q = Math.floor(rest / size);
    rest %= size;
    if (q) parts.push([q, `${cardinal(q)} ${q === 1 ? sing : plur}`]);
  }
  const q = Math.floor(rest / 1000);
  rest %= 1000;
  if (q) parts.push([q, q === 1 ? "mil" : `${below1000(q, fem)} mil`]);
  if (rest) parts.push([rest, below1000(rest, fem)]);
  let out = parts[0][1];
  for (const [value, text] of parts.slice(1)) out += (value < 100 || value % 100 === 0 ? " e " : " ") + text;
  return out;
}

const toInt = (s: string) => parseInt(s.replace(/\./g, ""), 10);
const digits = (s: string) => [...s].filter((c) => /\d/.test(c)).map((c) => UNITS[parseInt(c, 10)]).join(" ");

function decimalPart(frac: string): string {
  if (frac.startsWith("0") || frac.length > 2) {
    const rest = frac.replace(/^0+/, "");
    const lead = frac.length - rest.length;
    return [...Array(lead).fill("zero"), ...(rest ? (rest.length <= 2 ? [cardinal(parseInt(rest, 10))] : [digits(rest)]) : [])].join(" ");
  }
  return cardinal(parseInt(frac, 10));
}

function money(whole: number, cents: number, scale = ""): string {
  if (scale) { // "R$ 2 milhões" -> "dois milhões de reais"; "R$ 3 mil" -> "três mil reais"
    const low = scale.toLowerCase();
    if (low === "mil") return `${whole === 1 ? "mil" : `${cardinal(whole, true)} mil`} reais`;
    const [sing, plur] = low.startsWith("milh") ? ["milhão", "milhões"] : ["bilhão", "bilhões"];
    return `${cardinal(whole)} ${whole === 1 ? sing : plur} de reais`;
  }
  const parts: string[] = [];
  if (whole || !cents) {
    const de = whole >= 1e6 && whole % 1e6 === 0 ? " de" : "";
    parts.push(`${cardinal(whole)}${de} ${whole === 1 ? "real" : "reais"}`);
  }
  if (cents) parts.push(`${cardinal(cents)} ${cents === 1 ? "centavo" : "centavos"}`);
  return parts.join(" e ");
}

const NUM = String.raw`\d{1,3}(?:\.\d{3})+|\d+`;
const SCALE = String.raw`(?:\s+(mil|milhão|milhao|milhões|milhoes|bilhão|bilhao|bilhões|bilhoes)\b)?`;
const RE_MONEY = new RegExp(String.raw`R\$\s*(${NUM})(?:,(\d{1,2}))?${SCALE}`, "gi");
const RE_REAIS = new RegExp(String.raw`(?<![\w])(${NUM})(?:,(\d{2}))?\s+reais\b`, "gi");
const RE_PERCENT = new RegExp(String.raw`(${NUM})(?:,(\d+))?\s*%`, "g");
const RE_TIME = /(?<![\w])(\d{1,2})\s?h(?:\s?(\d{2}))?(?![\w])/g;
const RE_ORD = /(?<![\w])(\d{1,2})\s?([ºª°])/g;
const RE_DECIMAL = new RegExp(String.raw`(?<![\w])(${NUM}),(\d+)(?![\w])`, "g");
const RE_INT = new RegExp(String.raw`(?<![\w,.])(${NUM})(?![\w]|,\d)`, "g");

const nextWord = (text: string, pos: number) => (/^\s+([A-Za-zÀ-ÿ]+)/.exec(text.slice(pos))?.[1] || "").toLowerCase();

/** Troca os números do texto por extenso (pt-BR) para a locução. */
export function speak(input: string): string {
  if (!input || !/\d/.test(input)) return input;
  let text = input;

  text = text.replace(RE_MONEY, (_m, whole, cents, scale) => money(toInt(whole), cents ? parseInt(cents.padEnd(2, "0"), 10) : 0, scale || ""));
  text = text.replace(RE_REAIS, (_m, whole, cents) => money(toInt(whole), cents ? parseInt(cents, 10) : 0));
  text = text.replace(RE_PERCENT, (_m, whole, frac) => `${cardinal(toInt(whole))}${frac ? ` vírgula ${decimalPart(frac)}` : ""} por cento`);
  text = text.replace(RE_TIME, (_m, h, min) => {
    const hh = parseInt(h, 10);
    return `${cardinal(hh, true)} ${hh === 1 ? "hora" : "horas"}${min && parseInt(min, 10) ? ` e ${cardinal(parseInt(min, 10))}` : ""}`;
  });
  text = text.replace(RE_ORD, (_m, n, mark) => {
    const k = parseInt(n, 10);
    return k >= 1 && k <= 10 ? (mark === "ª" ? ORDINALS_F : ORDINALS_M)[k] : cardinal(k, mark === "ª");
  });
  text = text.replace(RE_DECIMAL, (_m, whole, frac) => `${cardinal(toInt(whole))} vírgula ${decimalPart(frac)}`);
  const snapshot = text;
  return text.replace(RE_INT, (m: string, raw: string, offset: number) => {
    if (!raw.includes(".") && (raw.length > 9 || (raw.length > 1 && raw.startsWith("0")))) return digits(raw); // telefone, código, documento
    const n = toInt(raw);
    if (n > 1e12) return digits(raw);
    return cardinal(n, FEMININE.has(nextWord(snapshot, offset + m.length)));
  });
}
