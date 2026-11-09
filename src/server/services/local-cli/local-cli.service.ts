import { prisma } from "../../lib/prisma";
import { commandExists, composePrompt, runCli, LocalCliError } from "./runner";

export interface CliPreset {
  preset: string;
  label: string;
  command: string;
  args: string;
  prompt_mode: "stdin" | "arg";
  models: string;
}

/** Receitas prontas: só preencher o formulário. {model} é omitido sozinho quando nenhum modelo é escolhido. */
export const CLI_PRESETS: CliPreset[] = [
  { preset: "claude", label: "Claude Code", command: "claude", args: "-p --output-format text --model {model}", prompt_mode: "stdin", models: "sonnet, opus, haiku" },
  { preset: "codex", label: "Codex (OpenAI)", command: "codex", args: "exec --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=low --model {model} --output-last-message {outfile} -", prompt_mode: "stdin", models: "codex-auto-review" },
  { preset: "gemini", label: "Gemini CLI", command: "gemini", args: "--model {model} -p \"Responda ao pedido recebido.\"", prompt_mode: "stdin", models: "gemini-2.5-pro, gemini-2.5-flash" },
  { preset: "antigravity", label: "Antigravity (agy)", command: "agy", args: "--model {model} -p", prompt_mode: "arg", models: "" },
  { preset: "qoder", label: "Qoder", command: "qodercli", args: "--model {model} --tools \"\" -p", prompt_mode: "stdin", models: "" },
  { preset: "opencode", label: "OpenCode", command: "opencode", args: "run --model {model} \"Siga o pedido recebido.\"", prompt_mode: "stdin", models: "" },
  { preset: "qwen", label: "Qwen Code", command: "qwen", args: "--model {model} -p \"Responda ao pedido recebido.\"", prompt_mode: "stdin", models: "" },
  { preset: "custom", label: "Outro CLI", command: "", args: "", prompt_mode: "stdin", models: "" },
];

export interface LocalCliInput {
  name: string;
  preset: string;
  command: string;
  args: string;
  prompt_mode: "stdin" | "arg";
  models?: string | null;
  timeout_sec?: number;
  is_active?: boolean;
}

export const parseModels = (s: string | null | undefined) => (s || "").split(",").map((m) => m.trim()).filter(Boolean);

function toDto(r: { id: number; name: string; preset: string; command: string; args: string; prompt_mode: string; models: string | null; timeout_sec: number; is_active: boolean }) {
  return {
    id: r.id, name: r.name, preset: r.preset, command: r.command, args: r.args, prompt_mode: r.prompt_mode,
    models: parseModels(r.models), models_text: r.models || "", timeout_sec: r.timeout_sec, is_active: r.is_active,
  };
}

export async function list(companyId: number | null) {
  const rows = await prisma.localCli.findMany({ where: { company_id: companyId }, orderBy: { id: "asc" } });
  return rows.map((r) => ({ ...toDto(r), installed: !!commandExists(r.command) }));
}

export async function create(companyId: number | null, data: LocalCliInput) {
  const row = await prisma.localCli.create({
    data: { company_id: companyId, ...data, models: data.models?.trim() || null, timeout_sec: data.timeout_sec ?? 300 },
  });
  return toDto(row);
}

export async function update(companyId: number | null, id: number, data: Partial<LocalCliInput>) {
  const cur = await prisma.localCli.findFirst({ where: { id, company_id: companyId } });
  if (!cur) throw new LocalCliError("CLI não encontrado.", 404);
  const row = await prisma.localCli.update({ where: { id }, data: { ...data, models: data.models === undefined ? undefined : data.models?.trim() || null } });
  return toDto(row);
}

export async function remove(companyId: number | null, id: number) {
  await prisma.localCli.deleteMany({ where: { id, company_id: companyId } });
}

export async function get(companyId: number | null, id: number) {
  const row = await prisma.localCli.findFirst({ where: { id, company_id: companyId, is_active: true } });
  if (!row) throw new LocalCliError("CLI local não encontrado ou desativado.", 404);
  return row;
}

/** Quais presets têm o executável no PATH deste servidor. */
export function detect() {
  return CLI_PRESETS.filter((p) => p.command).map((p) => ({ ...p, path: commandExists(p.command) }));
}

/** Roda um prompt mínimo para o admin conferir se o CLI responde. */
export async function test(companyId: number | null, id: number, model?: string) {
  const row = await get(companyId, id);
  const started = Date.now();
  const text = await runCli(row, model || parseModels(row.models)[0] || "", composePrompt(undefined, [{ role: "user", content: "Responda somente com a palavra: ok" }]));
  return { ok: true, ms: Date.now() - started, reply: text.slice(0, 200) };
}
