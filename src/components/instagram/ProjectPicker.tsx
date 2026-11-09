import { Label } from "@/src/components/ui/label";
import type { ProjectAccount } from "@/src/services/instagram.service";

/** Escolhe o cliente (projeto) cuja conta do Instagram será usada — só lista os que têm conta conectada. */
export function ProjectPicker({ projects, value, onChange, disabled, label = "Cliente (conta do Instagram)" }: { projects: ProjectAccount[]; value: number | null; onChange: (id: number) => void; disabled?: boolean; label?: string }) {
  const connected = projects.filter((p) => p.connected || p.project_id === value);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {connected.length === 0 ? (
        <p className="rounded-lg border border-border p-2.5 text-sm text-muted-foreground">Nenhum projeto tem conta conectada. Conecte uma na aba Conta.</p>
      ) : (
        <select
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60"
        >
          <option value="" disabled>Selecione…</option>
          {connected.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}{p.account?.username ? ` — @${p.account.username}` : ""}</option>
          ))}
        </select>
      )}
    </div>
  );
}
