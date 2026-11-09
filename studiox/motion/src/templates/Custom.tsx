import React from 'react';
import {AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// "Personalizado": the AI writes the animation, at the user's explicit request (they asked for free-form motion graphics).
// `code` is the BODY of a function that receives the names below and must `return` a React component, written with
// React.createElement (no JSX). Compiled here at run time, so the editor's preview and the server's Remotion render run the
// very same code, with no new bundle per item.
//
// Containment (the code is written by a model, so it is treated as untrusted):
//  - backend/motion_graphics.py rejects code that names the network, the DOM, storage, eval/import, Math.random...
//  - before compiling, a CSP meta forbids network connections from this document;
//  - the editor's live preview mounts this inside a sandboxed iframe with an opaque origin (frontend/motion-sandbox.html),
//    so it cannot touch the editor's page, storage or credentials; the render runs in Remotion's own throwaway Chromium.
export type CustomProps = {
  code?: string;
  prompt?: string;
};

const NAMES = ['React', 'useCurrentFrame', 'useVideoConfig', 'interpolate', 'spring', 'random', 'AbsoluteFill', 'Easing'];
const VALUES: unknown[] = [React, useCurrentFrame, useVideoConfig, interpolate, spring, random, AbsoluteFill, Easing];
const compiled = new Map<string, React.ComponentType | null>();
let locked = false;

function lockNetwork(): void {
  if (locked || typeof document === 'undefined') return;
  locked = true;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = "connect-src 'none'; form-action 'none'";
  document.head.appendChild(meta);
}

function compile(code: string): React.ComponentType | null {
  if (compiled.has(code)) return compiled.get(code) ?? null;
  lockNetwork();
  let component: React.ComponentType | null = null;
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(...NAMES, `"use strict";\n${code}`);
    const out = factory(...VALUES);
    component = typeof out === 'function' ? (out as React.ComponentType) : null;
  } catch (err) {
    console.error('Motion personalizado: o código não compila:', err);
  }
  compiled.set(code, component);
  return component;
}

class Guard extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch(err: unknown) {
    console.error('Motion personalizado: erro ao desenhar:', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const Custom: React.FC<CustomProps> = ({code = ''}) => {
  const Scene = compile(code);
  if (!Scene) return null;
  return (
    <AbsoluteFill style={{backgroundColor: 'transparent'}}>
      <Guard>
        <Scene />
      </Guard>
    </AbsoluteFill>
  );
};
