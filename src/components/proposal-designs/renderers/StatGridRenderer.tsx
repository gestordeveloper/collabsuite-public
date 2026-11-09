import type { KindRendererProps } from "./types";
import type { StatGridData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY, MultiLine } from "./shared";

export function StatGridRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<StatGridData>) {
  const muted = mutedColor(tone, theme);
  const hasImage = !!data.image;
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "grid", gridTemplateColumns: hasImage ? "1fr 1fr" : "1fr", gap: 72, alignItems: "start", flex: 1 }}>
          <div>
            <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={68} />
            {header?.intro && (
              <div style={{ fontSize: 27, lineHeight: 1.55, color: muted, marginTop: 24, whiteSpace: "pre-line" }}>{header.intro}</div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${hasImage ? 2 : data.columns}, 1fr)`, gap: 24 }}>
            {data.cards.map((c, i) => (
              <div key={i} style={{ borderRadius: 20, padding: 36, ...toneStyle(c.tone, theme) }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 60, lineHeight: 1 }}>{c.value}</div>
                <div style={{ fontSize: 23, marginTop: 10, opacity: 0.85 }}>{c.label}</div>
              </div>
            ))}
            {hasImage && (
              <div style={{ position: "relative", minHeight: 180, borderRadius: 20, overflow: "hidden", background: theme.lightColor }}>
                {data.image?.url ? (
                  <img src={data.image.url} alt={data.image.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textMutedColor, fontSize: 18 }}>
                    {data.image?.alt || "Imagem"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {data.notes && data.notes.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.notes.length}, 1fr)`, gap: 24, borderTop: `2px solid ${theme.lightColor}`, paddingTop: 28 }}>
            {data.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 23, lineHeight: 1.5, color: muted }}>
                <strong style={{ color: tone === "dark" ? "#FFFFFF" : "#0B1F1C", fontWeight: 600, display: "block", marginBottom: 6 }}>
                  <MultiLine text={n.title} />
                </strong>
                {n.text}
              </div>
            ))}
          </div>
        )}
      </SlidePad>
    </div>
  );
}
