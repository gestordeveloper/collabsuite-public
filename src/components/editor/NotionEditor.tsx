import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { useEffect, useRef } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code as CodeIcon,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote, Highlighter, Palette,
  Table as TableIcon
} from "lucide-react";
import { CommentThreadExtension, type ActivityAttachmentInput } from "./nodes/CommentThread";
import { TaskChecklistExtension } from "./nodes/TaskChecklist";
import { AttachmentExtension } from "./nodes/Attachment";
import { SlashMenuExtension } from "./SlashMenu";
import { SubtaskListExtension } from "./nodes/SubtaskList";
import { SprintListExtension } from "./nodes/SprintList";
import { DriveFilesExtension } from "./nodes/DriveFiles";
import type { TaskChecklist, TaskActivity, TaskAttachment } from "../../types";

interface NotionEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Entrega a instância do editor a quem quiser desenhar a própria barra de formatação (ex.: Anotações). */
  onEditorReady?: (editor: Editor | null) => void;

  taskId?: number;
  activities?: TaskActivity[];
  checklists?: TaskChecklist[];
  attachments?: TaskAttachment[];
  onAddActivity?: (content: string, attachment?: ActivityAttachmentInput) => Promise<void>;
  onAddChecklist?: (title: string) => Promise<void>;
  onToggleChecklist?: (itemId: number, is_done: boolean) => Promise<void>;
  onDeleteChecklist?: (itemId: number) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<TaskAttachment | null>;
  onDeleteAttachment?: (attachmentId: number) => Promise<void>;
  onRefreshTask?: () => void;
}

export function NotionEditor({
  content, onChange, placeholder = "Digite / para comandos...", className = "", onEditorReady,
  taskId, activities, checklists, attachments, onAddActivity, onAddChecklist, onToggleChecklist, onDeleteChecklist, onUploadAttachment, onDeleteAttachment, onRefreshTask,
}: NotionEditorProps) {
  const updatingContent = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      CommentThreadExtension,
      TaskChecklistExtension,
      AttachmentExtension,
      SlashMenuExtension,
      SubtaskListExtension,
      SprintListExtension,
      DriveFilesExtension,
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      if (!updatingContent.current) {
        onChange(editor.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: "max-w-none focus:outline-none min-h-[160px] text-sm leading-relaxed prose-tables:border-collapse prose-tables:w-full prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/50",
      },
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (editor && content !== undefined) {
      const currentHtml = editor.getHTML();
      if (currentHtml !== content) {
        updatingContent.current = true;
        requestAnimationFrame(() => {
          editor.commands.setContent(content || "");
          updatingContent.current = false;
        });
      }
    }
  }, [editor, content]);

  useEffect(() => {
    if (editor && taskId && activities && checklists && onAddActivity && onAddChecklist && onToggleChecklist && onDeleteChecklist) {
      const commentStorage = (editor.storage as any).commentThread;
      if (commentStorage) {
        commentStorage.activities = activities;
        commentStorage.onAddActivity = onAddActivity;
      }
      const checklistStorage = (editor.storage as any).taskChecklist;
      if (checklistStorage) {
        checklistStorage.checklists = checklists;
        checklistStorage.onAddChecklist = onAddChecklist;
        checklistStorage.onToggleChecklist = onToggleChecklist;
        checklistStorage.onDeleteChecklist = onDeleteChecklist;
      }
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, taskId, activities, checklists, onAddActivity, onAddChecklist, onToggleChecklist, onDeleteChecklist]);

  useEffect(() => {
    if (editor && taskId) {
      const attachmentStorage = (editor.storage as any).attachment;
      if (attachmentStorage) {
        attachmentStorage.attachments = attachments || [];
        attachmentStorage.onUploadFile = onUploadAttachment || null;
        attachmentStorage.onDeleteAttachment = onDeleteAttachment || null;
      }
      const subtaskStorage = (editor.storage as any).subtaskList;
      if (subtaskStorage) subtaskStorage.taskId = taskId;
      const sprintStorage = (editor.storage as any).sprintList;
      if (sprintStorage) sprintStorage.taskId = taskId;
      const driveStorage = (editor.storage as any).driveFiles;
      if (driveStorage) driveStorage.taskId = taskId;

      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, taskId, attachments, onUploadAttachment, onDeleteAttachment]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `flex h-8 w-8 items-center justify-center rounded-md transition-colors ${active ? "bg-primary/15 text-primary" : "text-foreground hover:bg-muted"}`;

  return (
    <div className={`notion-editor ${className}`}>
      <div className="px-1 pt-2">
        <EditorContent editor={editor} />
      </div>
      <BubbleMenu
        editor={editor}
        shouldShow={({ state }) => !state.selection.empty || editor.isActive("table")}
        className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg max-w-sm"
      >
        <button className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></button>
        
        <div className="mx-0.5 h-5 w-px bg-border" />
        
        {/* Color picker */}
        <div className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted cursor-pointer overflow-hidden">
          <Palette className="h-4 w-4 text-foreground pointer-events-none absolute" />
          <input 
            type="color" 
            onInput={(e) => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()} 
            value={editor.getAttributes("textStyle").color || "#000000"} 
            className="w-full h-full opacity-0 cursor-pointer"
            title="Cor do Texto"
          />
        </div>
        
        {/* Highlight picker */}
        <div className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted cursor-pointer overflow-hidden">
          <Highlighter className="h-4 w-4 text-foreground pointer-events-none absolute" />
          <input 
            type="color" 
            onInput={(e) => editor.chain().focus().toggleHighlight({ color: (e.target as HTMLInputElement).value }).run()} 
            value={editor.getAttributes("highlight").color || "#ffcc00"} 
            className="w-full h-full opacity-0 cursor-pointer"
            title="Cor de Marca-texto"
          />
        </div>
        
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></button>
        <button className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></button>
        
        {/* Table controls only show if in table */}
        {editor.isActive("table") && (
          <>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <button className={btn(false)} onClick={() => editor.chain().focus().deleteTable().run()} title="Deletar tabela">
              <TableIcon className="h-4 w-4 text-destructive" />
            </button>
          </>
        )}
      </BubbleMenu>
    </div>
  );
}
