import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { NotionEditor } from "@/src/components/editor/NotionEditor";
import { NoteToolbar } from "@/src/components/notes/NoteToolbar";
import { Button } from "@/src/components/ui/button";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import * as attachmentService from "@/src/services/attachment.service";
import { formatShortDate } from "@/src/lib/task-view";
import type { Folder, Task, TaskAttachment } from "@/src/types";

const TEMPLATE_LABELS: Record<string, string> = {
  spreadsheet: "planilha",
  form: "formulário",
  proposal: "proposta",
  flowchart: "fluxograma",
  whatsapp: "campanha de WhatsApp",
  whiteboard: "quadro branco",
};

const TITLE_DELAY = 800;
const CONTENT_DELAY = 1000;

function formatUpdated(value: string): string {
  const d = new Date(value);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Hoje, ${time}` : `${formatShortDate(d)}, ${time}`;
}

interface NoteEditorPaneProps {
  task: Task;
  folders: Folder[];
  onBack: () => void;
  onDelete: (task: Task) => void;
  onMoveToFolder: (task: Task, folderId: number | null) => void;
}

/** Editor da anotação selecionada: título + conteúdo com salvamento automático (uma instância por nota). */
export function NoteEditorPane({ task, folders, onBack, onDelete, onMoveToFolder }: NoteEditorPaneProps) {
  const navigate = useNavigate();
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);

  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content || task.description || "");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: task.title, content: task.content || task.description || "" });

  // Salvamentos da mesma nota entram numa fila: título e conteúdo podem vencer o atraso quase juntos e
  // duas gravações simultâneas na mesma linha podem falhar no servidor.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [inFlight, setInFlight] = useState(0);

  const save = useCallback(
    (patch: Partial<Pick<Task, "title" | "content" | "description">>) => {
      setInFlight((n) => n + 1);
      const run = async () => {
        try {
          updateTaskInState(await taskService.updateTask(task.id, patch));
        } catch (err) {
          console.error("Falha ao salvar a anotação", err);
        } finally {
          setInFlight((n) => n - 1);
        }
      };
      queue.current = queue.current.then(run);
      return queue.current;
    },
    [task.id, updateTaskInState]
  );

  useEffect(
    () => () => {
      if (titleTimer.current) {
        clearTimeout(titleTimer.current);
        titleTimer.current = null;
        save({ title: latest.current.title });
      }
      if (contentTimer.current) {
        clearTimeout(contentTimer.current);
        contentTimer.current = null;
        save({ content: latest.current.content, description: latest.current.content });
      }
    },
    [save]
  );

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [title]);

  function onTitleChange(value: string) {
    setTitle(value);
    latest.current.title = value;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      save({ title: value });
    }, TITLE_DELAY);
  }

  function onContentChange(value: string) {
    setContent(value);
    latest.current.content = value;
    if (contentTimer.current) clearTimeout(contentTimer.current);
    contentTimer.current = setTimeout(() => {
      contentTimer.current = null;
      save({ content: value, description: value });
    }, CONTENT_DELAY);
  }

  async function refresh() {
    const fresh = await taskService.fetchTask(task.id);
    updateTaskInState(fresh);
    setContent(fresh.content || fresh.description || "");
    setRefreshKey((k) => k + 1);
  }

  async function uploadAttachment(file: File): Promise<TaskAttachment | null> {
    try {
      const { url, size, type } = await attachmentService.uploadFile(file);
      const att = await attachmentService.createAttachment(task.id, { file_name: file.name, file_url: url, file_size: size, file_type: type });
      await refresh();
      return att;
    } catch (err) {
      console.error("Upload failed", err);
      return null;
    }
  }

  const folderName = folders.find((f) => f.id === task.folder_id)?.name ?? "Sem pasta";
  const templateLabel = task.template && task.template !== "default" ? TEMPLATE_LABELS[task.template] : null;
  const pending = inFlight > 0 || !!titleTimer.current || !!contentTimer.current;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NoteToolbar
        editor={templateLabel ? null : editor}
        status={pending ? "Salvando…" : "Salvo automaticamente"}
        actions={
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Abrir versão completa" onClick={() => navigate(`/task/${task.id}`)}>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" title="Excluir anotação" onClick={() => onDelete(task)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="note-article mx-auto flex max-w-[760px] flex-col gap-3.5 px-6 pb-24 pt-6 md:px-10 md:pb-20 md:pt-12">
          <button type="button" onClick={onBack} className="-mb-1 flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground md:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> Todas as anotações
          </button>

          {task.cover && <img src={task.cover} alt="" className="h-40 w-full rounded-xl border object-cover" />}

          <span className="text-xs text-subtle">{folderName} / {title || "Sem título"}</span>

          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            placeholder="Sem título"
            onChange={(e) => onTitleChange(e.target.value)}
            className="task-title-textarea w-full resize-none overflow-hidden bg-transparent font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] outline-none placeholder:text-subtle md:text-[36px]"
          />

          <div className="grid grid-cols-[120px_1fr] items-center gap-y-2 border-b pb-4 text-[13px]">
            <span className="text-subtle">Caderno</span>
            <select
              value={task.folder_id ?? ""}
              onChange={(e) => onMoveToFolder(task, e.target.value ? Number(e.target.value) : null)}
              className="h-7 w-fit max-w-full rounded-md border border-transparent bg-transparent px-1 text-[13px] hover:border-input focus:border-primary focus:outline-none"
            >
              <option value="">Sem pasta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <span className="text-subtle">Atualizado</span>
            <span>{formatUpdated(task.updated_at)}</span>
            {task.due_at && (
              <>
                <span className="text-subtle">Prazo</span>
                <span className="font-mono text-xs">{formatShortDate(task.due_at)}</span>
              </>
            )}
          </div>

          {templateLabel ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">
                Esta anotação é uma {templateLabel} e é editada na tela completa.
              </p>
              <Button onClick={() => navigate(`/task/${task.id}`)} className="gap-1.5">
                <ExternalLink className="h-4 w-4" /> Abrir {templateLabel}
              </Button>
            </div>
          ) : (
            <NotionEditor
              key={`${task.id}-${refreshKey}`}
              content={content}
              onChange={onContentChange}
              onEditorReady={setEditor}
              placeholder="Escreva sua anotação… use / para comandos"
              taskId={task.id}
              activities={task.activities}
              checklists={task.checklists}
              attachments={task.attachments}
              onAddActivity={async (c, attachment) => { await taskService.addActivity(task.id, c, attachment); await refresh(); }}
              onAddChecklist={async (t) => { await taskService.addChecklistItem(task.id, t); await refresh(); }}
              onToggleChecklist={async (itemId, isDone) => { await taskService.toggleChecklistItem(itemId, isDone); await refresh(); }}
              onDeleteChecklist={async (itemId) => { await taskService.deleteChecklistItem(itemId); await refresh(); }}
              onUploadAttachment={uploadAttachment}
              onDeleteAttachment={async (attachmentId) => { await attachmentService.deleteAttachment(task.id, attachmentId); await refresh(); }}
              onRefreshTask={refresh}
            />
          )}
        </article>
      </div>
    </div>
  );
}
