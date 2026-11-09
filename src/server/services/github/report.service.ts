/**
 * Relatório de atualizações: lê os commits do período no GitHub, pede à IA (chaves já configuradas em
 * Configurações > Integrações) um texto em linguagem simples, agrupado por tema, e monta o PDF.
 */
import PDFDocument from "pdfkit";
import { HttpError } from "../../lib/httpError";
import { requireCfg, chat, AIGenerationError, CONTEXT_LIMIT_CHARS, type AiCfg } from "../carrossel/aiClient";
import * as repo from "./repo.service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
// Datas escolhidas na tela são do horário de Brasília.
const TZ = "-03:00";

export interface ReportInput {
  since: string;
  until: string;
  branch?: string;
  provider?: string;
  model?: string;
}

interface Entry { date: string; subject: string }

const SKIP_RE = /rebuild do frontend|build do frontend|vue-build|^merge\b/i;
const VERSION_RE = /^chore(\([^)]*\))?:\s*release\b.*?(\d+\.\d+\.\d+)/i;

const subjectOf = (message: string) => message.split(/\r?\n/)[0].trim();
const brDate = (d: string) => d.split("-").reverse().join("/");
const dayOf = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : "");

const versionCmp = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

function validateRange(input: ReportInput) {
  if (!DATE_RE.test(input.since ?? "") || !DATE_RE.test(input.until ?? "")) throw new HttpError("Informe a data inicial e a final.");
  const a = new Date(`${input.since}T00:00:00Z`).getTime();
  const b = new Date(`${input.until}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) throw new HttpError("Data inválida.");
  if (b < a) throw new HttpError("A data final não pode ser antes da inicial.");
  if ((b - a) / 86400_000 > MAX_DAYS) throw new HttpError(`Escolha um período de até ${MAX_DAYS} dias.`);
}

// ─── IA ─────────────────────────────────────────────────────────────────────────

const STYLE_RULES = `REGRAS DE LINGUAGEM (obrigatórias):
- Escreva em português do Brasil, para gestores e equipe SEM conhecimento técnico (nível de uma criança abaixo da 5ª série).
- Frases curtas. Uma ideia por frase. Palavras do dia a dia.
- Troque o jargão: "dashboard" vira "painel"; "refactor" vira "arrumação interna"; build, deploy, payload, endpoint, API, migration, cache etc. NÃO devem aparecer: diga "ajustes internos".
- Diga o BENEFÍCIO, não a técnica: "agora dá para...", "ficou mais fácil...". Explique entre parênteses o que for difícil.
- NÃO invente funções que não aparecem nos commits. Se um commit for vago, resuma de forma geral ou junte com outro.
- NÃO cite códigos de tarefa, hashes, nomes de arquivos, de classes ou de pessoas.
- Sem emojis e sem caracteres especiais fora do português comum.`;

function listing(entries: Entry[]) {
  return entries.map((e) => `- ${e.subject}`).join("\n");
}

function chunkEntries(entries: Entry[], limit: number): Entry[][] {
  const chunks: Entry[][] = [];
  let cur: Entry[] = [];
  let size = 0;
  for (const e of entries) {
    const len = e.subject.length + 3;
    if (cur.length && size + len > limit) { chunks.push(cur); cur = []; size = 0; }
    cur.push(e);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function ask(cfg: AiCfg, system: string, user: string, maxTokens: number) {
  const { text } = await chat(cfg, system, [{ role: "user", content: user }], maxTokens, { json: false, effort: "low" });
  const out = text.trim();
  if (!out) throw new AIGenerationError("A IA não devolveu texto. Tente novamente.");
  return out;
}

async function writeMarkdown(cfg: AiCfg, ctx: {
  projectName: string; since: string; until: string; entries: Entry[];
  versions: { count: number; first: string | null; last: string | null }; features: number; fixes: number;
}): Promise<string> {
  const limit = CONTEXT_LIMIT_CHARS[cfg.provider];
  let material: string;
  const chunks = chunkEntries(ctx.entries, limit);
  if (chunks.length === 1) {
    material = listing(ctx.entries);
  } else {
    // Muitos commits para um pedido só: resume cada bloco em temas e junta tudo no pedido final.
    const parts: string[] = [];
    for (const c of chunks) {
      parts.push(await ask(cfg,
        `Você resume lista de mudanças de um sistema. ${STYLE_RULES}\nDevolva só tópicos "- " curtos, agrupados por tema (uma linha de tema em **negrito** antes de cada grupo). Não perca nenhuma mudança relevante.`,
        `Mudanças:\n${listing(c)}`, 3500));
    }
    material = parts.join("\n\n");
  }

  const total = ctx.entries.length;
  const versionLine = ctx.versions.count > 0
    ? `O sistema foi atualizado ${ctx.versions.count} vezes (da versão ${ctx.versions.first} até a ${ctx.versions.last}).`
    : "Não há versões numeradas no período; não cite versões.";

  const system = `Você escreve relatórios de atualizações de um sistema. ${STYLE_RULES}

FORMATO (use SOMENTE este Markdown):
# Relatório de Novidades do <nome>
**De DD/MM/AAAA até DD/MM/AAAA**
(parágrafo de abertura curto com o número de versões e de mudanças)
---
## 1. <Tema>
- item com **negrito** nas palavras-chave
(demais seções numeradas; agrupe por TEMA, não por data; crie ou junte temas conforme as mudanças; sub-itens só com "  - ")
---
## Resumo em números
| O que | Quantidade |
|---|---|
(linhas da tabela)
---
**Conclusão:** uma ou duas frases sobre os maiores destaques.

Não use outro formato (nada de blocos de código, links ou imagens). Devolva apenas o Markdown.`;

  const user = `Nome do projeto: ${ctx.projectName}
Período: de ${brDate(ctx.since)} até ${brDate(ctx.until)}
Total de mudanças: ${total}
${versionLine}
Coisas novas (commits "feature"/"feat"): cerca de ${ctx.features}
Coisas consertadas (commits "fix"): cerca de ${ctx.fixes}
Arrumações internas: o resto

Na tabela "Resumo em números" use estas linhas: ${ctx.versions.count > 0 ? '"Versões novas lançadas", ' : ""}"Mudanças feitas", "Coisas novas", "Coisas consertadas", "Arrumações internas". Para novas/consertadas diga "cerca de" (é uma estimativa).

Mudanças do período:
${material}`;

  return ask(cfg, system, user, 6000);
}

// ─── PDF ────────────────────────────────────────────────────────────────────────

const BLUE = "#1f4e8c";
const DARK = "#222222";
const GREY = "#666666";
const LINE = "#cfd6df";

/** pdfkit só tem as fontes padrão (WinAnsi): troca o que ela não desenha por equivalentes simples. */
function sanitize(t: string): string {
  return t
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/ /g, " ")
    .replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, "")
    .replace(/`/g, "");
}

