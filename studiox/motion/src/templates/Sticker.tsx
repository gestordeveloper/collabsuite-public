import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// A big emoji centred on the frame (or on whatever the item follows), with one of a few looping animations.
export type StickerProps = {
  emoji?: string;
  animation?: 'pop' | 'bounce' | 'pulse' | 'spin';
  scale?: number;
};

export const Sticker: React.FC<StickerProps> = ({emoji = '🔥', animation = 'pop', scale = 100}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const pop = spring({frame, fps, config: {damping: 8, stiffness: 170, mass: 0.6}});
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = interpolate(pop, [0, 0.4], [0, 1], {extrapolateRight: 'clamp'}) * out;

  let dy = 0;
  let extraScale = 1;
  let rotate = 0;
  if (animation === 'bounce') dy = -Math.abs(Math.sin(frame / 7)) * 60;
  if (animation === 'pulse') extraScale = 1 + Math.sin(frame / 4) * 0.12;
  if (animation === 'spin') rotate = interpolate(pop, [0, 1], [-180, 0]) + Math.sin(frame / 12) * 6;
  if (animation === 'pop') rotate = Math.sin(frame / 10) * 6;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          opacity,
          fontSize: 230,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.45))',
          transform: `translateY(${dy}px) rotate(${rotate}deg) scale(${(scale / 100) * pop * extraScale})`,
        }}
      >
        {emoji}
      </div>
    </AbsoluteFill>
  );
};
