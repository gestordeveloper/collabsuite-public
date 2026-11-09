import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import multer from "multer";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function extFromMime(mimeType: string): string {
  return mimeType.startsWith("application/")
    ? mimeType.split("/")[1]?.replace("vnd.openxmlformats-officedocument.wordprocessingml.document", "docx").replace("vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx").replace("vnd.openxmlformats-officedocument.presentationml.presentation", "pptx").replace("vnd.ms-excel", "xls").replace("vnd.ms-word", "doc").replace("vnd.ms-powerpoint", "ppt") || "bin"
    : (mimeType.split("/")[1]?.replace("svg+xml", "svg") || "bin");
}

/** Persists a file buffer to S3 (if configured) or local disk, and returns its public URL. */
export async function storeBuffer(buffer: Buffer, ext: string, mimeType: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;

  const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;

  if (AWS_S3_BUCKET && AWS_S3_REGION && AWS_S3_KEY && AWS_S3_SECRET) {
    const s3 = new S3Client({
      region: AWS_S3_REGION,
      credentials: {
        accessKeyId: AWS_S3_KEY,
        secretAccessKey: AWS_S3_SECRET,
      },
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: mimeType,
        // Removed ACL: "public-read" as many buckets disable ACLs.
        // The bucket should be configured with a bucket policy for public access.
      })
    );

    return `https://${AWS_S3_BUCKET}.s3.${AWS_S3_REGION}.amazonaws.com/${filename}`;
  }

  // Fallback to local
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

export async function uploadImage(req: Request, res: Response) {
  try {
    const { image } = req.body;
    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "No file provided" });
    }

    const base64Idx = image.indexOf(";base64,");
    if (base64Idx === -1) {
      return res.status(400).json({ error: "Invalid file format: no base64 data" });
    }

    const mimeType = image.slice(5, base64Idx) || "application/octet-stream";
    const base64Data = image.slice(base64Idx + 8);
    const buffer = Buffer.from(base64Data, "base64");

    const url = await storeBuffer(buffer, extFromMime(mimeType), mimeType);
    res.json({ url });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
}

// Large binary uploads (e.g. meeting-recording audio) go through multipart/form-data instead of
// the base64-in-JSON path above: a long recording easily blows past express.json's 50mb body
// limit once base64's ~33% size overhead is added, and the FileReader().readAsDataURL() step on
// the client is slow and memory-heavy for tens of megabytes. That combination is what made
// meeting recordings silently fail to attach — the file could still land in S3 (the PUT itself
// is comparatively small and fast) while the surrounding request stalled or got rejected before
// a response came back, so the follow-up "create attachment" call never ran. Multer streams the
// upload straight from the multipart body with its own size limit, independent of express.json.
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
export const uploadFileMiddleware = memoryUpload.single("file");

export async function uploadFile(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const nameExt = path.extname(file.originalname).replace(/^\./, "");
    const ext = nameExt || extFromMime(file.mimetype);
    const mimeType = file.mimetype || "application/octet-stream";

    const url = await storeBuffer(file.buffer, ext, mimeType);
    res.json({ url, size: file.size, type: mimeType });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------------------------
// Upload em partes (chunked). Um único POST com o arquivo inteiro estoura o timeout / limite de
// corpo do proxy reverso (502 Bad Gateway) em arquivos pesados. O cliente fatia o arquivo em
// pedaços pequenos; cada um vira uma requisição curta. No fim, o servidor concatena os pedaços
// em disco (streaming, sem carregar tudo na memória) e envia ao S3 / pasta local.
// ---------------------------------------------------------------------------------------------
const CHUNK_ROOT = path.join(os.tmpdir(), "collabsuite-chunked-uploads");
const MAX_CHUNKED_SIZE = 5 * 1024 * 1024 * 1024; // 5GB (limite do PutObject único)
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const STALE_MS = 6 * 60 * 60 * 1000;

interface ChunkSession {
  userId: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
}
const chunkSessions = new Map<string, ChunkSession>();

function sessionDir(id: string) {
  return path.join(CHUNK_ROOT, id);
}

async function removeDir(dir: string) {
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function sweepStaleSessions() {
  const now = Date.now();
  for (const [id, s] of chunkSessions) {
    if (now - s.createdAt > STALE_MS) {
      chunkSessions.delete(id);
      await removeDir(sessionDir(id));
    }
  }
  // Diretórios órfãos (ex.: servidor reiniciou no meio de um upload)
  const entries = await fs.promises.readdir(CHUNK_ROOT).catch(() => [] as string[]);
  for (const name of entries) {
    if (chunkSessions.has(name)) continue;
    const st = await fs.promises.stat(path.join(CHUNK_ROOT, name)).catch(() => null);
    if (st && now - st.mtimeMs > STALE_MS) await removeDir(path.join(CHUNK_ROOT, name));
  }
}

function getSession(req: Request, res: Response): { id: string; s: ChunkSession } | null {
  const id = String(req.params.uploadId || "");
  const s = chunkSessions.get(id);
  if (!s || s.userId !== (req as any).user?.id) {
    res.status(404).json({ error: "Upload session not found" });
    return null;
  }
  return { id, s };
}

export async function initChunkedUpload(req: Request, res: Response) {
  try {
    const { filename, type, size } = req.body || {};
    const total = Number(size);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Invalid size" });
    }
    if (total > MAX_CHUNKED_SIZE) {
      return res.status(413).json({ error: "Arquivo grande demais (máx. 5GB)" });
    }
    await fs.promises.mkdir(CHUNK_ROOT, { recursive: true });
    sweepStaleSessions().catch(() => {});

    const id = crypto.randomUUID();
    await fs.promises.mkdir(sessionDir(id), { recursive: true });
    chunkSessions.set(id, {
      userId: (req as any).user?.id,
      filename: typeof filename === "string" ? filename : "file",
      mimeType: typeof type === "string" && type ? type : "application/octet-stream",
      size: total,
      createdAt: Date.now(),
    });
    res.json({ uploadId: id });
  } catch (err: any) {
    console.error("Chunk init error:", err);
    res.status(500).json({ error: err.message });
  }
}

const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CHUNK_BYTES } });
export const uploadChunkMiddleware = chunkUpload.single("chunk");

