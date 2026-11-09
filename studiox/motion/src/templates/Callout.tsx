import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// A label with an arrow whose TIP is the centre of the frame: when the item follows something (js/motion.js "Seguir"),
// the final pass slides the whole frame so the tip lands on the target. `direction` = where the label sits relative to the tip.
export type CalloutProps = {
  text?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  bgColor?: string;
  textColor?: string;
  scale?: number;
};

const ARROW = 40; // arrow length (px, before `scale`)
const GAP = 4;

export const Callout: React.FC<CalloutProps> = ({
  text = 'Olha isso!',
  direction = 'up',
  bgColor = '#ec1889',
  textColor = '#ffffff',
  scale = 100,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const pop = spring({frame, fps, config: {damping: 11, stiffness: 160, mass: 0.7}});
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = interpolate(pop, [0, 0.5], [0, 1], {extrapolateRight: 'clamp'}) * out;
  const bob = Math.sin(frame / 5) * 7; // the arrow nudges toward the target

  // Everything is laid out around the tip at (0, 0); `direction` says which side the label is on.
  const dirs: Record<string, [number, number]> = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
  const [ax, ay] = dirs[direction] ?? dirs.up;
  const arrowBox = ax !== 0 ? {w: ARROW, h: ARROW * 1.2} : {w: ARROW * 1.2, h: ARROW};
  const polys: Record<string, string> = {
    up: 'polygon(0 0, 100% 0, 50% 100%)', // label above: the arrow points down at the tip
    down: 'polygon(50% 0, 0 100%, 100% 100%)',
    left: 'polygon(0 0, 100% 50%, 0 100%)',
    right: 'polygon(100% 0, 100% 100%, 0 50%)',
  };

  const arrowStyle: React.CSSProperties = {
    position: 'absolute',
    width: arrowBox.w,
    height: arrowBox.h,
    background: bgColor,
    clipPath: polys[direction] ?? polys.up,
    left: ax === 0 ? -arrowBox.w / 2 : ax < 0 ? -arrowBox.w - GAP : GAP,
    top: ay === 0 ? -arrowBox.h / 2 : ay < 0 ? -arrowBox.h - GAP : GAP,
    transform: `translate(${ax * -bob}px, ${ay * -bob}px)`,
  };
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    whiteSpace: 'nowrap',
    background: bgColor,
    color: textColor,
    padding: '16px 34px',
    borderRadius: 18,
    fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: 800,
    fontSize: 54,
    lineHeight: 1.1,
    boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
    ...(ay !== 0
      ? {left: 0, transform: 'translateX(-50%)', ...(ay < 0 ? {bottom: ARROW + GAP - 2} : {top: ARROW + GAP - 2})}
      : {top: 0, transform: 'translateY(-50%)', ...(ax < 0 ? {right: arrowBox.w + GAP - 2} : {left: arrowBox.w + GAP - 2})}),
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
          transform: `scale(${(scale / 100) * interpolate(pop, [0, 1], [0.3, 1])})`,
          transformOrigin: '0 0',
        }}
      >
        <div style={arrowStyle} />
        <div style={labelStyle}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};
