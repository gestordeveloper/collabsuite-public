import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
  Menu,
  Settings,
  HelpCircle,
  Calendar as CalendarIcon,
  Check,
  X,
  User as UserIcon,
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Grid,
  CalendarRange,
} from "lucide-react";
import { useThemeStore } from "@/src/store/theme.store";
import { useTaskStore } from "@/src/store/task.store";
import { StickyNote } from "lucide-react";
import { useAuthStore } from "@/src/store/auth.store";
import type { Task, Funnel } from "@/src/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { UserAvatar } from "@/src/components/common/UserAvatar";
import { cn } from "@/src/lib/utils";
import { hexA } from "@/src/lib/design";

interface AgendaViewProps {
  tasks: Task[];
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
  onNewTask: () => void;
  onTaskClick: (t: Task) => void;
}

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function getWeekRangeString(date: Date) {
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  
  const startDay = sunday.getDate();
  const endDay = saturday.getDate();
  
  const startMonthStr = sunday.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const endMonthStr = saturday.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  
  if (sunday.getMonth() === saturday.getMonth()) {
    return `${startDay} - ${endDay} de ${startMonthStr}`;
  } else {
    return `${startDay} de ${startMonthStr} - ${endDay} de ${endMonthStr}`;
  }
}

// Today Button component replicating Google Calendar's today sheets
const TodayButton = ({ onClick }: { onClick: () => void }) => {
  const todayNum = new Date().getDate();
  return (
    <Button variant="ghost" size="icon" className="relative h-10 w-10 text-muted-foreground" onClick={onClick}>
      <div className="h-6 w-6 border-2 border-current rounded-md flex flex-col overflow-hidden items-center justify-center">
        <div className="h-1.5 w-full bg-current" />
        <span className="text-[10px] font-bold leading-none mt-0.5">{todayNum}</span>
      </div>
    </Button>
  );
};

// Cabeçalho de mês da lista de programação (mobile), no padrão do design system
const MonthBanner = ({ date }: { date: Date }) => (
  <div className="mb-3 mt-6 flex items-center gap-3 first:mt-2">
    <h3 className="font-display text-lg font-semibold tracking-[-0.01em]">
      {MONTHS[date.getMonth()]} <span className="font-normal text-muted-foreground">{date.getFullYear()}</span>
    </h3>
    <span className="h-px flex-1 bg-border" />
  </div>
);

