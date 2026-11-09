import { GitBranch } from "lucide-react";
import * as gh from "@/src/services/github.service";
import { useLoad } from "./common";

/** Seletor de branch (carrega a lista do repositório). */
export function BranchSelect({ projectId, value, onChange, className }: { projectId: number; value: string; onChange: (b: string) => void; className?: string }) {
  const { data } = useLoad(() => gh.listBranches(projectId), [projectId]);
  const names = data?.branches.map((b) => b.name) ?? [];
  // Mantém a opção atual visível mesmo antes da lista chegar ou se a branch foi apagada.
  const options = names.includes(value) ? names : [value, ...names];
  return (
    <label className={`inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 text-[13px] ${className ?? ""}`}>
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="sr-only">Branch</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-[220px] bg-transparent outline-none">
        {options.map((n) => <option key={n} value={n}>{n}{n === data?.default_branch ? " (padrão)" : ""}</option>)}
      </select>
    </label>
  );
}
