import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Images, Trash2, Download } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent } from "@/src/components/ui/dialog";
import * as generatedImageService from "@/src/services/generated-image.service";
import type { GeneratedImage } from "@/src/services/generated-image.service";

export function ImageGalleryPage() {
  const navigate = useNavigate();
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GeneratedImage | null>(null);

  useEffect(() => {
    generatedImageService
      .fetchGeneratedImages()
      .then(setImages)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("Excluir esta imagem da galeria?")) return;
    await generatedImageService.deleteGeneratedImage(id);
    setImages((prev) => prev.filter((img) => img.id !== id));
    setSelected(null);
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/agentes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Galeria de imagens</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">Imagens geradas pelos seus agentes.</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : images.length === 0 ? (
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-card py-20 text-center">
          <Images className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-medium text-muted-foreground">Nenhuma imagem gerada ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Peça a um agente com a ferramenta "Gerar imagem" ativada para criar uma.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setSelected(img)}
              className="group relative aspect-square overflow-hidden rounded-xl border bg-muted/30 text-left"
            >
              <img src={img.url} alt={img.prompt} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="line-clamp-2 text-[11px] text-white">{img.prompt}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <div className="space-y-3">
              <img src={selected.url} alt={selected.prompt} className="max-h-[70vh] w-full rounded-lg object-contain" />
              <p className="text-sm">{selected.prompt}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {selected.agent?.name ? `${selected.agent.name} · ` : ""}
                  {new Date(selected.created_at).toLocaleString("pt-BR")}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={selected.url} target="_blank" rel="noreferrer" download>
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(selected.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
