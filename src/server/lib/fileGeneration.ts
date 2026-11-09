import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import * as XLSX from "xlsx";

export type GeneratedFileFormat = "pdf" | "docx" | "xlsx" | "txt" | "md";

export interface GeneratedFile {
  buffer: Buffer;
  ext: string;
  mimeType: string;
}

/** Very small markdown-ish line classifier shared by the PDF/DOCX builders — just enough to make
 *  an agent's generated report look like a document (headings, bullets, bold) without pulling in
 *  a full markdown renderer for what is, in practice, short text/report content. */
interface ParsedLine {
  kind: "h1" | "h2" | "bullet" | "paragraph" | "blank";
  text: string;
}

function parseLines(content: string): ParsedLine[] {
  return content.split(/\r?\n/).map((raw) => {
    const line = raw.trimEnd();
    if (line.trim() === "") return { kind: "blank", text: "" };
    if (line.startsWith("## ")) return { kind: "h2", text: line.slice(3).trim() };
    if (line.startsWith("# ")) return { kind: "h1", text: line.slice(2).trim() };
    if (line.startsWith("- ") || line.startsWith("* ")) return { kind: "bullet", text: line.slice(2).trim() };
    return { kind: "paragraph", text: line.trim() };
  });
}

function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

export function buildPdfBuffer(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const line of parseLines(content)) {
      switch (line.kind) {
        case "h1":
          doc.moveDown(0.5).fontSize(20).font("Helvetica-Bold").text(stripBold(line.text));
          break;
        case "h2":
          doc.moveDown(0.5).fontSize(15).font("Helvetica-Bold").text(stripBold(line.text));
          break;
        case "bullet":
          doc.fontSize(11).font("Helvetica").text(`•  ${stripBold(line.text)}`, { indent: 15 });
          break;
        case "blank":
          doc.moveDown(0.5);
          break;
        default:
          doc.fontSize(11).font("Helvetica").text(stripBold(line.text));
      }
    }

    doc.end();
  });
}

export async function buildDocxBuffer(content: string): Promise<Buffer> {
  const children: Paragraph[] = parseLines(content).map((line) => {
    switch (line.kind) {
      case "h1":
        return new Paragraph({ text: stripBold(line.text), heading: HeadingLevel.HEADING_1 });
      case "h2":
        return new Paragraph({ text: stripBold(line.text), heading: HeadingLevel.HEADING_2 });
      case "bullet":
        return new Paragraph({ text: stripBold(line.text), bullet: { level: 0 } });
      case "blank":
        return new Paragraph({ children: [] });
      default:
        return new Paragraph({ children: [new TextRun(stripBold(line.text))] });
    }
  });

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

/** `content` for xlsx must be a JSON string: either an array of arrays (rows/columns) or an
 *  array of objects (first row becomes the header) — the tool description tells the model this. */
export function buildXlsxBuffer(jsonContent: string): Buffer {
  let rows: unknown;
  try {
    rows = JSON.parse(jsonContent);
  } catch {
    throw new Error('Conteúdo inválido para planilha: esperado um JSON de array de arrays ou array de objetos em "content".');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Conteúdo da planilha vazio ou em formato inesperado.");
  }

  const isAoa = Array.isArray(rows[0]);
  const sheet = isAoa ? XLSX.utils.aoa_to_sheet(rows as unknown[][]) : XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Planilha1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildTextBuffer(content: string): Buffer {
  return Buffer.from(content, "utf-8");
}

const FORMAT_META: Record<GeneratedFileFormat, { ext: string; mimeType: string }> = {
  pdf: { ext: "pdf", mimeType: "application/pdf" },
  docx: { ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { ext: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  txt: { ext: "txt", mimeType: "text/plain" },
  md: { ext: "md", mimeType: "text/markdown" },
};

export async function buildGeneratedFile(format: GeneratedFileFormat, content: string): Promise<GeneratedFile> {
  const meta = FORMAT_META[format];
  let buffer: Buffer;
  switch (format) {
    case "pdf":
      buffer = await buildPdfBuffer(content);
      break;
    case "docx":
      buffer = await buildDocxBuffer(content);
      break;
    case "xlsx":
      buffer = buildXlsxBuffer(content);
      break;
    default:
      buffer = buildTextBuffer(content);
  }
  return { buffer, ext: meta.ext, mimeType: meta.mimeType };
}
