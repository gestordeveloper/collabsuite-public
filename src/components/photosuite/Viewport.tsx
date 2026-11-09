import { useCallback, useEffect, useRef } from "react";
import { Stroke } from "@/src/lib/photosuite/brush";
import { createCanvas, getPixels, maskKey, renderDocument } from "@/src/lib/photosuite/engine";
import {
  coverageAt, drawAnts, fromShape, getSelection, shifted, type Rect, type SelMode,
} from "@/src/lib/photosuite/selection";
import { collectIds, findLayer, walk } from "@/src/lib/photosuite/tree";
import { contains, corners, HANDLES, pointAt, resizeByHandle, rotateTo, type TState } from "@/src/lib/photosuite/transform";
import type { Point } from "@/src/lib/photosuite/fill";
import type { Layer, RasterLayer } from "@/src/lib/photosuite/types";
import {
  DEFAULT_STROKE, cloneShape, corner, deleteAnchor, ellipsePath, findAnchor, findSegment, hitFill, insertAnchor, linePath, polygonPath,
  rectPath, starPath, toPath2D, toggleSmooth, translateShape, type AnchorHit, type ShapeData, type SubPath,
} from "@/src/lib/photosuite/vector";
import type { ShapeOpts } from "@/src/store/photosuite.store";
import { TextEditorOverlay } from "./TextEditorOverlay";
import { usePhotosuite } from "@/src/store/photosuite.store";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;
const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0625, 0.08, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const HANDLE_PX = 5; // raio de acerto/desenho das alças, em px de tela
const ROTATE_OFFSET_PX = 28;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

