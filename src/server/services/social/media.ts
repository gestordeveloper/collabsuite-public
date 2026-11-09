/**
 * Acesso ao arquivo de vídeo de um post. YouTube e TikTok recebem os bytes por upload (não baixam de uma URL),
 * então funcionam até com o app em localhost. Vídeos são grandes: nunca carregamos o arquivo inteiro na memória.
 */
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export interface MediaFile {
  path: string;
  size: number;
  mime: string;
  cleanup: () => Promise<void>;
}

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4" };
export const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
export const isVideoUrl = (url: string) => VIDEO_EXT.test(url.split("?")[0]);

export async function openMedia(url: string): Promise<MediaFile> {
  const clean = url.split("?")[0];
  const mime = MIME[path.extname(clean).toLowerCase()] ?? "video/mp4";

  if (clean.startsWith("/uploads/")) {
    const root = path.join(process.cwd(), "uploads");
    const file = path.resolve(process.cwd(), clean.replace(/^\//, ""));
    if (!file.startsWith(root + path.sep)) throw new Error("Caminho de mídia inválido.");
    const st = await fsp.stat(file).catch(() => null);
    if (!st) throw new Error("O arquivo de vídeo não foi encontrado no servidor.");
    return { path: file, size: st.size, mime, cleanup: async () => {} };
  }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "collabsuite-social-"));
  const file = path.join(dir, `${crypto.randomBytes(6).toString("hex")}${path.extname(clean) || ".mp4"}`);
  const cleanup = async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  try {
    const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;
    if (AWS_S3_BUCKET && AWS_S3_REGION && AWS_S3_KEY && AWS_S3_SECRET && url.includes(`${AWS_S3_BUCKET}.s3.`)) {
      const s3 = new S3Client({ region: AWS_S3_REGION, credentials: { accessKeyId: AWS_S3_KEY, secretAccessKey: AWS_S3_SECRET } });
      const obj = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) }));
      await pipeline(obj.Body as Readable, fs.createWriteStream(file));
    } else {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o vídeo (${res.status}).`);
      await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(file));
    }
    const st = await fsp.stat(file);
    if (st.size === 0) throw new Error("O arquivo de vídeo está vazio.");
    return { path: file, size: st.size, mime, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Lê o trecho [start, end] (inclusivo) do arquivo. */
export async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const len = end - start + 1;
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
