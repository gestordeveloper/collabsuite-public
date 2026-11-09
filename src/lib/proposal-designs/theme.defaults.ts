import type { DesignId, ThemeTokens } from "./types";

export const DEFAULT_THEME: Record<Exclude<DesignId, "classic">, ThemeTokens> = {
  model1: {
    primaryColor: "#0C4A45",
    midColor: "#146A62",
    accentColor: "#7FD3C4",
    lightColor: "#EEF5F3",
    textMutedColor: "#56706C",
    logoUrl: "",
    companyName: "Sua Empresa",
  },
  model2: {
    primaryColor: "#0C4A45",
    midColor: "#146A62",
    accentColor: "#7FD3C4",
    lightColor: "#F4F1EA",
    textMutedColor: "#56706C",
    logoUrl: "",
    companyName: "Sua Empresa",
  },
};
