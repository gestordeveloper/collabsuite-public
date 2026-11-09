import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Switch } from "@/src/components/ui/switch";
import {
  deleteKnowledge,
  errorMessage,
  fetchKnowledge,
  saveChannelSettings,
  searchKnowledge,
  uploadKnowledge,
  type KnowledgeHit,
  type KnowledgeStatus,
} from "@/src/services/agent-channel.service";

interface Props {
  agentId: number;
  ragEnabled: boolean;
  onRagChange: (enabled: boolean) => void;
  onNotify: (msg: string) => void;
}

export function KnowledgeTab({ agentId, ragEnabled, onRagChange, onNotify }: Props) {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => fetchKnowledge(agentId).then(setStatus).catch((e) => onNotify(errorMessage(e))), [agentId, onNotify]);
  useEffect(() => void load(), [load]);

  // Enquanto algum arquivo estiver sendo indexado, atualiza a lista sozinha.
  const processing = status?.files.some((f) => f.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [processing, load]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) await uploadKnowledge(agentId, file);
      onNotify("Arquivo(s) enviado(s). A indexação roda em segundo plano.");
      await load();
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function toggleRag(enabled: boolean) {
    try {
      await saveChannelSettings(agentId, { rag_enabled: enabled });
      onRagChange(enabled);
    } catch (err) {
      onNotify(errorMessage(err));
    }
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setHits(await searchKnowledge(agentId, query.trim()));
    } catch (err) {
      onNotify(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-4">
      {status && !status.qdrant_configured && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          O Qdrant não está configurado no servidor. Defina <code>QDRANT_URL</code> (e <code>QDRANT_API_KEY</code>, se houver) no <code>.env</code> e reinicie.
        </p>
      )}
      {status?.qdrant_configured && !status.qdrant_connected && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">Não foi possível conectar ao Qdrant. Verifique a URL e a chave.</p>
      )}

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <h3 className="font-display text-lg font-semibold">RAG (busca semântica)</h3>
          <p className="text-sm text-muted-foreground">Quando ativo, o agente consulta os documentos abaixo antes de responder.</p>
        </div>
        <Switch checked={ragEnabled} onCheckedChange={toggleRag} />
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-display text-lg font-semibold">Upload de documentos</h3>
        <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, CSV, TXT, MD ou HTML. Precisa de uma credencial OpenAI (embeddings).</p>
        <input ref={input} type="file" multiple className="hidden" accept=".pdf,.txt,.docx,.csv,.md,.html,.xlsx" onChange={(e) => onFiles(e.target.files)} />
        <Button onClick={() => input.current?.click()} disabled={uploading || !status?.qdrant_configured} className="gap-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar arquivos
        </Button>
      </Card>

      <Card className="space-y-2 p-5">
        <h3 className="font-display text-lg font-semibold">Arquivos indexados</h3>
        {!status?.files.length ? (
          <p className="text-sm text-muted-foreground">Nenhum arquivo ainda.</p>
        ) : (
          status.files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.filename}</p>
                <p className={`text-xs ${f.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {f.status === "processing" && "Indexando…"}
                  {f.status === "ready" && `${f.chunks_count} trechos`}
                  {f.status === "error" && (f.error || "Erro ao indexar")}
                </p>
              </div>
              {f.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() =>
                  deleteKnowledge(agentId, f.id)
                    .then(load)
                    .catch((e) => onNotify(errorMessage(e)))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-display text-lg font-semibold">Teste de busca</h3>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder="Pergunte algo que esteja nos documentos" />
          <Button onClick={runSearch} disabled={searching} className="gap-2">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </Button>
        </div>
        {hits && (hits.length === 0 ? <p className="text-sm text-muted-foreground">Nada encontrado.</p> : null)}
        {hits?.map((h, i) => (
          <div key={i} className="rounded-lg border p-3 text-sm">
            <p className="mb-1 text-xs text-muted-foreground">
              {h.metadata.source_file} · {h.metadata.chunk_type} · {h.metadata.title} · score {h.score.toFixed(3)}
            </p>
            <p className="whitespace-pre-wrap">{h.text}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}
