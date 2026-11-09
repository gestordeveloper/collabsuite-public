import api from "./api";
import type { Character, ComicSlide, Dialogue, Episode, Series } from "@/src/server/services/carrossel/comic.service";
import type { ImageProvider, JobState } from "./carrossel.service";

export type { Character, ComicSlide, Dialogue, Episode, Series };

const BASE = "/carrosseis/comics";

export const listStyles = () => api.get<{ id: string; label: string }[]>(`${BASE}/styles`).then((r) => r.data);

export const listSeries = () => api.get<Series[]>(`${BASE}/series`).then((r) => r.data);
export const saveSeries = (s: Partial<Series>) => api.post<Series>(`${BASE}/series`, s).then((r) => r.data);
export const deleteSeries = (id: string) => api.delete(`${BASE}/series/${id}`);
export const uploadSheet = (seriesId: string, charId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<Series>(`${BASE}/series/${seriesId}/characters/${charId}/sheets`, form).then((r) => r.data);
};
export const deleteSheet = (seriesId: string, charId: string, url: string) =>
  api.delete<Series>(`${BASE}/series/${seriesId}/characters/${charId}/sheets`, { params: { url } }).then((r) => r.data);

export const listEpisodes = (seriesId: string) => api.get<Episode[]>(`${BASE}/series/${seriesId}/episodes`).then((r) => r.data);
export const saveEpisode = (e: Partial<Episode>) => api.post<Episode>(`${BASE}/episodes`, e).then((r) => r.data);
export const deleteEpisode = (seriesId: string, episodeId: string) => api.delete(`${BASE}/series/${seriesId}/episodes/${episodeId}`);

export type Step = "script" | "prompts" | "images" | "compose" | "video";
export const startStep = (seriesId: string, episodeId: string, step: Step, body: { provider?: string; model?: string; slides?: number[]; image_provider?: ImageProvider } = {}) =>
  api.post<JobState<Episode>>(`${BASE}/series/${seriesId}/episodes/${episodeId}/${step}-job`, body).then((r) => r.data);
export const startSeason = (seriesId: string, body: { story: string; episodes: number; slides: number; provider?: string; model?: string }) =>
  api.post<JobState<{ episodes: string[] }>>(`${BASE}/series/${seriesId}/season-job`, body).then((r) => r.data);

export const exportEpisode = (seriesId: string, episodeId: string) =>
  api.get<Blob>(`${BASE}/series/${seriesId}/episodes/${episodeId}/export.zip`, { responseType: "blob", timeout: 5 * 60 * 1000 }).then((r) => r.data);
export const exportSeries = (seriesId: string) =>
  api.get<Blob>(`${BASE}/series/${seriesId}/export.zip`, { responseType: "blob", timeout: 10 * 60 * 1000 }).then((r) => r.data);

export interface Voice { id: string; name: string; preview_url: string }
export interface ElevenSettings { configured: boolean; from_env: boolean; voice_id: string; model: string; styles: { id: string; label: string }[] }
export const listVoices = () => api.get<Voice[]>(`${BASE}/voices`).then((r) => r.data);
export const getElevenSettings = () => api.get<ElevenSettings>("/carrosseis/eleven/settings").then((r) => r.data);
export const saveElevenSettings = (body: { api_key?: string; voice_id?: string; model?: string }) =>
  api.put<ElevenSettings>("/carrosseis/eleven/settings", body).then((r) => r.data);
export const uploadAudio = (seriesId: string, episodeId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<Episode>(`${BASE}/series/${seriesId}/episodes/${episodeId}/audio`, form, { timeout: 5 * 60 * 1000 }).then((r) => r.data);
};
export const deleteAudio = (seriesId: string, episodeId: string) => api.delete<Episode>(`${BASE}/series/${seriesId}/episodes/${episodeId}/audio`).then((r) => r.data);

export function blankSeries(): Series {
  return {
    id: "", project_id: null, name: "", universe: "", premise: "", style_notes: "", art_style: "graphic_novel",
    palette: { base: "#0B1A2B", secondary: "#2E5E7E", accent: "#E8A33D" }, characters: [], narrator_voice_id: "", story: "", analysis: "", created: "",
  };
}

export function blankCharacter(): Character {
  return { id: "", name: "", role: "", description: "", voice: "", sheets: [], look: "", voice_id: "" };
}

export function episodeStatus(e: Episode): { key: "todo" | "wip" | "done"; label: string } {
  if (!e.slides.length) return { key: "todo", label: "Falta o roteiro" };
  if (e.slides.every((s) => s.final)) return { key: "done", label: "Pronto" };
  if (e.slides.some((s) => s.art)) return { key: "wip", label: "Desenhando" };
  return { key: "wip", label: "Falta desenhar" };
}

// ─── Aprovação do cliente (link público) ───────────────────────────────────────
export interface EpisodeShare { share_token: string | null; approved_at: string | null; approved_by: string | null }
export const getEpisodeShare = (seriesId: string, episodeId: string) =>
  api.get<EpisodeShare>(`${BASE}/series/${seriesId}/episodes/${episodeId}/share`).then((r) => r.data);
export const setEpisodeShare = (seriesId: string, episodeId: string, enabled: boolean) =>
  api.post<EpisodeShare>(`${BASE}/series/${seriesId}/episodes/${episodeId}/share`, { enabled }).then((r) => r.data);
