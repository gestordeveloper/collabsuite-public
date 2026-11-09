// Live preview of motion graphics items: runs @remotion/player (a React component) directly in the
// browser, bundled once via `npm run build:player` in motion/ into frontend/vendor/motion-player.js
// (see motion/src/player-entry.tsx) — the SAME component the server renders with motion/render.mjs,
// so the preview is not a second hand-kept-in-sync implementation (unlike the headline's JS+ffmpeg
// animation, which has to be kept equal by hand — see [[headline-canvas-architecture]]).
//
// Positioned over the video the same way js/headlines.js's #live-headline is: an absolute layer
// inserted right before #overlay-layer, so it paints after js/fx.js's #fx-canvas (split/zoom/LUT)
// but under the headline/captions layer, matching backend/render_service.py::compose_final's order.
const MotionPlayer = {
  FPS: 30,   // matches the fixed fps backend/routes_motion.py::_render_size uses today

  _layer: null,
  _items: new Map(),   // item id -> {el, specKey}

  ready() { return typeof window.StudioXMotionPlayerBundle !== 'undefined'; },

  ensureLayer() {
    if (this._layer) return this._layer;
    const overlay = document.getElementById('overlay-layer');
    if (!overlay) return null;
    const layer = document.createElement('div');
    layer.id = 'motion-preview-layer';
    layer.className = 'motion-preview-layer';
    overlay.insertAdjacentElement('beforebegin', layer);
    this._layer = layer;
    return layer;
  },

  // Items whose code is WRITTEN BY THE AI ("custom") run inside a sandboxed iframe with an opaque origin and a CSP without
  // network (frontend/motion-sandbox.html): they cannot reach the editor's page, storage or credentials. Every other item
  // is mounted straight in the page, as before.
  containerFor(itemId, sandboxed) {
    const layer = this.ensureLayer();
    if (!layer) return null;
    let entry = this._items.get(itemId);
    if (!entry) {
      let el;
      if (sandboxed) {
        el = document.createElement('iframe');
        el.setAttribute('sandbox', 'allow-scripts');   // deliberately NOT allow-same-origin
        el.src = 'motion-sandbox.html?v=2';
        el.style.cssText = 'border:0;background:transparent;color-scheme:normal';
      } else {
        el = document.createElement('div');
      }
      el.className = 'motion-preview-item';
      layer.appendChild(el);
      entry = {el, specKey: '', sandboxed: !!sandboxed, ready: false, pending: []};
      if (sandboxed) this.watchSandbox(entry);
      this._items.set(itemId, entry);
    }
    return entry;
  },

  watchSandbox(entry) {
    window.addEventListener('message', e => {
      if (e.source !== entry.el.contentWindow || !e.data || e.data.type !== 'ready') return;
      entry.ready = true;
      for (const m of entry.pending) entry.el.contentWindow.postMessage(m, '*');
      entry.pending = [];
    });
  },

  send(entry, msg) {
    if (!entry.ready) {   // keep only the latest of each kind while the sandbox is still loading
      entry.pending = entry.pending.filter(m => m.type !== msg.type);
      entry.pending.push(msg);
    } else {
      entry.el.contentWindow.postMessage(msg, '*');
    }
  },

  mountItem(entry, spec) {
    if (entry.sandboxed) this.send(entry, {type: 'mount', spec});
    else window.StudioXMotionPlayerBundle.mount(entry.el, spec);
  },

  seekItem(entry, frame) {
    if (entry.sandboxed) {
      if (entry.lastFrame === Math.round(frame)) return;
      entry.lastFrame = Math.round(frame);
      this.send(entry, {type: 'seek', frame});
    } else {
      window.StudioXMotionPlayerBundle.seek(entry.el, frame);
    }
  },

  renderSize() {
    if (typeof CanvasFrame !== 'undefined' && CanvasFrame.state) {   // the chosen aspect ratio (outputSize() answers {w, h})
      const o = CanvasFrame.outputSize();
      return {width: o.w, height: o.h};
    }
    const meta = (typeof App !== 'undefined' && App.currentProject && App.currentProject.meta) || {};
    return {
      width: meta.display_width || meta.width || 1080,
      height: meta.display_height || meta.height || 1920,
    };
  },

  // Called every animation frame by js/player.js::Player.syncToVideo, with the OUTPUT-timeline time
  // (same clock as headline/music/split — see Timeline.sourceToSequence).
  syncAt(outTime) {
    if (!this.ready() || typeof Motion === 'undefined' || !Motion.cfg || !Motion.cfg.enabled || !Motion.cfg.items.length) {
      this.hideAll();
      return;
    }
    const {width, height} = this.renderSize();
    const live = new Set();
    for (const it of Motion.cfg.items) {
      const end = it.start + it.duration;
      if (outTime < it.start - 0.02 || outTime >= end) continue;
      const entry = this.containerFor(it.id, it.template_id === 'custom');
      if (!entry) continue;
      live.add(it.id);
      const key = `${it.template_id}|${JSON.stringify(it.props)}|${it.duration}|${width}|${height}`;
      if (entry.specKey !== key) {
        entry.specKey = key;
        entry.lastFrame = null;
        this.mountItem(entry, {
          templateId: it.template_id, inputProps: it.props, width, height,
          fps: this.FPS, durationInSeconds: it.duration,
        });
      }
      // A graphic that follows a face / hand / point is only SHIFTED (its design is centred in the frame), and hidden while
      // the target is out of sight — the render slides the same video the same way (backend/motion_track.py)
      const pos = typeof MotionTrack !== 'undefined' ? MotionTrack.positionAt(it, outTime) : null;
      if (pos && pos.hidden) { entry.el.style.display = 'none'; continue; }
      entry.el.style.display = '';
      entry.el.style.transform = pos ? `translate(${((pos.x - 0.5) * 100).toFixed(3)}%, ${((pos.y - 0.5) * 100).toFixed(3)}%)` : '';
      const frame = (outTime - it.start) * this.FPS;
      this.seekItem(entry, frame);
    }
    for (const [id, entry] of this._items) {
      if (!live.has(id) || entry.el.style.display === 'none') entry.el.style.display = 'none';
    }
  },

  hideAll() {
    for (const entry of this._items.values()) entry.el.style.display = 'none';
  },

  remove(itemId) {
    const entry = this._items.get(itemId);
    if (!entry) return;
    if (this.ready() && !entry.sandboxed) window.StudioXMotionPlayerBundle.unmount(entry.el);
    entry.el.remove();
    this._items.delete(itemId);
  },
};
