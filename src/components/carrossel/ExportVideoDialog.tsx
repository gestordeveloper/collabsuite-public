import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import * as service from "@/src/services/carrossel.service";

const selectCls = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none";
const labelCls = "mb-1 block text-xs text-muted-foreground";
const ANIMATIONS = [
  { id: "slide", label: "A de cada slide" }, { id: "none", label: "Nenhuma" }, { id: "fade-up", label: "Subir suave" },
  { id: "slide-left", label: "Entrar da esquerda" }, { id: "slide-right", label: "Entrar da direita" }, { id: "zoom-in", label: "Zoom de entrada" },
  { id: "blur-in", label: "Foco (desfoque)" }, { id: "pop", label: "Pop" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  slideCount: number;
  /** Salva o carrossel antes de exportar (o servidor exporta a versão salva). */
  beforeExport: () => Promise<void>;
}

/** Stories (1080×1920), MP4 com animação e PNGs no formato de Stories. */
export function ExportVideoDialog({ open, onOpenChange, projectId, slideCount, beforeExport }: Props) {
  const [format, setFormat] = useState<"feed" | "story">("story");
  const [png, setPng] = useState(true);
  const [mp4, setMp4] = useState(true);
  const [animation, setAnimation] = useState("slide");
  const [seconds, setSeconds] = useState(5);
  const [fps, setFps] = useState(30);
  const [merge, setMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setStage({ stage: "Enviando o pedido", pct: 1 });
    try {
      await beforeExport();
      const job = await service.startExportVideo(projectId, {
        format, outputs: [...(png ? ["png" as const] : []), ...(mp4 ? ["mp4" as const] : [])], animation, seconds, fps, merge,
      });
      const res = await service.waitJob(job, (j) => setStage({ stage: j.stage, pct: j.pct }));
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onOpenChange(false);
    } catch (e) {
      setError(service.errorMessage(e, "Não foi possível exportar."));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Exportar Stories e vídeo</DialogTitle>
          <DialogDescription>Os {slideCount} slides em PNG e/ou MP4. Pode levar alguns minutos.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Formato</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className={selectCls}><option value="story">Stories (1080×1920)</option><option value="feed">Feed (1080×1350)</option></select></div>
          <div><label className={labelCls}>Animação</label>
            <select value={animation} onChange={(e) => setAnimation(e.target.value)} className={selectCls}>{ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
          <div><label className={labelCls}>Duração do slide (s)</label><Input type="number" min={1} max={30} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></div>
          <div><label className={labelCls}>Quadros por segundo</label>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className={selectCls}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select></div>
        </div>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={png} onChange={(e) => setPng(e.target.checked)} /> PNG</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mp4} onChange={(e) => setMp4(e.target.checked)} /> MP4</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} disabled={!mp4} /> Um único vídeo com todos os slides</label>
        </div>
        {busy && stage && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> {stage.stage}</span><span className="font-mono text-muted-foreground">{stage.pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${stage.pct}%` }} /></div>
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={run} disabled={busy || (!png && !mp4)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar (ZIP)</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
