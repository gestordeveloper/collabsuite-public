import api from "./api";
import type {
  CarouselProjectData, GenerateRequest, SlideData, SlideTemplateDef, TemplateGroup, TemplateSlot,
} from "@/src/server/services/carrossel/types";

export type { CarouselProjectData, GenerateRequest, SlideData, SlideTemplateDef, TemplateGroup, TemplateSlot };

/** Marca sem o HTML pesado dos modelos (só o que a UI precisa: campos, limites, arquétipo). */
export interface BrandbookSummary {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  colors: Record<string, string>;
  typography: Record<string, string>;
  writing_rules: string[];
  default_theme: "dark" | "light";
  is_default: boolean;
  asset_names: string[];
  logo_filename: string | null;
  icon_filename: string | null;
  import_report: Record<string, any>;
  slide_templates: (Omit<SlideTemplateDef, "html"> & { has_html: boolean })[];
}

export interface ProjectListItem {
  id: string;
  title: string;
  brandbook_id: string;
  archetype: string;
  carousel_model: string;
  is_single_slide: boolean;
  slide_count: number;
  theme: string;
  first_slide: { template_code?: string | null; title: string } | null;
  project_id: number | null;
  project: { id: number; name: string; color: string | null } | null;
  user_id: number;
  created_at: string;
  updated_at: string;
}

export interface AiProviderStatus {
  id: string; // groq | openrouter | anthropic | openai | "cli:<id>"
  label?: string;
  free_model?: boolean;
  configured: boolean;
  default_model: string;
  models: { id: string; label: string }[];
}

export interface JobState<T = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "error" | "cancelled";
  stage: string;
  pct: number;
  result?: T;
  error?: string;
  error_status?: number;
}

export interface ReviewResult {
  resumo: string;
  nota_geral: number | null;
  slides: { index: number; titulo: string; modelo: string; nota: number | null; problemas: string[]; sugestao: string }[];
}

const BASE = "/carrosseis";

export const getAiStatus = () => api.get<{ providers: AiProviderStatus[] }>(`${BASE}/ai/status`).then((r) => r.data.providers);
export const listBrandbooks = () => api.get<BrandbookSummary[]>(`${BASE}/brandbooks`).then((r) => r.data);

export const importBrandbook = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<BrandbookSummary>(`${BASE}/brandbooks/import-zip`, form, { timeout: 5 * 60 * 1000 }).then((r) => r.data);
};
export const reanalyzeBrandbook = (id: string) => api.post<BrandbookSummary>(`${BASE}/brandbooks/${id}/reanalyze`).then((r) => r.data);
export const updateBrandbook = (id: string, patch: Partial<Pick<BrandbookSummary, "name" | "handle" | "description" | "writing_rules" | "default_theme">>) =>
  api.put<BrandbookSummary>(`${BASE}/brandbooks/${id}`, patch).then((r) => r.data);
export const deleteBrandbook = (id: string) => api.delete(`${BASE}/brandbooks/${id}`);

export const listProjects = (projectId?: number) =>
  api.get<ProjectListItem[]>(`${BASE}/projects`, { params: projectId ? { project_id: projectId } : undefined }).then((r) => r.data);
export const getProject = (id: string) => api.get<CarouselProjectData>(`${BASE}/projects/${id}`).then((r) => r.data);
export const saveProject = (p: CarouselProjectData) => api.put<CarouselProjectData>(`${BASE}/projects/${p.id}`, p).then((r) => r.data);
export const deleteProject = (id: string) => api.delete(`${BASE}/projects/${id}`);
export const duplicateProject = (id: string) => api.post<CarouselProjectData>(`${BASE}/projects/${id}/duplicate`).then((r) => r.data);

export const uploadImage = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<{ url: string }>(`${BASE}/upload-image`, form).then((r) => r.data.url);
};

export const previewSlideHtml = (brandbookId: string, slide: SlideData, total: number, isSingle: boolean, animated = false) =>
  api
    .post<string>(`${BASE}/preview-slide`, { brandbook_id: brandbookId, slide, total, is_single_slide: isSingle, animated }, { responseType: "text", transformResponse: (d) => d })
    .then((r) => r.data);

export const templatePreviewUrl = (brandbookId: string, code: string, theme?: string) =>
  `${BASE}/brandbooks/${brandbookId}/templates/${code}/preview${theme ? `?theme=${theme}` : ""}`;

export const exportProject = (id: string, slideIndices?: number[]) =>
  api.post<Blob>(`${BASE}/projects/${id}/export`, { slide_indices: slideIndices }, { responseType: "blob", timeout: 10 * 60 * 1000 }).then((r) => r.data);
export const slidePng = (id: string, index: number) =>
  api.get<Blob>(`${BASE}/projects/${id}/slides/${index}/png`, { responseType: "blob", timeout: 5 * 60 * 1000 }).then((r) => r.data);

export interface VideoExportBody {
  slide_indices?: number[] | null;
  format: "feed" | "story";
  outputs: ("png" | "mp4")[];
  animation: string;
  ken_burns?: boolean | null;
  seconds: number;
  fps: number;
  merge: boolean;
}
export const getAnimationPresets = () => api.get<{ id: string; label: string }[]>(`${BASE}/animation-presets`).then((r) => r.data);
export const startExportVideo = (id: string, body: VideoExportBody) =>
  api.post<JobState<{ url: string; filename: string; counts: { png: number; mp4: number } }>>(`${BASE}/projects/${id}/export-video-job`, body).then((r) => r.data);

