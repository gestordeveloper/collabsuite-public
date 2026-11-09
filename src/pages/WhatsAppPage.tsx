import { MessageCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ConnectionsTab } from "@/src/components/whatsapp/ConnectionsTab";
import { ContactListsTab } from "@/src/components/whatsapp/ContactListsTab";
import { CampaignsTab } from "@/src/components/whatsapp/CampaignsTab";

export function WhatsAppPage() {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8 min-h-screen">
      <div className="mb-6 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20">
          <MessageCircle className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Conecte seu número, organize contatos e dispare mensagens com segurança.</p>
        </div>
      </div>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList>
          <TabsTrigger value="connections">Conexões</TabsTrigger>
          <TabsTrigger value="contacts">Contatos</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="mt-6">
          <ConnectionsTab />
        </TabsContent>

        <TabsContent value="contacts" className="mt-6">
          <ContactListsTab />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-6">
          <CampaignsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
