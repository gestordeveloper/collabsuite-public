import React from 'react';
import {Composition} from 'remotion';
import {KineticTitle, KineticTitleProps} from './templates/KineticTitle';
import {LowerThird, LowerThirdProps} from './templates/LowerThird';
import {Counter, CounterProps} from './templates/Counter';
import {Badge, BadgeProps} from './templates/Badge';
import {Callout, CalloutProps} from './templates/Callout';
import {FocusRing, FocusRingProps} from './templates/FocusRing';
import {Sticker, StickerProps} from './templates/Sticker';
import {DataRain, DataRainProps} from './templates/DataRain';
import {Custom, CustomProps} from './templates/Custom';

// Every job also carries width/height/fps/durationInSeconds alongside the template's own props
// (backend/motion_graphics.py decides these from the project's render size and the item's duration).
type JobMeta = {
  width?: number;
  height?: number;
  fps?: number;
  durationInSeconds?: number;
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* One <Composition> per catalog entry in backend/motion_graphics.py MOTION_TEMPLATES.
          durationInFrames/fps/width/height below are placeholders only used by Remotion Studio;
          the real render always overrides them via calculateMetadata from the job's own props. */}
      <Composition
        id="kinetic-title"
        component={KineticTitle}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{text: 'StudioX', color: '#ffffff', highlightColor: '#ff7a1a'} as KineticTitleProps}
        calculateMetadata={async ({props}) => {
          const p = props as KineticTitleProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 4;
          return {
            durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)),
            fps,
            width: p.width ?? 1920,
            height: p.height ?? 1080,
          };
        }}
      />
      <Composition
        id="lower-third"
        component={LowerThird}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{name: 'Seu Nome', subtitle: 'Seu cargo ou canal'} as LowerThirdProps}
        calculateMetadata={async ({props}) => {
          const p = props as LowerThirdProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 4;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="counter"
        component={Counter}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{value: 100, label: 'clientes atendidos'} as CounterProps}
        calculateMetadata={async ({props}) => {
          const p = props as CounterProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 3;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="badge"
        component={Badge}
        durationInFrames={75}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{text: 'NOVO'} as BadgeProps}
        calculateMetadata={async ({props}) => {
          const p = props as BadgeProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 2.5;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="callout"
        component={Callout}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{text: 'Olha isso!'} as CalloutProps}
        calculateMetadata={async ({props}) => {
          const p = props as CalloutProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 3;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="focus-ring"
        component={FocusRing}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{label: ''} as FocusRingProps}
        calculateMetadata={async ({props}) => {
          const p = props as FocusRingProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 3;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="sticker"
        component={Sticker}
        durationInFrames={75}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{emoji: '🔥'} as StickerProps}
        calculateMetadata={async ({props}) => {
          const p = props as StickerProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 2.5;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="data-rain"
        component={DataRain}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{chars: '0123456789'} as DataRainProps}
        calculateMetadata={async ({props}) => {
          const p = props as DataRainProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 4;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
      <Composition
        id="custom"
        component={Custom}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{code: ''} as CustomProps}
        calculateMetadata={async ({props}) => {
          const p = props as CustomProps & JobMeta;
          const fps = p.fps ?? 30;
          const durationInSeconds = p.durationInSeconds ?? 4;
          return {durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)), fps, width: p.width ?? 1920, height: p.height ?? 1080};
        }}
      />
    </>
  );
};
