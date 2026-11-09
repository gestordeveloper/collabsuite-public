import fs from "fs/promises";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

/** Downloads the bytes of an already-uploaded file, regardless of where uploadImage/uploadFile
 *  ended up putting it (S3, or the local ./uploads fallback). Shared by anything that needs to
 *  re-read a stored upload server-side — meeting-recording transcription, WhatsApp media sends. */
export async function fetchStoredFileBytes(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith("/uploads/")) {
    return fs.readFile(path.join(process.cwd(), fileUrl.replace(/^\//, "")));
  }

  const { AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_KEY, AWS_S3_SECRET } = process.env;
  if (AWS_S3_BUCKET && AWS_S3_REGION && AWS_S3_KEY && AWS_S3_SECRET && fileUrl.includes(`${AWS_S3_BUCKET}.s3.`)) {
    const key = decodeURIComponent(new URL(fileUrl).pathname.replace(/^\//, ""));
    const s3 = new S3Client({ region: AWS_S3_REGION, credentials: { accessKeyId: AWS_S3_KEY, secretAccessKey: AWS_S3_SECRET } });
    const obj = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));
    const bytes = await (obj.Body as any).transformToByteArray();
    return Buffer.from(bytes);
  }

  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Não foi possível baixar o arquivo (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
