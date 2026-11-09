import type { KindRendererProps } from "./types";
import type { TimelinePhasesData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY } from "./shared";

export function TimelinePhasesRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<TimelinePhasesData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={68} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
          {data.phases.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 32, alignItems: "center" }}>
              <div style={{ textAlign: "right", fontSize: 22, color: muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{p.dateLabel}</div>
              <div
                style={{
                  borderRadius: 16, padding: "26px 36px", width: `${p.widthPct}%`, marginLeft: `${p.offsetPct}%`,
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24,
                  ...toneStyle(p.tone, theme),
                }}
              >
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 28 }}>{p.title}</span>
                <span style={{ fontSize: 21, opacity: 0.85 }}>{p.detail}</span>
              </div>
            </div>
          ))}
        </div>
        {data.milestones && data.milestones.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.milestones.length}, 1fr)`, gap: 24, borderTop: `2px solid ${theme.lightColor}`, paddingTop: 24 }}>
            {data.milestones.map((m, i) => (
              <div key={i} style={{ fontSize: 22, lineHeight: 1.5, color: muted }}>
                <strong style={{ color: tone === "dark" ? "#FFFFFF" : "#0B1F1C", fontWeight: 600, display: "block", marginBottom: 6 }}>{m.title}</strong>
                {m.text}
              </div>
            ))}
          </div>
        )}
      </SlidePad>
    </div>
  );
}
