import { useState } from "react";
import { Download, ExternalLink, FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import * as gh from "@/src/services/github.service";
import { BranchSelect } from "./BranchSelect";
import { ErrorBox, GITHUB_AUTH_EVENT } from "./common";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Últimos 7 dias", range: () => [daysAgo(6), iso(new Date())] },
  { label: "Últimos 30 dias", range: () => [daysAgo(29), iso(new Date())] },
  { label: "Este mês", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; } },
  { label: "Mês passado", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
];

function pdfBlobUrl(report: gh.UpdateReport) {
  const bytes = Uint8Array.from(atob(report.pdf_base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/** Gera, com IA, o relatório de novidades (linguagem simples) das mudanças do repositório entre duas datas. */
export function ReportPanel({ projectId, link }: { projectId: number; projectName: string; link: gh.RepoLink }) {
  const [since, setSince] = useState(() => daysAgo(29));
  const [until, setUntil] = useState(() => iso(new Date()));
  const [branch, setBranch] = useState(link.default_branch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<gh.UpdateReport | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await gh.generateReport(projectId, { since, until, branch }));
    } catch (err) {
      if ((err as any)?.response?.status === 424) window.dispatchEvent(new Event(GITHUB_AUTH_EVENT));
      setError(gh.errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!report) return;
    const url = pdfBlobUrl(report);
    const a = document.createElement("a");
    a.href = url;
    a.download = report.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function open() {
    if (!report) return;
    const url = pdfBlobUrl(report);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const invalid = !since || !until || until < since;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-display text-base font-semibold">Relatório de atualizações</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A IA lê tudo o que foi feito no repositório entre as datas escolhidas e escreve um relatório em linguagem simples (novidades, correções e melhorias), pronto em PDF.
        </p>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => { const [a, b] = p.range(); setSince(a); setUntil(b); }}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="rep-since">De</Label>
            <Input id="rep-since" type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-until">Até</Label>
            <Input id="rep-until" type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <BranchSelect projectId={projectId} value={branch} onChange={setBranch} className="h-9" />
        </div>

        {until < since && since && until && <p className="mt-2 text-xs text-destructive">A data final não pode ser antes da inicial.</p>}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={generate} disabled={busy || invalid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {busy ? "Gerando relatório…" : "Gerar relatório"}
          </Button>
          {busy && <span className="text-xs text-subtle">A IA está escrevendo; pode levar até um minuto.</span>}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {report && (
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{report.filename}</p>
              <p className="text-xs text-subtle">{report.total_changes} mudanças analisadas · IA: {report.provider}/{report.model}</p>
            </div>
            <Button size="sm" onClick={download}><Download className="h-4 w-4" /> Baixar PDF</Button>
            <Button size="sm" variant="outline" onClick={open}><ExternalLink className="h-4 w-4" /> Abrir</Button>
          </div>
          {report.truncated && (
            <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              O período tem commits demais: foram lidos só os mais recentes. Use um período menor para um relatório completo.
            </p>
          )}
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border bg-surface p-4 font-sans text-[13px] leading-relaxed">{report.markdown}</pre>
        </div>
      )}
    </div>
  );
}
