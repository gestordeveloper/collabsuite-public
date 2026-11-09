import type { KindRendererProps } from "./types";
import type { CasesGridData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, FONT_DISPLAY } from "./shared";

export function CasesGridRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<CasesGridData>) {
  const muted = mutedColor(tone, theme);
  const cardBg = tone === "dark" ? "rgba(255,255,255,0.08)" : theme.lightColor;
  const imageTop = data.layout === "image-top";
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <HeadingWithDivider title={header?.title} dividerColor={theme.accentColor} size={68} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, flex: 1 }}>
          {data.cases.map((c, i) => (
            <div key={i} style={{ background: cardBg, borderRadius: 20, overflow: "hidden", display: imageTop ? "flex" : "grid", flexDirection: imageTop ? "column" : undefined, gridTemplateColumns: imageTop ? undefined : "280px minmax(0,1fr)" }}>
              <div style={{ position: "relative", height: imageTop ? 240 : "auto", background: "rgba(0,0,0,0.08)" }}>
                {c.image?.url ? (
                  <img src={c.image.url} alt={c.image.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, opacity: 0.6 }}>
                    {c.image?.alt || "Imagem"}
                  </div>
                )}
              </div>
              <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 30 }}>{c.title}</div>
                <div style={{ fontSize: 22, lineHeight: 1.5, opacity: 0.9 }}>{c.text}</div>
                <div style={{ display: "flex", gap: 36, marginTop: "auto" }}>
                  {c.stats.map((s, si) => (
                    <div key={si}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 38, color: theme.accentColor }}>{s.value}</div>
                      <div style={{ fontSize: 19, opacity: 0.8 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SlidePad>
    </div>
  );
}
