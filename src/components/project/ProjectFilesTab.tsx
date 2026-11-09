import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, Folder, ExternalLink, Upload, Download, Trash2, Loader2, Cloud, AlertTriangle, ChevronRight, Home } from "lucide-react";
import { Eye, Copy, Check } from "lucide-react";
import { FilePreviewDialog, type PreviewFile } from "@/src/components/common/FilePreviewDialog";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
import * as driveService from "@/src/services/drive.service";
import { DRIVE_FOLDER_MIME_TYPE } from "@/src/services/drive.service";
import type { DriveFile, DriveStatus } from "@/src/services/drive.service";

function formatSize(size?: string | null) {
  const bytes = Number(size || 0);
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProjectFilesTab({ projectId }: { projectId: number }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  const currentFolderId = path.length > 0 ? path[path.length - 1].id : undefined;

  const loadFiles = useCallback(async (folderId?: string) => {
    setLoadingFiles(true);
    try {
      const list = await driveService.fetchDriveFiles(projectId, folderId);
      setFiles(list);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar os arquivos.");
    } finally {
      setLoadingFiles(false);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPath([]);
    try {
      const s = await driveService.fetchDriveStatus(projectId);
      setStatus(s);
      if (s.folderId) {
        await loadFiles(undefined);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível carregar o status do Drive.");
    } finally {
      setLoading(false);
    }
  }, [projectId, loadFiles]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const s = await driveService.connectDrive(projectId);
      setStatus(s);
      await loadFiles(undefined);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível criar a pasta no Drive.");
    } finally {
      setConnecting(false);
    }
  }

  function openFolder(file: DriveFile) {
    setPath((prev) => [...prev, { id: file.id, name: file.name }]);
    loadFiles(file.id);
  }

  function goToBreadcrumb(index: number) {
    // index === -1 volta para a raiz do projeto
    const nextPath = index === -1 ? [] : path.slice(0, index + 1);
    setPath(nextPath);
    loadFiles(nextPath.length > 0 ? nextPath[nextPath.length - 1].id : undefined);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const uploaded = await driveService.uploadDriveFile(projectId, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl,
        folderId: currentFolderId,
      });
      setFiles((prev) => [uploaded, ...prev]);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCreateFolder() {
    const name = window.prompt("Nome da nova pasta:");
    if (!name?.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      await driveService.createDriveFolder(projectId, { name: name.trim(), parentFolderId: currentFolderId });
      await loadFiles(currentFolderId);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível criar a pasta.");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDelete(file: DriveFile) {
    const isFolder = file.mimeType === DRIVE_FOLDER_MIME_TYPE;
    if (!window.confirm(`Excluir "${file.name}"? ${isFolder ? "A pasta e seu conteúdo vão" : "O arquivo vai"} para a lixeira do Google Drive.`)) return;
    try {
      await driveService.deleteDriveFile(projectId, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível excluir.");
    }
  }

  async function handlePreview(file: DriveFile) {
    setOpeningId(file.id);
    setError(null);
    try {
      const type = file.mimeType.startsWith("application/vnd.google-apps.") ? "application/pdf" : file.mimeType;
      const blob = await driveService.fetchDriveFileBlob(projectId, file.id);
      setPreview({ url: URL.createObjectURL(new Blob([blob], { type })), name: file.name, type });
    } catch {
      setError("Não foi possível abrir este arquivo para visualização.");
    } finally {
      setOpeningId(null);
    }
  }

  function closePreview() {
    if (preview?.url.startsWith("blob:")) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function handleCopyLink(file: DriveFile) {
    try {
      await navigator.clipboard.writeText(file.webViewLink!);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId((id) => (id === file.id ? null : id)), 2000);
    } catch {
      window.prompt("Copie o link:", file.webViewLink!);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  if (!status?.folderId && !status?.currentUserConnected) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Cloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Sua conta do Google não está conectada. Conecte em Configurações para gerenciar arquivos deste projeto no Google Drive.
          </p>
          <Button size="sm" onClick={() => navigate("/settings")}>Ir para Configurações</Button>
        </CardContent>
      </Card>
    );
  }

  if (!status?.folderId) {
    return (
      <Card className="max-w-lg mx-auto mt-8">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <FolderPlus className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Este projeto ainda não tem uma pasta no Google Drive.
          </p>
          <Button size="sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5 mr-1.5" />}
            Criar Pasta no Drive
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!status.ownerConnected && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          O responsável por esta pasta perdeu a conexão com o Google. Peça para reconectar em Configurações para voltar a listar/enviar/excluir arquivos por aqui.
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <button onClick={() => goToBreadcrumb(-1)} className="flex items-center gap-1 hover:text-foreground transition-colors shrink-0">
            <Home className="h-3 w-3" /> Projeto
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 opacity-40 shrink-0" />
              <button
                onClick={() => goToBreadcrumb(i)}
                className={`hover:text-foreground transition-colors truncate ${i === path.length - 1 ? "text-foreground font-medium" : ""}`}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {path.length === 0 && status.folderLink && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => window.open(status.folderLink!, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" /> Abrir no Drive
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleCreateFolder} disabled={creatingFolder}>
            {creatingFolder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
            Nova Pasta
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Enviar Arquivo
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loadingFiles ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">
          {path.length > 0 ? "Esta pasta está vazia." : "Nenhum arquivo enviado ainda."}
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {files.map((file) => {
            const isFolder = file.mimeType === DRIVE_FOLDER_MIME_TYPE;
            return (
              <div key={file.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div
                  className={`flex items-center gap-2.5 min-w-0 ${isFolder ? "cursor-pointer" : ""}`}
                  onClick={isFolder ? () => openFolder(file) : undefined}
                >
                  {isFolder ? (
                    <Folder className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : file.iconLink ? (
                    <img src={file.iconLink} alt="" className="h-5 w-5 shrink-0" />
                  ) : null}
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${isFolder ? "hover:underline" : ""}`}>{file.name}</p>
                    {!isFolder && (
                      <p className="text-xs text-muted-foreground">
                        {formatSize(file.size)}
                        {file.modifiedTime && ` · ${new Date(file.modifiedTime).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isFolder && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Visualizar aqui" disabled={openingId === file.id} onClick={() => handlePreview(file)}>
                      {openingId === file.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  {file.webViewLink && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Copiar link" onClick={() => handleCopyLink(file)}>
                      {copiedId === file.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  {file.webViewLink && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Abrir no Drive" onClick={() => window.open(file.webViewLink!, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {!isFolder && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Baixar" onClick={() => window.open(file.webContentLink || file.webViewLink || "#", "_blank")}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Excluir" onClick={() => handleDelete(file)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {preview && <FilePreviewDialog file={preview} onClose={closePreview} />}
    </div>
  );
}
