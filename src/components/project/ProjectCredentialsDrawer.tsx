import { X, KeyRound } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { ProjectCredentialsTab } from "@/src/components/project/ProjectCredentialsTab";

interface ProjectCredentialsDrawerProps {
  projectId: number | null;
  projectName?: string;
  projectColor?: string | null;
  onClose: () => void;
}

export function ProjectCredentialsDrawer({ projectId, projectName, projectColor, onClose }: ProjectCredentialsDrawerProps) {
  const isOpen = projectId != null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sheet Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-2xl bg-card border-l shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {isOpen && projectId != null && (
          <>
            <div
              className="flex items-center justify-between gap-4 p-5 border-b shrink-0"
              style={{ borderLeftColor: projectColor || "#EC1889", borderLeftWidth: 4 }}
            >
              <div className="min-w-0 flex items-center gap-2.5">
                <KeyRound className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Credenciais do Projeto</p>
                  <h2 className="text-lg font-bold truncate">{projectName}</h2>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <ProjectCredentialsTab projectId={projectId} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
