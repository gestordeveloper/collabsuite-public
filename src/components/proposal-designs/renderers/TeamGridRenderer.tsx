import type { KindRendererProps } from "./types";
import type { TeamGridData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY } from "./shared";

export function TeamGridRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<TeamGridData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 64 }}>
          <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={68} />
          {header?.intro && <div style={{ fontSize: 25, lineHeight: 1.5, color: muted, maxWidth: 560 }}>{header.intro}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.columns}, 1fr)`, gap: 22, flex: 1 }}>
          {data.members.map((m, i) => (
            <div key={i} style={{ borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 16, ...toneStyle(m.tone, theme) }}>
              <div style={{ width: 100, height: 100, borderRadius: "50%", overflow: "hidden", background: "rgba(0,0,0,0.08)", flexShrink: 0 }}>
                {m.photo?.url ? (
                  <img src={m.photo.url} alt={m.photo.alt || m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, opacity: 0.6 }}>Foto</div>
                )}
              </div>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 26 }}>{m.name}</div>
                <div style={{ fontSize: 21, opacity: 0.85, marginTop: 4 }}>{m.role}</div>
              </div>
            </div>
          ))}
        </div>
        {data.noteText && (
          <div style={{ fontSize: 22, color: muted, borderTop: `2px solid ${theme.lightColor}`, paddingTop: 20 }}>{data.noteText}</div>
        )}
      </SlidePad>
    </div>
  );
}
