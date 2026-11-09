import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export type BadgeProps = {
  text?: string;
  bgColor?: string;
  textColor?: string;
  scale?: number;
};

export const Badge: React.FC<BadgeProps> = ({
  text = 'NOVO',
  bgColor = '#ec1889',
  textColor = '#ffffff',
  scale: size = 100,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // A bouncy pop-in (spring overshoots past 1 before settling), with a small permanent tilt.
  const pop = spring({frame, fps, config: {damping: 9, stiffness: 180, mass: 0.6}});
  const scale = interpolate(pop, [0, 1], [0, 1]);
  const rotation = interpolate(pop, [0, 1], [-18, -8]);
  const opacity = interpolate(pop, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{
        transform: `rotate(${rotation}deg) scale(${scale * (size / 100)})`, opacity,
        background: bgColor, color: textColor, padding: '22px 46px', borderRadius: 999,
        fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: 64, letterSpacing: 1,
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)', whiteSpace: 'nowrap',
      }}>{text}</div>
    </AbsoluteFill>
  );
};
