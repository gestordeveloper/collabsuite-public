import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, FolderOpen, ImagePlus, Link2, MoreVertical, Plus, Search, SquarePen, Trash2, Users } from "lucide-react";
import * as photosuiteService from "@/src/services/photosuite.service";
import type { PhotoDocumentRecord } from "@/src/lib/photosuite/types";
import { OPEN_ACCEPT, persistImport, readFile } from "@/src/lib/photosuite/formats";
import { useDashboard } from "@/src/context/dashboard.context";
import type { Project } from "@/src/types";
import { Card } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/src/components/ui/dropdown-menu";

const ALL_PROJECTS = "all";
const NO_PROJECT = "none";

const PRESETS = [
  { id: "ig-square", label: "Post Instagram", w: 1080, h: 1080 },
  { id: "ig-portrait", label: "Carrossel / Retrato", w: 1080, h: 1350 },
  { id: "ig-story", label: "Story / Reels", w: 1080, h: 1920 },
  { id: "hd", label: "Full HD", w: 1920, h: 1080 },
  { id: "4k", label: "4K UHD", w: 3840, h: 2160 },
  { id: "a4", label: "A4 (300 dpi)", w: 2480, h: 3508 },
  { id: "custom", label: "Personalizado", w: 1920, h: 1080 },
] as const;

type Background = "white" | "transparent" | "color";

function initialDoc(width: number, height: number, fill: string | null): string {
  return JSON.stringify({
    version: 1,
    width,
    height,
    layers: [
      {
        id: "bg", type: "raster", name: "Fundo", visible: true, locked: false, opacity: 1, blend: "normal",
        x: 0, y: 0, width, height, fill, src: null, mask: null,
      },
    ],
  });
}