export function AgendaView({ tasks, currentDate, setCurrentDate, onNewTask, onTaskClick }: AgendaViewProps) {
  const navigate = useNavigate();
  const { themeColor } = useThemeStore();
  const { funnels, projects } = useTaskStore();

  function colorForFunnel(funnelId?: number | null) {
    const project = projects.find((p) => p.funnels.some((f) => f.id === funnelId));
    return project?.color ?? undefined;
  }

  // Every project's first funnel is named "Funil Principal" by default (see project.service.ts),
  // so a flat list of funnel names is mostly indistinguishable rows — this resolves each funnel
  // back to its project's name, and only appends the funnel name too when a project actually has
  // more than one funnel (otherwise it'd just be noisy "Funil Principal" repeated everywhere).
  const funnelCountByProject = useMemo(() => {
    const counts = new Map<number, number>();
    funnels.forEach((f) => counts.set(f.project_id, (counts.get(f.project_id) || 0) + 1));
    return counts;
  }, [funnels]);

  function labelForFunnel(f: Funnel) {
    const projectName = projects.find((p) => p.id === f.project_id)?.name || f.name;
    const needsDisambiguation = (funnelCountByProject.get(f.project_id) || 0) > 1;
    return needsDisambiguation ? `${projectName} · ${f.name}` : projectName;
  }

  const { user } = useAuthStore();
  
  const [viewMode, setViewMode] = useState<"schedule" | "day" | "week" | "month">("week");
  const [showMiniCalendarDropdown, setShowMiniCalendarDropdown] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showCalendars, setShowCalendars] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [searchPeople, setSearchPeople] = useState("");
  const [filterUserProjects, setFilterUserProjects] = useState<Record<number, boolean>>({});
  const [userCalendarChecked, setUserCalendarChecked] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  const [isMobile, setIsMobile] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasScrolledToToday, setHasScrolledToToday] = useState(false);

  // Google Calendar style hover preview tooltip for events
  const [hoverEvent, setHoverEvent] = useState<{ task: Task; x: number; y: number } | null>(null);

  function showEventTooltip(e: React.MouseEvent, task: Task) {
    setHoverEvent({ task, x: e.clientX, y: e.clientY });
  }

  function moveEventTooltip(e: React.MouseEvent) {
    setHoverEvent((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  }

  function hideEventTooltip() {
    setHoverEvent(null);
  }

  function eventTimeRangeLabel(task: Task) {
    if (!task.hour_at) return "Dia inteiro";
    const [h, m] = task.hour_at.split(":").map(Number);
    let duration = 1;
    if (task.estimated_time) {
      const [dh, dm] = task.estimated_time.split(":").map(Number);
      duration = dh + dm / 60;
    }
    const endMinutesTotal = h * 60 + m + duration * 60;
    const endH = Math.floor(endMinutesTotal / 60) % 24;
    const endM = Math.round(endMinutesTotal % 60);
    const endLabel = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    return `${task.hour_at} - ${endLabel}`;
  }

  // Touch Swipe Gesture State
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = (onSwipeLeft: () => void, onSwipeRight: () => void) => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      onSwipeLeft();
    } else if (isRightSwipe) {
      onSwipeRight();
    }
  };

  // Sync mobile state and sidebar behavior
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    setIsMobile(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setShowSidebar(false);
      setViewMode("schedule");
    } else {
      setShowSidebar(true);
      setViewMode("week");
    }
  }, [isMobile]);

  // Fallback if desktop somehow gets schedule view mode
  useEffect(() => {
    if (!isMobile && viewMode === "schedule") {
      setViewMode("week");
    }
  }, [isMobile, viewMode]);

  // Keep current time updated
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);


  // Filter tasks based on selected calendars (funnels), user search, and personal calendar checkbox
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // A agenda é pessoal: só entra o que é meu (responsável ou participante), mesmo que a
      // tarefa esteja num projeto compartilhado e visível para mim no Kanban.
      const isMine = t.user_id === user?.id || t.taskUsers?.some((tu) => tu.user_id === user?.id);
      if (!isMine) return false;
      const fid = t.funnel_id;
      if (fid != null && filterUserProjects[fid] === false) {
        return false;
      }
      if (fid == null && !userCalendarChecked) {
        return false;
      }
      if (searchPeople.trim() !== "") {
        const query = searchPeople.toLowerCase();
        const userName = `${t.user?.first_name || ""} ${t.user?.last_name || ""}`.toLowerCase();
        const userUsername = (t.user?.username || "").toLowerCase();
        const taskTitle = (t.title || "").toLowerCase();
        
        if (!userName.includes(query) && !userUsername.includes(query) && !taskTitle.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, user?.id, filterUserProjects, userCalendarChecked, searchPeople]);

  function shiftDate(amount: number) {
    const d = new Date(currentDate);
    if (viewMode === "day") d.setDate(d.getDate() + amount);
    else if (viewMode === "week") d.setDate(d.getDate() + amount * 7);
    else d.setMonth(d.getMonth() + amount);
    setCurrentDate(d);
  }

  function handleToday() {
    setCurrentDate(new Date());
  }

  function getWeekDays(d: Date) {
    const start = new Date(d);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      return x;
    });
  }

  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);

  function tasksForDay(day: Date) {
    const target = day.toDateString();
    return filteredTasks.filter((t) => t.due_at && new Date(t.due_at).toDateString() === target);
  }

  function funnelColor(task: Task) {
    return colorForFunnel(task.funnel_id) ?? themeColor;
  }

  // Google Calendar style month cells calculation
  function buildMonthGrid() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const cells: Date[] = [];
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push(new Date(year, month - 1, prevMonthDays - i));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(year, month, d));
    }
    let nextMonthDay = 1;
    while (cells.length < 42) {
      cells.push(new Date(year, month + 1, nextMonthDay++));
    }
    return cells;
  }

  const miniDays = useMemo(() => buildMonthGrid(), [currentDate]);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Computes the absolute positions of timed events inside a day, handling horizontal overlap nicely
  function computeDayTimedEvents(day: Date) {
    const dayTasks = tasksForDay(day);
    const timedTasks = dayTasks.filter((t) => t.hour_at);

    const events = timedTasks
      .map((t) => {
        const [h, m] = t.hour_at!.split(":").map(Number);
        const start = h + m / 60;
        let duration = 1.0; 
        if (t.estimated_time) {
          const [dh, dm] = t.estimated_time.split(":").map(Number);
          duration = dh + dm / 60;
        }
        const end = start + duration;
        return {
          task: t,
          start,
          end,
          top: start * 56, 
          height: Math.max(22, duration * 56 - 3), 
          colIndex: 0,
          colCount: 1,
        };
      })
      .sort((a, b) => a.start - b.start);

    const columns: { end: number }[][] = [];
    for (const ev of events) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.end <= ev.start) {
          columns[c].push(ev);
          ev.colIndex = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev]);
        ev.colIndex = columns.length - 1;
      }
    }

    for (const ev of events) {
      const overlaps = events.filter(
        (other) => other.task.id !== ev.task.id && other.start < ev.end && other.end > ev.start
      );
      const occupiedCols = new Set(overlaps.map((o) => o.colIndex));
      occupiedCols.add(ev.colIndex);
      ev.colCount = Math.max(1, occupiedCols.size);
    }

    return events.map((ev) => {
      const width = 100 / ev.colCount;
      const left = ev.colIndex * width;
      return {
        task: ev.task,
        top: ev.top,
        height: ev.height,
        width: `${width - 2}%`,
        left: `${left}%`,
      };
    });
  }

  // Header month text
  const headerDateLabel = useMemo(() => {
    if (viewMode === "day") {
      return currentDate.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    }
    if (viewMode === "week") {
      const first = weekDays[0];
      const last = weekDays[6];
      if (first.getFullYear() !== last.getFullYear()) {
        return `${MONTHS[first.getMonth()]} de ${first.getFullYear()} - ${MONTHS[last.getMonth()]} de ${last.getFullYear()}`;
      }
      if (first.getMonth() !== last.getMonth()) {
        return `${MONTHS[first.getMonth()]} - ${MONTHS[last.getMonth()]} de ${first.getFullYear()}`;
      }
      return `${MONTHS[first.getMonth()]} de ${first.getFullYear()}`;
    }
    return `${MONTHS[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
  }, [currentDate, viewMode, weekDays]);

  // Mobile Schedule date range bounds
  const rangeStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setMonth(currentDate.getMonth() - 1);
    d.setDate(1);
    return d;
  }, [currentDate]);

  const rangeEnd = useMemo(() => {
    const d = new Date(currentDate);
    d.setMonth(currentDate.getMonth() + 6);
    return d;
  }, [currentDate]);

  // Grouped tasks chronologically for mobile schedule list
  const groupedDays = useMemo(() => {
    const map: Record<string, { date: Date; tasks: Task[] }> = {};
    
    filteredTasks.forEach((t) => {
      if (!t.due_at) return;
      const d = new Date(t.due_at);
      if (d < rangeStart || d > rangeEnd) return;
      const key = d.toDateString();
      if (!map[key]) {
        map[key] = { date: d, tasks: [] };
      }
      map[key].tasks.push(t);
    });

    Object.values(map).forEach((day) => {
      day.tasks.sort((a, b) => {
        if (!a.hour_at) return -1;
        if (!b.hour_at) return 1;
        return a.hour_at.localeCompare(b.hour_at);
      });
    });
    
    return Object.values(map).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [filteredTasks, rangeStart, rangeEnd]);

  // Flat mobile schedule list including month headers and week dividers
  const mobileScheduleList = useMemo(() => {
    const list: Array<
      | { type: "month-banner"; date: Date }
      | { type: "week-divider"; label: string }
      | { type: "day-row"; date: Date; tasks: Task[] }
    > = [];

    if (groupedDays.length === 0) return list;

    let lastMonth = -1;
    let lastYear = -1;
    let lastWeekNum = -1;

    groupedDays.forEach((day) => {
      const d = day.date;
      const m = d.getMonth();
      const y = d.getFullYear();
      
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - d.getDay());
      const wNum = sunday.getTime(); 

      if (m !== lastMonth || y !== lastYear) {
        list.push({ type: "month-banner", date: d });
        lastMonth = m;
        lastYear = y;
        lastWeekNum = wNum; 
      } else if (wNum !== lastWeekNum) {
        list.push({ type: "week-divider", label: getWeekRangeString(d) });
        lastWeekNum = wNum;
      }

      list.push({ type: "day-row", date: d, tasks: day.tasks });
    });

    return list;
  }, [groupedDays]);

  // Scroll to the selected day's row when currentDate changes (on Schedule view)
  useEffect(() => {
    if (isMobile && viewMode === "schedule" && mobileScheduleList.length > 0) {
      const timer = setTimeout(() => {
        const targetTime = new Date(currentDate).setHours(0, 0, 0, 0);
        const targetDay = mobileScheduleList.find((item) => 
          item.type === "day-row" && item.date.getTime() >= targetTime
        );
        
        if (targetDay && targetDay.type === "day-row") {
          const id = `day-row-${targetDay.date.toDateString()}`;
          const element = document.getElementById(id);
          if (element) {
            const container = element.closest(".overflow-y-auto") as HTMLElement;
            if (container) {
              const elementRect = element.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
              container.scrollTo({ top: relativeTop - 16, behavior: "smooth" });
            }
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentDate, isMobile, viewMode, mobileScheduleList]);

  // Desktop: ao abrir Dia/Semana, começa perto das 07h em vez de meia-noite.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isMobile && viewMode !== "month") {
      gridScrollRef.current?.scrollTo({ top: 7 * 56 - 8 });
    }
  }, [isMobile, viewMode]);

  if (isMobile) {
    return (
      <div className="flex h-full flex-col bg-background text-foreground overflow-hidden relative">
        {/* Mobile local toolbar */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-3 shadow-xs">
          {isSearching ? (
            <div className="flex flex-1 items-center gap-2">
              <Search className="h-4.5 w-4.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar compromissos..."
                value={searchPeople}
                onChange={(e) => setSearchPeople(e.target.value)}
                className="flex-1 bg-transparent border-0 outline-none text-sm placeholder-muted-foreground text-foreground"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => { setIsSearching(false); setSearchPeople(""); }}>
                <X className="h-4.5 w-4.5" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {/* Month title selector toggles mini monthly calendar dropdown */}
                <button
                  onClick={() => setShowMiniCalendarDropdown(!showMiniCalendarDropdown)}
                  className="flex items-center gap-1 text-base font-semibold text-foreground capitalize focus:outline-none"
                >
                  <span>
                    {currentDate.toLocaleDateString("pt-BR", { month: "long" })}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1 font-normal">
                    {currentDate.getFullYear()}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", showMiniCalendarDropdown && "rotate-180")} />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={() => setIsSearching(true)}>
                  <Search className="h-5 w-5" />
                </Button>
                <TodayButton onClick={handleToday} />
              </div>
            </>
          )}
        </div>

        {/* Mini Monthly Calendar Dropdown Overlay */}
        {showMiniCalendarDropdown && (
          <div className="absolute top-14 left-0 right-0 z-40 bg-card border-b shadow-lg animate-in slide-in-from-top duration-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-foreground uppercase tracking-wider pl-1">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => shiftDate(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => shiftDate(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-1.5 text-center">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <span key={i} className="text-[11px] font-bold text-muted-foreground/80 h-6 flex items-center justify-center">
                  {d}
                </span>
              ))}
              {miniDays.map((d, i) => {
                const isCurrentMonth = d.getMonth() === currentDate.getMonth();
                const isSelected = d.toDateString() === currentDate.toDateString();
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setCurrentDate(d);
                      setShowMiniCalendarDropdown(false);
                    }}
                    className={cn(
                      "h-8 w-8 rounded-full text-xs font-semibold m-auto flex items-center justify-center transition-colors hover:bg-muted focus:outline-none",
                      !isCurrentMonth && "text-muted-foreground/30",
                      isCurrentMonth && "text-foreground",
                      isSelected && "bg-primary text-primary-foreground hover:opacity-90 shadow-xs",
                      isToday && !isSelected && "border-2 border-primary text-primary font-bold shadow-xs"
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mobile Main Content Scroll Area */}
        <div className="flex-1 overflow-y-auto bg-background">
          
          {/* SCHEDULE VIEW */}
          {viewMode === "schedule" && (
            <div className="px-4 pb-24">
              {mobileScheduleList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-80 text-center p-6 bg-card rounded-2xl border my-4">
                  <div className="h-12 w-12 text-muted-foreground/30 mb-3 animate-pulse">
                    <CalendarIcon className="h-full w-full" />
                  </div>
                  <p className="text-sm font-bold text-muted-foreground">Nenhum compromisso neste período</p>
                  <p className="text-xs text-muted-foreground/60 mt-1 max-w-[220px]">
                    Toque no botão "+" no canto inferior para agendar um compromisso.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {mobileScheduleList.map((item, idx) => {
                    if (item.type === "month-banner") {
                      return <MonthBanner key={`mb-${idx}`} date={item.date} />;
                    }
                    if (item.type === "week-divider") {
                      return (
                        <div key={`wd-${idx}`} className="text-[10px] font-bold text-muted-foreground/40 py-2 pl-16 tracking-wider">
                          {item.label}
                        </div>
                      );
                    }
                    
                    const d = item.date;
                    const isToday = d.toDateString() === new Date().toDateString();
                    const weekdayAbbr = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").slice(0, 3);
                    const dayNum = d.getDate();

                    return (
                      <div key={`dr-${idx}`} id={`day-row-${d.toDateString()}`} className="flex gap-4 mb-3 items-start shrink-0">
                        {/* Left Date Column */}
                        <div className="flex flex-col items-center w-12 shrink-0 pt-1">
                          <span className={cn("text-[10px] font-bold uppercase tracking-wider", isToday ? "text-primary font-black" : "text-muted-foreground/50")}>
                            {weekdayAbbr}
                          </span>
                          <span className={cn(
                            "text-lg font-bold h-8 w-8 rounded-full flex items-center justify-center mt-1 transition-all",
                            isToday ? "bg-primary text-primary-foreground shadow-md scale-105" : "text-foreground/90"
                          )}>
                            {dayNum}
                          </span>
                        </div>
                        {/* Right Event Capsules Column */}
                        <div className="flex-1 space-y-2">
                          {item.tasks.map((task) => (
                            <div
                              key={task.id}
                              onClick={() => onTaskClick(task)}
                              className="cursor-pointer rounded-xl px-4 py-3.5 flex flex-col justify-center bg-card border border-border border-l-4 shadow-xs select-none transition-all active:scale-[0.98]"
                              style={{
                                borderLeftColor: funnelColor(task),
                              }}
                            >
                              <span className="text-sm font-semibold text-foreground leading-snug break-words flex items-center gap-1">
                                {task.type === "note" && <StickyNote className="h-3 w-3 shrink-0 text-amber-500" />}
                                {task.title}
                              </span>
                              {task.hour_at && (
                                <span className="text-[10px] text-muted-foreground font-semibold mt-1">
                                  {task.hour_at}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DAY VIEW */}
          {viewMode === "day" && (
            <div
              className="h-full flex flex-col overflow-hidden select-none bg-card"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={() => onTouchEnd(() => shiftDate(1), () => shiftDate(-1))}
            >
              {/* Day View Header */}
              <div className="px-4 py-3 border-b flex items-center justify-between bg-card shrink-0">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                    {WEEKDAYS[currentDate.getDay()]}
                  </span>
                  <span className="text-xl font-bold text-foreground mt-0.5">
                    {currentDate.getDate()} de {MONTHS[currentDate.getMonth()]}
                  </span>
                </div>
                {currentDate.toDateString() === new Date().toDateString() && (
                  <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-full">
                    Hoje
                  </span>
                )}
              </div>

              {/* Day Scroll Container */}
              <div className="flex-1 overflow-y-auto relative flex">
                {/* Hours column */}
                <div className="w-14 shrink-0 border-r bg-card/50 select-none">
                  {hours.map((h) => {
                    const label = h === 0 ? "" : h > 12 ? `${h - 12} PM` : `${h} AM`;
                    return (
                      <div key={h} className="h-14 flex items-start justify-end pr-2 text-[10px] text-muted-foreground/75">
                        <span className="-mt-1.5 font-medium">{label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Day column */}
                <div className="flex-1 relative min-h-[1344px] bg-card">
                  {hours.map((h) => (
                    <div key={h} className="h-14 border-b border-muted/30" />
                  ))}

                  {/* Current Time Indicator line */}
                  {currentDate.toDateString() === new Date().toDateString() && (
                    <div
                      className="absolute left-0 right-0 z-30 pointer-events-none"
                      style={{
                        top: (currentTime.getHours() + currentTime.getMinutes() / 60) * 56,
                      }}
                    >
                      <div className="h-0.5 bg-red-500 w-full relative">
                        <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                      </div>
                    </div>
                  )}

                  {/* Absolute positioned timed events */}
                  {computeDayTimedEvents(currentDate).map(({ task, top, height, width, left }) => (
                    <div
                      key={task.id}
                      onClick={() => onTaskClick(task)}
                      className="absolute z-10 cursor-pointer rounded-lg border-l-4 px-3 py-2 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-start overflow-hidden active:scale-[0.98]"
                      style={{
                        backgroundColor: `${funnelColor(task)}12`,
                        borderLeftColor: funnelColor(task),
                        color: funnelColor(task),
                        top,
                        height,
                        width: `calc(${width} - 4px)`,
                        left: `calc(${left} + 2px)`,
                      }}
                    >
                      <p className="truncate text-[10px] font-bold tracking-wider uppercase opacity-90 leading-tight">
                        {task.hour_at}
                      </p>
                      <p className="truncate text-xs font-semibold leading-snug mt-0.5 flex items-center gap-1">
                        {task.type === "note" && <StickyNote className="h-3 w-3 shrink-0 text-amber-500" />}
                        {task.title}
                      </p>
                      {height > 35 && task.description && (
                        <p className="truncate text-[9px] opacity-75 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* WEEK VIEW */}
          {viewMode === "week" && (
            <div
              className="h-full flex flex-col bg-card overflow-hidden"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={() => onTouchEnd(() => shiftDate(1), () => shiftDate(-1))}
            >
              {/* Header: Weekdays (Horizontal scrollable, synced with grid columns) */}
              <div className="flex border-b shrink-0 bg-card select-none">
                {/* Spacer matching the hours column width */}
                <div className="w-12 shrink-0 border-r bg-card" />
                
                {/* Horizontal scrollable weekdays header */}
                <div className="flex-1 flex overflow-hidden" id="mobile-week-header-scroll">
                  {weekDays.map((day) => {
                    const isToday = day.toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={day.toISOString()}
                        className={cn(
                          "min-w-[110px] w-[33.333%] shrink-0 flex flex-col items-center justify-center py-2 border-r",
                          isToday && "bg-primary/[0.06] border-b-2 border-b-primary"
                        )}
                      >
                        <span className={cn("text-[9px] font-bold uppercase", isToday ? "text-primary" : "text-muted-foreground/60")}>
                          {WEEKDAYS[day.getDay()]}
                        </span>
                        <span
                          className={cn(
                            "text-sm font-bold mt-0.5 h-6 w-6 flex items-center justify-center rounded-full",
                            isToday ? "bg-primary text-primary-foreground shadow-xs" : "text-foreground/90"
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body: Vertical & Horizontal scrollable container */}
              <div className="flex-1 overflow-y-auto flex relative bg-card">
                {/* Hours column (sticky left, scrolls vertically with the container) */}
                <div className="w-12 shrink-0 border-r bg-card select-none sticky left-0 z-20">
                  {hours.map((h) => {
                    const label = h === 0 ? "" : h > 12 ? `${h - 12} PM` : `${h} AM`;
                    return (
                      <div key={h} className="h-14 flex items-start justify-end pr-2 text-[9px] text-muted-foreground/75 font-semibold bg-card">
                        <span className="-mt-1.5">{label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Day Columns (scrolls horizontally, contains grid lines and events) */}
                <div
                  className="flex-1 flex overflow-x-auto snap-x snap-mandatory z-10"
                  id="mobile-week-grid-scroll"
                  onScroll={(e) => {
                    const header = document.getElementById("mobile-week-header-scroll");
                    if (header) {
                      header.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
                    }
                  }}
                >
                  <div className="flex min-h-[1344px] relative flex-1">
                    {weekDays.map((day) => {
                      const isToday = day.toDateString() === new Date().toDateString();
                      const timedEvents = computeDayTimedEvents(day);
                      
                      return (
                        <div
                          key={day.toISOString()}
                          className={cn(
                            "min-w-[110px] w-[33.333%] shrink-0 border-r relative snap-start",
                            isToday && "bg-primary/[0.03]"
                          )}
                        >
                          {/* Hour slot horizontal lines */}
                          {hours.map((h) => (
                            <div key={h} className="h-14 border-b border-muted/20" />
                          ))}

                          {/* Current Time Indicator line */}
                          {isToday && (
                            <div
                              className="absolute left-0 right-0 z-30 pointer-events-none"
                              style={{
                                top: (currentTime.getHours() + currentTime.getMinutes() / 60) * 56,
                              }}
                            >
                              <div className="h-0.5 bg-red-500 w-full relative" />
                            </div>
                          )}

                          {/* Timed events */}
                          {timedEvents.map(({ task, top, height, width, left }) => (
                            <div
                              key={task.id}
                              onClick={() => onTaskClick(task)}
                              className="absolute z-10 cursor-pointer rounded border-l-[3px] px-1 py-0.5 shadow-xs flex flex-col justify-start overflow-hidden active:scale-[0.98]"
                              style={{
                                backgroundColor: `${funnelColor(task)}12`,
                                borderLeftColor: funnelColor(task),
                                color: funnelColor(task),
                                top,
                                height,
                                width: `calc(${width} - 2px)`,
                                left: `calc(${left} + 1px)`,
                              }}
                            >
                              <p className="truncate text-[8px] font-bold leading-none uppercase opacity-90">
                                {task.hour_at}
                              </p>
                              <p className="truncate text-[10px] font-bold leading-tight mt-0.5">
                                {task.title}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MONTH VIEW */}
          {viewMode === "month" && (
            <div className="h-full flex flex-col bg-card overflow-hidden">
              {/* Monthly Grid Card at the top */}
              <div className="p-4 border-b shrink-0 bg-card">
                <div className="grid grid-cols-7 gap-y-2 text-center">
                  {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((d, i) => (
                    <span key={i} className="text-[10px] font-bold text-muted-foreground/60 h-6 flex items-center justify-center">
                      {d}
                    </span>
                  ))}
                  {miniDays.map((d, i) => {
                    const isCurrentMonth = d.getMonth() === currentDate.getMonth();
                    const isSelected = d.toDateString() === currentDate.toDateString();
                    const isToday = d.toDateString() === new Date().toDateString();
                    const dayTasks = tasksForDay(d);
                    const hasTasks = dayTasks.length > 0;

                    return (
                      <button
                        key={i}
                        onClick={() => setCurrentDate(d)}
                        className="h-8 w-8 relative m-auto flex flex-col items-center justify-center focus:outline-none animate-in fade-in-50 duration-200"
                      >
                        <span
                          className={cn(
                            "h-7 w-7 rounded-full text-xs font-semibold flex items-center justify-center transition-colors",
                            !isCurrentMonth && "text-muted-foreground/30",
                            isCurrentMonth && "text-foreground",
                            isSelected && "bg-primary text-primary-foreground hover:opacity-90 shadow-xs",
                            isToday && !isSelected && "border-2 border-primary text-primary font-bold shadow-xs"
                          )}
                        >
                          {d.getDate()}
                        </span>
                        {/* Dot indicator if there are tasks on this day */}
                        {hasTasks && !isSelected && (
                          <span
                            className="absolute bottom-0.5 h-1 w-1 rounded-full"
                            style={{ backgroundColor: funnelColor(dayTasks[0]) }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tasks for selected day at the bottom */}
              <div className="flex-1 overflow-y-auto px-4 py-4 bg-background">
                <div className="mb-3 px-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Compromissos para {currentDate.getDate()} de {MONTHS[currentDate.getMonth()]}
                  </span>
                </div>

                {tasksForDay(currentDate).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center bg-card rounded-xl border">
                    <CalendarCheck className="h-8 w-8 text-muted-foreground/20 mb-2" />
                    <p className="text-xs font-bold text-muted-foreground/60">Nenhum compromisso agendado</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasksForDay(currentDate).map((task) => (
                      <div
                        key={task.id}
                        onClick={() => onTaskClick(task)}
                        className="cursor-pointer rounded-xl px-4 py-3 flex flex-col justify-center bg-card border border-border border-l-4 shadow-xs select-none transition-all active:scale-[0.98]"
                        style={{
                          borderLeftColor: funnelColor(task),
                        }}
                      >
                        <span className="text-sm font-semibold text-foreground leading-snug break-words flex items-center gap-1">
                          {task.type === "note" && <StickyNote className="h-3 w-3 shrink-0 text-amber-500" />}
                          {task.title}
                        </span>
                        {task.hour_at && (
                          <span className="text-[10px] text-muted-foreground font-semibold mt-1">
                            {task.hour_at}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Floating Action Button (FAB) */}
        <button
          onClick={onNewTask}
          className="fixed bottom-20 right-4 z-40 bg-primary shadow-lg hover:shadow-xl transition-all duration-200 h-14 w-14 rounded-full flex items-center justify-center text-primary-foreground active:scale-90"
          style={{ backgroundColor: themeColor }}
        >
          <Plus className="h-6 w-6" />
        </button>

        {/* Slide-out Sidebar Drawer on Mobile */}
        {showSidebar && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
              onClick={() => setShowSidebar(false)}
            />
            <div className="relative flex flex-col w-72 max-w-xs bg-card p-5 border-r shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between mb-6">
                <span className="font-display font-bold text-lg text-foreground">Menu da Agenda</span>
                <Button variant="ghost" size="icon" onClick={() => setShowSidebar(false)} className="rounded-full h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 pr-1">
                {/* View Switcher Navigation */}
                <div className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block px-3 mb-2">Visualizações</span>
                  
                  <button
                    onClick={() => { setViewMode("schedule"); setShowSidebar(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left focus:outline-none",
                      viewMode === "schedule" ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/80"
                    )}
                  >
                    <CalendarRange className="h-4.5 w-4.5 text-muted-foreground" />
                    <span>Programação</span>
                  </button>

                  <button
                    onClick={() => { setViewMode("day"); setShowSidebar(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left focus:outline-none",
                      viewMode === "day" ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/80"
                    )}
                  >
                    <Clock className="h-4.5 w-4.5 text-muted-foreground" />
                    <span>Dia</span>
                  </button>

                  <button
                    onClick={() => { setViewMode("week"); setShowSidebar(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left focus:outline-none",
                      viewMode === "week" ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/80"
                    )}
                  >
                    <CalendarDays className="h-4.5 w-4.5 text-muted-foreground" />
                    <span>Semana</span>
                  </button>

                  <button
                    onClick={() => { setViewMode("month"); setShowSidebar(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left focus:outline-none",
                      viewMode === "month" ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/80"
                    )}
                  >
                    <Grid className="h-4.5 w-4.5 text-muted-foreground" />
                    <span>Mês</span>
                  </button>
                </div>

                <hr className="border-border my-4" />

                {/* Mini Calendar in Sidebar */}
                <div>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                      {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </span>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => shiftDate(-1)}>
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => shiftDate(1)}>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-1 text-center">
                    {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                      <span key={i} className="text-[10px] font-semibold text-muted-foreground/80 h-6 flex items-center justify-center">
                        {d}
                      </span>
                    ))}
                    {miniDays.map((d, i) => {
                      const isCurrentMonth = d.getMonth() === currentDate.getMonth();
                      const isSelected = d.toDateString() === currentDate.toDateString();
                      const isToday = d.toDateString() === new Date().toDateString();
                      return (
                        <button
                          key={i}
                          onClick={() => { setCurrentDate(d); setShowSidebar(false); }}
                          className={cn(
                            "h-7 w-7 rounded-full text-xs font-medium m-auto flex items-center justify-center transition-colors hover:bg-muted focus:outline-none",
                            !isCurrentMonth && "text-muted-foreground/30",
                            isCurrentMonth && "text-foreground",
                            isSelected && "bg-primary text-primary-foreground hover:opacity-90",
                            isToday && !isSelected && "border-2 border-primary text-primary font-bold shadow-xs"
                          )}
                        >
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Calendars / Funnels selection */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Minhas agendas</span>
                  <div className="space-y-3 mt-2 pl-1">
                    <label className="flex items-center gap-3 text-sm cursor-pointer select-none group">
                      <input
                        type="checkbox"
                        checked={userCalendarChecked}
                        onChange={(e) => setUserCalendarChecked(e.target.checked)}
                        className="h-4 w-4 rounded cursor-pointer"
                        style={{ accentColor: "var(--primary)" }}
                      />
                      <span className="text-foreground/85 group-hover:text-foreground text-xs truncate">
                        {user?.first_name || "Minha Agenda"}
                      </span>
                    </label>

                    {funnels.map((f) => (
                      <label key={f.id} className="flex items-center gap-3 text-sm cursor-pointer select-none group">
                        <input
                          type="checkbox"
                          checked={filterUserProjects[f.id] !== false}
                          onChange={(e) => setFilterUserProjects((prev) => ({ ...prev, [f.id]: e.target.checked }))}
                          className="h-4 w-4 rounded cursor-pointer"
                          style={{ accentColor: colorForFunnel(f.id) ?? themeColor }}
                        />
                        <span className="text-foreground/85 group-hover:text-foreground text-xs truncate">
                          {labelForFunnel(f)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop — Ebenezer Design System (Dia / Semana / Mês)
  const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const todayString = new Date().toDateString();
  const visibleDays = viewMode === "day" ? [currentDate] : weekDays;
  const dayTasksSorted = tasksForDay(currentDate).sort((a, b) => (a.hour_at ?? "99:99").localeCompare(b.hour_at ?? "99:99"));
  const busyMinutes = dayTasksSorted.reduce((sum, t) => {
    if (!t.hour_at) return sum;
    const [dh, dm] = (t.estimated_time || "01:00").split(":").map(Number);
    return sum + dh * 60 + dm;
  }, 0);
  const busyLabel = busyMinutes > 0 ? ` · ${Math.floor(busyMinutes / 60)}h${busyMinutes % 60 ? String(busyMinutes % 60).padStart(2, "0") : ""} ocupadas` : "";

  const segmented = (
    <div className="flex gap-1 rounded-[9px] border bg-card p-[3px]">
      {([["day", "Dia"], ["week", "Semana"], ["month", "Mês"]] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setViewMode(key)}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            viewMode === key ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const eventChipStyle = (task: Task) => ({ backgroundColor: hexA(funnelColor(task), 0.16) });

  return (
    <div className="flex min-h-0 flex-1 select-none flex-col overflow-hidden bg-background text-foreground">
      {/* Barra superior: título, navegação, hoje e modo de visualização */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 px-6 pb-4 pt-5 lg:px-8">
        <button
          type="button"
          title={showSidebar ? "Ocultar painel" : "Mostrar painel"}
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-muted-foreground transition-colors hover:text-foreground"
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em]">{headerDateLabel}</h1>
        <div className="flex gap-1">
          <button type="button" aria-label="Anterior" onClick={() => shiftDate(-1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Próximo" onClick={() => shiftDate(1)} className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={handleToday} className="flex h-[30px] items-center rounded-[7px] border px-3 text-[13px] transition-colors hover:bg-accent">
          Hoje
        </button>
        <div className="flex-1" />
        {segmented}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6 lg:px-8">
        {/* Painel lateral: criar, mini calendário, busca e agendas */}
        {showSidebar && (
          <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto">
            <Button onClick={onNewTask} className="w-full gap-1.5">
              <Plus className="h-4 w-4" strokeWidth={2.4} /> Criar
            </Button>

            <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">
                  {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                </span>
                <div className="flex gap-0.5">
                  <button type="button" aria-label="Mês anterior" onClick={() => { const d = new Date(currentDate); d.setMonth(d.getMonth() - 1); setCurrentDate(d); }} className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-accent hover:text-foreground">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Próximo mês" onClick={() => { const d = new Date(currentDate); d.setMonth(d.getMonth() + 1); setCurrentDate(d); }} className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-accent hover:text-foreground">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                  <span key={i} className="py-1 text-[11px] text-subtle">{d}</span>
                ))}
                {miniDays.map((d, i) => {
                  const inMonth = d.getMonth() === currentDate.getMonth();
                  const isSelected = d.toDateString() === currentDate.toDateString();
                  const isToday = d.toDateString() === todayString;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCurrentDate(d)}
                      className={cn(
                        "grid h-[30px] place-items-center rounded-[7px] text-xs transition-colors",
                        isToday ? "bg-primary font-semibold text-white" : isSelected ? "bg-primary/15 font-semibold text-primary" : inMonth ? "text-foreground hover:bg-accent" : "text-subtle/50 hover:bg-accent"
                      )}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input
                type="text"
                placeholder="Pesquisar pessoas"
                value={searchPeople}
                onChange={(e) => setSearchPeople(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-surface pl-9 pr-8 text-xs outline-none transition-colors placeholder:text-subtle focus:border-primary focus:ring-[3px] focus:ring-primary/25"
              />
              {searchPeople && (
                <button type="button" onClick={() => setSearchPeople("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-accent">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <button type="button" className="label-caps flex w-full items-center justify-between px-1" onClick={() => setShowCalendars(!showCalendars)}>
                <span>Minhas agendas</span>
                {showCalendars ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showCalendars && (
                <div className="flex flex-col gap-1">
                  {[
                    { key: "me", label: user?.first_name || "Minha Agenda", color: themeColor, checked: userCalendarChecked, toggle: () => setUserCalendarChecked(!userCalendarChecked) },
                    ...funnels.map((f) => ({
                      key: String(f.id),
                      label: labelForFunnel(f),
                      color: colorForFunnel(f.id) ?? themeColor,
                      checked: filterUserProjects[f.id] !== false,
                      toggle: () => setFilterUserProjects((prev) => ({ ...prev, [f.id]: prev[f.id] === false })),
                    })),
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="checkbox"
                      aria-checked={item.checked}
                      onClick={item.toggle}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border-[1.5px]"
                        style={item.checked ? { backgroundColor: item.color, borderColor: item.color } : { borderColor: "#4A4A52" }}
                      >
                        {item.checked && <Check className="h-3 w-3 text-white" strokeWidth={3.5} />}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Painel principal: Dia / Semana / Mês */}
        <main className="flex min-h-0 min-w-0 flex-1 gap-4">
          {viewMode === "month" ? (
            <div key="month" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-border">
              <div className="grid shrink-0 grid-cols-7 gap-px">
                {DOW_SHORT.map((d) => (
                  <div key={d} className="bg-surface px-3 py-2.5 text-xs font-medium text-subtle">{d}</div>
                ))}
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-y-auto" style={{ gridAutoRows: "minmax(124px, 1fr)" }}>
                {miniDays.map((d, i) => {
                  const inMonth = d.getMonth() === currentDate.getMonth();
                  const isToday = d.toDateString() === todayString;
                  const dayTasks = tasksForDay(d).sort((a, b) => (a.hour_at ?? "").localeCompare(b.hour_at ?? ""));
                  return (
                    <div key={i} className={cn("flex min-w-0 flex-col gap-1 p-2", inMonth ? "bg-card" : "bg-surface")}>
                      <button
                        type="button"
                        onClick={() => { setCurrentDate(d); setViewMode("day"); }}
                        className={cn(
                          "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[13px] font-medium transition-colors",
                          isToday ? "bg-primary text-white" : inMonth ? "hover:bg-accent" : "text-subtle/50 hover:bg-accent"
                        )}
                      >
                        {d.getDate()}
                      </button>
                      {dayTasks.slice(0, 3).map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onTaskClick(t)}
                          onMouseEnter={(e) => showEventTooltip(e, t)}
                          onMouseMove={moveEventTooltip}
                          onMouseLeave={hideEventTooltip}
                          className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[5px] px-1.5 py-[3px] text-xs transition-opacity hover:opacity-80"
                          style={eventChipStyle(t)}
                        >
                          <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ backgroundColor: funnelColor(t) }} />
                          {t.hour_at && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{t.hour_at}</span>}
                          {t.type === "note" && <StickyNote className="h-2.5 w-2.5 shrink-0 text-warning" />}
                          <span className="truncate">{t.title}</span>
                        </div>
                      ))}
                      {dayTasks.length > 3 && (
                        <button
                          type="button"
                          onClick={() => { setCurrentDate(d); setViewMode("day"); }}
                          className="pl-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          +{dayTasks.length - 3} mais
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div key="timegrid" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-surface">
                {viewMode === "day" ? (
                  <div className="flex shrink-0 items-center gap-2.5 border-b px-[18px] py-3.5">
                    <span className={cn("grid h-[34px] w-[34px] place-items-center rounded-full font-display font-semibold", currentDate.toDateString() === todayString ? "bg-primary text-white" : "bg-input")}>
                      {currentDate.getDate()}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{currentDate.toLocaleDateString("pt-BR", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase())}</span>
                      <span className="text-xs text-subtle">{dayTasksSorted.length} {dayTasksSorted.length === 1 ? "evento" : "eventos"}{busyLabel}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid shrink-0 border-b pr-[10px]" style={{ gridTemplateColumns: "60px repeat(7, minmax(0, 1fr))" }}>
                    <span />
                    {visibleDays.map((day) => {
                      const isToday = day.toDateString() === todayString;
                      const allDay = tasksForDay(day).filter((t) => !t.hour_at);
                      return (
                        <div key={day.toISOString()} className="flex min-w-0 flex-col gap-1.5 border-l px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-xs", isToday ? "text-primary" : "text-subtle")}>{DOW_SHORT[day.getDay()]}</span>
                            <span className={cn("grid h-7 w-7 place-items-center rounded-full font-display text-[15px] font-semibold", isToday && "bg-primary text-white")}>
                              {day.getDate()}
                            </span>
                          </div>
                          {allDay.length > 0 && (
                            <div className="flex max-h-[76px] min-w-0 flex-col gap-1 overflow-y-auto">
                              {allDay.map((t) => (
                                <div
                                  key={t.id}
                                  onClick={() => onTaskClick(t)}
                                  onMouseEnter={(e) => showEventTooltip(e, t)}
                                  onMouseMove={moveEventTooltip}
                                  onMouseLeave={hideEventTooltip}
                                  className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                                  style={eventChipStyle(t)}
                                >
                                  <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ backgroundColor: funnelColor(t) }} />
                                  <span className="truncate">{t.title}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div ref={gridScrollRef} className="relative flex min-h-0 flex-1 overflow-y-auto">
                  <div className="w-[60px] shrink-0 select-none">
                    {hours.map((h) => (
                      <div key={h} className="h-14 pr-2 text-right font-mono text-[10px] text-subtle">
                        <span className="relative -top-1.5">{h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</span>
                      </div>
                    ))}
                  </div>

                  <div className="relative flex min-h-[1344px] flex-1">
                    {visibleDays.map((day) => {
                      const isToday = day.toDateString() === todayString;
                      const timedEvents = computeDayTimedEvents(day);
                      const timeLineTop = (currentTime.getHours() + currentTime.getMinutes() / 60) * 56;
                      return (
                        <div key={day.toISOString()} className={cn("relative min-w-0 flex-1 border-l", isToday && "bg-card")}>
                          {hours.map((h) => (
                            <div key={h} className="h-14 border-b border-border/50" />
                          ))}

                          {isToday && (
                            <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: timeLineTop }}>
                              <div className="relative h-0.5 w-full bg-primary">
                                <div className="absolute -left-[5px] -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                              </div>
                            </div>
                          )}

                          {timedEvents.map(({ task, top, height, width, left }) => (
                            <div
                              key={task.id}
                              onClick={() => onTaskClick(task)}
                              onMouseEnter={(e) => showEventTooltip(e, task)}
                              onMouseMove={moveEventTooltip}
                              onMouseLeave={hideEventTooltip}
                              className="absolute z-10 flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-[7px] border px-2 py-1.5 transition-shadow hover:z-20 hover:shadow-md"
                              style={{
                                backgroundColor: hexA(funnelColor(task), 0.16),
                                borderColor: hexA(funnelColor(task), 0.35),
                                top,
                                height,
                                width,
                                left,
                              }}
                            >
                              <span className="flex items-center gap-1 truncate text-xs font-semibold leading-tight">
                                {task.type === "note" && <StickyNote className="h-3 w-3 shrink-0 text-warning" />}
                                {task.title}
                              </span>
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {eventTimeRangeLabel(task).replace(" - ", " – ")}
                              </span>
                              {height > 44 && task.description && (
                                <span className="truncate text-[10px] text-muted-foreground/80">{task.description}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {viewMode === "day" && (
                <aside className="hidden w-[300px] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 xl:flex">
                  <span className="text-[13px] font-semibold">Prazos do dia</span>
                  {dayTasksSorted.length === 0 ? (
                    <p className="text-sm text-subtle">Nada com prazo neste dia.</p>
                  ) : (
                    dayTasksSorted.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        className="flex cursor-pointer flex-col gap-1 rounded-[9px] bg-accent p-2.5 transition-colors hover:bg-input/60"
                      >
                        <span className="text-[13px] font-medium">{t.title}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: funnelColor(t) }} />
                          {t.hour_at ? <span className="font-mono">{t.hour_at}</span> : "Dia inteiro"}
                        </span>
                      </div>
                    ))
                  )}
                </aside>
              )}
            </>
          )}
        </main>
      </div>

      {/* Prévia ao passar o mouse sobre um evento */}
      {hoverEvent && (
        <div
          className="pointer-events-none fixed z-50 max-w-[260px] overflow-hidden rounded-xl border border-input bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
          style={{
            left: Math.min(hoverEvent.x + 16, window.innerWidth - 280),
            top: Math.min(hoverEvent.y + 16, window.innerHeight - 140),
          }}
        >
          <div className="h-1.5 w-full" style={{ backgroundColor: funnelColor(hoverEvent.task) }} />
          <div className="p-3">
            <p className="flex items-center gap-1.5 break-words text-sm font-semibold leading-snug text-foreground">
              {hoverEvent.task.type === "note" && <StickyNote className="h-3.5 w-3.5 shrink-0 text-warning" />}
              {hoverEvent.task.title}
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              {eventTimeRangeLabel(hoverEvent.task)}
            </p>
            {hoverEvent.task.description && (
              <p className="mt-1.5 line-clamp-3 break-words text-xs text-muted-foreground/80">
                {hoverEvent.task.description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
