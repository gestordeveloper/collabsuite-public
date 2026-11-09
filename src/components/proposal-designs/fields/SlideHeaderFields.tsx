import { TextField } from "./TextField";
import { TextAreaField } from "./TextAreaField";
import type { RunningHeader, SlideHeader } from "@/src/lib/proposal-designs/types";

interface HeaderProps {
  header: SlideHeader | undefined;
  onChange: (header: SlideHeader) => void;
  titleHint?: string;
  show?: { title?: boolean; intro?: boolean; introQuote?: boolean };
}

/** Editor for the common title/intro (and optional pull-quote) that most kinds show above their content.
 *  `show` is decided by each kind-editor to match what its renderer actually displays. */
export function SlideHeaderFields({ header, onChange, titleHint, show }: HeaderProps) {
  const h = header || {};
  const s = show || { title: true, intro: true };
  return (
    <div className="grid grid-cols-1 gap-3 border-b pb-3">
      {s.title && (
        <TextAreaField
          label="Título"
          value={h.title || ""}
          onChange={(v) => onChange({ ...h, title: v })}
          rows={2}
          hint={titleHint || "Use uma quebra de linha para dividir o título em duas linhas."}
        />
      )}
      {s.intro && (
        <TextAreaField label="Texto de introdução" value={h.intro || ""} onChange={(v) => onChange({ ...h, intro: v })} rows={3} />
      )}
      {s.introQuote && (
        <div className="grid grid-cols-1 gap-2">
          <TextAreaField label="Citação" value={h.introQuote?.text || ""} onChange={(v) => onChange({ ...h, introQuote: { text: v, attribution: h.introQuote?.attribution || "" } })} rows={2} />
          <TextField label="Atribuição da citação" value={h.introQuote?.attribution || ""} onChange={(v) => onChange({ ...h, introQuote: { text: h.introQuote?.text || "", attribution: v } })} />
        </div>
      )}
    </div>
  );
}

interface RunningHeaderProps {
  value: RunningHeader | undefined;
  onChange: (v: RunningHeader) => void;
}

export function RunningHeaderFields({ value, onChange }: RunningHeaderProps) {
  const v = value || {};
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField label="Cabeçalho (esquerda)" value={v.left || ""} onChange={(val) => onChange({ ...v, left: val })} />
      <TextField label="Cabeçalho (direita)" value={v.right || ""} onChange={(val) => onChange({ ...v, right: val })} />
    </div>
  );
}