type Run = { text: string; bold: boolean };
function runsOf(t: string): Run[] {
  return sanitize(t).split("**").map((text, i) => ({ text, bold: i % 2 === 1 })).filter((r) => r.text);
}

export function buildReportPdf(markdown: string, footerTitle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 64, left: 56, right: 56 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    /** Texto com trechos em negrito: quebra linhas por palavra (o `continued` do pdfkit perde o fluxo ao trocar de fonte). */
    const writeRuns = (t: string, opts: { size: number; color?: string; x?: number; w?: number; gap?: number; allBold?: boolean }) => {
      const x0 = opts.x ?? left;
      const w = opts.w ?? width;
      const gap = opts.gap ?? 2;
      const fontOf = (bold: boolean) => (bold || opts.allBold ? "Helvetica-Bold" : "Helvetica");
      const words: { text: string; bold: boolean; space: boolean }[] = [];
      for (const r of runsOf(t)) {
        const parts = r.text.split(/(\s+)/).filter((p) => p !== "");
        for (const p of parts) {
          if (/^\s+$/.test(p)) { if (words.length) words[words.length - 1].space = true; }
          else if (words.length && !words[words.length - 1].space && words[words.length - 1].bold === r.bold) words[words.length - 1].text += p;
          else words.push({ text: p, bold: r.bold, space: false });
        }
      }
      if (!words.length) { doc.moveDown(0.3); return; }
      const lineH = opts.size * 1.2 + gap;
      let x = x0;
      if (doc.y + lineH > bottom()) doc.addPage();
      let y = doc.y;
      for (const wd of words) {
        doc.font(fontOf(wd.bold)).fontSize(opts.size);
        const ww = doc.widthOfString(wd.text);
        const sp = doc.widthOfString(" ");
        if (x > x0 && x + ww > x0 + w) {
          x = x0;
          y += lineH;
          if (y + lineH > bottom()) { doc.addPage(); y = doc.y; }
        }
        doc.fillColor(opts.color ?? DARK).text(wd.text, x, y, { lineBreak: false });
        x += ww + (wd.space ? sp : 0);
      }
      doc.x = left;
      doc.y = y + lineH;
    };

    const lines = markdown.replace(/\r/g, "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trimEnd();
      if (!line.trim()) continue;

      if (/^-{3,}$/.test(line.trim())) {
        doc.moveDown(0.4);
        doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.7).strokeColor(LINE).stroke();
        doc.moveDown(0.7);
        continue;
      }
      if (line.startsWith("# ")) {
        if (doc.y + 60 > bottom()) doc.addPage();
        writeRuns(line.slice(2), { size: 22, color: BLUE, allBold: true, gap: 3 });
        doc.moveDown(0.3);
        continue;
      }
      if (line.startsWith("## ")) {
        if (doc.y + 70 > bottom()) doc.addPage();
        doc.moveDown(0.6);
        writeRuns(line.slice(3), { size: 15, color: BLUE, allBold: true });
        doc.moveDown(0.3);
        continue;
      }
      if (line.startsWith("### ")) {
        doc.moveDown(0.3);
        writeRuns(line.slice(4), { size: 12, color: BLUE, allBold: true });
        doc.moveDown(0.2);
        continue;
      }
      if (line.trim().startsWith("|")) {
        // junta todas as linhas da tabela
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        i--;
        drawTable(rows);
        continue;
      }
      const bullet = /^(\s*)[-*]\s+(.*)$/.exec(raw);
      if (bullet) {
        const level = Math.min(2, Math.floor(bullet[1].length / 2));
        const indent = 14 + level * 16;
        if (doc.y + 24 > bottom()) doc.addPage();
        const y = doc.y;
        doc.font("Helvetica").fontSize(11).fillColor(level ? GREY : BLUE).text(level ? "-" : "•", left + indent - 12, y, { lineBreak: false });
        doc.y = y;
        writeRuns(bullet[2], { size: 11, x: left + indent, w: width - indent, gap: 2.5 });
        doc.moveDown(0.25);
        continue;
      }
      writeRuns(line, { size: 11, gap: 3 });
      doc.moveDown(0.4);
    }

    function drawTable(rows: string[][]) {
      if (!rows.length) return;
      const cols = Math.max(...rows.map((r) => r.length));
      const colW = [width * (cols === 2 ? 0.62 : 1 / cols), ...Array(cols - 1).fill(width * (cols === 2 ? 0.38 : 1 / cols))];
      doc.moveDown(0.3);
      rows.forEach((cells, ri) => {
        const heights = cells.map((c, ci) => {
          doc.font(ri === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(11);
          return doc.heightOfString(sanitize(c).replace(/\*\*/g, ""), { width: colW[ci] - 16 });
        });
        const h = Math.max(...heights) + 12;
        if (doc.y + h > bottom()) doc.addPage();
        const y = doc.y;
        let x = left;
        cells.forEach((c, ci) => {
          doc.rect(x, y, colW[ci], h).fillAndStroke(ri === 0 ? BLUE : ri % 2 ? "#f4f7fb" : "#ffffff", LINE);
          doc.font(ri === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(11).fillColor(ri === 0 ? "#ffffff" : DARK)
            .text(sanitize(c).replace(/\*\*/g, ""), x + 8, y + 6, { width: colW[ci] - 16, lineBreak: true });
          x += colW[ci];
        });
        doc.y = y + h;
      });
      doc.moveDown(0.6);
    }

    // rodapé com numeração em todas as páginas
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // sem isso o texto do rodapé abre uma página nova
      doc.font("Helvetica").fontSize(9).fillColor(GREY);
      doc.text(sanitize(footerTitle), left, doc.page.height - 40, { width: width - 80, lineBreak: false });
      doc.text(`Página ${p + 1} de ${range.count}`, left + width - 80, doc.page.height - 40, { width: 80, align: "right", lineBreak: false });
      doc.page.margins.bottom = oldBottom;
    }
    doc.end();
  });
}