let checker: HTMLCanvasElement | null = null;
/** Padrão xadrez de transparência (16px, células de 8px), criado uma vez. */
function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (!checker) {
    checker = createCanvas(16, 16);
    const c = checker.getContext("2d")!;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = "#d4d4d4";
    c.fillRect(8, 0, 8, 8);
    c.fillRect(0, 8, 8, 8);
  }
  return ctx.createPattern(checker, "repeat")!;
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Retângulo do marquee com Shift (quadrado) e Alt (a partir do centro). */
function marqueeRect(p0: Point, p1: Point, constrain: boolean, fromCenter: boolean): Rect {
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  if (constrain) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (fromCenter) return { x: p0.x - Math.abs(dx), y: p0.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return normRect(p0, { x: p0.x + dx, y: p0.y + dy });
}

type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Drag =
  | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
  | { kind: "stroke"; stroke: Stroke; key: string; label: string }
  | { kind: "move"; startX: number; startY: number; before: Layer[]; ids: string[] }
  | { kind: "marquee"; shape: "rect" | "ellipse"; p0: Point; p1: Point; mode: SelMode; shift: boolean; alt: boolean }
  | { kind: "lasso"; points: Point[]; mode: SelMode }
  | { kind: "selmove"; start: Point; base: HTMLCanvasElement }
  | { kind: "gradient"; p0: Point; p1: Point }
  | { kind: "crop"; mode: "new" | "move" | "handle"; handle?: CropHandle; start: Point; orig: Rect }
  | { kind: "xform"; mode: "move" | "scale" | "rotate"; hx: number; hy: number; start: Point; orig: TState }
  | { kind: "text-box"; p0: Point; p1: Point }
  | { kind: "shape"; id: string | null; p0: Point; p1: Point }
  | { kind: "pen-handle"; id: string; path: number; index: number }
  | { kind: "anchor"; id: string; hit: AnchorHit; start: Point; origDoc: ShapeData; items: { path: number; index: number }[] };

/** Geometria da forma arrastada, em coordenadas do documento. */
function shapeFromDrag(opts: ShapeOpts, p0: Point, p1: Point, constrain: boolean, fromCenter: boolean): ShapeData {
  const kind = opts.kind;
  let paths: SubPath[];
  if (kind === "polygon" || kind === "star") {
    const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const rot = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    paths = [kind === "polygon" ? polygonPath(p0.x, p0.y, r, opts.sides, rot) : starPath(p0.x, p0.y, r, r * opts.starInner, opts.sides, rot)];
  } else if (kind === "line") {
    let q = p1;
    if (constrain) {
      const ang = Math.round(Math.atan2(p1.y - p0.y, p1.x - p0.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      q = { x: p0.x + Math.cos(ang) * len, y: p0.y + Math.sin(ang) * len };
    }
    paths = [linePath(p0.x, p0.y, q.x, q.y)];
  } else {
    const r = marqueeRect(p0, p1, constrain, fromCenter);
    paths = [kind === "ellipse" ? ellipsePath(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rectPath(r.x, r.y, r.w, r.h, kind === "rounded" ? opts.radius : 0)];
  }
  return {
    paths,
    fill: kind === "line" ? null : opts.fill,
    stroke: kind === "line" ? (opts.stroke ?? DEFAULT_STROKE) : opts.stroke,
    evenOdd: false,
  };
}

/** Inverte o sentido de um subcaminho (as alças de entrada e saída trocam de lugar). */
function reversePath(sp: SubPath): SubPath {
  return { closed: sp.closed, points: [...sp.points].reverse().map((a) => ({ ...a, ix: a.ox, iy: a.oy, ox: a.ix, oy: a.iy })) };
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const compRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const lastRendered = useRef(-1);
  const frame = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const phase = useRef(0);
  const pointer = useRef<Point | null>(null);
  // Clonar: origem definida com Alt+clique; o deslocamento persiste entre traços quando "alinhado".
  const cloneSrc = useRef<Point | null>(null);
  const cloneOffset = useRef<{ dx: number; dy: number } | null>(null);

  const docId = usePhotosuite((s) => s.docId);
  const revision = usePhotosuite((s) => s.revision);
  const view = usePhotosuite((s) => s.view);
  const viewCommand = usePhotosuite((s) => s.viewCommand);
  const tool = usePhotosuite((s) => s.tool);
  const hasSelection = usePhotosuite((s) => s.hasSelection);
  const selectionRev = usePhotosuite((s) => s.selectionRev);
  const transform = usePhotosuite((s) => s.transform);
  const crop = usePhotosuite((s) => s.crop);

  const toScreen = (p: Point, v: { zoom: number; x: number; y: number }): Point => ({ x: v.x + p.x * v.zoom, y: v.y + p.y * v.zoom });

  const drawOverlays = useCallback((ctx: CanvasRenderingContext2D) => {
    const s = usePhotosuite.getState();
    const { w, h } = sizeRef.current;
    const v = s.view;
    const sc = (p: Point) => toScreen(p, v);
    const d = drag.current;

    const dashed = (path: () => void, width = 1) => {
      ctx.save();
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      ctx.strokeStyle = "#000";
      ctx.beginPath(); path(); ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); path(); ctx.stroke();
      ctx.restore();
    };

    // seleção (formigas marchando)
    const sel = getSelection();
    if (sel && s.hasSelection) drawAnts(ctx, sel, v, w, h, phase.current);

    // marquee / laço em andamento
    if (d?.kind === "marquee") {
      const r = marqueeRect(d.p0, d.p1, d.shift, d.alt);
      const a = sc({ x: r.x, y: r.y });
      const rw = r.w * v.zoom;
      const rh = r.h * v.zoom;
      dashed(() => {
        if (d.shape === "rect") ctx.rect(a.x + 0.5, a.y + 0.5, rw, rh);
        else ctx.ellipse(a.x + rw / 2, a.y + rh / 2, Math.max(0.1, rw / 2), Math.max(0.1, rh / 2), 0, 0, Math.PI * 2);
      });
    } else if (d?.kind === "lasso" && d.points.length > 1) {
      dashed(() => {
        d.points.forEach((p, i) => {
          const q = sc(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
      });
    } else if (d?.kind === "gradient") {
      const a = sc(d.p0);
      const b = sc(d.p1);
      dashed(() => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      for (const q of [a, b]) {
        ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    // origem do clone
    if (s.tool === "clone" && cloneSrc.current) {
      const base = pointer.current && cloneOffset.current && s.opts.cloneAligned ? { x: pointer.current.x + cloneOffset.current.dx, y: pointer.current.y + cloneOffset.current.dy } : cloneSrc.current;
      const q = sc(base);
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 2;
      ctx.beginPath();
      ctx.moveTo(q.x - 8, q.y); ctx.lineTo(q.x + 8, q.y);
      ctx.moveTo(q.x, q.y - 8); ctx.lineTo(q.x, q.y + 8);
      ctx.stroke();
      ctx.restore();
    }

    // recorte
    if (s.crop) {
      const c = s.crop;
      const a = sc({ x: c.x, y: c.y });
      const cw = c.w * v.zoom;
      const ch = c.h * v.zoom;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(a.x, a.y, cw, ch);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, cw, ch);
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(a.x + (cw * i) / 3, a.y); ctx.lineTo(a.x + (cw * i) / 3, a.y + ch);
        ctx.moveTo(a.x, a.y + (ch * i) / 3); ctx.lineTo(a.x + cw, a.y + (ch * i) / 3);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      for (const hd of cropHandles(c, v)) {
        ctx.fillRect(hd.p.x - HANDLE_PX, hd.p.y - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
        ctx.strokeRect(hd.p.x - HANDLE_PX + 0.5, hd.p.y - HANDLE_PX + 0.5, HANDLE_PX * 2, HANDLE_PX * 2);
      }
      ctx.restore();
    }

    // retângulo do texto em criação
    if (d?.kind === "text-box") {
      const r = normRect(d.p0, d.p1);
      const a = sc({ x: r.x, y: r.y });
      dashed(() => ctx.rect(a.x + 0.5, a.y + 0.5, r.w * v.zoom, r.h * v.zoom));
    }

    // caminho da forma ativa (caneta / seleção direta)
    const act = s.activeId ? findLayer(s.layers, s.activeId)?.layer : null;
    if ((s.tool === "pen" || s.tool === "direct") && act && act.type === "raster" && act.shape) {
      ctx.save();
      ctx.translate(v.x + act.x * v.zoom, v.y + act.y * v.zoom);
      ctx.scale(v.zoom, v.zoom);
      ctx.lineWidth = 1 / v.zoom;
      ctx.strokeStyle = "#ec1889";
      ctx.stroke(toPath2D(act.shape.paths));
      ctx.restore();
      const selItems = s.anchorSel && s.anchorSel.id === act.id ? s.anchorSel.items : [];
      const toScreen2 = (x: number, y: number) => sc({ x: act.x + x, y: act.y + y });
      ctx.save();
      ctx.lineWidth = 1;
      act.shape.paths.forEach((sp, pi) =>
        sp.points.forEach((a, i) => {
          const isSel = selItems.some((it) => it.path === pi && it.index === i);
          const q = toScreen2(a.x, a.y);
          if (isSel) {
            // alças da âncora selecionada
            ctx.strokeStyle = "#ec1889";
            for (const [hx, hy] of [[a.ix, a.iy], [a.ox, a.oy]]) {
              if (!hx && !hy) continue;
              const h = toScreen2(a.x + hx, a.y + hy);
              ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(h.x, h.y); ctx.stroke();
              ctx.fillStyle = "#fff";
              ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
          }
          ctx.fillStyle = isSel ? "#ec1889" : "#fff";
          ctx.strokeStyle = "#ec1889";
          ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
          ctx.strokeRect(q.x - 3.5, q.y - 3.5, 7, 7);
        }),
      );
      ctx.restore();
    }

    // transformação livre
    if (s.transform) {
      const t = s.transform;
      const cs = corners(t).map(sc);
      ctx.save();
      ctx.strokeStyle = "#ec1889";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      cs.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      const top = sc(pointAt(t, 0, -1));
      const rp = rotateHandle(t, v);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#ec1889";
      for (const hd of HANDLES) {
        const q = sc(pointAt(t, hd.hx, hd.hy));
        ctx.fillRect(q.x - HANDLE_PX, q.y - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
        ctx.strokeRect(q.x - HANDLE_PX + 0.5, q.y - HANDLE_PX + 0.5, HANDLE_PX * 2, HANDLE_PX * 2);
      }
      ctx.beginPath(); ctx.arc(rp.x, rp.y, HANDLE_PX, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = usePhotosuite.getState();
    if (!s.width) return;
    if (!compRef.current) compRef.current = createCanvas(s.width, s.height);
    const comp = compRef.current;
    if (lastRendered.current !== s.revision || comp.width !== s.width || comp.height !== s.height) {
      renderDocument({ width: s.width, height: s.height, layers: s.layers }, comp);
      lastRendered.current = s.revision;
    }

    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { zoom, x, y } = s.view;
    const dw = s.width * zoom;
    const dh = s.height * zoom;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, dw, dh);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, dw, dh);
    ctx.clip();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = checkerPattern(ctx);
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();
    ctx.imageSmoothingEnabled = zoom < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(comp, x, y, dw, dh);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, dw + 1, dh + 1);

    drawOverlays(ctx);
  }, [drawOverlays]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: r.width, h: r.height };
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  useEffect(() => {
    schedule();
  }, [revision, view, docId, selectionRev, transform, crop, schedule]);

  // Formigas marchando: só anima enquanto há seleção
  useEffect(() => {
    if (!hasSelection) return;
    const t = setInterval(() => {
      phase.current = (phase.current + 1) % 8;
      schedule();
    }, 140);
    return () => clearInterval(t);
  }, [hasSelection, schedule]);

  useEffect(() => {
    compRef.current = null;
    lastRendered.current = -1;
    cloneSrc.current = null;
    cloneOffset.current = null;
  }, [docId]);

  const fitTo = useCallback((zoomOverride?: number) => {
    const { w, h } = sizeRef.current;
    const s = usePhotosuite.getState();
    if (!w || !s.width) return;
    const pad = 48;
    const zoom = zoomOverride ?? clampZoom(Math.min((w - pad) / s.width, (h - pad) / s.height, 1));
    s.setView({ zoom, x: (w - s.width * zoom) / 2, y: (h - s.height * zoom) / 2 });
  }, []);

  useEffect(() => {
    if (docId == null) return;
    const t = setTimeout(() => fitTo(), 30);
    return () => clearTimeout(t);
  }, [docId, fitTo]);

  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const s = usePhotosuite.getState();
    const { zoom, x, y } = s.view;
    const z = clampZoom(next);
    s.setView({ zoom: z, x: cx - ((cx - x) / zoom) * z, y: cy - ((cy - y) / zoom) * z });
  }, []);

  useEffect(() => {
    if (!viewCommand) return;
    const { w, h } = sizeRef.current;
    const zoom = usePhotosuite.getState().view.zoom;
    if (viewCommand.type === "fit") fitTo();
    else if (viewCommand.type === "actual") zoomAt(1, w / 2, h / 2);
    else if (viewCommand.type === "in") zoomAt(ZOOM_STEPS.find((z) => z > zoom + 1e-4) ?? MAX_ZOOM, w / 2, h / 2);
    else zoomAt([...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-4) ?? MIN_ZOOM, w / 2, h / 2);
  }, [viewCommand, fitTo, zoomAt]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s = usePhotosuite.getState();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        zoomAt(s.view.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        s.setView({ x: s.view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: s.view.y - (e.shiftKey ? 0 : e.deltaY) });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === "INPUT") return !["range", "checkbox", "radio", "color", "button"].includes((el as HTMLInputElement).type);
      return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        spaceDown.current = true;
        if (containerRef.current) containerRef.current.style.cursor = "grab";
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        if (containerRef.current) containerRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Geometria (alças)
  // ---------------------------------------------------------------------------------------------

  function cropHandles(c: Rect, v: { zoom: number; x: number; y: number }): { id: CropHandle; p: Point }[] {
    const x0 = v.x + c.x * v.zoom, y0 = v.y + c.y * v.zoom;
    const x1 = x0 + c.w * v.zoom, y1 = y0 + c.h * v.zoom;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return [
      { id: "nw", p: { x: x0, y: y0 } }, { id: "n", p: { x: mx, y: y0 } }, { id: "ne", p: { x: x1, y: y0 } },
      { id: "e", p: { x: x1, y: my } }, { id: "se", p: { x: x1, y: y1 } }, { id: "s", p: { x: mx, y: y1 } },
      { id: "sw", p: { x: x0, y: y1 } }, { id: "w", p: { x: x0, y: my } },
    ];
  }

  function rotateHandle(t: TState, v: { zoom: number; x: number; y: number }): Point {
    const top = toScreen(pointAt(t, 0, -1), v);
    return { x: top.x + Math.sin(t.rot) * ROTATE_OFFSET_PX, y: top.y - Math.cos(t.rot) * ROTATE_OFFSET_PX };
  }

  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { zoom, x, y } = usePhotosuite.getState().view;
    return { x: (e.clientX - rect.left - x) / zoom, y: (e.clientY - rect.top - y) / zoom };
  };

  const toLocalScreen = (e: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function sampleColor(p: Point): string | null {
    const comp = compRef.current;
    if (!comp) return null;
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    if (px < 0 || py < 0 || px >= comp.width || py >= comp.height) return null;
    const d = comp.getContext("2d")!.getImageData(px, py, 1, 1).data;
    return d[3] === 0 ? null : toHex(d[0], d[1], d[2]);
  }

  function paintTarget(): { layer: RasterLayer; canvas: HTMLCanvasElement; key: string; isMask: boolean } | null {
    const s = usePhotosuite.getState();
    if (!s.activeId) return null;
    const found = findLayer(s.layers, s.activeId);
    if (!found || found.layer.type !== "raster") return null;
    const layer = found.layer;
    if (layer.locked || !layer.visible) return null;
    if (layer.adjustment && !layer.mask) return null;
    const isMask = (s.target === "mask" || !!layer.adjustment) && !!layer.mask;
    if ((layer.text || layer.shape) && !isMask) return null;
    const key = isMask ? maskKey(layer.id) : layer.id;
    const canvas = getPixels(key);
    return canvas ? { layer, canvas, key, isMask } : null;
  }

  /** Camada visível mais alta com pixel opaco sob o ponto (Ctrl+clique com Mover). */
  function pickLayerAt(p: Point): string | null {
    const s = usePhotosuite.getState();
    const rasters: RasterLayer[] = [];
    walk(s.layers, (l) => {
      if (l.type === "raster" && l.visible) rasters.push(l);
    });
    for (let i = rasters.length - 1; i >= 0; i--) {
      const l = rasters[i];
      const c = getPixels(l.id);
      const lx = Math.floor(p.x - l.x);
      const ly = Math.floor(p.y - l.y);
      if (!c || lx < 0 || ly < 0 || lx >= c.width || ly >= c.height) continue;
      if (c.getContext("2d", { willReadFrequently: true })!.getImageData(lx, ly, 1, 1).data[3] > 8) return l.id;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Ponteiro
  // ---------------------------------------------------------------------------------------------

  // -------------------------------------------------------------------------------------------
  // Texto, caneta, seleção direta e formas
  // -------------------------------------------------------------------------------------------

  /** Sessão da caneta: a camada/subcaminho em construção (vários cliques viram um passo de histórico). */
  const penSession = useRef<{ id: string; path: number } | null>(null);

  function shapeLayerOf(id: string | null | undefined): RasterLayer | null {
    if (!id) return null;
    const f = findLayer(usePhotosuite.getState().layers, id);
    return f && f.layer.type === "raster" && f.layer.shape && !f.layer.locked ? f.layer : null;
  }
  const toLocalOf = (l: RasterLayer, p: Point): Point => ({ x: p.x - l.x, y: p.y - l.y });

  function finishPen() {
    if (!penSession.current) return;
    penSession.current = null;
    usePhotosuite.getState().liveCommit("Caneta");
    schedule();
  }

  // Enter/Esc terminam o caminho; trocar de ferramenta também
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === "Escape") && penSession.current) {
        e.preventDefault();
        finishPen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (tool !== "pen") finishPen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  function penDown(p: Point, e: React.PointerEvent) {
    const s = usePhotosuite.getState();
    const tol = 8 / s.view.zoom;
    const sess = penSession.current;

    if (sess) {
      const layer = shapeLayerOf(sess.id);
      if (!layer) return finishPen();
      const shape = layer.shape!;
      const local = toLocalOf(layer, p);
      const sp = shape.paths[sess.path];
      // clicar no primeiro ponto fecha o caminho
      if (sp.points.length >= 3 && Math.hypot(sp.points[0].x - local.x, sp.points[0].y - local.y) <= tol) {
        const ns = cloneShape(shape);
        ns.paths[sess.path].closed = true;
        s.liveUpdateShape(sess.id, ns);
        return finishPen();
      }
      const ns = cloneShape(shape);
      ns.paths[sess.path].points.push(corner(local.x, local.y));
      s.liveUpdateShape(sess.id, ns);
      drag.current = { kind: "pen-handle", id: sess.id, path: sess.path, index: ns.paths[sess.path].points.length - 1 };
      return;
    }

    const active = shapeLayerOf(s.activeId);
    if (active) {
      const shape = active.shape!;
      const local = toLocalOf(active, p);
      const hit = findAnchor(shape, local, tol);
      if (hit) {
        const sp = shape.paths[hit.path];
        if (!sp.closed && (hit.index === 0 || hit.index === sp.points.length - 1)) {
          // continua um caminho aberto a partir da ponta
          s.liveBegin();
          const ns = cloneShape(shape);
          if (hit.index === 0) ns.paths[hit.path] = reversePath(ns.paths[hit.path]);
          s.liveUpdateShape(active.id, ns);
          penSession.current = { id: active.id, path: hit.path };
        } else {
          s.setShape(active.id, deleteAnchor(shape, hit.path, hit.index), { label: "Excluir ponto" });
        }
        return;
      }
      const seg = findSegment(shape, local, tol);
      if (seg) {
        s.setShape(active.id, insertAnchor(shape, seg), { label: "Adicionar ponto" });
        return;
      }
      // Shift+clique: novo subcaminho na mesma camada de forma (sem Shift, começa uma camada nova)
      if (e.shiftKey) {
        s.liveBegin();
        const ns = cloneShape(shape);
        ns.paths.push({ closed: false, points: [corner(local.x, local.y)] });
        s.liveUpdateShape(active.id, ns);
        penSession.current = { id: active.id, path: ns.paths.length - 1 };
        drag.current = { kind: "pen-handle", id: active.id, path: ns.paths.length - 1, index: 0 };
        return;
      }
    }

    // nova camada de forma
    s.liveBegin();
    const doc: ShapeData = {
      paths: [{ closed: false, points: [corner(p.x, p.y)] }],
      fill: s.shapeOpts.fill,
      stroke: s.shapeOpts.stroke ?? DEFAULT_STROKE,
      evenOdd: false,
    };
    const id = s.liveCreateShape(doc, "Forma");
    penSession.current = { id, path: 0 };
    drag.current = { kind: "pen-handle", id, path: 0, index: 0 };
  }

  function directDown(p: Point, e: React.PointerEvent) {
    const s = usePhotosuite.getState();
    const tol = 8 / s.view.zoom;
    let layer = shapeLayerOf(s.activeId);
    const near = (l: RasterLayer) => {
      const local = toLocalOf(l, p);
      return !!findAnchor(l.shape!, local, tol) || !!findSegment(l.shape!, local, tol) || hitFill(l.shape!, local);
    };
    if (!layer || !near(layer)) {
      // escolhe a forma de cima sob o cursor
      const shapes: RasterLayer[] = [];
      walk(s.layers, (l) => {
        if (l.type === "raster" && l.shape && l.visible && !l.locked) shapes.push(l);
      });
      const hit = [...shapes].reverse().find(near);
      if (hit) {
        s.selectLayer(hit.id);
        layer = hit;
      }
    }
    if (!layer) {
      s.setAnchorSel(null);
      return;
    }
    const shape = layer.shape!;
    const local = toLocalOf(layer, p);
    const sel = s.anchorSel && s.anchorSel.id === layer.id ? s.anchorSel.items : [];
    const hit = findAnchor(shape, local, tol, sel);
    if (!hit) {
      s.setAnchorSel({ id: layer.id, items: [] });
      return;
    }
    if (hit.kind === "anchor" && e.altKey) {
      // Alt+clique: converte entre ponto suave e de canto
      s.setShape(layer.id, toggleSmooth(shape, hit.path, hit.index), { label: "Converter ponto" });
      s.setAnchorSel({ id: layer.id, items: [{ path: hit.path, index: hit.index }] });
      return;
    }
    let items = sel;
    if (hit.kind === "anchor") {
      const inSel = sel.some((i) => i.path === hit.path && i.index === hit.index);
      items = e.shiftKey ? (inSel ? sel.filter((i) => !(i.path === hit.path && i.index === hit.index)) : [...sel, { path: hit.path, index: hit.index }]) : inSel ? sel : [{ path: hit.path, index: hit.index }];
      s.setAnchorSel({ id: layer.id, items });
    }
    s.liveBegin();
    drag.current = { kind: "anchor", id: layer.id, hit, start: p, origDoc: translateShape(shape, layer.x, layer.y), items };
  }

  /** Texto de cima (visível) sob o ponto. */
  function textLayerAt(p: Point): RasterLayer | null {
    const s = usePhotosuite.getState();
    let hit: RasterLayer | null = null;
    walk(s.layers, (l) => {
      if (l.type === "raster" && l.text && l.visible && !l.locked && p.x >= l.x && p.y >= l.y && p.x <= l.x + l.width && p.y <= l.y + l.height) hit = l;
    });
    return hit;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    const s = usePhotosuite.getState();
    containerRef.current!.setPointerCapture(e.pointerId);
    const p = toDoc(e);
    const sp = toLocalScreen(e);

    const panning = e.button === 1 || spaceDown.current || s.tool === "hand";
    if (panning) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, originX: s.view.x, originY: s.view.y };
      containerRef.current!.style.cursor = "grabbing";
      return;
    }

    // Transformação livre tem prioridade sobre as ferramentas
    if (s.transform) {
      const t = s.transform;
      const rp = rotateHandle(t, s.view);
      if (Math.hypot(sp.x - rp.x, sp.y - rp.y) <= HANDLE_PX + 3) {
        drag.current = { kind: "xform", mode: "rotate", hx: 0, hy: 0, start: p, orig: t };
        return;
      }
      for (const hd of HANDLES) {
        const q = toScreen(pointAt(t, hd.hx, hd.hy), s.view);
        if (Math.abs(sp.x - q.x) <= HANDLE_PX + 2 && Math.abs(sp.y - q.y) <= HANDLE_PX + 2) {
          drag.current = { kind: "xform", mode: "scale", hx: hd.hx, hy: hd.hy, start: p, orig: t };
          return;
        }
      }
      if (contains(t, p)) drag.current = { kind: "xform", mode: "move", hx: 0, hy: 0, start: p, orig: t };
      return;
    }

    if (s.tool === "zoom") {
      zoomAt(s.view.zoom * (e.altKey ? 0.5 : 2), sp.x, sp.y);
      return;
    }

    const selMode: SelMode = e.shiftKey && e.altKey ? "int" : e.shiftKey ? "add" : e.altKey ? "sub" : s.opts.selMode;

    // Alt + pincel/borracha = conta-gotas temporário; Alt + clonar = define a origem
    if (s.tool === "clone" && e.altKey) {
      cloneSrc.current = p;
      cloneOffset.current = null;
      schedule();
      return;
    }
    if (s.tool === "eyedropper" || ((s.tool === "brush" || s.tool === "eraser") && e.altKey)) {
      const c = sampleColor(p);
      if (c) (e.shiftKey ? s.setBg : s.setFg)(c);
      return;
    }

    switch (s.tool) {
      case "move": {
        if (e.ctrlKey || e.metaKey) {
          const id = pickLayerAt(p);
          if (id) s.selectLayer(id);
        }
        const cur = usePhotosuite.getState();
        const movable = cur.selectedIds.filter((id) => {
          const f = findLayer(cur.layers, id);
          return f && !f.layer.locked && !(f.layer.type === "raster" && f.layer.adjustment);
        });
        if (!movable.length) return;
        drag.current = { kind: "move", startX: p.x, startY: p.y, before: cur.layers, ids: movable };
        return;
      }

      case "marquee":
      case "ellipse":
      case "lasso": {
        // Arrastar de dentro de uma seleção existente move a seleção
        const plain = selMode === s.opts.selMode && selMode === "new";
        const sel = getSelection();
        if (plain && sel && coverageAt(p.x, p.y) >= 128) {
          drag.current = { kind: "selmove", start: p, base: sel };
          return;
        }
        drag.current =
          s.tool === "lasso"
            ? { kind: "lasso", points: [p], mode: selMode }
            : { kind: "marquee", shape: s.tool === "ellipse" ? "ellipse" : "rect", p0: p, p1: p, mode: selMode, shift: false, alt: false };
        return;
      }

      case "text": {
        if (s.textEdit) s.finishTextEdit();
        const hitText = textLayerAt(p);
        if (hitText) {
          s.selectLayer(hitText.id);
          s.setTextEdit(hitText.id);
          return;
        }
        drag.current = { kind: "text-box", p0: p, p1: p };
        return;
      }

      case "pen":
        penDown(p, e);
        return;

      case "direct":
        directDown(p, e);
        return;

      case "shape":
        drag.current = { kind: "shape", id: null, p0: p, p1: p };
        return;

      case "wand":
        s.magicWand(p.x, p.y, selMode);
        return;

      case "bucket":
        s.bucketFill(p.x, p.y);
        return;

      case "gradient":
        drag.current = { kind: "gradient", p0: p, p1: p };
        return;

      case "crop": {
        const c = s.crop;
        if (c) {
          for (const hd of cropHandles(c, s.view)) {
            if (Math.abs(sp.x - hd.p.x) <= HANDLE_PX + 3 && Math.abs(sp.y - hd.p.y) <= HANDLE_PX + 3) {
              drag.current = { kind: "crop", mode: "handle", handle: hd.id, start: p, orig: c };
              return;
            }
          }
          if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
            drag.current = { kind: "crop", mode: "move", start: p, orig: c };
            return;
          }
        }
        drag.current = { kind: "crop", mode: "new", start: p, orig: { x: p.x, y: p.y, w: 0, h: 0 } };
        return;
      }

      case "brush":
      case "eraser":
      case "clone": {
        const t = paintTarget();
        if (!t) return;
        const local = { x: p.x - t.layer.x, y: p.y - t.layer.y };
        let erase = s.tool === "eraser";
        let color = s.fg;
        if (t.isMask) {
          // Máscara: valor no alfa. Cor clara revela (pinta branco), escura esconde (apaga).
          const [r, g, b] = hexToRgb(s.fg);
          const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
          if (s.tool !== "eraser") erase = lum < 0.5;
          color = "#ffffff";
        }
        let clone: { dx: number; dy: number } | null = null;
        if (s.tool === "clone") {
          if (!cloneSrc.current) return; // sem origem definida (Alt+clique)
          if (!cloneOffset.current || !s.opts.cloneAligned) cloneOffset.current = { dx: cloneSrc.current.x - p.x, dy: cloneSrc.current.y - p.y };
          clone = cloneOffset.current;
          erase = false;
        }
        const sel = getSelection();
        const stroke = new Stroke(t.canvas, s.brush, color, erase, {
          clip: sel ? { canvas: sel, ox: t.layer.x, oy: t.layer.y } : null,
          clone,
        });
        stroke.begin(local.x, local.y, e.pointerType === "pen" ? e.pressure || 1 : 1);
        drag.current = { kind: "stroke", stroke, key: t.key, label: s.tool === "clone" ? "Carimbo de clone" : erase ? "Borracha" : "Pincel" };
        s.bump();
        return;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = usePhotosuite.getState();
    const p = toDoc(e);
    pointer.current = p;

    const cur = cursorRef.current;
    if (cur) {
      const rect = containerRef.current!.getBoundingClientRect();
      const showBrush = (s.tool === "brush" || s.tool === "eraser" || s.tool === "clone") && !spaceDown.current && !s.transform;
      const dia = Math.max(2, s.brush.size * s.view.zoom);
      cur.style.display = showBrush ? "block" : "none";
      cur.style.width = cur.style.height = `${dia}px`;
      cur.style.transform = `translate(${e.clientX - rect.left - dia / 2}px, ${e.clientY - rect.top - dia / 2}px)`;
    }
    if (s.tool === "clone" && cloneSrc.current) schedule();

    const d = drag.current;
    if (!d) return;

    switch (d.kind) {
      case "pan":
        s.setView({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
        break;

      case "stroke": {
        const found = s.activeId ? findLayer(s.layers, s.activeId) : null;
        if (!found || found.layer.type !== "raster") return;
        const layer = found.layer;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const q = toDoc(ev);
          d.stroke.move(q.x - layer.x, q.y - layer.y, ev.pointerType === "pen" ? ev.pressure || 1 : 1);
        }
        s.bump();
        break;
      }

      case "move": {
        const dx = Math.round(p.x - d.startX);
        const dy = Math.round(p.y - d.startY);
        const expanded = new Set<string>();
        for (const id of d.ids) {
          const f = findLayer(d.before, id);
          if (f) collectIds(f.layer).forEach((x) => expanded.add(x));
        }
        const apply = (ls: Layer[]): Layer[] =>
          ls.map((l) => {
            if (l.type === "group") return { ...l, children: apply(l.children) };
            return expanded.has(l.id) && !l.adjustment ? { ...l, x: l.x + dx, y: l.y + dy } : l;
          });
        s.setLayersLive(apply(d.before));
        break;
      }

      case "marquee":
        d.p1 = p;
        d.shift = e.shiftKey;
        d.alt = e.altKey;
        schedule();
        break;

      case "lasso":
        d.points.push(p);
        schedule();
        break;

      case "selmove":
        s.setSelectionLive(shifted(d.base, p.x - d.start.x, p.y - d.start.y));
        break;

      case "gradient": {
        let q = p;
        if (e.shiftKey) {
          // Shift trava em múltiplos de 45°
          const ang = Math.round(Math.atan2(p.y - d.p0.y, p.x - d.p0.x) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(p.x - d.p0.x, p.y - d.p0.y);
          q = { x: d.p0.x + Math.cos(ang) * len, y: d.p0.y + Math.sin(ang) * len };
        }
        d.p1 = q;
        s.paintGradientStroke(d.p0, q, true);
        break;
      }

      case "crop": {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (d.mode === "new") {
          s.setCrop(normRect(d.start, p));
        } else if (d.mode === "move") {
          s.setCrop({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy });
        } else if (d.handle) {
          let { x: x0, y: y0 } = d.orig;
          let x1 = d.orig.x + d.orig.w;
          let y1 = d.orig.y + d.orig.h;
          if (d.handle.includes("w")) x0 += dx;
          if (d.handle.includes("e")) x1 += dx;
          if (d.handle.includes("n")) y0 += dy;
          if (d.handle.includes("s")) y1 += dy;
          s.setCrop(normRect({ x: x0, y: y0 }, { x: x1, y: y1 }));
        }
        break;
      }

      case "text-box":
        d.p1 = p;
        schedule();
        break;

      case "shape": {
        d.p1 = p;
        if (!d.id && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < 3 / s.view.zoom) break;
        const doc = shapeFromDrag(s.shapeOpts, d.p0, p, e.shiftKey, e.altKey);
        if (!d.id) {
          s.liveBegin();
          d.id = s.liveCreateShape(doc, s.shapeOpts.kind === "line" ? "Linha" : "Forma");
        } else {
          const layer = shapeLayerOf(d.id);
          if (layer) s.liveUpdateShape(d.id, translateShape(doc, -layer.x, -layer.y));
        }
        break;
      }

      case "pen-handle": {
        const layer = shapeLayerOf(d.id);
        if (!layer) break;
        const local = toLocalOf(layer, p);
        const a = layer.shape!.paths[d.path]?.points[d.index];
        if (!a) break;
        const dx = local.x - a.x;
        const dy = local.y - a.y;
        if (Math.hypot(dx, dy) < 3 / s.view.zoom) break;
        const ns = cloneShape(layer.shape!);
        const na = ns.paths[d.path].points[d.index];
        na.ox = dx; na.oy = dy;
        if (!e.altKey) { na.ix = -dx; na.iy = -dy; }
        s.liveUpdateShape(d.id, ns);
        break;
      }

      case "anchor": {
        const layer = shapeLayerOf(d.id);
        if (!layer) break;
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        const ns = cloneShape(d.origDoc);
        if (d.hit.kind === "anchor") {
          for (const it of d.items) {
            const a = ns.paths[it.path].points[it.index];
            a.x += dx; a.y += dy;
          }
        } else {
          const a = ns.paths[d.hit.path].points[d.hit.index];
          const o = d.origDoc.paths[d.hit.path].points[d.hit.index];
          const offX = p.x - o.x;
          const offY = p.y - o.y;
          const moving = d.hit.kind === "in" ? "i" : "o";
          const other = d.hit.kind === "in" ? "o" : "i";
          a[`${moving}x` as "ix"] = offX;
          a[`${moving}y` as "iy"] = offY;
          // ponto suave (alças alinhadas): a alça oposta gira junto, mantendo o comprimento (Alt quebra)
          const ox = o[`${other}x` as "ix"];
          const oy = o[`${other}y` as "iy"];
          const mx = o[`${moving}x` as "ix"];
          const my = o[`${moving}y` as "iy"];
          const collinear = (ox || oy) && (mx || my) && Math.abs(ox * my - oy * mx) < 1e-3 * Math.hypot(ox, oy) * Math.hypot(mx, my) + 1e-6 && ox * mx + oy * my < 0;
          if (!e.altKey && collinear) {
            const len = Math.hypot(ox, oy);
            const mag = Math.hypot(offX, offY) || 1;
            a[`${other}x` as "ix"] = (-offX / mag) * len;
            a[`${other}y` as "iy"] = (-offY / mag) * len;
          }
        }
        s.liveUpdateShape(d.id, translateShape(ns, -layer.x, -layer.y));
        break;
      }

      case "xform": {
        if (d.mode === "move") s.setTransform({ ...d.orig, cx: d.orig.cx + (p.x - d.start.x), cy: d.orig.cy + (p.y - d.start.y) });
        else if (d.mode === "rotate") s.setTransform(rotateTo(d.orig, p, e.shiftKey));
        else s.setTransform(resizeByHandle(d.orig, d.hx, d.hy, p, e.shiftKey, e.altKey));
        break;
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (containerRef.current) {
      containerRef.current.style.cursor = spaceDown.current ? "grab" : "";
      if (containerRef.current.hasPointerCapture(e.pointerId)) containerRef.current.releasePointerCapture(e.pointerId);
    }
    if (!d) return;
    const s = usePhotosuite.getState();
    const { width: W, height: H } = s;

    switch (d.kind) {
      case "stroke": {
        const result = d.stroke.end();
        if (result) s.commitStroke(result, d.key, d.label);
        break;
      }
      case "move":
        s.commitLive("Mover", d.before);
        break;
      case "marquee": {
        const r = marqueeRect(d.p0, d.p1, d.shift, d.alt);
        if (r.w < 2 && r.h < 2) {
          if (d.mode === "new") s.deselect();
          break;
        }
        const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
        const shape = fromShape(
          W, H,
          (ctx) => {
            if (d.shape === "rect") ctx.fillRect(x, y, w, h);
            else {
              ctx.beginPath();
              ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          },
          s.opts.feather,
        );
        s.applySelection(shape, d.mode, d.shape === "rect" ? "Seleção retangular" : "Seleção elíptica");
        break;
      }
      case "lasso": {
        if (d.points.length < 3) {
          if (d.mode === "new") s.deselect();
          break;
        }
        const shape = fromShape(
          W, H,
          (ctx) => {
            ctx.beginPath();
            d.points.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
            ctx.closePath();
            ctx.fill();
          },
          s.opts.feather,
        );
        s.applySelection(shape, d.mode, "Laço");
        break;
      }
      case "selmove":
        s.commitSelectionMove(d.base);
        break;
      case "gradient":
        s.paintGradientStroke(d.p0, d.p1, false);
        break;
      case "crop": {
        const c = usePhotosuite.getState().crop;
        if (c && (c.w < 2 || c.h < 2)) s.setCrop(null);
        break;
      }
      case "xform":
        break;
      case "text-box": {
        const r = normRect(d.p0, d.p1);
        const dragged = r.w > 8 / s.view.zoom && r.h > 8 / s.view.zoom;
        if (dragged) s.addTextLayer(r.x, r.y, { w: Math.round(r.w), h: Math.round(r.h) });
        else s.addTextLayer(d.p0.x, d.p0.y - s.textStyle.size * 0.8, null);
        break;
      }
      case "shape":
        if (d.id) s.liveCommit(s.shapeOpts.kind === "line" ? "Linha" : "Forma");
        break;
      case "anchor":
        s.liveCommit("Editar caminho");
        break;
      case "pen-handle":
        break; // a sessão da caneta continua aberta até Enter/Esc/fechar o caminho
    }
    schedule();
  }

  const cursorClass =
    tool === "hand" ? "cursor-grab"
    : tool === "zoom" ? "cursor-zoom-in"
    : tool === "move" ? "cursor-move"
    : tool === "brush" || tool === "eraser" || tool === "clone" ? "cursor-none"
    : tool === "text" ? "cursor-text"
    : "cursor-crosshair";

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full touch-none select-none overflow-hidden bg-[#1b1b1d] ${transform ? "cursor-default" : cursorClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (cursorRef.current) cursorRef.current.style.display = "none";
      }}
      onDoubleClick={() => {
        const s = usePhotosuite.getState();
        if (s.transform) s.commitTransform();
        else if (s.tool === "crop" && s.crop) s.commitCrop();
        else if (s.tool === "pen") finishPen();
        else if (s.tool === "direct") {
          const layer = shapeLayerOf(s.activeId);
          const pt = pointer.current;
          if (layer && pt) {
            const seg = findSegment(layer.shape!, toLocalOf(layer, pt), 8 / s.view.zoom);
            if (seg) s.setShape(layer.id, insertAnchor(layer.shape!, seg), { label: "Adicionar ponto" });
          }
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <TextEditorOverlay />
      <div
        ref={cursorRef}
        className="pointer-events-none absolute left-0 top-0 hidden rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
      />
    </div>
  );
}
