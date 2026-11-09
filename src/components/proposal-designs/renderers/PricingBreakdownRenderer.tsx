import type { KindRendererProps } from "./types";
import type { PricingBreakdownData } from "@/src/lib/proposal-designs/types";
import { SlidePad, RunningHeaderRow, HeadingWithDivider, sectionStyle, mutedColor, toneStyle, FONT_DISPLAY } from "./shared";

export function PricingBreakdownRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<PricingBreakdownData>) {
  const muted = mutedColor(tone, theme);
  const mainCardStyle = toneStyle("light", theme);

  return (
    <div style={sectionStyle(tone, theme)}>
      <SlidePad>
        <RunningHeaderRow left={runningHeader?.left} right={runningHeader?.right} color={muted} />
        <HeadingWithDivider title={header?.title || "Investimento"} dividerColor={theme.midColor} size={68} />
        {header?.intro && <div style={{ fontSize: 24, lineHeight: 1.5, color: muted, maxWidth: 700 }}>{header.intro}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 28, flex: 1 }}>
          <div style={{ borderRadius: 20, padding: 44, display: "flex", flexDirection: "column", ...mainCardStyle }}>
            {data.layout === "table" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px 240px", gap: 20, fontSize: 19, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7, paddingBottom: 16, borderBottom: "2px solid currentColor" }}>
                  <span>Fase</span><span style={{ textAlign: "right" }}>Horas</span><span style={{ textAlign: "right" }}>Valor</span>
                </div>
                {data.rows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px 240px", gap: 20, alignItems: "center", padding: "22px 0", borderBottom: "1px solid currentColor", opacity: 0.95 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 27 }}>{r.label}</div>
                      {r.detail && <div style={{ fontSize: 19, opacity: 0.75 }}>{r.detail}</div>}
                    </div>
                    <div style={{ textAlign: "right", fontSize: 23, opacity: 0.8 }}>{r.hours}</div>
                    <div style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 27 }}>{r.price}</div>
                  </div>
                ))}
                {data.totalPrice && (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px 240px", gap: 20, alignItems: "center", paddingTop: 22 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 27 }}>{data.totalLabel || "Total"}</div>
                    <div style={{ textAlign: "right", fontSize: 23, opacity: 0.8 }}>{data.totalHours}</div>
                    <div style={{ textAlign: "right", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 36, color: theme.midColor }}>{data.totalPrice}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.midColor }}>{data.mainKicker}</div>
                {data.totalPrice && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 72, lineHeight: 1 }}>{data.totalPrice}</div>
                  </div>
                )}
                <div style={{ height: 2, background: "currentColor", opacity: 0.15, margin: "20px 0" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 28px", fontSize: 22 }}>
                  {data.rows.map((r, i) => (
                    <div key={i}><strong style={{ display: "block", fontWeight: 600 }}>{r.label}</strong>{r.price}</div>
                  ))}
                </div>
              </>
            )}
            {data.paymentNote && <div style={{ marginTop: "auto", paddingTop: 22, fontSize: 21, opacity: 0.8 }}>{data.paymentNote}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ borderRadius: 20, padding: 40, flex: 1, ...toneStyle("dark", theme) }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.accentColor, marginBottom: 16 }}>{data.feeKicker}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 60, lineHeight: 1, color: theme.accentColor }}>
                {data.feePrice}<span style={{ fontSize: 28, fontWeight: 600, color: "#FFFFFF" }}>{data.feeSuffix}</span>
              </div>
              <div style={{ fontSize: 22, lineHeight: 1.5, marginTop: 16, opacity: 0.9 }}>{data.feeDetail}</div>
            </div>
            {(data.noteTitle || data.noteText) && (
              <div style={{ borderRadius: 20, padding: 32, fontSize: 22, lineHeight: 1.5, ...toneStyle("outline", theme) }}>
                {data.noteTitle && <strong style={{ display: "block", marginBottom: 6, color: theme.accentColor }}>{data.noteTitle}</strong>}
                {data.noteText}
              </div>
            )}
            {data.footerNote && <div style={{ fontSize: 20, color: muted }}>{data.footerNote}</div>}
          </div>
        </div>
      </SlidePad>
    </div>
  );
}
