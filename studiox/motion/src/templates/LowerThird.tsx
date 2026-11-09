import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export type LowerThirdProps = {
  name?: string;
  subtitle?: string;
  accentColor?: string;
  textColor?: string;
};

export const LowerThird: React.FC<LowerThirdProps> = ({
  name = 'Seu Nome',
  subtitle = 'Seu cargo ou canal',
  accentColor = '#ec1889',
  textColor = '#ffffff',
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width} = useVideoConfig();

  const inProgress = spring({frame, fps, config: {damping: 16, stiffness: 140, mass: 0.7}});
  const outStart = durationInFrames - Math.round(fps * 0.4);
  const outProgress = frame > outStart
    ? spring({frame: frame - outStart, fps, config: {damping: 20, stiffness: 160}})
    : 0;

  const slideIn = interpolate(inProgress, [0, 1], [-width * 0.6, 0]);
  const slideOut = interpolate(outProgress, [0, 1], [0, -width * 0.6]);
  const x = slideIn + slideOut;
  const opacity = interpolate(inProgress, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) *
    (1 - outProgress);

  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 0 14% 6%'}}>
      <div style={{transform: `translateX(${x}px)`, opacity, display: 'flex', alignItems: 'stretch', maxWidth: '84%'}}>
        <div style={{width: 10, background: accentColor, borderRadius: 6}} />
        <div style={{
          background: 'rgba(10,10,14,0.82)', padding: '18px 28px', marginLeft: 14, borderRadius: 10,
          display: 'flex', flexDirection: 'column', gap: 4, backdropFilter: 'blur(2px)',
        }}>
          <span style={{
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: 46, color: textColor, lineHeight: 1.1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{name}</span>
          <span style={{
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 500, fontSize: 28, color: accentColor, lineHeight: 1.1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{subtitle}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
