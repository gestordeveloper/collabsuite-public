import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Calendar, Headset, Flame, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/src/lib/utils";
import { NAV_SECTIONS } from "./nav-items";

const TAB_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/habitos", label: "Hábitos", icon: Flame, exact: false },
  { to: "/atendimento", label: "Atendimento", icon: Headset, exact: false },
  { to: "/agenda", label: "Agenda", icon: Calendar, exact: false },
];

export function Tabbar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="more-backdrop"
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              key="more-sheet"
              className="fixed bottom-16 left-0 right-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t bg-surface px-4 pb-4 pt-3 md:hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 350, damping: 35 }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Menu</span>
                <button onClick={() => setMoreOpen(false)} className="p-1 text-subtle" aria-label="Fechar menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {NAV_SECTIONS.map((section) => (
                <div key={section.label} className="mb-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">{section.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium",
                            isActive ? "border-primary text-foreground" : "text-subtle"
                          )
                        }
                      >
                        <item.icon className="h-5 w-5" strokeWidth={1.8} />
                        <span className="text-center">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-surface/90 px-2 pb-safe backdrop-blur-lg md:hidden">
        {TAB_ITEMS.map((item) => {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center justify-center flex-1 py-1 px-1 text-[10px] sm:text-xs font-medium transition-colors duration-200 select-none",
                  isActive ? "text-foreground" : "text-subtle hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative flex items-center justify-center">
                    <item.icon className={cn("h-5 w-5 mb-0.5", isActive && "text-primary")} strokeWidth={1.8} />
                  </div>
                  <span>{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTabIndicator"
                      className="absolute top-0 left-[20%] right-[20%] h-[3px] rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center py-1 px-1 text-[10px] font-medium select-none sm:text-xs",
            moreOpen ? "text-foreground" : "text-subtle"
          )}
        >
          <Menu className={cn("mb-0.5 h-5 w-5", moreOpen && "text-primary")} strokeWidth={1.8} />
          <span>Mais</span>
        </button>
      </nav>
    </>
  );
}
