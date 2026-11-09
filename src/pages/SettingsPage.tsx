import { useState, useEffect } from "react";
import { Sun, Moon, Palette, Volume2, User, CalendarClock, ArrowLeft, ChevronRight, FileSignature, Bell, Bot, BarChart3, FileText } from "lucide-react";
import { AnalyticsPage } from "@/src/pages/AnalyticsPage";
import { useThemeStore } from "@/src/store/theme.store";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Switch } from "@/src/components/ui/switch";
import { Label } from "@/src/components/ui/label";
import { ProfileSettings } from "@/src/components/settings/ProfileSettings";
import { ProposalTemplateEditor } from "@/src/components/settings/ProposalTemplateEditor";
import { NotificationSettings } from "@/src/components/settings/NotificationSettings";
import { IntegrationSettings } from "@/src/components/settings/IntegrationSettings";

const PRESET_COLORS = ["#EC1889", "#9B7BFF", "#4C9BFF", "#2DD4BF", "#F7B32B", "#2BD47D", "#FF5A5F", "#8A8A94"];

type SettingsTab = "profile" | "appearance" | "schedule" | "proposals" | "notifications" | "integrations" | "reports";

export function SettingsPage() {
  const { darkMode, toggleDarkMode, themeColor, setThemeColor } = useThemeStore();
  const [activeTab, setActiveTab] = useState<SettingsTab | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // Detect screen size to handle layout changes dynamically
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    setIsDesktop(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  // In desktop view, default to the 'profile' tab if none is active
  useEffect(() => {
    if (isDesktop && activeTab === null) {
      setActiveTab("profile");
    }
  }, [isDesktop, activeTab]);

  const menuItems = [
    {
      id: "profile" as SettingsTab,
      label: "Meu Perfil",
      description: "Nome, email, biografia e foto de perfil",
      icon: User,
      colorClass: "bg-blue-500/10 text-blue-500 dark:bg-blue-500/20",
    },
    {
      id: "appearance" as SettingsTab,
      label: "Aparência",
      description: "Tema escuro, claro e cores de destaque",
      icon: Palette,
      colorClass: "bg-pink-500/10 text-pink-500 dark:bg-pink-500/20",
    },
    {
      id: "schedule" as SettingsTab,
      label: "Minha Agenda",
      description: "Horários de atendimento, dias e integrações",
      icon: CalendarClock,
      colorClass: "bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20",
    },
    {
      id: "proposals" as SettingsTab,
      label: "Modelos de Proposta",
      description: "Crie templates de propostas comerciais",
      icon: FileSignature,
      colorClass: "bg-violet-500/10 text-violet-500 dark:bg-violet-500/20",
    },
    {
      id: "notifications" as SettingsTab,
      label: "Notificações",
      description: "Push, e-mail e alertas de chamados, reuniões e campanhas",
      icon: Bell,
      colorClass: "bg-amber-500/10 text-amber-500 dark:bg-amber-500/20",
    },
    {
      id: "integrations" as SettingsTab,
      label: "Integrações de IA",
      description: "Credenciais de Groq, OpenAI, Claude e OpenRouter",
      icon: Bot,
      colorClass: "bg-cyan-500/10 text-cyan-500 dark:bg-cyan-500/20",
    },
    {
      id: "reports" as SettingsTab,
      label: "Relatórios",
      description: "Estatísticas, burndown e produtividade da equipe",
      icon: BarChart3,
      colorClass: "bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8 min-h-screen">
      {/* Title section - only visible when on mobile menu or on desktop */}
      {(!activeTab || isDesktop) && (
        <div className="mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">Configurações</h2>
          <p className="text-sm text-muted-foreground">Gerencie sua conta, preferências e integrações.</p>
        </div>
      )}

      {/* Main Grid Wrapper */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
        
        {/* Desktop Sidebar OR Mobile Menu Dashboard */}
        {(!activeTab || isDesktop) && (
          <div className="md:col-span-1 flex flex-col gap-1 w-full bg-card rounded-2xl p-2 border shadow-sm md:shadow-none md:border-none md:bg-transparent">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 text-left ${
                    isActive && isDesktop
                      ? "bg-primary/10 text-primary font-semibold"
                      : "hover:bg-accent text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${item.colorClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-none">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{item.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 md:hidden" />
                </button>
              );
            })}
            <a
              href="/docs/index.html"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 text-left hover:bg-accent text-foreground"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg shrink-0 bg-slate-500/10 text-slate-500 dark:bg-slate-500/20">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">Documentação API</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">Abre a referência da API em nova aba</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 md:hidden" />
            </a>
          </div>
        )}

        {/* Setting Content Panel */}
        {activeTab && (
          <div className="md:col-span-3 flex flex-col gap-6 w-full">
            {/* Mobile-only Back Header */}
            {!isDesktop && (
              <button
                type="button"
                onClick={() => setActiveTab(null)}
                className="flex items-center gap-2 py-2 text-sm font-semibold text-primary hover:opacity-85 transition-opacity"
              >
                <ArrowLeft className="h-4 w-4" /> Voltar para Configurações
              </button>
            )}

            {/* Render selected section content */}
            <div className="w-full bg-card rounded-2xl border p-4 sm:p-6 shadow-sm">
              {activeTab === "appearance" && (
                <Card className="border-none shadow-none bg-transparent">
                  <CardHeader className="px-0 pt-0 pb-4">
                    <CardTitle className="flex items-center gap-2 text-xl font-bold font-display">
                      <Palette className="h-5 w-5 text-primary" /> Aparência e Preferências
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 space-y-6">
                    {/* Theme selector */}
                    <div className="space-y-3">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tema do Sistema</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => darkMode && toggleDarkMode()}
                          className={`flex items-center justify-center gap-3 rounded-xl border p-4 text-sm font-semibold transition-all duration-200 ${
                            !darkMode
                              ? "border-primary bg-primary/5 text-primary shadow-sm"
                              : "border-border bg-background hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <Sun className="h-5 w-5" /> Claro
                        </button>
                        <button
                          type="button"
                          onClick={() => !darkMode && toggleDarkMode()}
                          className={`flex items-center justify-center gap-3 rounded-xl border p-4 text-sm font-semibold transition-all duration-200 ${
                            darkMode
                              ? "border-primary bg-primary/5 text-primary shadow-sm"
                              : "border-border bg-background hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <Moon className="h-5 w-5" /> Escuro
                        </button>
                      </div>
                    </div>

                    {/* Accent Color picker */}
                    <div className="space-y-3 border-t pt-6">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cor de Destaque</Label>
                      <div className="flex flex-wrap items-center gap-3">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setThemeColor(c)}
                            className={`h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all duration-200 hover:scale-110 ${
                              themeColor === c ? "ring-foreground scale-105" : "ring-transparent"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <div className="relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-background border hover:scale-110 transition-transform">
                          <input
                            type="color"
                            value={themeColor}
                            onChange={(e) => setThemeColor(e.target.value)}
                            className="absolute inset-[-4px] h-[44px] w-[44px] cursor-pointer border-0 bg-transparent p-0"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Alerts toggle switch */}
                    <div className="flex items-center justify-between rounded-xl border p-4 bg-muted/10 border-t pt-4">
                      <div className="flex items-center gap-3">
                        <Volume2 className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <Label className="text-sm font-semibold">Alertas sonoros</Label>
                          <p className="text-xs text-muted-foreground">Reproduzir som ao receber notificações.</p>
                        </div>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === "profile" && <ProfileSettings activeSection="profile" />}
              {activeTab === "schedule" && <ProfileSettings activeSection="schedule" />}
              {activeTab === "proposals" && (
                <div className="w-full">
                  <ProposalTemplateEditor onBack={() => setActiveTab("profile")} />
                </div>
              )}
              {activeTab === "notifications" && <NotificationSettings />}
              {activeTab === "integrations" && <IntegrationSettings />}
              {activeTab === "reports" && (
                <div className="-m-4 sm:-m-6">
                  <AnalyticsPage />
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}