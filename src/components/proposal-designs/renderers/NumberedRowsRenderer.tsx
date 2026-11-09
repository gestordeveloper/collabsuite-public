import type { KindRendererProps } from "./types";
import type { NumberedRowsData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, FONT_DISPLAY } from "./shared";

export function NumberedRowsRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<NumberedRowsData>) {
  const muted = mutedColor(tone, theme);
  const hasStats = data.rows.some((r) => r.statValue);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 64 }}>
          <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={68} />
          {header?.intro && <div style={{ fontSize: 25, lineHeight: 1.5, color: muted, maxWidth: 560 }}>{header.intro}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          {data.rows.map((row, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: hasStats ? "100px minmax(0,1.6fr) minmax(0,1fr) 240px" : "100px minmax(0,1fr)",
                gap: 32, alignItems: "center",
                borderTop: `2px solid ${theme.lightColor}`,
                borderBottom: i === data.rows.length - 1 ? `2px solid ${theme.lightColor}` : undefined,
                padding: "28px 0",
              }}
            >
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 40, color: theme.midColor }}>{row.number}</div>
              <div>
                {row.title && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 32, marginBottom: 8 }}>{row.title}</div>}
                <div style={{ fontSize: 24, color: muted }}>{row.text}</div>
              </div>
              {row.resultText && <div style={{ fontSize: 23, lineHeight: 1.5, color: muted }}>{row.resultText}</div>}
              {row.statValue && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 40 }}>{row.statValue}</div>
                  <div style={{ fontSize: 19, color: muted }}>{row.statLabel}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </SlidePad>
    </div>
  );
}
