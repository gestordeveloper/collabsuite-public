import type { KindRendererProps } from "./types";
import type { TocData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor } from "./shared";
import { FONT_DISPLAY } from "./shared";

export function TocRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<TocData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={76} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px 72px" }}>
          {data.items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 28, alignItems: "baseline", borderBottom: `1px solid ${theme.lightColor}`, paddingBottom: 20 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 28, color: theme.accentColor, minWidth: 56 }}>{it.number}</span>
              <span style={{ fontSize: 30, fontWeight: 500 }}>{it.label}</span>
            </div>
          ))}
        </div>
      </SlidePad>
    </div>
  );
}
