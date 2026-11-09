import type { KindRendererProps } from "./types";
import type { CoverData } from "@/src/lib/proposal-designs/types";
import { FONT_DISPLAY, FONT_BODY, BrandBadge, RunningHeaderRow, MultiLine, DividerBar } from "./shared";

function Highlighted({ text, highlight, accent }: { text: string; highlight?: string; accent: string }) {
  if (!highlight || !text.includes(highlight)) return <MultiLine text={text} />;
  const idx = text.indexOf(highlight);
  const before = text.slice(0, idx);
  const after = text.slice(idx + highlight.length);
  return (
    <>
      <MultiLine text={before} />
      <span style={{ color: accent }}>{highlight}</span>
      <MultiLine text={after} />
    </>
  );
}

export function CoverRenderer({ data, tone, runningHeader, theme }: KindRendererProps<CoverData>) {
  const dark = tone === "dark";
  const bg = dark ? theme.primaryColor : "#FFFFFF";
  const text = dark ? "#FFFFFF" : "#0B1F1C";
  const muted = dark ? "#CFE7E2" : theme.textMutedColor;

  const imageBox = (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 20, overflow: "hidden", background: dark ? "rgba(255,255,255,0.08)" : theme.lightColor }}>
      {data.image?.url ? (
        <img src={data.image.url} alt={data.image.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: muted, fontSize: 20 }}>
          {data.image?.alt || "Imagem"}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ width: 1920, height: 1080, background: bg, color: text, fontFamily: FONT_BODY, boxSizing: "border-box", padding: "72px 96px 0", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BrandBadge logoUrl={theme.logoUrl} companyName={theme.companyName} bg={dark ? theme.accentColor : theme.primaryColor} color={dark ? theme.primaryColor : theme.accentColor} />
          <span style={{ fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color: muted }}>{theme.companyName}</span>
        </div>
        <RunningHeaderRow left={undefined} right={runningHeader?.right} color={muted} />
      </div>

      {data.layout === "panorama-bottom" ? (
        <>
          <div style={{ paddingTop: 48, display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", gap: 72, alignItems: "end", flex: 1 }}>
            <div>
              <div style={{ fontSize: 26, letterSpacing: "0.16em", textTransform: "uppercase", color: theme.midColor, marginBottom: 28 }}>{data.kicker}</div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 108, lineHeight: 0.98, margin: 0, letterSpacing: "-0.03em" }}>
                <Highlighted text={data.headline} highlight={data.headlineHighlight} accent={theme.midColor} />
              </h1>
              <div style={{ fontSize: 28, lineHeight: 1.45, color: muted, maxWidth: 820, marginTop: 32 }}>{data.body}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
              {data.footerRows.map((row, i) => (
                <div key={i} style={{ borderTop: `2px solid ${dark ? "rgba(255,255,255,.3)" : "#0B3F3A"}`, paddingTop: 16, fontSize: 22, color: muted }}>
                  <strong style={{ display: "block", color: text, fontWeight: 600, fontSize: 25 }}>{row.label}</strong>{row.value}
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 200, position: "relative", marginTop: 40, marginBottom: 40 }}>{imageBox}</div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: data.layout === "full-bleed-right" ? "minmax(0,1fr) 620px" : "1fr 620px", gap: 72, alignItems: "end", flex: 1, paddingTop: 40, paddingBottom: 72 }}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
            <div>
              <div style={{ fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: theme.accentColor, marginBottom: 24 }}>{data.kicker}</div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 96, lineHeight: 1.0, margin: "0 0 28px", letterSpacing: "-0.02em" }}>
                <Highlighted text={data.headline} highlight={data.headlineHighlight} accent={theme.accentColor} />
              </h1>
              <DividerBar color={theme.accentColor} width={110} />
              <div style={{ fontSize: 27, lineHeight: 1.45, color: muted, maxWidth: 680, marginTop: 32 }}>{data.body}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {data.footerRows.map((row, i) => (
                <div key={i} style={{ fontSize: 20, color: muted }}>
                  <strong style={{ color: text, fontWeight: 600 }}>{row.label}:</strong> {row.value}
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", height: data.layout === "full-bleed-right" ? "100%" : 400 }}>{imageBox}</div>
        </div>
      )}
    </div>
  );
}
