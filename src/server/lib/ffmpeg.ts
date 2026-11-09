import { spawn } from "child_process";
import fsp from "fs/promises";
import os from "os";
import path from "path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(
        err.code === "ENOENT"
          ? new Error(`${bin} não encontrado no servidor. Instale o FFmpeg (ou defina FFMPEG_PATH/FFPROBE_PATH).`)
          : err
      )
    );
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${bin} falhou (${code}): ${stderr.trim()}`))));
  });
}

/** Executa o ffmpeg com os argumentos dados (rejeita com o final do stderr se falhar). */
export const runFfmpeg = (args: string[]) => run(FFMPEG, args);
export const ffmpegBinary = () => FFMPEG;

/** Converte qualquer áudio (webm/mp3/m4a…) em OGG/Opus mono, o formato que o WhatsApp toca como mensagem de voz. */
export async function transcodeToOggOpus(input: Buffer): Promise<Buffer> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "ticket-voice-"));
  try {
    const inFile = path.join(dir, "in");
    const outFile = path.join(dir, "out.ogg");
    await fsp.writeFile(inFile, input);
    await run(FFMPEG, ["-y", "-i", inFile, "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", outFile]);
    return await fsp.readFile(outFile);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Converte a gravação para MP3 mono 64kbps. O webm do MediaRecorder sai sem duração nem índice de
 * seek, então o <audio> do navegador não deixa avançar/voltar; o MP3 reescrito pelo ffmpeg tem os dois.
 */
export async function transcodeToMp3(input: string, output: string): Promise<void> {
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "32000", "-c:a", "libmp3lame", "-b:a", "64k", output]);
}

/** Duração em segundos, ou null se o ffprobe não estiver disponível / o arquivo não for legível. */
export async function probeDurationSeconds(file: string): Promise<number | null> {
  try {
    const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    const sec = parseFloat(out.trim());
    return Number.isFinite(sec) ? sec : null;
  } catch {
    return null;
  }
}

export interface AudioChunks {
  files: string[];
  dir: string;
}

/**
 * Converte qualquer áudio/vídeo (webm, mp4, m4a…) em pedaços de MP3 mono 16kHz 64kbps de
 * `chunkSeconds` cada. ~4,5 MB por 10 min — bem abaixo do limite de 25 MB por requisição do
 * Whisper (Groq/OpenAI), e já extrai só a trilha de áudio quando o arquivo for um vídeo.
 */
export async function splitForTranscription(input: string, chunkSeconds = 600): Promise<AudioChunks> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "recording-chunks-"));
  try {
    await run(FFMPEG, [
      "-y", "-i", input,
      "-f", "segment", "-segment_time", String(chunkSeconds), "-reset_timestamps", "1",
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
      path.join(dir, "chunk_%03d.mp3"),
    ]);
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".mp3")).sort().map((f) => path.join(dir, f));
    if (!files.length) throw new Error("O FFmpeg não gerou nenhum trecho de áudio (arquivo vazio ou sem trilha de áudio).");
    return { files, dir };
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export async function cleanupDir(dir: string) {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}
