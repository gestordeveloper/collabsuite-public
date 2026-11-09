import { useMemo, useState } from "react";
import { Code2, Copy, Check, Info, Columns, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/src/components/ui/select";
import type { Project } from "@/src/types";

function buildSnippet(origin: string, funnelId: number) {
  return `<script src="${origin}/api/public/widget/script.js"></script>
<script>
  window.addEventListener('load', function () {
    window.CollabSupportWidget.init({
      funnel_id: ${funnelId},
      user_id: "ID_DO_USUARIO_LOGADO",   // vindo da sessão da sua plataforma
      first_name: "NOME_DO_USUARIO",
      last_name: "SOBRENOME_DO_USUARIO",
      email: "EMAIL_DO_USUARIO",
      telephone: "TELEFONE_OPCIONAL"
    });
  });
</script>`;
}

export function ProjectWidgetTab({ project, onCreateFunnel }: { project: Project; onCreateFunnel: () => void }) {
  const defaultFunnel = useMemo(
    () => project.funnels.find((f) => f.is_default) || project.funnels[0] || null,
    [project.funnels]
  );
  const [selectedFunnelId, setSelectedFunnelId] = useState<number | null>(defaultFunnel?.id ?? null);
  const [copied, setCopied] = useState(false);

  const selectedFunnel = project.funnels.find((f) => f.id === selectedFunnelId) || defaultFunnel;

  const snippet = useMemo(() => {
    if (!selectedFunnel) return "";
    return buildSnippet(window.location.origin, selectedFunnel.id);
  }, [selectedFunnel]);

  function copySnippet() {
    navigator.clipboard.writeText(snippet).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!selectedFunnel) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Este projeto ainda não tem um funil. Crie um funil primeiro para gerar o script de chamados.
          </p>
          <Button size="sm" className="gap-1.5" onClick={onCreateFunnel}>
            <Plus className="h-3.5 w-3.5" /> Novo Funil
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="font-display text-[15px] font-semibold text-foreground flex items-center gap-2">
            <Code2 className="h-3.5 w-3.5" /> Widget de Chamados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Cole este script nas plataformas onde você dá suporte para que os usuários abram e acompanhem chamados
            diretamente por lá. Cada chamado aberto entra automaticamente na coluna <strong>Backlog</strong> do funil
            escolhido, de onde seu time acompanha e movimenta pelo Kanban normalmente.
          </p>

          {project.funnels.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Funil de destino dos chamados</label>
              <Select
                value={String(selectedFunnel.id)}
                onValueChange={(v) => setSelectedFunnelId(Number(v))}
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {project.funnels.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}{f.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="relative">
            <pre className="text-xs bg-muted/40 border rounded-lg p-4 pr-4 overflow-x-auto whitespace-pre">
              <code>{snippet}</code>
            </pre>
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 h-8 gap-1.5 text-xs bg-background"
              onClick={copySnippet}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado!" : "Copiar código"}
            </Button>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border rounded-lg p-3">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>
              Cole o script antes do <code className="bg-muted px-1 rounded">{"</body>"}</code> da plataforma host.
              Os campos <code className="bg-muted px-1 rounded">user_id</code>, <code className="bg-muted px-1 rounded">first_name</code>,{" "}
              <code className="bg-muted px-1 rounded">last_name</code>, <code className="bg-muted px-1 rounded">email</code> e{" "}
              <code className="bg-muted px-1 rounded">telephone</code> precisam ser preenchidos dinamicamente pelo
              sistema hospedeiro com os dados do usuário já logado nele — é assim que o widget identifica quem abriu
              cada chamado.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
          <CardTitle className="font-display text-[15px] font-semibold text-foreground">
            Etapas do funil "{selectedFunnel.name}"
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y">
          {selectedFunnel.stages
            .slice()
            .sort((a, b) => (a.stage_order || 0) - (b.stage_order || 0))
            .map((s) => {
              const isBacklog = (s.name || "").trim().toLowerCase() === "backlog";
              return (
                <div key={s.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <Columns className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className={isBacklog ? "font-semibold text-primary" : ""}>{s.name}</span>
                  {isBacklog && (
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      recebe os chamados
                    </span>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