function NewDocumentDialog({ open, onOpenChange, projectId, onCreate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: number | null;
  onCreate: (doc: PhotoDocumentRecord) => void;
}) {
  const [name, setName] = useState("Sem título");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("ig-square");
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1080);
  const [bg, setBg] = useState<Background>("white");
  const [color, setColor] = useState("#ffffff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPreset(id: (typeof PRESETS)[number]["id"]) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id)!;
    if (id !== "custom") {
      setW(p.w);
      setH(p.h);
    }
  }

  const valid = name.trim() && w >= 1 && h >= 1 && w <= 16000 && h <= 16000;

  async function create() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fill = bg === "white" ? "#ffffff" : bg === "color" ? color : null;
      const doc = await photosuiteService.createDocument({
        name: name.trim(), width: w, height: h, project_id: projectId, doc: initialDoc(w, h, fill),
      });
      onCreate(doc);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível criar o documento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo documento</DialogTitle>
          <DialogDescription>Escolha o tamanho e o fundo. Dá para mudar o resto depois, camada a camada.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label>Predefinição</Label>
            <Select value={preset} onValueChange={(v) => pickPreset(v as (typeof PRESETS)[number]["id"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}{p.id !== "custom" ? ` — ${p.w}×${p.h}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Largura (px)</Label>
              <Input type="number" min={1} max={16000} value={w} onChange={(e) => { setW(Number(e.target.value)); setPreset("custom"); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Altura (px)</Label>
              <Input type="number" min={1} max={16000} value={h} onChange={(e) => { setH(Number(e.target.value)); setPreset("custom"); }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Fundo</Label>
            <div className="flex items-center gap-2">
              {([
                ["white", "Branco"],
                ["transparent", "Transparente"],
                ["color", "Cor"],
              ] as const).map(([id, label]) => (
                <Button key={id} type="button" size="sm" variant={bg === id ? "default" : "outline"} onClick={() => setBg(id)}>
                  {label}
                </Button>
              ))}
              {bg === "color" && (
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent" />
              )}
            </div>
          </div>
          {w * h > 50_000_000 && (
            <p className="text-xs text-amber-500">Documento muito grande ({Math.round((w * h) / 1e6)} MP) — pode ficar lento no navegador.</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={create} disabled={!valid || busy}>{busy ? "Criando…" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocCard({ doc, project, projects, onOpen, onDuplicate, onDelete, onAssignProject }: {
  doc: PhotoDocumentRecord;
  project: Project | null;
  projects: Project[];
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAssignProject: (projectId: number | null) => void;
}) {
  return (
    <Card className="group cursor-pointer overflow-hidden p-0 transition-all hover:border-primary/40 hover:shadow-md" onClick={onOpen}>
      <div
        className="relative flex aspect-video items-center justify-center bg-[#1b1b1d]"
        style={{
          backgroundImage: "conic-gradient(#2a2a2d 25%, #232326 0 50%, #2a2a2d 0 75%, #232326 0)",
          backgroundSize: "16px 16px",
        }}
      >
        {doc.thumbnail_url ? (
          <img src={doc.thumbnail_url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <SquarePen className="h-8 w-8 text-muted-foreground/40" />
        )}
        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="h-7 w-7 shadow" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4" /> Duplicar</DropdownMenuItem>
              {doc.is_owner !== false && (<>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mover para projeto</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onAssignProject(null)}>
                <span className="h-4 w-4">{!doc.project_id ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                Sem projeto
              </DropdownMenuItem>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => onAssignProject(p.id)}>
                  <span className="h-4 w-4">{doc.project_id === p.id ? <Check className="h-4 w-4 text-primary" /> : null}</span>
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Excluir
              </DropdownMenuItem>
              </>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-primary">{doc.name}</h3>
        {(doc.is_owner === false || doc.visibility === "project" || doc.share_token) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            {doc.is_owner === false && <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary"><Users className="h-3 w-3" /> de {doc.owner_name ?? "um colega"}</span>}
            {doc.is_owner !== false && doc.visibility === "project" && <span className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5"><Users className="h-3 w-3" /> Equipe</span>}
            {doc.share_token && <span className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5"><Link2 className="h-3 w-3" /> Link público</span>}
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{doc.width}×{doc.height}</p>
          {project && (
            <span className="flex items-center gap-1 truncate text-[10px] font-medium text-muted-foreground">
              <FolderOpen className="h-3 w-3 shrink-0" /> <span className="truncate">{project.name}</span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PhotosuitePage() {
  const navigate = useNavigate();
  const { projects } = useDashboard();
  const [docs, setDocs] = useState<PhotoDocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    photosuiteService.listDocuments().then(setDocs).finally(() => setIsLoading(false));
  }, []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const currentProjectId = projectFilter !== ALL_PROJECTS && projectFilter !== NO_PROJECT ? Number(projectFilter) : null;

  const filtered = docs.filter((d) => {
    if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (projectFilter === NO_PROJECT) return !d.project_id;
    if (projectFilter !== ALL_PROJECTS) return d.project_id === Number(projectFilter);
    return true;
  });

  /** Abrir arquivo (PSD, SVG, .photosuite ou imagem): lê, envia os pixels e cria o documento. */
  async function openFile(file: File) {
    setOpening(true);
    try {
      const result = await readFile(file);
      const id = await persistImport(result, currentProjectId);
      navigate(`/photosuite/${id}`);
    } catch (err: any) {
      console.error("Falha ao abrir arquivo", err);
      alert(err?.message || "Não foi possível abrir esse arquivo.");
    } finally {
      setOpening(false);
    }
  }

  async function handleDuplicate(id: number) {
    try {
      const copy = await photosuiteService.duplicateDocument(id);
      setDocs((prev) => [copy, ...prev]);
    } catch (err) {
      console.error("Falha ao duplicar", err);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este documento? Essa ação não pode ser desfeita.")) return;
    try {
      await photosuiteService.deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Falha ao excluir", err);
    }
  }

  async function handleAssignProject(id: number, project_id: number | null) {
    try {
      const updated = await photosuiteService.updateDocument(id, { project_id });
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, project_id: updated.project_id } : d)));
    } catch (err) {
      console.error("Falha ao vincular projeto", err);
    }
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Photosuite</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Editor de imagens com camadas, máscaras e modos de mesclagem — no estilo Photoshop.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={opening} className="h-9 gap-2 text-xs">
            <ImagePlus className="h-4 w-4" /> {opening ? "Abrindo…" : "Abrir arquivo"}
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="h-9 gap-2 text-xs">
            <Plus className="h-4 w-4" /> Novo documento
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={OPEN_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void openFile(f);
          }}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar por nome..." className="h-9 pl-9" />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-9 w-full sm:w-56"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>Todos os projetos</SelectItem>
            <SelectItem value={NO_PROJECT}>Sem projeto</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-card py-20 text-center">
          <SquarePen className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-medium text-muted-foreground">
            {docs.length === 0 ? "Nenhum documento ainda." : "Nenhum documento encontrado para esse filtro."}
          </p>
          {docs.length === 0 && (
            <Button onClick={() => setDialogOpen(true)} variant="secondary" size="sm" className="mt-4 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Criar primeiro documento
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              project={doc.project_id ? projectById.get(doc.project_id) ?? null : null}
              projects={projects}
              onOpen={() => navigate(`/photosuite/${doc.id}`)}
              onDuplicate={() => void handleDuplicate(doc.id)}
              onDelete={() => void handleDelete(doc.id)}
              onAssignProject={(pid) => void handleAssignProject(doc.id, pid)}
            />
          ))}
        </div>
      )}

      <NewDocumentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={currentProjectId}
        onCreate={(doc) => navigate(`/photosuite/${doc.id}`)}
      />
    </div>
  );
}
