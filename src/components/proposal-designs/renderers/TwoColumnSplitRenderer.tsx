import type { KindRendererProps } from "./types";
import type { CardGridData, NumberedRowsData, SplitBlock, StatGridData, TeamGridData, ThemeTokens, TwoColumnSplitData } from "@/src/lib/proposal-designs/types";
import { FONT_DISPLAY, HeadingWithDivider, mutedColor, toneStyle } from "./shared";

function BlockContent({ block, tone, theme }: { block: SplitBlock; tone: "dark" | "light"; theme: ThemeTokens }) {
  const muted = mutedColor(tone, theme);
  if (block.type === "numbered-rows") {
    const data = block.data as NumberedRowsData;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {data.rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 20 }}>
            <span style={{ color: theme.accentColor, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22 }}>{r.number}</span>
            <span style={{ fontSize: 24, lineHeight: 1.4 }}>{r.text}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "stat-grid") {
    const data = block.data as StatGridData;
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.columns}, 1fr)`, gap: 16 }}>
        {data.cards.map((c, i) => (
          <div key={i} style={{ borderRadius: 18, padding: 26, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, ...toneStyle(c.tone, theme) }}>
            <span style={{ fontSize: 21, opacity: 0.85 }}>{c.label}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30 }}>{c.value}</span>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "card-grid") {
    const data = block.data as CardGridData;
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.columns}, 1fr)`, gap: 16 }}>
        {data.cards.map((c, i) => (
          <div key={i} style={{ borderTop: `2px solid ${theme.lightColor}55`, paddingTop: 16 }}>
            {c.number && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: theme.midColor, marginBottom: 6 }}>{c.number}</div>}
            {c.title && <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 22, marginBottom: 6 }}>{c.title}</div>}
            {c.text && <div style={{ fontSize: 20, color: muted }}>{c.text}</div>}
          </div>
        ))}
      </div>
    );
  }
  // team-grid
  const data = block.data as TeamGridData;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.columns}, 1fr)`, gap: 16 }}>
      {data.members.map((m, i) => (
        <div key={i} style={{ borderRadius: 16, padding: 20, display: "flex", gap: 16, alignItems: "center", ...toneStyle(m.tone, theme) }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden", background: "rgba(0,0,0,0.08)", flexShrink: 0 }}>
            {m.photo?.url && <img src={m.photo.url} alt={m.photo.alt || m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 20 }}>{m.name}</div>
            <div style={{ fontSize: 17, opacity: 0.85 }}>{m.role}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({ block, tone, theme }: { block: SplitBlock; tone: "dark" | "light"; theme: ThemeTokens }) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {block.title && <HeadingWithDivider title={block.title} dividerColor={theme.midColor} size={44} />}
      <BlockContent block={block} tone={tone} theme={theme} />
      {block.noteText && (
        <div style={{ borderTop: `1px solid ${theme.lightColor}55`, paddingTop: 18, fontSize: 20, color: muted, marginTop: "auto" }}>{block.noteText}</div>
      )}
    </div>
  );
}

export function TwoColumnSplitRenderer({ data, header, tone, runningHeader, theme }: KindRendererProps<TwoColumnSplitData>) {
  const muted = mutedColor(tone, theme);
  return (
    <div style={{ width: 1920, height: 1080, boxSizing: "border-box", padding: "88px 96px", display: "flex", flexDirection: "column", gap: 40, fontFamily: "'Plus Jakarta Sans', sans-serif", ...(tone === "dark" ? { background: theme.primaryColor, color: "#FFFFFF" } : { background: "#FFFFFF", color: "#0B1F1C" }) }}>
      <div className="flex items-center justify-between" style={{ fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color: muted }}>
        <span>{runningHeader?.left}</span><span>{runningHeader?.right}</span>
      </div>
      {header?.title && <HeadingWithDivider title={header.title} dividerColor={theme.accentColor} size={68} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 88, flex: 1 }}>
        <Panel block={data.left} tone={tone} theme={theme} />
        <Panel block={data.right} tone={tone} theme={theme} />
      </div>
    </div>
  );
}
