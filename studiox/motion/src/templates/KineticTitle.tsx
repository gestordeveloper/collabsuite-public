import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// Mirrors the headline convention already used in backend/templates.py / frontend/js/headlines.js:
// *word* renders in highlightColor, same markup the user already knows from the headline editor.
export type KineticTitleProps = {
  text?: string;
  color?: string;
  highlightColor?: string;
  fontSize?: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
};

// `*` toggles highlight on/off as it streams through the text, same as the headline's own parser
// (frontend/js/headlines.js) — so `*50% OFF*` highlights the whole two-word span, not just a
// single word wrapped on both sides.
function parseHighlighted(text: string): {word: string; hl: boolean}[] {
  const words: {word: string; hl: boolean}[] = [];
  let hl = false;
  for (const rawWord of text.split(/\s+/).filter(Boolean)) {
    let out = '';
    let wordHl: boolean | null = null;
    for (const ch of rawWord) {
      if (ch === '*') {
        hl = !hl;
        continue;
      }
      if (wordHl === null) wordHl = hl;
      out += ch;
    }
    if (out) words.push({word: out, hl: wordHl ?? hl});
  }
  return words;
}

export const KineticTitle: React.FC<KineticTitleProps> = ({
  text = 'StudioX',
  color = '#ffffff',
  highlightColor = '#ff7a1a',
  fontSize = 90,
  fontFamily = 'Inter, Arial, sans-serif',
  align = 'center',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = parseHighlighted(text);
  const stagger = 4; // frames between each word's entrance starting

  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: justify,
        padding: '0 80px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: justify,
          gap: '0 24px',
          fontFamily,
          fontWeight: 800,
          fontSize,
          lineHeight: 1.15,
          textAlign: align,
        }}
      >
        {words.map(({word, hl}, i) => {
          const startFrame = i * stagger;
          const progress = spring({
            frame: frame - startFrame,
            fps,
            config: {damping: 14, stiffness: 120, mass: 0.6},
          });
          const translateY = interpolate(progress, [0, 1], [40, 0]);
          const opacity = interpolate(progress, [0, 1], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                transform: `translateY(${translateY}px)`,
                opacity,
                color: hl ? highlightColor : color,
                textShadow: '0 4px 18px rgba(0,0,0,0.45)',
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
