import type { KindRendererProps } from "./types";
import type { MethodTimelineData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY } from "./shared";

export function MethodTimelineRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<MethodTimelineData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad style={{ gap: 28 }}>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 64 }}>
          <HeadingWithDivider title={header?.title} dividerColor={theme.accentColor} size={62} />
          {header?.intro && <div style={{ fontSize: 23, lineHeight: 1.5, color: muted, maxWidth: 600 }}>{header.intro}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.steps.length}, 1fr)`, gap: 16 }}>
          {data.steps.map((s, i) => (
            <div key={i} style={{ borderRadius: 16, padding: 24, ...toneStyle(s.tone, theme) }}>
              {s.number && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, marginBottom: 8, opacity: 0.85 }}>{s.number} {s.title}</div>}
              {!s.number && s.title && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{s.title}</div>}
              <div style={{ fontSize: 20, lineHeight: 1.4, opacity: 0.9 }}>{s.text}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1, justifyContent: "center" }}>
          {data.phases.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 32, alignItems: "center" }}>
              <div style={{ textAlign: "right", fontSize: 21, color: muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{p.dateLabel}</div>
              <div style={{ borderRadius: 14, padding: "22px 34px", width: `${p.widthPct}%`, marginLeft: `${p.offsetPct}%`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, ...toneStyle(p.tone, theme) }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 26 }}>{p.title}</span>
                <span style={{ fontSize: 20, opacity: 0.85 }}>{p.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </SlidePad>
    </div>
  );
}
