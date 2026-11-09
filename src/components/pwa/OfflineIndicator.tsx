import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 shadow-lg backdrop-blur-sm">
        <WifiOff className="h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Você está offline
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400/70">
            Algumas funções podem estar indisponíveis.
          </p>
        </div>
      </div>
    </div>
  );
}

export function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4">
      <WifiOff className="h-20 w-20 text-muted-foreground" />
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">Sem conexão</h1>
        <p className="text-muted-foreground max-w-sm">
          Não foi possível conectar à internet. Verifique sua conexão e tente
          novamente. Dados em cache podem estar disponíveis.
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>
        <Wifi className="h-4 w-4" />
        Tentar novamente
      </Button>
    </div>
  );
}