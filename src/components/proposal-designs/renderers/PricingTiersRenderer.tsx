import type { KindRendererProps } from "./types";
import type { PricingTiersData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY } from "./shared";

export function PricingTiersRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<PricingTiersData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 64 }}>
          <HeadingWithDivider title={header?.title || "Investimento"} dividerColor={theme.midColor} size={68} />
          {header?.intro && <div style={{ fontSize: 24, lineHeight: 1.5, color: muted, maxWidth: 540 }}>{header.intro}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.tiers.length}, 1fr)`, gap: 24, flex: 1, alignItems: "stretch" }}>
          {data.tiers.map((t, i) => {
            const style = t.recommended ? toneStyle("dark", theme) : toneStyle("light", theme);
            return (
              <div key={i} style={{ borderRadius: 20, padding: t.recommended ? "48px 40px" : 40, display: "flex", flexDirection: "column", gap: 18, position: "relative", ...style }}>
                {t.recommended && (
                  <div style={{ position: "absolute", top: -16, left: 40, background: theme.accentColor, color: theme.primaryColor, fontSize: 18, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 18px", borderRadius: 999 }}>
                    {t.badgeLabel || "Recomendado"}
                  </div>
                )}
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 32 }}>{t.name}</div>
                <div style={{ fontSize: 21, opacity: 0.85 }}>{t.text}</div>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 50, lineHeight: 1 }}>{t.price}</div>
                  <div style={{ fontSize: 19, opacity: 0.75, marginTop: 6 }}>{t.period}</div>
                </div>
                <ul style={{ margin: 0, paddingLeft: 24, fontSize: 21, lineHeight: 1.65, opacity: 0.9 }}>
                  {t.features.map((f, fi) => <li key={fi}>{f}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
        {data.footerNotes.length > 0 && (
          <div style={{ display: "flex", gap: 44, fontSize: 21, color: muted, flexWrap: "wrap" }}>
            {data.footerNotes.map((n, i) => (
              <span key={i}><strong style={{ color: tone === "dark" ? "#FFFFFF" : "#0B1F1C", fontWeight: 600 }}>{n.label}</strong> {n.text}</span>
            ))}
          </div>
        )}
      </SlidePad>
    </div>
  );
}
