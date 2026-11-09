import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Headset } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { useAuthStore } from "@/src/store/auth.store";
import { errorMessage, fetchQueues, fetchTags, fetchTeam, type TeamMember, type TicketQueue, type TicketTag } from "@/src/services/ticket.service";
import { BotTab } from "@/src/components/tickets/settings/BotTab";
import { ConnectionsSettingsTab } from "@/src/components/tickets/settings/ConnectionsSettingsTab";
import { QueuesTab } from "@/src/components/tickets/settings/QueuesTab";
import { TagsTab } from "@/src/components/tickets/settings/TagsTab";

export function TicketSettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [queues, setQueues] = useState<TicketQueue[]>([]);
  const [tags, setTags] = useState<TicketTag[]>([]);
  const [tab, setTab] = useState("queues");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  // As abas de filas/etiquetas recarregam sozinhas; o editor do bot precisa das listas atualizadas ao abrir a aba.
  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([fetchTeam(), fetchQueues(), fetchTags()])
      .then(([m, q, t]) => {
        setTeam(m);
        setQueues(q);
        setTags(t);
      })
      .catch((err) => notify(errorMessage(err)));
  }, [isAdmin, tab, notify]);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8">
      <Link to="/atendimento" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar ao atendimento
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Headset className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Configurações de atendimento</h2>
          <p className="text-sm text-muted-foreground">Filas por área, etiquetas, bot e conexões do WhatsApp.</p>
        </div>
      </div>

      {!isAdmin ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Somente administradores podem alterar as configurações de atendimento.</p>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="queues">Filas</TabsTrigger>
            <TabsTrigger value="tags">Etiquetas</TabsTrigger>
            <TabsTrigger value="bot">Bot</TabsTrigger>
            <TabsTrigger value="connections">Conexões</TabsTrigger>
          </TabsList>
          <TabsContent value="queues" className="mt-6">
            <QueuesTab team={team} onNotify={notify} />
          </TabsContent>
          <TabsContent value="tags" className="mt-6">
            <TagsTab onNotify={notify} />
          </TabsContent>
          <TabsContent value="bot" className="mt-6">
            <BotTab queues={queues} team={team} tags={tags} onNotify={notify} />
          </TabsContent>
          <TabsContent value="connections" className="mt-6">
            <ConnectionsSettingsTab onNotify={notify} />
          </TabsContent>
        </Tabs>
      )}

      {notice && (
        <div role="status" className="fixed bottom-20 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg border bg-popover px-4 py-2.5 text-sm shadow-lg md:bottom-6">
          {notice}
        </div>
      )}
    </div>
  );
}
