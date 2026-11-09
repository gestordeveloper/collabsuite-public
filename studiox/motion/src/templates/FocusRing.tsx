import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// A pulsing ring centred on the frame's middle (or on whatever the item follows), with an optional short label under it.
export type FocusRingProps = {
  label?: string;
  color?: string;
  textColor?: string;
  size?: number;
  scale?: number;
};

export const FocusRing: React.FC<FocusRingProps> = ({
  label = '',
  color = '#ec1889',
  textColor = '#ffffff',
  size = 240,
  scale = 100,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const pop = spring({frame, fps, config: {damping: 12, stiffness: 140, mass: 0.7}});
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = interpolate(pop, [0, 0.4], [0, 1], {extrapolateRight: 'clamp'}) * out;
  const pulse = 1 + Math.sin(frame / 4.5) * 0.045;
  const ripple = (frame % 36) / 36; // a second ring that grows and fades, over and over
  const thick = Math.max(6, size * 0.045);

  const ring: React.CSSProperties = {
    position: 'absolute',
    left: -size / 2,
    top: -size / 2,
    width: size,
    height: size,
    boxSizing: 'border-box',
    borderRadius: '50%',
  };

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 0,
          height: 0,
          opacity,
          transform: `scale(${(scale / 100) * interpolate(pop, [0, 1], [1.7, 1])})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          style={{
            ...ring,
            border: `${thick}px solid ${color}`,
            transform: `scale(${pulse})`,
            boxShadow: `0 0 ${size * 0.18}px ${color}, inset 0 0 ${size * 0.12}px ${color}55`,
          }}
        />
        <div
          style={{
            ...ring,
            border: `${Math.max(3, thick * 0.5)}px solid ${color}`,
            transform: `scale(${1 + ripple * 0.7})`,
            opacity: (1 - ripple) * 0.7,
          }}
        />
        {label ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: size / 2 + 22,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              background: color,
              color: textColor,
              padding: '12px 28px',
              borderRadius: 999,
              fontFamily: 'Inter, Arial, sans-serif',
              fontWeight: 800,
              fontSize: 44,
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
