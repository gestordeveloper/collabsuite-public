import { NavLink, useNavigate } from "react-router-dom";
import { Search, Share2, LogOut } from "lucide-react";
import { useAuthStore } from "@/src/store/auth.store";
import { useDashboard } from "@/src/context/dashboard.context";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { cn } from "@/src/lib/utils";
import { NAV_SECTIONS } from "./nav-items";

interface SidebarProps {
  onCopyPublicLink: () => void;
  onOpenSearch: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Administrador",
  user: "Membro",
};

const SEARCH_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

const navItemClass = (active: boolean) =>
  cn(
    "group flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-border/70 text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground"
  );

export function Sidebar({ onCopyPublicLink, onOpenSearch }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const { tasks } = useDashboard();
  const navigate = useNavigate();

  // Tarefas abertas de nível superior (subtarefas têm task_id) — contador do Quadro.
  const openTasksCount = tasks.filter(
    (t) => !t.deleted_at && (t.task_id == null || t.task_id === 0) && t.status !== "done"
  ).length;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r bg-surface text-card-foreground md:flex">
      <div className="flex shrink-0 flex-col gap-5 px-3 pb-3 pt-4">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <div
          className="dynamic-color-img -m-1 h-9 w-9 shrink-0"
          style={{
            WebkitMaskImage: "url('/assets/images/icon.png')",
            maskImage: "url('/assets/images/icon.png')",
          }}
        />
        <div className="flex min-w-0 flex-col gap-px">
          <span className="font-display text-sm font-semibold tracking-[-0.01em]">Ebenezer</span>
          <span className="text-[11px] text-subtle">Collabsuite</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-[13px] text-subtle transition-colors hover:border-input hover:text-muted-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Buscar</span>
        <kbd className="rounded border border-input px-1.5 py-px font-mono text-[11px]">{SEARCH_SHORTCUT}</kbd>
      </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
      {NAV_SECTIONS.map((section) => (
        <nav key={section.label} className="flex flex-col gap-0.5">
          <span className="label-caps px-2.5 pb-1.5">{section.label}</span>
          {section.items.map((item) => {
            if (item.external) {
              return (
                <a
                  key={item.to}
                  href={item.to}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navItemClass(false)}
                >
                  <item.icon className="h-[17px] w-[17px] text-subtle" strokeWidth={1.8} />
                  {item.label}
                </a>
              );
            }
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navItemClass(isActive)}>
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={cn("h-[17px] w-[17px] shrink-0", isActive ? "text-primary" : "text-subtle")}
                      strokeWidth={1.8}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.to === "/tarefas" && openTasksCount > 0 && (
                      <span className="font-mono text-[11px] text-subtle">{openTasksCount}</span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      ))}

      </div>

      <div className="flex shrink-0 flex-col gap-3 px-3 pb-4 pt-3">
      <button
        type="button"
        onClick={onCopyPublicLink}
        className="flex h-[38px] items-center gap-2.5 rounded-lg border border-dashed border-input px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Share2 className="h-[17px] w-[17px] text-subtle" strokeWidth={1.8} />
        Agendamento Público
      </button>

      <div className="flex items-center gap-2.5 border-t px-2 pb-1 pt-3.5">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          title="Configurações do perfil"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <UserAvatar user={user} className="h-[30px] w-[30px] shrink-0 text-xs" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium">
              {user?.first_name} {user?.last_name}
            </span>
            <span className="truncate text-[11px] text-subtle">{ROLE_LABELS[user?.role ?? "user"] ?? "Membro"}</span>
          </div>
        </button>
        <button
          type="button"
          title="Sair"
          onClick={() => {
            logout();
            navigate("/");
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      </div>
    </aside>
  );
}
