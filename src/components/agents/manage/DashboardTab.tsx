import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarCheck, Clock, Coins, MessagesSquare, ShieldCheck, UserRoundCog, Users } from "lucide-react";
import { Card } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { PINK, SEMANTIC } from "@/src/lib/design";
import { errorMessage, fetchDashboard, type AgentDashboard, type DashboardSummary } from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  onNotify: (msg: string) => void;
}

const PERIODS = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0).replace(".", ",")}%`;
const int = (v: number) => v.toLocaleString("pt-BR");
const secs = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const compact = (v: number) => {
  const f = (n: number) => n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return v >= 1_000_000 ? `${f(v / 1_000_000)} mi` : v >= 1000 ? `${f(v / 1000)} mil` : String(v);
};
const dm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ACTION_LABEL: Record<string, string> = { created: "Agendou", rescheduled: "Remarcou", canceled: "Cancelou" };

/** Variação contra o período anterior de mesmo tamanho; `goodWhenUp` define a cor (queda de erros é bom). */
function Delta({ now, before, goodWhenUp = true, unit = "pct" }: { now: number; before: number; goodWhenUp?: boolean; unit?: "pct" | "pp" }) {
  if (!before && !now) return null;
  if (!before) return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  const diff = unit === "pp" ? (now - before) * 100 : ((now - before) / before) * 100;
  if (Math.abs(diff) < 0.5) return <span className="text-xs text-muted-foreground">= período anterior</span>;
  const up = diff > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color: good ? SEMANTIC.success : SEMANTIC.danger }}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(diff).toFixed(0)}
      {unit === "pp" ? " p.p." : "%"} <span className="font-normal text-muted-foreground">vs. anterior</span>
    </span>
  );
}

function Kpi({ icon: Icon, label, value, hint, delta }: { icon: typeof Users; label: string; value: string; hint?: string; delta?: React.ReactNode }) {
  return (
    <Card className="space-y-1 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="font-display text-2xl font-bold tracking-tight">{value}</p>
      <div className="min-h-4 text-xs text-muted-foreground">{delta ?? hint}</div>
    </Card>
  );
}

function Bars({ rows, empty }: { rows: { name: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="truncate">{r.name}</span>
            <span className="tabular-nums text-muted-foreground">{int(r.count)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full" style={{ width: `${(r.count / max) * 100}%`, backgroundColor: PINK }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-sm text-muted-foreground">Sem atendimentos no período.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[420px] space-y-[3px]">
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-[3px]">
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">{WEEKDAYS[d]}</span>
            {row.map((v, h) => (
              <div
                key={h}
                title={`${WEEKDAYS[d]} ${String(h).padStart(2, "0")}h: ${v} resposta(s)`}
                className="h-5 flex-1 rounded-[3px]"
                style={{ backgroundColor: v ? PINK : "transparent", opacity: v ? 0.15 + (v / max) * 0.85 : 1, boxShadow: v ? undefined : "inset 0 0 0 1px hsl(var(--border))" }}
              />
            ))}
          </div>
        ))}
        <div className="flex gap-[3px] pl-8">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="flex-1 text-center text-[9px] text-muted-foreground">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardTab({ agentId, onNotify }: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AgentDashboard | null>(null);

  useEffect(() => {
    setData(null);
    fetchDashboard(agentId, days)
      .then(setData)
      .catch((e) => onNotify(errorMessage(e)));
  }, [agentId, days, onNotify]);

  const periodPicker = (
    <div className="flex gap-1 rounded-lg border p-0.5">
      {PERIODS.map((p) => (
        <button key={p.days} onClick={() => setDays(p.days)} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${days === p.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {p.label}
        </button>
      ))}
    </div>
  );

  if (!data)
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{periodPicker}</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );

  const s: DashboardSummary = data.summary;
  const p: DashboardSummary = data.previous;
  const empty = s.turns === 0;
  const totalContactsOutcome = Math.max(1, s.contacts);
  const ht = data.handoff_tickets;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {empty ? "Nenhum atendimento no período. Os números aparecem aqui assim que o agente responder pelo WhatsApp." : `Atendimento do agente nos últimos ${data.days} dias (horário de Brasília).`}
        </p>
        {periodPicker}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label="Conversas atendidas" value={int(s.contacts)} delta={<Delta now={s.contacts} before={p.contacts} />} />
        <Kpi icon={MessagesSquare} label="Respostas enviadas" value={int(s.turns - s.errors)} hint={`${int(s.messages_in)} mensagens recebidas`} />
        <Kpi icon={ShieldCheck} label="Resolvidas pelo agente" value={empty ? "—" : pct(s.autonomous_rate)} delta={empty ? undefined : <Delta now={s.autonomous_rate} before={p.autonomous_rate} unit="pp" />} />
        <Kpi icon={UserRoundCog} label="Transferidas p/ humano" value={int(s.handoffs)} hint={empty ? undefined : `${pct(s.handoff_rate)} das conversas`} />
        <Kpi icon={CalendarCheck} label="Agendamentos feitos" value={int(s.appointments)} hint={empty ? undefined : `${pct(s.conversion_rate)} das conversas viram agenda`} delta={s.appointments || p.appointments ? <Delta now={s.appointments} before={p.appointments} /> : undefined} />
        <Kpi icon={Clock} label="Tempo até responder" value={secs(s.wait_ms.p50)} hint={`mediana · 95% em até ${secs(s.wait_ms.p95)}`} />
        <Kpi icon={AlertTriangle} label="Falhas" value={empty ? "—" : pct(s.error_rate)} hint={`${int(s.errors)} resposta(s) com erro`} delta={s.errors || p.errors ? <Delta now={s.error_rate} before={p.error_rate} goodWhenUp={false} unit="pp" /> : undefined} />
        <Kpi icon={Coins} label="Tokens consumidos" value={compact(s.input_tokens + s.output_tokens)} hint={`${int(s.tokens_per_turn)} por resposta · RAG em ${pct(s.rag_rate)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
          <h3 className="font-display text-base font-semibold">Conversas por dia</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={dm} interval={data.days > 30 ? Math.floor(data.days / 8) : data.days > 7 ? 2 : 0} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} labelFormatter={(v) => new Date(v + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} formatter={(v: number) => [v, "Conversas"]} />
                <Bar dataKey="contacts" name="Conversas" fill={PINK} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">Desfecho das conversas</h3>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            <div style={{ width: `${((s.contacts - s.handoffs) / totalContactsOutcome) * 100}%`, backgroundColor: SEMANTIC.success }} />
            <div style={{ width: `${(s.handoffs / totalContactsOutcome) * 100}%`, backgroundColor: SEMANTIC.warning, marginLeft: 2 }} />
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SEMANTIC.success }} />Resolvidas pelo agente</span>
              <span className="tabular-nums">{int(s.contacts - s.handoffs)}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SEMANTIC.warning }} />Transferidas p/ humano</span>
              <span className="tabular-nums">{int(s.handoffs)}</span>
            </li>
          </ul>
          {ht.total > 0 && (
            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">O que a equipe fez com as transferidas</p>
              <p>Aguardando: {ht.pending} · Em atendimento: {ht.open} · Concluídas: {ht.closed}</p>
              {ht.avg_close_minutes != null && <p>Tempo médio até concluir: {ht.avg_close_minutes >= 60 ? `${(ht.avg_close_minutes / 60).toFixed(1).replace(".", ",")} h` : `${ht.avg_close_minutes} min`}</p>}
            </div>
          )}
          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Contatos agora</p>
            <p>{int(data.contacts_now.active)} com o agente · {int(data.contacts_now.with_human)} com atendente · {int(data.contacts_now.new_in_period)} novos no período</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">Quando as pessoas falam com o agente</h3>
          <Heatmap grid={data.heatmap} />
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">Velocidade</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Cliente espera", s.wait_ms.avg, "média até 1ª resposta"],
              ["Agente pensa", s.agent_ms.p50, "mediana (IA + ferramentas)"],
              ["Pior caso", s.wait_ms.p95, "95% respondem até aqui"],
            ].map(([label, v, hint]) => (
              <div key={label as string} className="rounded-lg bg-muted/40 p-3">
                <p className="font-display text-xl font-bold">{secs(v as number | null)}</p>
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            "Cliente espera" inclui o tempo de espera para juntar mensagens (configurado na aba WhatsApp) e é medido até a primeira mensagem enviada.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">Ferramentas mais usadas</h3>
          <Bars rows={data.tools.slice(0, 8)} empty="Nenhuma ferramenta foi chamada no período." />
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">O que os clientes enviam</h3>
          <Bars
            rows={[
              { name: "Texto", count: data.media.text },
              { name: "Áudio", count: data.media.audio },
              { name: "Imagem", count: data.media.image },
              { name: "Sticker", count: data.media.sticker },
            ].filter((r) => r.count > 0)}
            empty="Sem mensagens no período."
          />
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-display text-base font-semibold">Agenda</h3>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["Agendados", data.appointments.created],
              ["Remarcados", data.appointments.rescheduled],
              ["Cancelados", data.appointments.canceled],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-muted/40 p-2">
                <p className="font-display text-lg font-bold">{v}</p>
                <p className="text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          {data.appointments.by_user.length > 0 && <Bars rows={data.appointments.by_user} empty="" />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2 p-5">
          <h3 className="font-display text-base font-semibold">Últimos compromissos</h3>
          {data.appointments.recent.length === 0 && <p className="text-sm text-muted-foreground">O agente ainda não mexeu na agenda neste período.</p>}
          {data.appointments.recent.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 border-b py-1.5 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span> {a.contact ? `· ${a.contact}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  na agenda de {a.user}
                  {a.starts_at ? ` · ${new Date(a.starts_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
            </div>
          ))}
        </Card>
        <Card className="space-y-2 p-5">
          <h3 className="font-display text-base font-semibold">Por que o agente transferiu</h3>
          {data.handoff_reasons.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma transferência no período.</p>}
          {data.handoff_reasons.map((r, i) => (
            <div key={i} className="border-b py-1.5 text-sm last:border-0">
              <p>{r.reason}</p>
              <p className="text-xs text-muted-foreground">{new Date(r.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
            </div>
          ))}
          {data.recent_errors.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <h4 className="text-xs font-semibold" style={{ color: SEMANTIC.danger }}>Últimas falhas</h4>
              {data.recent_errors.map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — {e.error}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
