import type { CardTone, ThemeTokens } from "@/src/lib/proposal-designs/types";

export const FONT_DISPLAY = "'Poppins', sans-serif";
export const FONT_BODY = "'Plus Jakarta Sans', sans-serif";

export const DARK_TEXT = "#0B1F1C";
export const MUTED_ON_DARK = "#A9CFC8";

/** Background/text color for a card of the given tone, resolved against the theme. */
export function toneStyle(tone: CardTone | undefined, theme: ThemeTokens): React.CSSProperties {
  switch (tone) {
    case "dark":
      return { background: theme.primaryColor, color: "#FFFFFF" };
    case "mid":
      return { background: theme.midColor, color: "#FFFFFF" };
    case "accent":
      return { background: theme.accentColor, color: theme.primaryColor };
    case "outline":
      return { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", color: "#FFFFFF" };
    case "light":
    default:
      return { background: theme.lightColor, color: theme.textMutedColor };
  }
}

/** Background/text color for a whole slide section. */
export function sectionStyle(tone: "dark" | "light", theme: ThemeTokens): React.CSSProperties {
  return tone === "dark"
    ? { background: theme.primaryColor, color: "#FFFFFF" }
    : { background: "#FFFFFF", color: DARK_TEXT };
}

export function mutedColor(tone: "dark" | "light", theme: ThemeTokens): string {
  return tone === "dark" ? MUTED_ON_DARK : theme.textMutedColor;
}

export function BrandBadge({
  logoUrl, companyName, bg, color,
}: { logoUrl?: string; companyName?: string; bg: string; color: string }) {
  const initial = (companyName || "E").trim().charAt(0).toUpperCase() || "E";
  return logoUrl ? (
    <img src={logoUrl} alt={companyName || "Logo"} style={{ height: 44, width: "auto", objectFit: "contain" }} />
  ) : (
    <div
      style={{
        width: 44, height: 44, borderRadius: 12, background: bg, color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

export function RunningHeaderRow({
  left, right, color,
}: { left?: string; right?: string; color: string }) {
  if (!left && !right) return null;
  return (
    <div
      className="flex items-center justify-between"
      style={{ fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color }}
    >
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

export function DividerBar({ color, width = 104 }: { color: string; width?: number }) {
  return <div style={{ width, height: 8, background: color, borderRadius: 4, flexShrink: 0 }} />;
}

export function MultiLine({ text }: { text: string | undefined }) {
  const lines = (text || "").split("\n");
  return (
    <>
      {lines.map((l, i) => (
        <span key={i}>
          {l}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export function HeadingWithDivider({
  title, dividerColor, size = 72, color,
}: { title: string | undefined; dividerColor: string; size?: number; color?: string }) {
  if (!title) return null;
  return (
    <div>
      <h2
        style={{
          fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.05,
          margin: "0 0 18px", color,
        }}
      >
        <MultiLine text={title} />
      </h2>
      <DividerBar color={dividerColor} />
    </div>
  );
}

export function SlidePad({
  children, style,
}: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: 1920, height: 1080, padding: "88px 96px", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: 40, fontFamily: FONT_BODY,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
