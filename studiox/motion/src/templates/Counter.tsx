import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export type CounterProps = {
  value?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  color?: string;
  scale?: number;
};

export const Counter: React.FC<CounterProps> = ({
  value = 100,
  prefix = '',
  suffix = '',
  label = 'clientes atendidos',
  color = '#ffffff',
  scale: size = 100,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const popIn = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const scale = interpolate(popIn, [0, 1], [0.6, 1]);
  const opacity = interpolate(popIn, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // The number counts up over the first ~70% of the duration, then holds at the final value.
  const countEnd = Math.max(1, Math.round(durationInFrames * 0.7));
  const t = Math.min(1, frame / countEnd);
  const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic: fast start, settles into the final value
  const shown = Math.round(eased * value);

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{transform: `scale(${scale * (size / 100)})`, opacity, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6}}>
        <span style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: 160, color, lineHeight: 1,
          textShadow: '0 6px 24px rgba(0,0,0,0.5)',
        }}>{prefix}{shown.toLocaleString('pt-BR')}{suffix}</span>
        <span style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 600, fontSize: 36, color, opacity: 0.9, letterSpacing: 1,
          textShadow: '0 4px 14px rgba(0,0,0,0.5)',
        }}>{label}</span>
      </div>
    </AbsoluteFill>
  );
};
