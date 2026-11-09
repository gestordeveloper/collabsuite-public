import { useEffect, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { usePhotosuite } from "@/src/store/photosuite.store";
import { cn } from "@/src/lib/utils";

const MAX = 16000;
const clampSize = (v: number) => Math.max(1, Math.min(MAX, Math.round(v) || 1));

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Tamanho da imagem: reamostra todas as camadas. */
export function ImageSizeDialog({ open, onOpenChange }: Props) {
  const width = usePhotosuite((s) => s.width);
  const height = usePhotosuite((s) => s.height);
  const resizeImage = usePhotosuite((s) => s.resizeImage);
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const [linked, setLinked] = useState(true);

  useEffect(() => {
    if (open) {
      setW(width);
      setH(height);
      setLinked(true);
    }
  }, [open, width, height]);

  const ratio = width / height;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tamanho da imagem</DialogTitle>
          <DialogDescription>Reamostra todas as camadas. Atual: {width}×{height} px.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label>Largura (px)</Label>
            <Input type="number" min={1} max={MAX} value={w} onChange={(e) => { const v = clampSize(Number(e.target.value)); setW(v); if (linked) setH(clampSize(v / ratio)); }} />
          </div>
          <button type="button" onClick={() => setLinked(!linked)} className="mb-1.5 flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent" title="Manter proporção">
            {linked ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
          </button>
          <div className="flex-1 space-y-1.5">
            <Label>Altura (px)</Label>
            <Input type="number" min={1} max={MAX} value={h} onChange={(e) => { const v = clampSize(Number(e.target.value)); setH(v); if (linked) setW(clampSize(v * ratio)); }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { resizeImage(w, h); onOpenChange(false); }}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tamanho da tela: muda o enquadramento sem reamostrar; a âncora diz de onde cresce/encolhe. */
export function CanvasSizeDialog({ open, onOpenChange }: Props) {
  const width = usePhotosuite((s) => s.width);
  const height = usePhotosuite((s) => s.height);
  const resizeCanvas = usePhotosuite((s) => s.resizeCanvas);
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);

  useEffect(() => {
    if (open) {
      setW(width);
      setH(height);
      setAnchor([0.5, 0.5]);
    }
  }, [open, width, height]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tamanho da tela</DialogTitle>
          <DialogDescription>Atual: {width}×{height} px. As camadas não são reamostradas.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Largura (px)</Label>
            <Input type="number" min={1} max={MAX} value={w} onChange={(e) => setW(clampSize(Number(e.target.value)))} />
          </div>
          <div className="space-y-1.5">
            <Label>Altura (px)</Label>
            <Input type="number" min={1} max={MAX} value={h} onChange={(e) => setH(clampSize(Number(e.target.value)))} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Âncora</Label>
          <div className="grid w-24 grid-cols-3 gap-1">
            {[0, 0.5, 1].flatMap((ay) =>
              [0, 0.5, 1].map((ax) => {
                const on = anchor[0] === ax && anchor[1] === ay;
                return (
                  <button
                    key={`${ax}-${ay}`}
                    type="button"
                    aria-label={`Âncora ${ax},${ay}`}
                    onClick={() => setAnchor([ax, ay])}
                    className={cn("h-7 rounded border", on ? "border-primary bg-primary" : "border-input bg-secondary hover:bg-accent")}
                  />
                );
              }),
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { resizeCanvas(w, h, anchor[0], anchor[1]); onOpenChange(false); }}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
