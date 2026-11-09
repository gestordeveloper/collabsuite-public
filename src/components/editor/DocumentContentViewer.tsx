import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
import type { Task } from "@/src/types";
import { CommentThreadExtension } from "@/src/components/editor/nodes/CommentThread";
import { TaskChecklistExtension } from "@/src/components/editor/nodes/TaskChecklist";
import { AttachmentExtension } from "@/src/components/editor/nodes/Attachment";
import { SubtaskListExtension } from "@/src/components/editor/nodes/SubtaskList";
import { SprintListExtension } from "@/src/components/editor/nodes/SprintList";
import { DriveFilesExtension } from "@/src/components/editor/nodes/DriveFiles";

/** Read-only TipTap viewer — same extensions as NotionEditor, editable=false.
 *  Shared by the public task page and the "Documento" PDF export. */
export function DocumentContentViewer({
  html,
  task,
  onAddComment,
}: {
  html: string;
  task: Task;
  /** Quando informado (link público), o nó de comentários aceita novos comentários mesmo somente leitura. */
  onAddComment?: (content: string, attachment?: { file?: File }) => Promise<void>;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskChecklistExtension,
      SubtaskListExtension,
      SprintListExtension,
      AttachmentExtension,
      DriveFilesExtension,
      CommentThreadExtension,
    ],
    content: html,
    editable: false,
    editorProps: {
      attributes: {
        class: "max-w-none focus:outline-none min-h-[40px] text-sm leading-relaxed prose-tables:border-collapse prose-tables:w-full prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:p-2 prose-th:bg-muted/50",
      },
    },
  });

  useEffect(() => {
    if (editor && task) {
      const commentStorage = (editor.storage as any).commentThread;
      if (commentStorage) {
        commentStorage.activities = task.activities || [];
        commentStorage.onAddActivity = onAddComment ?? null;
      }
      const checklistStorage = (editor.storage as any).taskChecklist;
      if (checklistStorage) {
        checklistStorage.checklists = task.checklists || [];
        checklistStorage.onAddChecklist = null;
        checklistStorage.onToggleChecklist = null;
        checklistStorage.onDeleteChecklist = null;
      }
      const attachmentStorage = (editor.storage as any).attachment;
      if (attachmentStorage) {
        attachmentStorage.attachments = task.attachments || [];
        attachmentStorage.onUploadFile = null;
        attachmentStorage.onDeleteAttachment = null;
      }
      const subtaskStorage = (editor.storage as any).subtaskList;
      if (subtaskStorage) {
        subtaskStorage.taskId = task.id;
        subtaskStorage.subtasks = (task as any).subtasks || [];
      }
      const sprintStorage = (editor.storage as any).sprintList;
      if (sprintStorage) {
        sprintStorage.taskId = task.id;
        sprintStorage.sprintTasks = (task as any).sprintTasks || [];
      }
      const driveStorage = (editor.storage as any).driveFiles;
      if (driveStorage) {
        driveStorage.taskId = task.id;
        driveStorage.isPublic = true;
      }
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, task, onAddComment]);

  return (
    <div className="notion-editor">
      <div className="px-1 pt-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
