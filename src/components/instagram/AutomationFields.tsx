import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import type { AutomationInput } from "@/src/services/instagram.service";

export type AutomationDraft = Required<Pick<AutomationInput, "keywords" | "reply_text" | "ai_reply" | "dm_text" | "cta_text" | "cta_link">>;

export const emptyAutomation = (): AutomationDraft => ({ keywords: [], reply_text: "", ai_reply: true, dm_text: "", cta_text: "", cta_link: "" });

/** Campos de "Engajar" reutilizados no diálogo de automação e no de postagem. */
export function AutomationFields({ value, onChange }: { value: AutomationDraft; onChange: (v: AutomationDraft) => void }) {
  const [kw, setKw] = useState("");
  const set = <K extends keyof AutomationDraft>(k: K, v: AutomationDraft[K]) => onChange({ ...value, [k]: v });

  const addKeyword = () => {
    const parts = kw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) set("keywords", [...new Set([...value.keywords, ...parts])]);
    setKw("");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Palavras-chave</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
          {value.keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              {k}
              <button type="button" onClick={() => set("keywords", value.keywords.filter((x) => x !== k))} aria-label={`Remover ${k}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addKeyword();
              }
            }}
            onBlur={addKeyword}
            placeholder={value.keywords.length ? "" : "Ex.: quero, link, ebook (Enter para adicionar)"}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p className="text-xs text-muted-foreground">Quem comentar qualquer uma dessas palavras (sem diferenciar maiúsculas/acentos) dispara a automação.</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Resposta pública com IA</Label>
            <p className="text-xs text-muted-foreground">Gera uma resposta diferente a cada comentário, usando suas chaves de IA.</p>
          </div>
          <Switch checked={value.ai_reply} onCheckedChange={(v) => set("ai_reply", v)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{value.ai_reply ? "Texto de reserva (se a IA falhar)" : "Resposta pública (opcional)"}</Label>
          <Input value={value.reply_text} onChange={(e) => set("reply_text", e.target.value)} placeholder="Ex.: Te enviei na DM! 😉" />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label>Mensagem direta (DM)</Label>
        <Textarea rows={3} value={value.dm_text} onChange={(e) => set("dm_text", e.target.value)} placeholder="Olá! Aqui está o material que você pediu…" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={value.cta_text} onChange={(e) => set("cta_text", e.target.value)} maxLength={20} placeholder="Texto do botão (máx. 20)" />
          <Input value={value.cta_link} onChange={(e) => set("cta_link", e.target.value)} placeholder="https://link-do-material" />
        </div>
        <p className="text-xs text-muted-foreground">Botão opcional: precisa de texto e link. Sem botão, a DM vai só com o texto.</p>
      </div>
    </div>
  );
}

export function toInput(d: AutomationDraft): AutomationInput {
  return { keywords: d.keywords, reply_text: d.reply_text, ai_reply: d.ai_reply, dm_text: d.dm_text, cta_text: d.cta_text, cta_link: d.cta_link };
}