export async function uploadChunk(req: Request, res: Response) {
  try {
    const found = getSession(req, res);
    if (!found) return;
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 100000) {
      return res.status(400).json({ error: "Invalid chunk index" });
    }
    if (!req.file) return res.status(400).json({ error: "No chunk provided" });
    await fs.promises.writeFile(path.join(sessionDir(found.id), `${index}.part`), req.file.buffer);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Chunk upload error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function completeChunkedUpload(req: Request, res: Response) {
  const found = getSession(req, res);
  if (!found) return;
  const { id, s } = found;
  const dir = sessionDir(id);
  const assembled = path.join(dir, "assembled");
  try {
    const totalChunks = Number(req.body?.totalChunks);
    if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
      return res.status(400).json({ error: "Invalid totalChunks" });
    }

    const out = fs.createWriteStream(assembled);
    try {
      for (let i = 0; i < totalChunks; i++) {
        const partPath = path.join(dir, `${i}.part`);
        if (!fs.existsSync(partPath)) {
          out.destroy();
          return res.status(400).json({ error: `Missing chunk ${i}` });
        }
        await new Promise<void>((resolve, reject) => {
          const rs = fs.createReadStream(partPath);
          rs.on("error", reject);
          rs.on("end", resolve);
          rs.pipe(out, { end: false });
        });
        await fs.promises.unlink(partPath).catch(() => {});
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }

    const stat = await fs.promises.stat(assembled);
    if (stat.size !== s.size) {
      return res.status(400).json({ error: `Size mismatch (${stat.size} != ${s.size})` });
    }

    const nameExt = path.extname(s.filename).replace(/^\./, "");
    const ext = nameExt || extFromMime(s.mimeType);
    const url = await storeFilePath(assembled, stat.size, ext, s.mimeType);
    res.json({ url, size: stat.size, type: s.mimeType });
  } catch (err: any) {
    console.error("Chunk complete error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    chunkSessions.delete(id);
    await removeDir(dir);
  }
}

/** Como storeBuffer, mas a partir de um arquivo em disco (streaming, sem carregar na memória). */
async function storeFilePath(filePath: string, size: number, ext: string, mimeType: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;
  const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;

  if (AWS_S3_BUCKET && AWS_S3_REGION && AWS_S3_KEY && AWS_S3_SECRET) {
    const s3 = new S3Client({
      region: AWS_S3_REGION,
      credentials: { accessKeyId: AWS_S3_KEY, secretAccessKey: AWS_S3_SECRET },
    });
    const body = fs.createReadStream(filePath);
    try {
      await s3.send(
        new PutObjectCommand({ Bucket: AWS_S3_BUCKET, Key: filename, Body: body, ContentLength: size, ContentType: mimeType })
      );
    } finally {
      body.destroy();
    }
    return `https://${AWS_S3_BUCKET}.s3.${AWS_S3_REGION}.amazonaws.com/${filename}`;
  }

  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.promises.copyFile(filePath, path.join(UPLOADS_DIR, filename));
  return `/uploads/${filename}`;
}

/**
 * Streams back an image hosted on our own S3 bucket, same-origin from the caller's point of
 * view. Needed for the proposal-deck PDF export: it rasterizes slides with html2canvas, which
 * has to read the image's raw pixels into a canvas — that's only allowed for a cross-origin
 * image (our S3 URLs) if the bucket sends CORS headers, which it doesn't, so those images were
 * silently skipped in the exported PDF even though they display fine as plain <img> tags. This
 * proxy uses our already-configured S3 credentials to fetch the bytes server-side (no CORS
 * involved there) and re-serves them from our own origin instead.
 */
export async function proxyImage(req: Request, res: Response) {
  try {
    const { url } = req.query;
    if (typeof url !== "string") {
      return res.status(400).json({ error: "Missing url" });
    }

    const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;
    if (!AWS_S3_BUCKET || !AWS_S3_REGION || !AWS_S3_KEY || !AWS_S3_SECRET) {
      return res.status(404).json({ error: "Remote storage not configured" });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }

    // Restrict to our own bucket's host so this can't be turned into an open SSRF proxy.
    const bucketHost = `${AWS_S3_BUCKET}.s3.${AWS_S3_REGION}.amazonaws.com`;
    if (parsed.host !== bucketHost) {
      return res.status(403).json({ error: "Host not allowed" });
    }

    const key = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

    const s3 = new S3Client({
      region: AWS_S3_REGION,
      credentials: { accessKeyId: AWS_S3_KEY, secretAccessKey: AWS_S3_SECRET },
    });

    const obj = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));

    res.setHeader("Content-Type", obj.ContentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const body: any = obj.Body;
    if (body && typeof body.pipe === "function") {
      body.pipe(res);
    } else if (body && typeof body.transformToByteArray === "function") {
      const bytes = await body.transformToByteArray();
      res.send(Buffer.from(bytes));
    } else {
      res.status(502).json({ error: "Empty object body" });
    }
  } catch (err: any) {
    console.error("Image proxy error:", err);
    res.status(502).json({ error: "Failed to fetch image" });
  }
}
