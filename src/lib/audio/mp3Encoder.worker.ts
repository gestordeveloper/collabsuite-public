import { Mp3Encoder } from "@breezystack/lamejs";

type InMessage =
  | { type: "init"; sampleRate: number; kbps: number }
  | { type: "encode"; samples: Int16Array }
  | { type: "finish" };

type OutMessage =
  | { type: "chunk"; data: Uint8Array }
  | { type: "done" }
  | { type: "error"; message: string };

let encoder: Mp3Encoder | null = null;

function post(msg: OutMessage, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer as any);
}

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      encoder = new Mp3Encoder(1, msg.sampleRate, msg.kbps);
      return;
    }

    if (msg.type === "encode") {
      if (!encoder) throw new Error("Codificador de áudio não inicializado.");
      const chunk = encoder.encodeBuffer(msg.samples);
      if (chunk.length > 0) post({ type: "chunk", data: chunk }, [chunk.buffer]);
      return;
    }

    if (msg.type === "finish") {
      if (!encoder) throw new Error("Codificador de áudio não inicializado.");
      const tail = encoder.flush();
      if (tail.length > 0) post({ type: "chunk", data: tail }, [tail.buffer]);
      encoder = null;
      post({ type: "done" });
    }
  } catch (err: any) {
    encoder = null;
    post({ type: "error", message: err?.message || "Falha ao codificar o áudio em MP3." });
  }
};
