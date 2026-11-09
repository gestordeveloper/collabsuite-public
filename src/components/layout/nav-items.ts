import {
  LayoutDashboard, Calendar, Settings,
  MessageCircle, Share2, Headset, Palette, Bot, Flame, HeartPulse, FolderKanban, CheckSquare, NotebookPen, Mic, GalleryHorizontal, Clapperboard, ImageIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  external?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
      { to: "/agenda", label: "Calendário", icon: Calendar },
      { to: "/entrada", label: "Anotações", icon: NotebookPen },
      { to: "/habitos", label: "Hábitos", icon: Flame },
      { to: "/saude", label: "Saúde", icon: HeartPulse },
      { to: "/projects", label: "Projetos", icon: FolderKanban },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { to: "/gravacoes", label: "Gravações", icon: Mic },
      { to: "/atendimento", label: "Atendimento", icon: Headset },
      { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/carrosseis", label: "Carrosséis", icon: GalleryHorizontal },
      { to: "/editor-de-video", label: "Editor de vídeo", icon: Clapperboard },
      { to: "/instagram", label: "Redes sociais", icon: Share2 },
      { to: "/designs", label: "Designs", icon: Palette },
      { to: "/photosuite", label: "Photosuite", icon: ImageIcon },
      { to: "/agentes", label: "Agentes", icon: Bot },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/settings", label: "Configurações", icon: Settings },
    ],
  },
];

/** Título exibido no breadcrumb do header para cada rota. */
export function pageTitleFor(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/task/")) return "Tarefa";
  if (pathname.startsWith("/kanban")) return "Kanban";
  if (pathname.startsWith("/analytics")) return "Relatórios";
  if (pathname === "/projects/dashboard") return "Painel do projeto";
  if (pathname.startsWith("/projects/")) return "Projeto";
  if (pathname.startsWith("/carrosseis/")) return "Editor de carrossel";
  if (pathname.startsWith("/novelas/")) return "Mini-novela HQ";
  if (/^\/agentes\/\d+\/gerenciar/.test(pathname)) return "Painel do agente";
  if (pathname.startsWith("/agentes/pipelines")) return "Pipelines de agentes";
  if (pathname.startsWith("/agentes/galeria")) return "Galeria de imagens";
  if (pathname.startsWith("/agentes/icps")) return "ICPs";
  if (pathname.startsWith("/atendimento/configuracoes")) return "Configurações de atendimento";
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!item.external && item.to !== "/" && pathname.startsWith(item.to)) return item.label;
    }
  }
  return "Collabsuite";
}
