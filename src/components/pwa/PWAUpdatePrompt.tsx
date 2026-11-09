import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Download, RefreshCw, Smartphone, WifiOff } from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import { useAuthStore } from "@/src/store/auth.store";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Rotas de link público — nunca devem pedir login ou instalação do app */
function isPublicRoute(pathname: string, search: string) {
  if (
    pathname.startsWith("/public/task/") ||
    pathname.startsWith("/public/proposal/") ||
    pathname.startsWith("/public/form/")
  ) {
    return true;
  }
  return new URLSearchParams(search).has("publicCalendar");
}

export function PWAUpdatePrompt() {
  const location = useLocation();
  const isPublic = isPublicRoute(location.pathname, location.search);

  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [updateSW, setUpdateSW] = useState<
    (reloadPage?: boolean) => Promise<void>
  >(() => Promise.resolve);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        // Links públicos não devem exibir prompts de atualização do app
        if (!isPublicRoute(window.location.pathname, window.location.search)) {
          setNeedRefresh(true);
        }
      },
      onOfflineReady() {
        if (!isPublicRoute(window.location.pathname, window.location.search)) {
          setOfflineReady(true);
        }
      },
    });
    setUpdateSW(() => update);
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      // Nunca exibe o convite de instalação em links públicos, mesmo que
      // o navegador tenha uma sessão autenticada
      if (isPublicRoute(window.location.pathname, window.location.search)) {
        return;
      }
      // Só exibe o convite de instalação para usuários autenticados
      const { isAuthenticated } = useAuthStore.getState();
      if (isAuthenticated) {
        setShowInstall(true);
      }
    };

    const handleAppInstalled = () => {
      setInstallEvent(null);
      setShowInstall(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const clearAllCaches = async () => {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await clearAllCaches();
      await updateSW(true);
    } catch (err) {
      console.error("Erro ao atualizar PWA:", err);
      window.location.reload();
    } finally {
      setUpdating(false);
      setNeedRefresh(false);
    }
  };

  const handleInstall = async () => {
    if (!installEvent) return;
    setShowInstall(false);
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstallEvent(null);
    } else {
      setInstallEvent(null);
    }
  };

  const dismissInstall = () => {
    setShowInstall(false);
  };

  const closeOfflineReady = () => setOfflineReady(false);

  // Links públicos nunca devem exibir popups de instalação/atualização do app
  if (isPublic) {
    return null;
  }

  return (
    <>
      {/* Popup de instalação */}
      <Dialog open={showInstall} onOpenChange={setShowInstall}>
        <DialogContent hideClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              Instalar Collabsuite
            </DialogTitle>
            <DialogDescription>
              Instale o app na sua tela inicial para acesso rápido e uso
              offline. Funciona como um aplicativo nativo, sem necessidade de
              navegador.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={dismissInstall}>
              Agora não
            </Button>
            <Button onClick={handleInstall} className="gap-2">
              <Download className="h-4 w-4" />
              Instalar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Popup de atualização */}
      <Dialog open={needRefresh} onOpenChange={setNeedRefresh}>
        <DialogContent hideClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className={`h-5 w-5 text-primary ${updating ? "animate-spin" : ""}`} />
              Nova versão disponível
            </DialogTitle>
            <DialogDescription>
              Há uma nova versão do Collabsuite pronta para uso. O cache será
              limpo e a atualização será aplicada automaticamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNeedRefresh(false)}
              disabled={updating}
            >
              Agora não
            </Button>
            <Button onClick={handleUpdate} disabled={updating} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${updating ? "animate-spin" : ""}`} />
              {updating ? "Atualizando..." : "Atualizar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Popup offline pronto */}
      <Dialog open={offlineReady} onOpenChange={closeOfflineReady}>
        <DialogContent hideClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-primary" />
              App pronto para uso offline
            </DialogTitle>
            <DialogDescription>
              O Collabsuite agora pode ser usado sem conexão com a internet.
              Recursos como projetos, tarefas e agenda estarão disponíveis
              offline.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={closeOfflineReady}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}