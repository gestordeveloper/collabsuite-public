import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { SUPPORTED_IMAGE_MIME_TYPES, type SupportedImageMimeType } from "./ai-providers/types";

export type AttachmentKind = "image" | "text-document" | "unsupported";

const SPREADSHEET_EXTENSIONS = ["xlsx", "xls", "csv"];
const TEXT_EXTENSIONS = ["txt", "md"];

const MAX_EXTRACTED_CHARS = 20000;
const TRUNCATION_NOTICE = "\n\n[conteúdo truncado — o arquivo é maior do que o limite analisado]";

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isSupportedImageMime(mimeType: string): mimeType is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function classifyAttachment(mimeType: string, filename: string): AttachmentKind {
  if (isSupportedImageMime(mimeType)) return "image";
  if (mimeType.startsWith("image/")) return "unsupported"; // e.g. HEIC/SVG — not accepted by any provider here

  const ext = extOf(filename);
  if (mimeType === "application/pdf" || ext === "pdf") return "text-document";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  )
    return "text-document";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "text/csv" ||
    SPREADSHEET_EXTENSIONS.includes(ext)
  )
    return "text-document";
  if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.includes(ext)) return "text-document";

  return "unsupported";
}

function truncateText(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return text.slice(0, MAX_EXTRACTED_CHARS) + TRUNCATION_NOTICE;
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractFromSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `### Planilha: ${sheetName}\n${csv}`;
  }).join("\n\n");
}

/** Reads the actual content of an uploaded document/spreadsheet into plain text so it can be
 *  dropped straight into a chat message as extra context — used only for non-image attachments;
 *  images go through the provider's vision content blocks instead (see ai-providers/types.ts). */
export async function extractTextFromDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  opts: { full?: boolean } = {}
): Promise<string> {
  const truncate = opts.full ? (t: string) => t : truncateText;
  const ext = extOf(filename);

  if (mimeType === "application/pdf" || ext === "pdf") {
    return truncate(await extractFromPdf(buffer));
  }
  if (mimeType.includes("wordprocessingml") || ext === "docx") {
    return truncate(await extractFromDocx(buffer));
  }
  if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel" || ["xlsx", "xls"].includes(ext)) {
    return truncate(extractFromSpreadsheet(buffer));
  }
  if (mimeType === "text/csv" || ext === "csv") {
    // XLSX.read also happily parses raw CSV bytes, keeping one code path for every tabular format.
    return truncate(extractFromSpreadsheet(buffer));
  }
  // Plain text / markdown / anything else classified as "text-document".
  return truncate(buffer.toString("utf-8"));
}
