/**
 * Constantes do Ebenezer Design System usadas em cores dinâmicas (dados → cor).
 * Cores estáticas de interface vêm dos tokens CSS em index.css (bg-card, text-muted-foreground…).
 */

export const PINK = "#EC1889";

/** Paleta de identificação (projetos, hábitos, avatares, tags). */
export const ACCENT_COLORS = [
  "#EC1889", // rosa Ebenezer
  "#9B7BFF", // violeta
  "#4C9BFF", // azul
  "#2DD4BF", // turquesa
  "#F7B32B", // âmbar
  "#2BD47D", // verde
  "#FF5CAE", // rosa claro
  "#8A8A94", // neutro
] as const;

/** Semânticas: sucesso, atenção, erro, informação. */
export const SEMANTIC = {
  success: "#2BD47D",
  warning: "#F7B32B",
  danger: "#FF5A5F",
  info: "#4C9BFF",
} as const;

/** Adiciona opacidade (0–1) a uma cor #RRGGBB → #RRGGBBAA. Fundo de tag = 14% da cor. */
export function hexA(hex: string, alpha: number): string {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : PINK;
  return clean + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/** Cor estável da paleta para uma string (nome de usuário, tag…). */
export function accentFromString(value: string): string {
  return ACCENT_COLORS[hashString(value || "?") % (ACCENT_COLORS.length - 1)];
}

/** Estilo de "tag suave": fundo com 14% de opacidade e texto na cor cheia. */
export function softTagStyle(color: string): { color: string; backgroundColor: string } {
  return { color, backgroundColor: hexA(color, 0.14) };
}

/** Prioridade das tarefas: alta = erro, média = atenção, baixa = neutro. */
export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  high: { label: "Alta", color: SEMANTIC.danger },
  medium: { label: "Média", color: SEMANTIC.warning },
  low: { label: "Baixa", color: "#8A8A94" },
};

/** Cor de identificação de uma etapa do funil a partir do status que ela representa. */
export function stageColor(stage: { status?: string | null; stage_done?: boolean | null }): string {
  if (stage.stage_done || stage.status === "done") return SEMANTIC.success;
  switch (stage.status) {
    case "inprogress":
      return PINK;
    case "review":
      return SEMANTIC.warning;
    case "notdone":
      return SEMANTIC.info;
    default:
      return "#8A8A94";
  }
}
