import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Type, Heading1, List, ListOrdered, ListChecks, MessageSquare,
  Quote, Minus, Code, Paperclip, Table, ListTree, Rocket, HardDrive
} from "lucide-react";

interface SlashItem {
  title: string;
  description: string;
  icon: any;
  command: ({ editor, range }: { editor: any; range: any }) => void;
}

const items: SlashItem[] = [
  { title: "Texto", description: "Apenas texto simples", icon: Type, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { title: "Título 1", description: "Heading de primeiro nível", icon: Heading1, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run() },
  { title: "Título 2", description: "Heading de segundo nível", icon: Heading1, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run() },
  { title: "Título 3", description: "Heading de terceiro nível", icon: Heading1, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run() },
  { title: "Lista com marcadores", description: "Lista não ordenada", icon: List, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: "Lista numerada", description: "Lista ordenada", icon: ListOrdered, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: "Checklist", description: "Lista de tarefas com checkboxes do banco", icon: ListChecks, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "taskChecklist" }).run() },
  { title: "Comentários", description: "Thread de comentários da tarefa", icon: MessageSquare, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "commentThread" }).run() },
  { title: "Citação", description: "Bloco de citação", icon: Quote, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: "Anexos", description: "Upload de arquivos na tarefa", icon: Paperclip, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "attachment" }).run() },
  { title: "Arquivos do Drive", description: "Selecionar e visualizar arquivos do Google Drive", icon: HardDrive, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "driveFiles" }).run() },
  { title: "Tabela", description: "Inserir tabela 3x3", icon: Table, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Subtarefas", description: "Lista de subtarefas vinculadas", icon: ListTree, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "subtaskList" }).run() },
  { title: "Tarefas da Sprint", description: "Lista de tarefas da mesma Sprint", icon: Rocket, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "sprintList" }).run() },
  { title: "Divisor", description: "Linha horizontal", icon: Minus, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { title: "Bloco de código", description: "Código formatado", icon: Code, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
];

function getQueryText(doc: any, cursorPos: number): string {
  const before = doc.textBetween(Math.max(0, cursorPos - 50), cursorPos, " ");
  const slashIdx = before.lastIndexOf("/");
  if (slashIdx === -1) return "";
  return before.slice(slashIdx + 1);
}

function SlashPopup({ editor, slashPos, onClose }: { editor: any; slashPos: number; onClose: () => void }) {
  const [query, setQuery] = useState(() => getQueryText(editor.state.doc, editor.state.selection.from));
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const onTransaction = () => {
      const pos = editor.state.selection.from;
      setQuery(getQueryText(editor.state.doc, pos));
    };
    editor.on("transaction", onTransaction);
    return () => editor.off("transaction", onTransaction);
  }, [editor]);

  const filtered = items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => setSelectedIndex(0), [query]);

  const handleSelect = (index: number) => {
    const item = filtered[index];
    if (item) {
      const range = { from: slashPos, to: editor.state.selection.from };
      item.command({ editor, range });
      onClose();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); handleSelect(selectedIndex); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex]);

  return (
    <div className="w-64 max-h-64 overflow-y-auto rounded-xl border bg-popover py-1 text-popover-foreground shadow-xl">
      {filtered.length === 0 && <div className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum resultado</div>}
      {filtered.map((item, index) => (
        <button
          key={item.title}
          onMouseDown={(e) => { e.preventDefault(); handleSelect(index); }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-all ${index === selectedIndex ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"}`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <item.icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{item.title}</div>
            <div className="truncate text-[10px] text-muted-foreground">{item.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export const SlashMenuExtension = Extension.create({
  name: "slashMenu",

  addProseMirrorPlugins() {
    const extension = this;
    let popupRoot: Root | null = null;
    let popupEl: HTMLDivElement | null = null;
    let slashPos: number | null = null;

    function closePopup() {
      if (popupRoot) { popupRoot.unmount(); popupRoot = null; }
      if (popupEl) { popupEl.remove(); popupEl = null; }
      slashPos = null;
    }

    function openPopup(pos: number) {
      const coords = extension.editor.view.coordsAtPos(pos);
      if (!coords) return;
      const editorEl = extension.editor.view.dom.closest(".notion-editor") || extension.editor.view.dom.parentElement;
      if (!editorEl) return;
      if (!popupEl) {
        popupEl = document.createElement("div");
        popupEl.style.position = "fixed";
        popupEl.style.zIndex = "9999";
        document.body.appendChild(popupEl);
      }
      popupEl.style.left = `${coords.left}px`;
      popupEl.style.top = `${coords.bottom + 4}px`;
      popupEl.style.width = "256px";
      slashPos = pos;
      if (!popupRoot) popupRoot = createRoot(popupEl);
      popupRoot.render(
        <SlashPopup editor={extension.editor} slashPos={pos} onClose={() => { closePopup(); extension.editor.commands.focus(); }} />
      );
    }

    return [
      new Plugin({
        key: new PluginKey("slashMenu"),
        props: {
          handleKeyDown(view, event) {
            if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              const { state } = view;
              const { empty, from } = state.selection;
              if (!empty) return false;
              const charBefore = state.doc.textBetween(Math.max(0, from - 1), from, " ");
              const isLineStart = charBefore === "" || charBefore.endsWith("\n");
              if (!isLineStart) return false;
              setTimeout(() => openPopup(from), 0);
              return false;
            }
            if (event.key === "Escape" && slashPos !== null) { closePopup(); return true; }
            if (event.key === "Backspace" && slashPos !== null) {
              const { from } = extension.editor.state.selection;
              if (from <= slashPos + 1) closePopup();
            }
            return false;
          },
        },
      }),
    ];
  },
});