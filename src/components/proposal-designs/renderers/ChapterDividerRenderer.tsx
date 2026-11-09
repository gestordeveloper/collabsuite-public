import type { KindRendererProps } from "./types";
import type { ChapterDividerData } from "@/src/lib/proposal-designs/types";
import { FONT_DISPLAY, FONT_BODY, MultiLine } from "./shared";

export function ChapterDividerRenderer({ data, theme }: KindRendererProps<ChapterDividerData>) {
  return (
    <div style={{ width: 1920, height: 1080, background: theme.midColor, color: "#FFFFFF", fontFamily: FONT_BODY, boxSizing: "border-box", padding: "88px 96px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color: "#CFE7E2" }}>{data.kicker}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 560px", gap: 80, alignItems: "end" }}>
        <div>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 128, lineHeight: 0.98, margin: "0 0 32px", letterSpacing: "-0.03em" }}>
            <MultiLine text={data.title} />
          </h2>
          <div style={{ fontSize: 28, lineHeight: 1.45, color: "#DCEFEB", maxWidth: 820 }}>{data.body}</div>
        </div>
        <div style={{ position: "relative", height: 360, borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
          {data.image?.url ? (
            <img src={data.image.url} alt={data.image.alt || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#CFE7E2", fontSize: 20 }}>
              {data.image?.alt || "Imagem de apoio"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
