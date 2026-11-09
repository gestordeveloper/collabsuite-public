import { RecordingsPanel } from "@/src/components/recordings/RecordingsPanel";

export function RecordingsPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="font-display text-xl font-bold">Gravações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todos os áudios ficam na sua conta AWS. A IA transcreve, resume e transforma as ações em tarefas do backlog de um projeto.
          </p>
        </div>
        <RecordingsPanel />
      </div>
    </div>
  );
}
