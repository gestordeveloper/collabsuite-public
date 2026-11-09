import React from 'react';
import {AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';

// Falling characters over the whole frame ("matrix" rain): numbers, letters or any symbols the person chooses.
// Everything is derived from frame + remotion's seeded random(), so the preview and the render draw the same thing.
export type DataRainProps = {
  chars?: string;
  color?: string;
  speed?: number; // 1..10
  density?: number; // % of the columns that carry a stream
  fontSize?: number;
  direction?: 'down' | 'up';
};

export const DataRain: React.FC<DataRainProps> = ({
  chars = '0123456789',
  color = '#00ff66',
  speed = 4,
  density = 60,
  fontSize = 34,
  direction = 'down',
}) => {
  const frame = useCurrentFrame();
  const {width, height, fps, durationInFrames} = useVideoConfig();

  const alphabet = Array.from(chars.replace(/\s+/g, '') || '0123456789');
  const colW = fontSize * 0.9;
  const cols = Math.max(1, Math.floor(width / colW));
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {extrapolateRight: 'clamp'});
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rowH = fontSize * 1.15;

  const streams: React.ReactNode[] = [];
  for (let c = 0; c < cols; c++) {
    if (random(`on-${c}`) * 100 > density) continue;
    const trail = 8 + Math.floor(random(`len-${c}`) * 16);
    const pxPerFrame = (speed * (0.5 + random(`spd-${c}`)) * height) / (fps * 4);
    const span = height + trail * rowH;
    const travelled = (frame * pxPerFrame + random(`off-${c}`) * span) % span;
    const headY = direction === 'down' ? travelled - trail * rowH : height - travelled + trail * rowH - rowH;
    const cells: React.ReactNode[] = [];
    for (let r = 0; r < trail; r++) {
      const age = r / trail; // 0 = head, 1 = tail end
      const y = direction === 'down' ? headY + (trail - 1 - r) * rowH : headY - (trail - 1 - r) * rowH;
      const ch = alphabet[Math.floor(random(`ch-${c}-${r}-${Math.floor(frame / 5)}`) * alphabet.length)];
      cells.push(
        <span
          key={r}
          style={{
            position: 'absolute',
            left: 0,
            top: y,
            color: r === 0 ? '#ffffff' : color,
            opacity: r === 0 ? 1 : Math.max(0, 1 - age) * 0.9,
            textShadow: `0 0 ${r === 0 ? 14 : 6}px ${color}`,
          }}
        >
          {ch}
        </span>,
      );
    }
    streams.push(
      <div key={c} style={{position: 'absolute', left: c * colW, top: 0, width: colW, height}}>
        {cells}
      </div>,
    );
  }

  return (
    <AbsoluteFill
      style={{
        opacity: fadeIn * fadeOut,
        overflow: 'hidden',
        fontFamily: '"Consolas", "Courier New", monospace',
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        backgroundColor: 'transparent',
      }}
    >
      {streams}
    </AbsoluteFill>
  );
};