// ─── orquestração ───────────────────────────────────────────────────────────────

export async function generateReport(userId: number, companyId: number | null, projectId: number, input: ReportInput) {
  validateRange(input);
  const project = await repo.assertMember(userId, projectId);
  const ctx = await repo.context(userId, projectId);

  const { commits, truncated } = await repo.listCommitsInRange(ctx, {
    since: new Date(`${input.since}T00:00:00${TZ}`).toISOString(),
    until: new Date(`${input.until}T23:59:59${TZ}`).toISOString(),
    sha: input.branch || undefined,
  });

  const entries: Entry[] = [];
  const versionList: string[] = [];
  for (const c of commits) {
    const subject = subjectOf(c.message);
    if (!subject) continue;
    const v = VERSION_RE.exec(subject);
    if (v) { versionList.push(v[2]); continue; }
    if (SKIP_RE.test(subject)) continue;
    entries.push({ date: dayOf(c.date), subject: subject.slice(0, 220) });
  }
  if (!entries.length) {
    throw new HttpError("Não há mudanças nesse período. Escolha outras datas (ou outra branch).", 404);
  }

  const sorted = [...versionList].sort(versionCmp);
  const features = entries.filter((e) => /^(feat|feature)(\([^)]*\))?!?:/i.test(e.subject)).length;
  const fixes = entries.filter((e) => /^fix(\([^)]*\))?!?:/i.test(e.subject)).length;

  const cfg = await requireCfg(userId, companyId, input.provider, input.model);
  const markdown = await writeMarkdown(cfg, {
    projectName: project.name, since: input.since, until: input.until, entries,
    versions: { count: sorted.length, first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null },
    features, fixes,
  });

  const footer = `Relatório de Novidades - ${project.name} - ${brDate(input.since)} a ${brDate(input.until)}`;
  const pdf = await buildReportPdf(markdown, footer);
  const slug = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "projeto";

  return {
    filename: `relatorio-${slug}-${input.since}_a_${input.until}.pdf`,
    markdown,
    pdf_base64: pdf.toString("base64"),
    total_changes: entries.length,
    truncated,
    provider: cfg.provider,
    model: cfg.model,
  };
}
