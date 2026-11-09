import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import * as photosuiteService from "@/src/services/photosuite.service";
import { Button } from "@/src/components/ui/button";

/** Link público (somente leitura) de um documento do Photosuite: mostra a imagem publicada. */
export function PublicPhotosuitePage() {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<photosuiteService.PublicPhotoDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    photosuiteService
      .getPublicDocument(token)
      .then(setDoc)
      .catch((err) => setError(err?.response?.data?.error || "Link inválido ou desativado."));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background p-6 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-destructive" /> {error}
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">{doc.name}</h1>
            <p className="text-xs text-muted-foreground">
              {doc.width}×{doc.height}
              {doc.owner_name ? ` · por ${doc.owner_name}` : ""}
              {doc.shared_at ? ` · publicado em ${new Date(doc.shared_at).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          <Button asChild size="sm" className="gap-1.5">
            <a href={doc.image_url} download={`${doc.name}.png`} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" /> Baixar imagem
            </a>
          </Button>
        </header>
        <div
          className="flex items-center justify-center overflow-hidden rounded-xl border border-border p-3"
          style={{ backgroundImage: "conic-gradient(#2a2a2d 25%, #232326 0 50%, #2a2a2d 0 75%, #232326 0)", backgroundSize: "20px 20px" }}
        >
          <img src={doc.image_url} alt={doc.name} className="max-h-[80vh] max-w-full object-contain" />
        </div>
        <p className="text-center text-[11px] text-muted-foreground">Feito com Photosuite</p>
      </div>
    </div>
  );
}
