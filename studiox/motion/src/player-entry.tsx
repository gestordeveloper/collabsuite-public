// Browser bundle for the LIVE preview in the StudioX editor: @remotion/player runs the exact same
// React components the server renders (backend/motion_render.py calls render.mjs for the real
// render), so preview and final output are driven by one piece of code, not two kept in sync by
// hand. Bundled once via `npm run build:player` (motion/build-player.mjs) into
// frontend/vendor/motion-player.js — frontend/js/motionplayer.js loads it as a normal <script>.
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {Player, type PlayerRef} from '@remotion/player';

import {KineticTitle} from './templates/KineticTitle';
import {LowerThird} from './templates/LowerThird';
import {Counter} from './templates/Counter';
import {Badge} from './templates/Badge';
import {Callout} from './templates/Callout';
import {FocusRing} from './templates/FocusRing';
import {Sticker} from './templates/Sticker';
import {DataRain} from './templates/DataRain';
import {Custom} from './templates/Custom';

// One entry per backend/motion_graphics.py MOTION_TEMPLATES id.
const COMPONENTS: Record<string, React.FC<any>> = {
  'kinetic-title': KineticTitle,
  'lower-third': LowerThird,
  counter: Counter,
  badge: Badge,
  callout: Callout,
  'focus-ring': FocusRing,
  sticker: Sticker,
  'data-rain': DataRain,
  custom: Custom,
};

type MountSpec = {
  templateId: string;
  inputProps: Record<string, unknown>;
  width: number;
  height: number;
  fps: number;
  durationInSeconds: number;
};

type Handle = {ref: React.RefObject<PlayerRef>; root: Root};
const mounted = new Map<HTMLElement, Handle>();

function mount(container: HTMLElement, spec: MountSpec): void {
  const Component = COMPONENTS[spec.templateId];
  if (!Component) return;
  const durationInFrames = Math.max(1, Math.round(spec.durationInSeconds * spec.fps));

  let handle = mounted.get(container);
  if (!handle) {
    handle = {ref: React.createRef<PlayerRef>(), root: createRoot(container)};
    mounted.set(container, handle);
  }
  handle.root.render(
    React.createElement(Player, {
      ref: handle.ref,
      component: Component,
      inputProps: spec.inputProps,
      durationInFrames,
      fps: spec.fps,
      compositionWidth: spec.width,
      compositionHeight: spec.height,
      style: {width: '100%', height: '100%'},
      controls: false,
      autoPlay: false,
      loop: false,
      clickToPlay: false,
      showVolumeControls: false,
      initiallyShowControls: false,
      doubleClickToFullscreen: false,
      spaceKeyToPlayOrPause: false,
    }),
  );
}

function seek(container: HTMLElement, frame: number): void {
  mounted.get(container)?.ref.current?.seekTo(Math.max(0, Math.round(frame)));
}

function unmount(container: HTMLElement): void {
  const handle = mounted.get(container);
  if (!handle) return;
  handle.root.unmount();
  mounted.delete(container);
}

(window as unknown as {StudioXMotionPlayerBundle: unknown}).StudioXMotionPlayerBundle = {mount, seek, unmount};
