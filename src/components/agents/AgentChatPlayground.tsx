import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Wrench, Loader2, AtSign, Target, Paperclip, X, FileText, FileSpreadsheet, FileImage, File as FileIcon, Download } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/src/components/ui/button";
import { Textarea } from "@/src/components/ui/textarea";
import type { Agent, ChatHistoryMessage, ToolCallEntry } from "@/src/services/agent.service";
import { fetchIcps, type Icp } from "@/src/services/icp.service";
import {
  fetchConversations,
  fetchConversation,
  sendConversationMessage,
  renameConversation,
  deleteConversation,
  type ConversationSummary,
  type MessageAttachment,
} from "@/src/services/agent-conversation.service";
import { uploadFile } from "@/src/services/upload.service";
import { AgentConversationSidebar } from "@/src/components/agents/AgentConversationSidebar";

interface ChatMessage extends ChatHistoryMessage {
  toolCalls?: ToolCallEntry[];
  attachments?: MessageAttachment[];
}

interface PendingAttachment {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  uploaded?: MessageAttachment;
  error?: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15MB
const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.xls,.csv,.txt,.md," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function attachmentIcon(mimeType: string) {
  if (isImageAttachment(mimeType)) return FileImage;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.startsWith("text/")) return FileText;
  return FileIcon;
}

function extractImageUrl(tc: { tool: string; result: string }): string | null {
  if (tc.tool !== "generate_image") return null;
  try {
    const parsed = JSON.parse(tc.result);
    return typeof parsed?.image_url === "string" ? parsed.image_url : null;
  } catch {
    return null;
  }
}

