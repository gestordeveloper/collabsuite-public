import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Armazenamento dos áudios das gravações. Diferente de uploadImage/uploadFile (que devolvem uma
 * URL pública do bucket), as gravações são privadas: o objeto fica no S3 sem acesso público e o
 * navegador toca/baixa via URL assinada de curta duração gerada a cada abertura da gravação.
 * Sem as variáveis AWS_S3_* cai para o disco local (./uploads/recordings) — só serve para dev.
 */

const LOCAL_DIR = path.join(process.cwd(), "uploads", "recordings");
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

function s3Config() {
  const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;
  if (!AWS_S3_BUCKET || !AWS_S3_REGION || !AWS_S3_KEY || !AWS_S3_SECRET) return null;
  return { bucket: AWS_S3_BUCKET, region: AWS_S3_REGION, key: AWS_S3_KEY, secret: AWS_S3_SECRET };
}

function s3Client(cfg: NonNullable<ReturnType<typeof s3Config>>) {
  return new S3Client({ region: cfg.region, credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret } });
}

export type StorageKind = "s3" | "local";

export function isS3Configured(): boolean {
  return s3Config() !== null;
}

export function buildRecordingKey(userId: number, ext: string): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 10);
  return `recordings/${userId}/${now.getUTCFullYear()}-${month}/${Date.now()}-${rand}.${ext}`;
}

/** Envia o arquivo (já em disco) para o S3 em streaming — não carrega o áudio inteiro na memória. */
export async function putRecordingFile(
  filePath: string,
  key: string,
  mimeType: string
): Promise<{ storage: StorageKind; key: string }> {
  const cfg = s3Config();
  if (cfg) {
    const { size } = await fsp.stat(filePath);
    await s3Client(cfg).send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: size,
        ContentType: mimeType,
      })
    );
    return { storage: "s3", key };
  }

  const dest = path.join(LOCAL_DIR, key.replace(/^recordings\//, ""));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(filePath, dest);
  return { storage: "local", key };
}

/** URL para o navegador tocar/baixar o áudio. */
export async function getRecordingUrl(storage: string, key: string, downloadName?: string): Promise<string> {
  if (storage === "s3") {
    const cfg = s3Config();
    if (!cfg) throw new Error("S3 não configurado neste ambiente (AWS_S3_* ausentes).");
    return getSignedUrl(
      s3Client(cfg),
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ...(downloadName && {
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        }),
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS }
    );
  }
  return `/uploads/recordings/${key.replace(/^recordings\//, "").split("/").map(encodeURIComponent).join("/")}`;
}

/** Baixa o objeto para um arquivo temporário (usado ao reprocessar uma gravação já enviada). */
export async function downloadRecordingToTemp(storage: string, key: string, ext: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "recording-dl-"));
  const dest = path.join(dir, `audio.${ext}`);

  if (storage === "s3") {
    const cfg = s3Config();
    if (!cfg) throw new Error("S3 não configurado neste ambiente (AWS_S3_* ausentes).");
    const obj = await s3Client(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    await pipeline(obj.Body as NodeJS.ReadableStream, fs.createWriteStream(dest));
  } else {
    await fsp.copyFile(path.join(LOCAL_DIR, key.replace(/^recordings\//, "")), dest);
  }
  return dest;
}

export async function deleteRecordingObject(storage: string, key: string): Promise<void> {
  if (storage === "s3") {
    const cfg = s3Config();
    if (!cfg) return;
    await s3Client(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return;
  }
  await fsp.rm(path.join(LOCAL_DIR, key.replace(/^recordings\//, "")), { force: true });
}
