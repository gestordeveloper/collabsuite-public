import api from "./api";
import type { TaskTranscript, TranscriptMessage } from "../types";

export async function createTranscript(taskId: number, attachmentId: number): Promise<TaskTranscript> {
  const { data } = await api.post(`/tasks/${taskId}/attachments/${attachmentId}/transcript`);
  return data as TaskTranscript;
}

export async function retryTranscript(transcriptId: number): Promise<TaskTranscript> {
  const { data } = await api.post(`/transcripts/${transcriptId}/retry`);
  return data as TaskTranscript;
}

export async function fetchTranscript(transcriptId: number): Promise<TaskTranscript> {
  const { data } = await api.get(`/transcripts/${transcriptId}`);
  return data as TaskTranscript;
}

export async function sendChatMessage(transcriptId: number, message: string): Promise<TranscriptMessage> {
  const { data } = await api.post(`/transcripts/${transcriptId}/messages`, { message });
  return data as TranscriptMessage;
}
