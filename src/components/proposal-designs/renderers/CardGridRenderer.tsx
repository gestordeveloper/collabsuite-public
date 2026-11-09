import type { KindRendererProps } from "./types";
import type { CardGridData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY, MultiLine } from "./shared";

export function CardGridRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<CardGridData>) {
  const muted = mutedColor(tone, theme);
  const textColor = tone === "dark" ? "#FFFFFF" : "#0B1F1C";
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />

        {header?.introQuote?.text ? (
          <div style={{ borderLeft: `8px solid ${theme.midColor}`, paddingLeft: 40, maxWidth: 1500 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 48, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
              “{header.introQuote.text}”
            </div>
            <div style={{ fontSize: 22, color: muted, marginTop: 18 }}>{header.introQuote.attribution}</div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 64 }}>
            <HeadingWithDivider title={header?.title} dividerColor={theme.midColor} size={68} />
            {header?.intro && (
              <div style={{ fontSize: 25, lineHeight: 1.5, color: muted, maxWidth: 560, flexShrink: 0 }}>{header.intro}</div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.columns}, 1fr)`, gap: 22, flex: 1 }}>
          {data.cards.map((c, i) => (
            <div key={i} style={{ borderRadius: 20, padding: 40, display: "flex", flexDirection: "column", gap: 16, ...toneStyle(c.tone, theme) }}>
              {c.number && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 32 }}>{c.number}</div>}
              {c.kicker && (
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 21, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {c.kicker}
                </div>
              )}
              {c.title && (
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 30, lineHeight: 1.2 }}>
                  <MultiLine text={c.title} />
                </div>
              )}
              {c.text && <div style={{ fontSize: 23, lineHeight: 1.5, opacity: 0.9 }}>{c.text}</div>}
              {c.bullets && c.bullets.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 24, fontSize: 22, lineHeight: 1.6, opacity: 0.9 }}>
                  {c.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>

        {data.footnote?.text && (
          <div style={{ background: tone === "dark" ? "rgba(255,255,255,0.08)" : theme.lightColor, borderRadius: 16, padding: "22px 32px", fontSize: 22, color: tone === "dark" ? "#CFE7E2" : theme.textMutedColor }}>
            <strong style={{ color: tone === "dark" ? theme.accentColor : textColor, fontWeight: 600 }}>{data.footnote.label}</strong> {data.footnote.text}
          </div>
        )}
      </SlidePad>
    </div>
  );
}
