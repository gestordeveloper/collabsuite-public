import { prisma } from "../lib/prisma";
import { transcribeAudio, chatCompletion, type ChatMessage } from "../lib/groq";
import { fetchStoredFileBytes as fetchAttachmentBytes } from "../lib/fileStorage";

export async function getOrCreateTranscript(taskId: number, attachmentId: number) {
  const existing = await prisma.taskTranscript.findFirst({ where: { attachment_id: attachmentId } });
  if (existing) return existing;
  return prisma.taskTranscript.create({ data: { task_id: taskId, attachment_id: attachmentId, status: "pending" } });
}

export async function runTranscription(transcriptId: number) {
  const transcript = await prisma.taskTranscript.findUnique({ where: { id: transcriptId }, include: { attachment: true } });
  if (!transcript || !transcript.attachment) throw new Error("Transcrição ou anexo não encontrado.");

  await prisma.taskTranscript.update({ where: { id: transcriptId }, data: { status: "processing", error: null } });

  try {
    const buffer = await fetchAttachmentBytes(transcript.attachment.file_url);
    const { text, language } = await transcribeAudio(buffer, transcript.attachment.file_name, transcript.attachment.file_type);
    return await prisma.taskTranscript.update({
      where: { id: transcriptId },
      data: { status: "done", text, language: language ? language.slice(0, 10) : null },
    });
  } catch (err: any) {
    return await prisma.taskTranscript.update({
      where: { id: transcriptId },
      data: { status: "error", error: (err?.message || "Falha ao transcrever.").slice(0, 500) },
    });
  }
}

export async function listTranscriptsForTask(taskId: number) {
  return prisma.taskTranscript.findMany({ where: { task_id: taskId }, orderBy: { created_at: "asc" } });
}

export async function getTranscript(transcriptId: number) {
  return prisma.taskTranscript.findUnique({
    where: { id: transcriptId },
    include: { messages: { orderBy: { created_at: "asc" } } },
  });
}

const buildSystemPrompt = (transcriptText: string) =>
  `Você é um assistente que ajuda a analisar a transcrição de uma reunião. Responda sempre em português do Brasil, ` +
  `de forma clara e objetiva. Baseie-se apenas no conteúdo da transcrição abaixo — se o que for perguntado não estiver ` +
  `nela, diga que isso não foi mencionado na reunião, em vez de inventar uma resposta.\n\nTranscrição da reunião:\n"""\n${transcriptText}\n"""`;

export async function sendChatMessage(transcriptId: number, userMessage: string) {
  const transcript = await prisma.taskTranscript.findUnique({
    where: { id: transcriptId },
    include: { messages: { orderBy: { created_at: "asc" } } },
  });
  if (!transcript) throw new Error("Transcrição não encontrada.");
  if (transcript.status !== "done" || !transcript.text) {
    throw new Error("A transcrição ainda não está pronta.");
  }

  await prisma.transcriptMessage.create({ data: { transcript_id: transcriptId, role: "user", content: userMessage } });

  const history: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(transcript.text) },
    ...transcript.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  const reply = await chatCompletion(history);

  return prisma.transcriptMessage.create({ data: { transcript_id: transcriptId, role: "assistant", content: reply || "…" } });
}
