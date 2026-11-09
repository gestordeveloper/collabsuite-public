import api from "./api";

/** Rewrites a (possibly cross-origin, e.g. S3) image URL to go through our own backend so it can
 *  be read into a canvas — see upload.controller.ts#proxyImage for why. */
export function proxyImageUrl(url: string): string {
  return `/api/upload/proxy-image?url=${encodeURIComponent(url)}`;
}

export async function uploadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { data } = await api.post("/upload", { image: reader.result });
        resolve(data.url);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Generic multipart upload for arbitrary binary files (e.g. custom font files) — see
 *  upload.controller.ts#uploadFile; unlike uploadImage, this isn't limited to images. */
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB por requisição
const CHUNK_RETRIES = 3;

export async function uploadFile(
  file: Blob,
  opts: { filename?: string; onProgress?: (fraction: number) => void } = {}
): Promise<{ url: string; size: number; type: string }> {
  const filename = opts.filename || (file as File).name || "file";
  const type = file.type || "application/octet-stream";

  // Arquivos pequenos: um único POST. Pesados: em partes (evita 502/timeout no proxy).
  if (file.size <= CHUNK_SIZE) {
    const formData = new FormData();
    formData.append("file", file, filename);
    const { data } = await api.post("/upload/file", formData);
    opts.onProgress?.(1);
    return { url: data.url, size: file.size, type };
  }

  const { data: init } = await api.post("/upload/chunked/init", { filename, type, size: file.size });
  const uploadId: string = init.uploadId;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const part = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
    let attempt = 0;
    for (;;) {
      try {
        const form = new FormData();
        form.append("chunk", part, "chunk");
        await api.post(`/upload/chunked/${uploadId}/chunk/${i}`, form, { timeout: 120000 });
        break;
      } catch (err) {
        if (++attempt >= CHUNK_RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    opts.onProgress?.((i + 1) / totalChunks);
  }

  const { data } = await api.post(`/upload/chunked/${uploadId}/complete`, { totalChunks }, { timeout: 600000 });
  return { url: data.url, size: file.size, type };
}