function extractGeneratedFile(tc: { tool: string; result: string }): { url: string; filename: string } | null {
  if (tc.tool !== "generate_file") return null;
  try {
    const parsed = JSON.parse(tc.result);
    if (typeof parsed?.file_url === "string") {
      return { url: parsed.file_url, filename: typeof parsed.filename === "string" ? parsed.filename : "arquivo" };
    }
    return null;
  } catch {
    return null;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ICP names mentioned via "@Nome" in the current draft — matched against the user's real ICPs,
 *  never left to the model to guess, so different clients' ICPs never bleed into each other. */
function findMentionedIcps(text: string, icps: Icp[]): Icp[] {
  return icps.filter((icp) => new RegExp(`@${escapeRegex(icp.name)}\\b`, "i").test(text));
}

// Estilos usam `current`/opacidade em vez de cores fixas, já que a mesma mensagem pode
// renderizar tanto sobre a bolha do usuário (bg-primary) quanto a do assistente (bg-muted).
const chatMarkdownComponents: Components = {
  p: ({ node: _node, ...props }) => <p className="mb-1.5 last:mb-0" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  h1: ({ node: _node, ...props }) => <h1 className="mb-1 mt-1.5 text-sm font-bold first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="mb-1 mt-1.5 text-sm font-bold first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="mb-1 mt-1.5 text-xs font-bold first:mt-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0" {...props} />,
  li: ({ node: _node, ...props }) => <li {...props} />,
  a: ({ node: _node, ...props }) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre className="mb-1.5 overflow-x-auto rounded-lg bg-black/10 p-2 text-[11px] last:mb-0 dark:bg-white/10" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 border-current/30 pl-2 italic opacity-80" {...props} />
  ),
  hr: () => <hr className="my-1.5 border-current/20" />,
  table: ({ node: _node, ...props }) => (
    <div className="mb-1.5 overflow-x-auto last:mb-0">
      <table className="border-collapse text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead {...props} />,
  tr: ({ node: _node, ...props }) => <tr className="border-b border-current/20" {...props} />,
  th: ({ node: _node, ...props }) => <th className="whitespace-nowrap px-2 py-1 text-left font-semibold" {...props} />,
  td: ({ node: _node, ...props }) => <td className="px-2 py-1 align-top" {...props} />,
};

function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

export function AgentChatPlayground({ agent }: { agent: Agent }) {
  const icpToolEnabled = agent.allowed_tools.includes("get_icp");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icps, setIcps] = useState<Icp[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (icpToolEnabled) fetchIcps().then(setIcps);
  }, [icpToolEnabled]);

  useEffect(() => {
    fetchConversations(agent.id).then(setConversations);
  }, [agent.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  function resetDraft() {
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setMentionQuery(null);
    setMentionStart(null);
    setPendingAttachments([]);
  }

  async function handleSelectConversation(id: number) {
    if (sending || loadingConversation || id === activeConversationId) return;
    setLoadingConversation(true);
    try {
      const detail = await fetchConversation(id);
      setMessages(detail.messages.map((m) => ({ role: m.role, content: m.content, toolCalls: m.tool_calls, attachments: m.attachments })));
      setActiveConversationId(id);
      setInput("");
      setError(null);
      setMentionQuery(null);
      setMentionStart(null);
      setPendingAttachments([]);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar essa conversa.");
    } finally {
      setLoadingConversation(false);
    }
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_ATTACHMENTS - pendingAttachments.length);
    if (fileInputRef.current) fileInputRef.current.value = "";

    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setPendingAttachments((prev) => [...prev, { id, file, status: "error", error: `Arquivo maior que ${formatFileSize(MAX_ATTACHMENT_SIZE)}.` }]);
        continue;
      }
      setPendingAttachments((prev) => [...prev, { id, file, status: "uploading" }]);
      try {
        const { url, size, type } = await uploadFile(file);
        const uploaded: MessageAttachment = { url, filename: file.name, mimeType: type, size };
        setPendingAttachments((prev) => prev.map((p) => (p.id === id ? { ...p, status: "done", uploaded } : p)));
      } catch (err: any) {
        setPendingAttachments((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: "error", error: err?.response?.data?.error || "Falha ao enviar arquivo." } : p))
        );
      }
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleRenameConversation(id: number, currentTitle: string) {
    const title = window.prompt("Novo título da conversa:", currentTitle);
    if (!title || !title.trim() || title.trim() === currentTitle) return;
    try {
      const updated = await renameConversation(id, title.trim());
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível renomear a conversa.");
    }
  }

  async function handleDeleteConversation(id: number) {
    if (!confirm("Excluir esta conversa? Essa ação não pode ser desfeita.")) return;
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeConversationId) resetDraft();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível excluir a conversa.");
    }
  }

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return icps.filter((i) => i.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);
  }, [mentionQuery, icps]);

  const activeMentions = useMemo(() => findMentionedIcps(input, icps), [input, icps]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);

    if (!icpToolEnabled || icps.length === 0) {
      setMentionQuery(null);
      return;
    }
    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const match = uptoCursor.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(cursor - match[0].length);
      setHighlighted(0);
    } else {
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  function selectMention(icp: Icp) {
    if (mentionStart == null) return;
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursor);
    const inserted = `@${icp.name} `;
    setInput(before + inserted + after);
    setMentionQuery(null);
    setMentionStart(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionMatches[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        setMentionStart(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSend() {
    const text = input.trim();
    const readyAttachments = pendingAttachments.filter((p): p is PendingAttachment & { uploaded: MessageAttachment } => p.status === "done" && !!p.uploaded);
    const stillUploading = pendingAttachments.some((p) => p.status === "uploading");
    if ((!text && readyAttachments.length === 0) || sending || stillUploading) return;

    const icpIds = findMentionedIcps(text, icps).map((i) => i.id);
    const conversationIdAtSend = activeConversationId;
    const attachmentsToSend = readyAttachments.map((p) => p.uploaded);
    setMessages((prev) => [...prev, { role: "user", content: text || "(arquivo anexado)", attachments: attachmentsToSend }]);
    setInput("");
    setPendingAttachments([]);
    setMentionQuery(null);
    setSending(true);
    setError(null);

    try {
      const result = await sendConversationMessage(agent.id, {
        conversation_id: conversationIdAtSend,
        message: text,
        icp_ids: icpIds.length ? icpIds : undefined,
        attachments: attachmentsToSend.length ? attachmentsToSend : undefined,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: result.message.content, toolCalls: result.message.tool_calls }]);

      setConversations((prev) => {
        const previousEntry = prev.find((c) => c.id === result.conversation.id);
        const entry: ConversationSummary = {
          id: result.conversation.id,
          agent_id: agent.id,
          title: result.conversation.title,
          created_at: previousEntry?.created_at ?? result.conversation.created_at,
          updated_at: result.conversation.updated_at,
          message_count: (previousEntry?.message_count ?? 0) + 2,
          last_message_preview: result.message.content.slice(0, 80),
        };
        return [entry, ...prev.filter((c) => c.id !== entry.id)];
      });
      if (conversationIdAtSend === null) setActiveConversationId(result.conversation.id);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível obter uma resposta do agente.");
    } finally {
      setSending(false);
    }
  }

  const canSend =
    !sending &&
    (!!input.trim() || pendingAttachments.some((p) => p.status === "done")) &&
    !pendingAttachments.some((p) => p.status === "uploading");
  const isEmpty = messages.length === 0 && !loadingConversation;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const composer = (
    <div className="relative w-full">
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-44 overflow-y-auto rounded-xl border bg-popover shadow-md">
          {mentionMatches.map((icp, i) => (
            <button
              key={icp.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectMention(icp);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                i === highlighted ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{icp.name}</span>
              {icp.niche && <span className="shrink-0 text-xs text-muted-foreground">· {icp.niche}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border bg-card px-3 pb-2.5 pt-3 shadow-sm transition-colors focus-within:border-foreground/30">
        {(pendingAttachments.length > 0 || (icpToolEnabled && activeMentions.length > 0)) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {activeMentions.map((icp) => (
              <span
                key={icp.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
              >
                <Target className="h-3 w-3" /> {icp.name}
              </span>
            ))}
            {pendingAttachments.map((p) => {
              const Icon = attachmentIcon(p.file.type);
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                    p.status === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-muted"
                  }`}
                >
                  {p.status === "uploading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  <span className="max-w-[140px] truncate">{p.file.name}</span>
                  {p.status === "error" && <span className="max-w-[160px] truncate">— {p.error}</span>}
                  <button type="button" onClick={() => removePendingAttachment(p.id)} className="opacity-60 hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            icpToolEnabled && icps.length > 0
              ? `Converse com ${agent.name}... (@ para marcar um ICP)`
              : `Converse com ${agent.name}...`
          }
          rows={1}
          className="max-h-[200px] min-h-[28px] resize-none border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center justify-between">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || pendingAttachments.length >= MAX_ATTACHMENTS}
            title="Anexar arquivo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button size="icon" className="h-8 w-8 rounded-full" onClick={handleSend} disabled={!canSend} title="Enviar">
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <AgentConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        disabled={sending || loadingConversation}
        onNew={resetDraft}
        onSelect={handleSelectConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
            <h3 className="flex items-center gap-3 text-center font-display text-3xl font-semibold tracking-tight">
              <span className="text-4xl leading-none">{agent.avatar_emoji || "🤖"}</span>
              Como posso ajudar?
            </h3>
            <div className="w-full max-w-2xl">{composer}</div>
            <p className="text-xs text-muted-foreground">
              Conversando com {agent.name}
              {icpToolEnabled && icps.length > 0 && " · digite @ para marcar um ICP"}
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
        <>
        <div className="flex-1 overflow-y-auto px-4 py-6">
         <div className="mx-auto w-full max-w-3xl space-y-6">
          {loadingConversation && (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px]"
                    : "w-full text-[15px] leading-relaxed"
                }
              >
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.attachments.map((att, j) =>
                      isImageAttachment(att.mimeType) ? (
                        <a key={j} href={att.url} target="_blank" rel="noreferrer" className="block">
                          <img src={att.url} alt={att.filename} className="h-20 w-20 rounded-lg border object-cover" />
                        </a>
                      ) : (
                        <a
                          key={j}
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-current/20 bg-black/5 px-2 py-1 text-xs dark:bg-white/5"
                        >
                          {(() => {
                            const Icon = attachmentIcon(att.mimeType);
                            return <Icon className="h-3.5 w-3.5 shrink-0" />;
                          })()}
                          <span className="max-w-[140px] truncate">{att.filename}</span>
                          <span className="opacity-60">· {formatFileSize(att.size)}</span>
                        </a>
                      )
                    )}
                  </div>
                )}
                <ChatMarkdown content={m.content} />
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {m.toolCalls.map((tc, j) => {
                      const imageUrl = extractImageUrl(tc);
                      const generatedFile = extractGeneratedFile(tc);
                      return (
                        <div key={j}>
                          <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                            <Wrench className="h-3 w-3" /> {tc.tool}
                          </div>
                          {imageUrl && (
                            <img src={imageUrl} alt="Imagem gerada" className="mt-2 max-w-[320px] rounded-xl border" />
                          )}
                          {generatedFile && (
                            <a
                              href={generatedFile.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1.5 flex items-center gap-2 rounded-lg border border-current/20 bg-black/5 px-3 py-2 text-xs hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
                            >
                              <Download className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{generatedFile.filename}</span>
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando...
            </div>
          )}
          <div ref={bottomRef} />
         </div>
        </div>

        <div className="px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            {composer}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
