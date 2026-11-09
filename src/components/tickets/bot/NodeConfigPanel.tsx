import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { cn } from "@/src/lib/utils";
import type { TeamMember, TicketQueue, TicketTag } from "@/src/services/ticket.service";
import { personName, TagChip } from "../helpers";
import { NODE_META, newId, type NodeType } from "./nodeMeta";

interface Props {
  nodeType: NodeType;
  data: Record<string, any>;
  isStart: boolean;
  queues: TicketQueue[];
  team: TeamMember[];
  tags: TicketTag[];
  onChange: (patch: Record<string, unknown>) => void;
  onSetStart: () => void;
  onDelete: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

const VARS_HINT = "Use {{name}} para o nome do cliente e {{variavel}} para respostas guardadas.";

export function NodeConfigPanel({ nodeType, data, isStart, queues, team, tags, onChange, onSetStart, onDelete }: Props) {
  const meta = NODE_META[nodeType];
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [key]: e.target.value });

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="font-display text-sm font-semibold">{meta.label}</h3>
        <p className="text-xs text-muted-foreground">{meta.hint}</p>
      </div>

      {nodeType === "message" && (
        <Field label="Texto" hint={VARS_HINT}>
          <Textarea rows={5} value={data.text ?? ""} onChange={set("text")} />
        </Field>
      )}

      {nodeType === "question" && (
        <>
          <Field label="Pergunta" hint={VARS_HINT}>
            <Textarea rows={3} value={data.prompt ?? ""} onChange={set("prompt")} />
          </Field>
          <Field label="Guardar resposta em" hint="Nome da variável (sem espaços), ex.: nome, cpf.">
            <Input value={data.variable ?? ""} onChange={set("variable")} />
          </Field>
        </>
      )}

      {nodeType === "menu" && (
        <>
          <Field label="Texto do menu" hint={VARS_HINT}>
            <Textarea rows={3} value={data.prompt ?? ""} onChange={set("prompt")} />
          </Field>
          <div className="space-y-2">
            <Label className="text-xs">Opções</Label>
            {(data.options || []).map((o: { id: string; label: string; keywords?: string }, i: number) => (
              <div key={o.id} className="space-y-1.5 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">{i + 1}</span>
                  <Input
                    value={o.label}
                    placeholder="Nome da opção"
                    onChange={(e) => onChange({ options: data.options.map((x: any) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => onChange({ options: data.options.filter((x: any) => x.id !== o.id) })} aria-label="Remover opção">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <Input
                  value={o.keywords ?? ""}
                  placeholder="Palavras-chave (separadas por vírgula)"
                  className="h-8 text-xs"
                  onChange={(e) => onChange({ options: data.options.map((x: any) => (x.id === o.id ? { ...x, keywords: e.target.value } : x)) })}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => onChange({ options: [...(data.options || []), { id: newId("o"), label: `Opção ${(data.options || []).length + 1}`, keywords: "" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar opção
            </Button>
            <p className="text-[11px] text-subtle">O cliente responde com o número ou com uma palavra-chave. Cada opção ganha uma saída no nó.</p>
          </div>
          <Field label="Resposta inválida (opcional)" hint="Se vazio, o menu é reenviado.">
            <Textarea rows={2} value={data.fallbackMessage ?? ""} onChange={set("fallbackMessage")} />
          </Field>
        </>
      )}

      {nodeType === "condition" && (
        <>
          <Field label="Variável" hint="Ex.: nome, __isBusinessHours, __minutesSinceLastClientMessage.">
            <Input value={data.variable ?? ""} onChange={set("variable")} />
          </Field>
          <Field label="Operador">
            <Select value={data.operator ?? "equals"} onValueChange={(v) => onChange({ operator: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">é igual a</SelectItem>
                <SelectItem value="contains">contém</SelectItem>
                <SelectItem value="gt">é maior que</SelectItem>
                <SelectItem value="lt">é menor que</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Valor">
            <Input value={data.value ?? ""} onChange={set("value")} />
          </Field>
        </>
      )}

      {nodeType === "set_variable" && (
        <>
          <Field label="Variável">
            <Input value={data.variable ?? ""} onChange={set("variable")} />
          </Field>
          <Field label="Valor" hint={VARS_HINT}>
            <Input value={data.value ?? ""} onChange={set("value")} />
          </Field>
        </>
      )}

      {nodeType === "wait" && (
        <Field label="Esperar (minutos)" hint="O fluxo continua sozinho depois desse tempo. Útil em fluxos de automação (follow-up).">
          <Input type="number" min={1} value={data.minutes ?? ""} onChange={(e) => onChange({ minutes: e.target.value === "" ? "" : Number(e.target.value) })} />
        </Field>
      )}

      {nodeType === "add_tag" && (
        <Field label="Etiquetas">
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">Crie etiquetas na aba Etiquetas.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = (data.tagIds || []).includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => onChange({ tagIds: on ? data.tagIds.filter((x: number) => x !== t.id) : [...(data.tagIds || []), t.id] })} className={cn(!on && "opacity-35 hover:opacity-70")}>
                    <TagChip tag={t} className="px-2.5 py-1 text-[11px]" />
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      )}

      {nodeType === "transfer_queue" && (
        <Field label="Fila de destino" hint="Depois deste nó a conversa passa para a equipe (ou para o fluxo da fila, se houver).">
          <Select value={data.queueId ? String(data.queueId) : ""} onValueChange={(v) => onChange({ queueId: Number(v) })}>
            <SelectTrigger><SelectValue placeholder="Escolha a fila" /></SelectTrigger>
            <SelectContent>
              {queues.map((q) => (
                <SelectItem key={q.id} value={String(q.id)}>{q.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {nodeType === "transfer_agent" && (
        <Field label="Atendente">
          <Select value={data.userId ? String(data.userId) : ""} onValueChange={(v) => onChange({ userId: Number(v) })}>
            <SelectTrigger><SelectValue placeholder="Escolha a pessoa" /></SelectTrigger>
            <SelectContent>
              {team.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{personName(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {nodeType === "notify_agent" && (
        <>
          <Field label="Aviso" hint={`Vira uma nota interna no atendimento. ${VARS_HINT}`}>
            <Textarea rows={3} value={data.message ?? ""} onChange={set("message")} />
          </Field>
          <Field label="Avisar" hint="Vazio = quem está com o atendimento.">
            <Select value={data.userId ? String(data.userId) : "none"} onValueChange={(v) => onChange({ userId: v === "none" ? null : Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Responsável atual</SelectItem>
                {team.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{personName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {nodeType === "http_request" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Método">
              <Select value={data.method ?? "GET"} onValueChange={(v) => onChange({ method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="col-span-2">
              <Field label="URL" hint={VARS_HINT}>
                <Input value={data.url ?? ""} onChange={set("url")} />
              </Field>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Cabeçalhos</Label>
            {(data.headers || []).map((h: { key: string; value: string }, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input value={h.key} placeholder="Nome" className="h-8 text-xs" onChange={(e) => onChange({ headers: data.headers.map((x: any, j: number) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                <Input value={h.value} placeholder="Valor" className="h-8 text-xs" onChange={(e) => onChange({ headers: data.headers.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onChange({ headers: data.headers.filter((_: any, j: number) => j !== i) })} aria-label="Remover cabeçalho">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => onChange({ headers: [...(data.headers || []), { key: "", value: "" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Cabeçalho
            </Button>
          </div>
          <Field label="Corpo (JSON)">
            <Textarea rows={4} value={data.body ?? ""} onChange={set("body")} className="font-mono text-xs" />
          </Field>
          <Field label="Guardar resposta em" hint="A variável recebe o texto da resposta; __http_status guarda o código.">
            <Input value={data.variable ?? ""} onChange={set("variable")} />
          </Field>
        </>
      )}

      {(nodeType === "image" || nodeType === "video" || nodeType === "audio") && (
        <>
          <Field label="URL do arquivo" hint="Link público (https://…) do arquivo a enviar.">
            <Input value={data.url ?? ""} onChange={set("url")} />
          </Field>
          {nodeType !== "audio" && (
            <Field label="Legenda (opcional)">
              <Textarea rows={2} value={data.caption ?? ""} onChange={set("caption")} />
            </Field>
          )}
        </>
      )}

      {nodeType === "end" && (
        <Field label="Mensagem final (opcional)" hint={VARS_HINT}>
          <Textarea rows={3} value={data.text ?? ""} onChange={set("text")} />
        </Field>
      )}

      <div className="flex flex-col gap-2 border-t pt-4">
        <Button variant="outline" size="sm" onClick={onSetStart} disabled={isStart}>
          {isStart ? "Este é o início do fluxo" : "Definir como início"}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir nó
        </Button>
      </div>
    </div>
  );
}
