import type { Editor } from "@tiptap/react";
import { cn } from "@/src/lib/utils";

interface NoteToolbarProps {
  editor: Editor | null;
  /** Texto de estado à direita ("Salvo automaticamente", "Salvando…"). */
  status: string;
  /** Ações extras (mover de pasta, abrir completa, excluir). */
  actions?: React.ReactNode;
}

const buttonClass = (active: boolean) =>
  cn(
    "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
  );

/** Barra de formatação das anotações (B I U · H1 H2 · Lista Checklist · </>), como no design system. */
export function NoteToolbar({ editor, status, actions }: NoteToolbarProps) {
  const run = (fn: (chain: ReturnType<Editor["chain"]>) => void) => () => {
    if (!editor) return;
    fn(editor.chain().focus());
  };
  const is = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-4 no-scrollbar md:px-6">
      <button type="button" title="Negrito" className={cn(buttonClass(is("bold")), "font-bold")} onClick={run((c) => c.toggleBold().run())}>B</button>
      <button type="button" title="Itálico" className={cn(buttonClass(is("italic")), "italic")} onClick={run((c) => c.toggleItalic().run())}>I</button>
      <button type="button" title="Sublinhado" className={cn(buttonClass(is("underline")), "underline")} onClick={run((c) => c.toggleUnderline().run())}>U</button>
      <span className="mx-1.5 h-[18px] w-px shrink-0 bg-border" />
      <button type="button" className={buttonClass(is("heading", { level: 1 }))} onClick={run((c) => c.toggleHeading({ level: 1 }).run())}>H1</button>
      <button type="button" className={buttonClass(is("heading", { level: 2 }))} onClick={run((c) => c.toggleHeading({ level: 2 }).run())}>H2</button>
      <button type="button" className={buttonClass(is("bulletList"))} onClick={run((c) => c.toggleBulletList().run())}>Lista</button>
      <button type="button" className={buttonClass(is("taskList"))} onClick={run((c) => c.toggleTaskList().run())}>Checklist</button>
      <button type="button" title="Bloco de código" className={cn(buttonClass(is("codeBlock")), "font-mono")} onClick={run((c) => c.toggleCodeBlock().run())}>&lt;/&gt;</button>
      <div className="flex-1" />
      <span className="mr-2 shrink-0 whitespace-nowrap text-xs text-subtle">{status}</span>
      {actions}
    </div>
  );
}
