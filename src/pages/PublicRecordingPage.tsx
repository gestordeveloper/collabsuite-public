import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { Badge } from "@/src/components/ui/badge";
import { formatDuration } from "@/src/services/recording.service";

interface PublicRecording {
  title: string;
  tipo: string;
  category: string | null;
  recorded_at: string;
  duration_seconds: number | null;
  summary: string | null;
  participants: string[];
  transcript: string | null;
  analysis_md: string | null;
  audio_url: string;
}

export function PublicRecordingPage() {
  const { token } = useParams<{ token: string }>();
  const [rec, setRec] = useState<PublicRecording | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/recording/${token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Link inválido ou desativado.");
        setRec(body);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background p-6 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 text-destructive" /> {error}
      </div>
    );
  }
  if (!rec) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">{rec.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{new Date(rec.recorded_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
            <span>{formatDuration(rec.duration_seconds)}</span>
            <Badge variant="outline">{rec.tipo}</Badge>
            {rec.category && <Badge variant="outline">{rec.category}</Badge>}
          </div>
        </header>

        <audio controls preload="metadata" src={rec.audio_url} className="w-full" />

        <Tabs defaultValue="report">
          <TabsList>
            <TabsTrigger value="report">Relatório</TabsTrigger>
            <TabsTrigger value="transcript">Transcrição</TabsTrigger>
          </TabsList>
          <TabsContent value="report" className="mt-4">
            <div className="rounded-lg border bg-card p-4 text-[13px] leading-relaxed [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:text-sm [&_h2]:font-bold [&_li]:ml-4 [&_li]:list-disc [&_table]:my-2 [&_table]:w-full [&_td]:border [&_td]:p-1.5 [&_th]:border [&_th]:p-1.5 [&_th]:text-left">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{rec.analysis_md || rec.summary || ""}</ReactMarkdown>
            </div>
          </TabsContent>
          <TabsContent value="transcript" className="mt-4">
            <pre className="whitespace-pre-wrap rounded-lg border bg-card p-4 font-sans text-[13px] leading-relaxed">{rec.transcript}</pre>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
