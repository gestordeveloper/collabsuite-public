import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import * as healthApi from "@/src/services/health.service";
import type { HealthGoals, HealthOverview, WorkoutPayload } from "@/src/services/health.service";
import { formatSleep, parseSleep } from "@/src/services/health.service";

const WORKOUT_TYPES = ["Caminhada", "Corrida", "Musculação", "Ciclismo", "Natação", "Yoga", "Futebol", "Funcional", "Outro"];

function errorText(err: any, fallback: string) {
  return err?.response?.data?.error || err?.message || fallback;
}

// ─── Metas ───

export function GoalsDialog({ open, goals, onClose, onSave }: {
  open: boolean;
  goals: HealthGoals;
  onClose: () => void;
  onSave: (goals: Partial<HealthGoals>) => Promise<void>;
}) {
  const [steps, setSteps] = useState("");
  const [water, setWater] = useState("");
  const [sleep, setSleep] = useState("");
  const [workouts, setWorkouts] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSteps(String(goals.steps));
    setWater(String(goals.water_ml));
    setSleep(formatSleep(goals.sleep_min));
    setWorkouts(String(goals.workouts_per_week));
    setWeight(goals.weight_kg != null ? String(goals.weight_kg) : "");
    setError(null);
  }, [open, goals]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sleepMin = parseSleep(sleep);
    if (sleepMin == null) return setError("Informe as horas de sono (ex.: 8h ou 7:30).");
    setSaving(true);
    setError(null);
    try {
      await onSave({
        steps: Number(steps),
        water_ml: Number(water),
        sleep_min: sleepMin,
        workouts_per_week: Number(workouts),
        weight_kg: weight.trim() ? Number(weight.replace(",", ".")) : null,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, "Não foi possível salvar as metas."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Metas diárias</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Passos por dia"><Input type="number" min={1000} value={steps} onChange={(e) => setSteps(e.target.value)} /></Field>
          <Field label="Água por dia (ml)"><Input type="number" min={500} step={50} value={water} onChange={(e) => setWater(e.target.value)} /></Field>
          <Field label="Sono por noite"><Input value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="8h" /></Field>
          <Field label="Treinos por semana"><Input type="number" min={0} max={14} value={workouts} onChange={(e) => setWorkouts(e.target.value)} /></Field>
          <Field label="Peso desejado (kg, opcional)"><Input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ex.: 72,5" inputMode="decimal" /></Field>
          <p className="text-[11px] text-subtle">
            Hábitos ligados a passos, água, sono ou treino são marcados sozinhos quando a meta do dia é batida.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Treino ───

export function WorkoutDialog({ open, date, onClose, onSave }: {
  open: boolean;
  date: string;
  onClose: () => void;
  onSave: (payload: WorkoutPayload) => Promise<void>;
}) {
  const [type, setType] = useState("Caminhada");
  const [duration, setDuration] = useState("30");
  const [calories, setCalories] = useState("");
  const [distance, setDistance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setType("Caminhada"); setDuration("30"); setCalories(""); setDistance(""); setError(null); }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Math.round(Number(duration));
    if (!type.trim() || !Number.isFinite(minutes) || minutes < 1) return setError("Informe o tipo e a duração.");
    setSaving(true);
    setError(null);
    try {
      await onSave({
        date,
        type: type.trim(),
        duration_min: minutes,
        calories: calories.trim() ? Math.round(Number(calories)) : null,
        distance_km: distance.trim() ? Number(distance.replace(",", ".")) : null,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, "Não foi possível registrar o treino."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar treino</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Tipo">
            <Input list="workout-types" value={type} onChange={(e) => setType(e.target.value)} maxLength={40} />
            <datalist id="workout-types">{WORKOUT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Minutos"><Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
            <Field label="Calorias"><Input type="number" min={0} value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="opc." /></Field>
            <Field label="Km"><Input value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="opc." inputMode="decimal" /></Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Registrar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Conexão (API de importação) ───

export function SyncDialog({ open, sync, onClose, onChanged }: {
  open: boolean;
  sync: HealthOverview["sync"];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"token" | "example" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setToken(null); setCopied(null); setError(null); }
  }, [open]);

  const endpoint = `${window.location.origin}/api/health/ingest`;
  const example = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${token ?? "SEU_TOKEN"}" \\
  -H "Content-Type: application/json" \\
  -d '{"days":[{"date":"2026-10-30","steps":9210,"sleep_min":455,"weight_kg":74.2}],
       "workouts":[{"date":"2026-10-30","type":"Corrida","duration_min":35,"calories":320,"distance_km":5.2,"external_id":"run-1"}]}'`;

  async function copy(value: string, which: "token" | "example") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* sem permissão de clipboard */ }
  }

  async function generate() {
    if (sync.has_token && !confirm("Gerar um novo token desativa o atual. Os apps conectados precisarão do novo. Continuar?")) return;
    setBusy(true);
    setError(null);
    try {
      setToken((await healthApi.createSyncToken()).token);
      onChanged();
    } catch (err) {
      setError(errorText(err, "Não foi possível gerar o token."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm("Revogar o token? Os apps que o usam deixam de sincronizar.")) return;
    setBusy(true);
    try {
      await healthApi.revokeSyncToken();
      setToken(null);
      onChanged();
    } catch (err) {
      setError(errorText(err, "Não foi possível revogar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sincronizar com o celular ou relógio</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          <p className="text-muted-foreground">
            Gere um token pessoal e configure no app que lê os dados do seu celular/relógio (Health Connect, Apple Saúde, Fitbit, Garmin…)
            para enviar passos, sono, peso e treinos a este endereço. Valores que você digitou à mão não são sobrescritos.
          </p>

          <div className="rounded-lg border bg-surface p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-subtle">Endereço</div>
            <code className="break-all font-mono text-xs">POST {endpoint}</code>
          </div>

          <div className="rounded-lg border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-subtle">Token</span>
              {sync.last_synced_at && (
                <span className="text-[11px] text-subtle">última sincronização: {new Date(sync.last_synced_at).toLocaleString("pt-BR")}</span>
              )}
            </div>
            {token ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs">{token}</code>
                  <Button type="button" size="sm" variant="outline" onClick={() => copy(token, "token")}>
                    {copied === "token" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-warning">Copie agora: por segurança ele não será mostrado de novo.</p>
              </>
            ) : sync.has_token ? (
              <p className="font-mono text-xs text-muted-foreground">hk_••••••••••••••••{sync.token_hint}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum token gerado.</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={generate} disabled={busy}>
                <KeyRound className="h-4 w-4" /> {sync.has_token ? "Gerar novo token" : "Gerar token"}
              </Button>
              {sync.has_token && (
                <Button type="button" size="sm" variant="ghost" onClick={revoke} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Revogar
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-surface p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-subtle">Exemplo de envio</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => copy(example, "example")}>
                {copied === "example" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{example}</pre>
            <p className="mt-2 text-[11px] text-subtle">
              Campos aceitos por dia: steps, water_ml, sleep_min, sleep_quality, weight_kg, body_fat, waist_cm, hip_cm, chest_cm, arm_cm, thigh_cm, calf_cm, neck_cm, mood, energy, stress.
              Reenviar o mesmo dia ou treino (mesmo external_id) atualiza em vez de duplicar.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
