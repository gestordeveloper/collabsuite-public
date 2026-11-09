import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Bell, Plus, ArrowLeft } from "lucide-react";
import { useNotificationStore } from "@/src/store/notification.store";
import { useAuthStore } from "@/src/store/auth.store";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import type { User } from "@/src/types";
import { cn } from "@/src/lib/utils";
import { pageTitleFor } from "./nav-items";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  users: Partial<User>[];
  onNewTask: () => void;
  extra?: React.ReactNode;
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

const MAX_TEAM_AVATARS = 4;

export function Header({ searchQuery, onSearchChange, users, onNewTask, extra }: HeaderProps) {
  const { notifications, unreadCount, markAllRead, markRead } = useNotificationStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = unreadCount;

  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const showSearch = ["/kanban", "/entrada", "/projects", "/tarefas"].includes(location.pathname);
  const title = pageTitleFor(location.pathname);
  const teamAvatars = users.slice(0, MAX_TEAM_AVATARS);
  const teamOverflow = users.length - teamAvatars.length;

  if (showSearch && isMobileSearchOpen) {
    return (
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface px-4 backdrop-blur md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setIsMobileSearchOpen(false);
            onSearchChange("");
          }}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar..."
            className="pl-9 w-full h-9 text-xs"
            autoFocus
          />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/85 px-4 backdrop-blur md:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="dynamic-color-img -mx-1 h-8 w-8 shrink-0 md:hidden"
          style={{
            WebkitMaskImage: "url('/assets/images/icon.png')",
            maskImage: "url('/assets/images/icon.png')",
          }}
        />
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <span className={cn("hidden text-[13px] text-subtle", !extra && "md:inline")}>Ebenezer</span>
          <span className={cn("hidden text-input", !extra && "md:inline")}>/</span>
          <span className="truncate text-[13px] font-medium">{title}</span>
        </div>
        {showSearch && (
          <div className="hidden w-full max-w-[240px] md:relative md:ml-2 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar tarefas..."
              className="h-9 pl-9"
            />
          </div>
        )}
      </div>

      {extra && (
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {extra}
        </div>
      )}

      <div className="flex items-center gap-2 md:gap-3">
        {teamAvatars.length > 0 && (
          <div className={cn("hidden items-center pl-1.5", extra ? "2xl:flex" : "lg:flex")}>
            {teamAvatars.map((member) => (
              <UserAvatar
                key={member.id}
                user={member}
                className="-ml-1.5 h-[26px] w-[26px] border-2 border-background text-[10px]"
              />
            ))}
            {teamOverflow > 0 && (
              <span className="-ml-1.5 flex h-[26px] min-w-[26px] items-center justify-center rounded-full border-2 border-background bg-input px-1 font-mono text-[10px] text-muted-foreground">
                +{teamOverflow}
              </span>
            )}
          </div>
        )}

        {showSearch && (
          <Button
            onClick={() => setIsMobileSearchOpen(true)}
            variant="ghost"
            size="icon"
            className="md:hidden"
          >
            <Search className="h-5 w-5" />
          </Button>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" title="Notificações">
              <Bell className="h-[17px] w-[17px]" strokeWidth={1.8} />
              {unread > 0 && (
                <span className="absolute right-2 top-[7px] flex h-[7px] w-[7px] rounded-full border-[1.5px] border-background bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b p-3">
              <p className="font-display text-sm font-semibold">Notificações</p>
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                Marcar como lidas
              </Button>
            </div>
            <ScrollArea className="h-72">
              {notifications.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma notificação
                </p>
              ) : (
                <ul className="divide-y">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      onClick={() => {
                        markRead(n.id);
                        if (n.link) navigate(n.link);
                      }}
                      className={`flex cursor-pointer flex-col gap-1 p-3 text-sm transition-colors hover:bg-accent ${n.read_at ? "opacity-60" : ""}`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        {n.title}
                      </span>
                      {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                      <span className="font-mono text-[11px] text-subtle">{timeAgo(n.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <button onClick={() => navigate("/settings")} className="rounded-full md:hidden" title="Configurações">
          <UserAvatar user={user} className="h-8 w-8 text-xs" />
        </button>

        <Button onClick={onNewTask} className="gap-1.5 px-3 text-[13px] md:px-3.5">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
          <span className="hidden sm:inline">Nova tarefa</span>
        </Button>
      </div>
    </header>
  );
}
