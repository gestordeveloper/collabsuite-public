import { create } from "zustand";

interface ThemeState {
  darkMode: boolean;
  themeColor: string;
  toggleDarkMode: () => void;
  setThemeColor: (color: string) => void;
}

/** Rosa Ebenezer — cor primária do design system. */
export const BRAND_COLOR = "#ec1889";
const LEGACY_DEFAULT_COLOR = "#4f46e5";
const THEME_VERSION = "ebenezer-1";

// Migração única: quem nunca escolheu uma cor própria (ou ficou com o índigo antigo, que era o
// padrão) passa para o rosa Ebenezer. Escolhas explícitas de outras cores são preservadas.
if (localStorage.getItem("collab_theme_v") !== THEME_VERSION) {
  if ((localStorage.getItem("collab_color") ?? LEGACY_DEFAULT_COLOR).toLowerCase() === LEGACY_DEFAULT_COLOR) {
    localStorage.removeItem("collab_color");
  }
  localStorage.setItem("collab_theme_v", THEME_VERSION);
}

// Interface escura por padrão; a escolha explícita do usuário (claro/escuro) continua valendo.
const savedDarkRaw = localStorage.getItem("collab_dark");
const savedDark = savedDarkRaw === null ? true : savedDarkRaw === "true";
const savedColor = localStorage.getItem("collab_color") || BRAND_COLOR;

// Apply dark class to document root on init
if (savedDark) {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

// Apply initial CSS variable
document.documentElement.style.setProperty("--primary", savedColor);

export const useThemeStore = create<ThemeState>((set) => ({
  darkMode: savedDark,
  themeColor: savedColor,

  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem("collab_dark", String(next));
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      return { darkMode: next };
    }),

  setThemeColor: (color: string) =>
    set(() => {
      localStorage.setItem("collab_color", color);
      document.documentElement.style.setProperty("--primary", color);
      return { themeColor: color };
    }),
}));