export const startGenerate = (req: GenerateRequest) => api.post<JobState<CarouselProjectData>>(`${BASE}/generate-job`, req).then((r) => r.data);
export const startRegenerate = (body: { project_id: string; index: number; instruction?: string; keep_template?: boolean; provider?: string; model?: string }) =>
  api.post<JobState<SlideData>>(`${BASE}/regenerate-slide-job`, body).then((r) => r.data);
export const startReview = (body: { project_id: string; provider?: string; model?: string }) =>
  api.post<JobState<ReviewResult>>(`${BASE}/review-job`, body).then((r) => r.data);
export const getJob = <T,>(id: string) => api.get<JobState<T>>(`${BASE}/jobs/${id}`).then((r) => r.data);
export const cancelJob = (id: string) => api.post(`${BASE}/jobs/${id}/cancel`);

/** Acompanha um job até terminar (polling de 1,5 s). Rejeita com a mensagem de erro do servidor. */
export async function waitJob<T>(job: JobState<T>, onProgress?: (j: JobState<T>) => void, signal?: AbortSignal): Promise<T> {
  let cur = job;
  for (;;) {
    onProgress?.(cur);
    if (cur.status === "done") return cur.result as T;
    if (cur.status === "error") throw new Error(cur.error || "Falha na geração.");
    if (cur.status === "cancelled") throw new Error("Geração cancelada.");
    if (signal?.aborted) {
      void cancelJob(cur.id).catch(() => undefined);
      throw new Error("Geração cancelada.");
    }
    await new Promise((r) => setTimeout(r, 1500));
    cur = await getJob<T>(job.id);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function errorMessage(err: any, fallback = "Algo deu errado."): string {
  return err?.response?.data?.error || err?.message || fallback;
}

// ─── Pessoas ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string;
  name: string;
  description: string;
  style: string;
  mood: string;
  scenarios: string;
  avoid: string;
  notes: string;
  photos: string[];
}

export const listPeople = () => api.get<Person[]>(`${BASE}/people`).then((r) => r.data);
export const savePerson = (p: Partial<Person>) => api.post<Person>(`${BASE}/people`, p).then((r) => r.data);
export const deletePerson = (id: string) => api.delete(`${BASE}/people/${id}`);
export const addPersonPhoto = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<Person>(`${BASE}/people/${id}/photos`, form).then((r) => r.data);
};
export const removePersonPhoto = (id: string, url: string) => api.delete<Person>(`${BASE}/people/${id}/photos`, { params: { url } }).then((r) => r.data);

// ─── Imagens por IA ────────────────────────────────────────────────────────────

export type ImageProvider = "openrouter" | "openai" | "gemini" | "flow";
export const getFlowStatus = () => api.get<{ connected: boolean; pending: number }>(`${BASE}/flow/status`).then((r) => r.data);
export const createFlowToken = () => api.post<{ token: string }>(`${BASE}/flow/token`).then((r) => r.data.token);
export const getImageProviders = () => api.get<{ providers: ImageProvider[] }>(`${BASE}/image-providers`).then((r) => r.data.providers);
export const generateImage = (body: { prompt?: string; provider?: ImageProvider; references?: string[]; person_id?: string; scene?: string; brandbook_id?: string }) =>
  api.post<{ url: string }>(`${BASE}/generate-image`, body, { timeout: 5 * 60 * 1000 }).then((r) => r.data.url);

// ─── Imagem e Texto: estilo ────────────────────────────────────────────────────

export interface ImageTextStyle {
  box_color: string; headline_color: string; subheadline_color: string; box_width: number; box_radius: number;
  box_position: "bottom" | "center" | "top"; font: string; headline_size: number; headline_weight: number; subheadline_size: number;
  overlay: number; brightness: number; show_username: boolean; username: string; username_size: number; show_dots: boolean;
  headline_max: number; subheadline_max: number;
}
export interface ImageTextStyleOverview {
  defaults: ImageTextStyle;
  global: Partial<ImageTextStyle>;
  brandbooks: Record<string, Partial<ImageTextStyle>>;
}
export const getImageTextStyle = () => api.get<ImageTextStyleOverview>(`${BASE}/image-text/style`).then((r) => r.data);
export const saveImageTextStyle = (scope: string, style: Partial<ImageTextStyle> | null) =>
  api.put<ImageTextStyleOverview>(`${BASE}/image-text/style/${scope}`, style ?? {}).then((r) => r.data);
export const previewImageTextHtml = (body: { brandbook_id: string; style: Partial<ImageTextStyle>; headline?: string; subheadline?: string; image_url?: string | null }) =>
  api.post<string>(`${BASE}/image-text/preview`, body, { responseType: "text", transformResponse: (d) => d }).then((r) => r.data);

// ─── Prompts ───────────────────────────────────────────────────────────────────

export interface PromptKind {
  label: string;
  description: string;
  default: string;
  variables: { name: string; description: string; required: boolean }[];
  global: string | null;
  brandbooks: Record<string, string>;
}
export const listPrompts = () => api.get<Record<string, PromptKind>>(`${BASE}/prompts`).then((r) => r.data);
export const savePrompt = (kind: string, scope: string, text: string | null) =>
  api.put<{ warnings: string[] }>(`${BASE}/prompts/${kind}`, { scope, text }).then((r) => r.data.warnings);
