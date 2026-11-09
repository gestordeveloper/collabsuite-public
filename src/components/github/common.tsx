import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDot, GitMerge, GitPullRequest, GitPullRequestClosed, Loader2, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { errMsg, type DiffFile, type Person } from "@/src/services/github.service";

export const GITHUB_AUTH_EVENT = "github-auth-error";

/** Carrega dados ao montar/mudar as dependências; `reload` busca de novo sem piscar a tela. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (silent: boolean) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (mine === seq.current) { setData(result); setError(null); }
    } catch (err) {
      // 424 = o GitHub recusou a conta conectada: avisa a aba para mostrar o botão "Reconectar" na hora.
      if ((err as any)?.response?.status === 424) window.dispatchEvent(new Event(GITHUB_AUTH_EVENT));
      if (mine === seq.current) setError(errMsg(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void run(false); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error, reload: () => run(true), setData };
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora há pouco";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 2592000) return `há ${Math.floor(s / 86400)} d`;
  if (s < 31536000) {
    const months = Math.floor(s / 2592000);
    return `há ${months} ${months === 1 ? "mês" : "meses"}`;
  }
  const years = Math.floor(s / 31536000);
  return `há ${years} ${years === 1 ? "ano" : "anos"}`;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 underline">Tentar de novo</button>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Avatar({ person, size = 20 }: { person: Person | null | { avatar: string | null; login?: string | null; name?: string }; size?: number }) {
  const avatar = person?.avatar;
  const label = (person as any)?.login || (person as any)?.name || "?";
  return avatar ? (
    <img src={avatar} alt={label} width={size} height={size} className="shrink-0 rounded-full bg-muted" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase" style={{ width: size, height: size }}>
      {String(label).slice(0, 1)}
    </span>
  );
}

const PULSE = "animate-pulse";

/** Ícone + cor do estado de uma execução do Actions. */
export function RunStatus({ status, conclusion, className }: { status: string; conclusion: string | null; className?: string }) {
  if (status !== "completed") {
    return <CircleDot className={cn("h-4 w-4 text-warning", status === "in_progress" && PULSE, className)} aria-label={status === "queued" ? "Na fila" : "Em execução"} />;
  }
  if (conclusion === "success") return <CheckCircle2 className={cn("h-4 w-4 text-success", className)} aria-label="Sucesso" />;
  if (conclusion === "failure" || conclusion === "timed_out") return <XCircle className={cn("h-4 w-4 text-destructive", className)} aria-label="Falhou" />;
  return <MinusCircle className={cn("h-4 w-4 text-muted-foreground", className)} aria-label={conclusion === "cancelled" ? "Cancelado" : "Concluído"} />;
}

export function runLabel(status: string, conclusion: string | null): string {
  if (status === "queued") return "Na fila";
  if (status === "in_progress") return "Em execução";
  return ({ success: "Sucesso", failure: "Falhou", cancelled: "Cancelado", skipped: "Ignorado", timed_out: "Tempo esgotado", neutral: "Neutro" } as Record<string, string>)[conclusion ?? ""] ?? "Concluído";
}

export function PullState({ state, merged, draft }: { state: string; merged: boolean; draft: boolean }) {
  if (merged) return <span className="inline-flex items-center gap-1 rounded-full bg-[#9B7BFF]/15 px-2 py-0.5 text-xs font-medium text-[#9B7BFF]"><GitMerge className="h-3 w-3" /> Merged</span>;
  if (state === "closed") return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"><GitPullRequestClosed className="h-3 w-3" /> Fechado</span>;
  if (draft) return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><GitPullRequest className="h-3 w-3" /> Rascunho</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success"><GitPullRequest className="h-3 w-3" /> Aberto</span>;
}

export function IssueState({ state }: { state: string }) {
  return state === "closed" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#9B7BFF]/15 px-2 py-0.5 text-xs font-medium text-[#9B7BFF]"><CheckCircle2 className="h-3 w-3" /> Fechada</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success"><CircleDot className="h-3 w-3" /> Aberta</span>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  const hex = /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : "#8A8A94";
  return <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: `${hex}66`, color: hex, background: `${hex}14` }}>{name}</span>;
}

/** Pílula de filtro (aberto / fechado / todos…). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-[9px] border bg-surface p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition-colors", value === o.value ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── diff ───────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = { added: "novo", removed: "removido", modified: "alterado", renamed: "renomeado", copied: "copiado", changed: "alterado" };

function PatchLines({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto bg-background py-1 font-mono text-[12px] leading-[1.45]">
      {patch.split("\n").map((line, i) => {
        const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return (
          <div
            key={i}
            className={cn(
              "whitespace-pre px-3",
              kind === "add" && "bg-success/10 text-success",
              kind === "del" && "bg-destructive/10 text-destructive",
              kind === "hunk" && "bg-info/10 text-info",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function DiffView({ files }: { files: DiffFile[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (files.length === 0) return <Empty>Nenhum arquivo alterado.</Empty>;
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {files.length} arquivo(s) alterado(s) · <span className="text-success">+{additions}</span> <span className="text-destructive">−{deletions}</span>
      </p>
      {files.map((f) => {
        const expanded = open[f.filename] ?? files.length <= 8;
        return (
          <div key={f.filename} className="overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [f.filename]: !expanded }))}
              className="flex w-full items-center gap-2 bg-card px-3 py-2 text-left text-[13px] hover:bg-accent/40"
              aria-expanded={expanded}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {f.previous_filename ? `${f.previous_filename} → ` : ""}{f.filename}
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] uppercase text-muted-foreground">{STATUS_LABEL[f.status] ?? f.status}</span>
              <span className="shrink-0 font-mono text-xs"><span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span></span>
            </button>
            {expanded && (
              f.patch ? (
                <>
                  <PatchLines patch={f.patch} />
                  {f.patch_truncated && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Diff cortado por ser muito grande — veja o restante no GitHub.</p>}
                </>
              ) : (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">Sem diff de texto (arquivo binário ou grande demais).</p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
