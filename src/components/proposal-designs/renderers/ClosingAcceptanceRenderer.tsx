import type { KindRendererProps } from "./types";
import type { ClosingAcceptanceData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY, MultiLine, DividerBar } from "./shared";

export function ClosingAcceptanceRenderer({ data, tone, runningHeader, theme }: KindRendererProps<ClosingAcceptanceData>) {
  const muted = mutedColor(tone, theme);
  const cardStyle = toneStyle("light", theme);
  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 620px", gap: 80, flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 88, lineHeight: 1.02, margin: "0 0 24px", letterSpacing: "-0.02em" }}>
              <MultiLine text={data.title} />
            </h2>
            <DividerBar color={theme.accentColor} />
            <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 40 }}>
              {data.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 52, height: 52, borderRadius: 14, background: theme.accentColor, color: theme.primaryColor, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.number}</div>
                  <div style={{ fontSize: 26, lineHeight: 1.45, opacity: 0.95 }}>{s.text}</div>
                </div>
              ))}
            </div>
            {data.footerContact && (
              <div style={{ marginTop: "auto", fontSize: 22, color: muted, borderTop: "1px solid rgba(255,255,255,.18)", paddingTop: 22 }}>{data.footerContact}</div>
            )}
          </div>
          <div style={{ borderRadius: 24, padding: 44, display: "flex", flexDirection: "column", gap: 26, ...cardStyle }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.midColor }}>{data.acceptanceKicker}</div>
            <div style={{ fontSize: 23, lineHeight: 1.5, opacity: 0.85 }}>{data.acceptanceText}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 30, marginTop: 8 }}>
              {data.signers.map((s, i) => (
                <div key={i}>
                  <div style={{ height: 2, background: "currentColor", opacity: 0.3, marginBottom: 12 }} />
                  <div style={{ fontSize: 22, fontWeight: 600 }}>{s.party}</div>
                  <div style={{ fontSize: 20, opacity: 0.7 }}>{s.detail}</div>
                </div>
              ))}
            </div>
            {data.footerNote && (
              <div style={{ marginTop: "auto", borderTop: "1px solid currentColor", opacity: 0.85, paddingTop: 20, fontSize: 20 }}>{data.footerNote}</div>
            )}
          </div>
        </div>
      </SlidePad>
    </div>
  );
}
