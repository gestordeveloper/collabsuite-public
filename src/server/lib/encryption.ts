import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let warned = false;

function getKey(): Buffer {
  let secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (!warned) {
      console.warn("[encryption] ENCRYPTION_KEY não definida no .env — usando uma chave derivada do JWT_SECRET apenas para desenvolvimento. Defina ENCRYPTION_KEY em produção.");
      warned = true;
    }
    secret = process.env.JWT_SECRET || "collabsuite-secret-key-change-in-production";
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Valor criptografado inválido.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
