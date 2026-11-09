// Aspect ratio and a free scale/position/rotation transform of the video within its frame.
// Rendered by backend/canvas.py, as the first visual step of the last render pass (before zoom,
// split screen, headline and captions, which all draw on the resulting frame).
//
// Preview: `#video-container`'s own aspect-ratio becomes the chosen one, and `#main-video` is sized
// with left/top/width/height to a "cover" fit (fills the frame, like scale=1) times the user's scale,
// moved by x/y (a fraction of the frame) — see videoBox(). Rotation is the one thing still done with
// a CSS transform on the video, because split screen (js/splitscreen.js) also needs that property for
// its speaker crop: while a speaker segment is on screen, split screen owns `transform` and this
// module steps aside (the rotation preview pauses; the render itself is unaffected).
//
// Saved with the project as edit.canvas = {ratio, background, transform}.

const CanvasFrame = {
  RATIOS: { original: null, '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] },
  LONG_SIDE: 1920,
  state: null,
  _lastT: 0,
  _ro: null,

  // --- Config -----------------------------------------------------------------
  clean(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const t = s.transform && typeof s.transform === 'object' ? s.transform : {};
    return {
      ratio: Object.prototype.hasOwnProperty.call(this.RATIOS, s.ratio) ? s.ratio : 'original',
      background: /^#[0-9a-fA-F]{6}$/.test(s.background || '') ? s.background : '#000000',
      transform: {
        scale: num(t.scale, 1, 0.05, 8),
        x: num(t.x, 0, -3, 3),
        y: num(t.y, 0, -3, 3),
        rotation: num(t.rotation, 0, -180, 180)
      }
    };
  },

  exportConfig() { return { ratio: this.state.ratio, background: this.state.background, transform: { ...this.state.transform } }; },

  applyExternal(saved) {
    this.state = this.clean(saved);
    this.paint();
    this.applyPreview();
  },

  // --- Setup --------------------------------------------------------------------
  init() {
    this.state = this.clean(null);
    this.bindTabToggle();
    this.bindControls();
    this.bindDrag();
    const video = document.getElementById('main-video');
    if (video) video.addEventListener('loadedmetadata', () => this.applyPreview());
    const wrap = document.getElementById('video-container')?.parentElement;
    if (wrap && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.applyPreview());
      this._ro.observe(wrap);
    }
    this.paint();
    this.applyPreview();
  },

  $(id) { return document.getElementById(id); },

  bindTabToggle() {
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
      this.$('frame-hit')?.classList.toggle('hidden', b.dataset.tab !== 'tab-frame');
    }));
  },

  bindControls() {
    const $ = id => this.$(id);
    $('frame-ratio')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-ratio]');
      if (b) { this.state.ratio = b.dataset.ratio; this.changed(); }
    });
    $('frame-scale')?.addEventListener('input', e => this.setTransform({ scale: parseInt(e.target.value, 10) / 100 }));
    $('frame-rotation')?.addEventListener('input', e => this.setTransform({ rotation: parseInt(e.target.value, 10) }));
    $('frame-x')?.addEventListener('input', e => this.setTransform({ x: parseInt(e.target.value, 10) / 100 }));
    $('frame-y')?.addEventListener('input', e => this.setTransform({ y: parseInt(e.target.value, 10) / 100 }));
    $('frame-background')?.addEventListener('input', e => { this.state.background = e.target.value; this.changed(); });
    $('btn-frame-reset')?.addEventListener('click', () => { this.state.transform = { scale: 1, x: 0, y: 0, rotation: 0 }; this.changed(); });
  },

  // Drag anywhere on the preview (while the "Formato" tab is open) to pan; the wheel zooms
  bindDrag() {
    const el = this.$('frame-hit');
    if (!el) return;
    let dragging = false, startX = 0, startY = 0, startTX = 0, startTY = 0;
    el.addEventListener('pointerdown', e => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startTX = this.state.transform.x; startTY = this.state.transform.y;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      const r = this.$('video-container')?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      this.setTransform({ x: startTX + (e.clientX - startX) / r.width, y: startTY + (e.clientY - startY) / r.height });
    });
    const end = () => { dragging = false; el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.setTransform({ scale: this.state.transform.scale + (e.deltaY > 0 ? -0.05 : 0.05) });
    }, { passive: false });
  },

  setTransform(partial) {
    this.state = this.clean({ ...this.state, transform: { ...this.state.transform, ...partial } });
    this.changed();
  },

  changed() {
    this.paint();
    this.applyPreview();
  },

  paint() {
    const $ = id => this.$(id);
    const t = this.state.transform;
    document.querySelectorAll('#frame-ratio button[data-ratio]').forEach(b => b.classList.toggle('active', b.dataset.ratio === this.state.ratio));
    const slider = (id, val) => { const el = $(id); if (el && document.activeElement !== el) el.value = val; };
    slider('frame-scale', Math.round(t.scale * 100));
    slider('frame-rotation', Math.round(t.rotation));
    slider('frame-x', Math.round(t.x * 100));
    slider('frame-y', Math.round(t.y * 100));
    if ($('frame-scale-val')) $('frame-scale-val').textContent = `${Math.round(t.scale * 100)}%`;
    if ($('frame-rotation-val')) $('frame-rotation-val').textContent = `${Math.round(t.rotation)}°`;
    if ($('frame-x-val')) $('frame-x-val').textContent = `${Math.round(t.x * 100)}%`;
    if ($('frame-y-val')) $('frame-y-val').textContent = `${Math.round(t.y * 100)}%`;
    if ($('frame-background') && document.activeElement !== $('frame-background')) $('frame-background').value = this.state.background;
  },

  // ---------------------------------------------------------------------------
  // Geometry (shared with js/splitscreen.js, which lays its boxes out on the same frame)
  // ---------------------------------------------------------------------------
  // The output frame's own size, long side fixed at 1920 like render.py itself scales every video to
  // (backend/canvas.py::target_size mirrors this). "original" uses the source's own ratio at that
  // same 1920 scale, so a headline PNG drawn at this size never needs more than a light rescale.
  outputSize() {
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    const video = Player && Player.video;
    const meta = (typeof App !== 'undefined' && App.currentProject && App.currentProject.meta) || {};
    const vw = (video && video.videoWidth) || meta.width || 1920;
    const vh = (video && video.videoHeight) || meta.height || 1080;
    const [rw, rh] = this.RATIOS[this.state.ratio] || [vw, vh];
    return rh > rw ? { w: even(this.LONG_SIDE * rw / rh), h: this.LONG_SIDE } : { w: this.LONG_SIDE, h: even(this.LONG_SIDE * rh / rw) };
  },

  // Where `#main-video` sits inside `#video-container`, in container px: a "cover" fit (fills the
  // frame at scale=1) times the user's scale, moved by x/y (a fraction of the frame).
  videoBox() {
    const box = this.$('video-container'), video = Player && Player.video;
    if (!box || !video) return null;
    const meta = (typeof App !== 'undefined' && App.currentProject && App.currentProject.meta) || {};
    const vw = video.videoWidth || meta.width || 16, vh = video.videoHeight || meta.height || 9;
    const cw = box.clientWidth, ch = box.clientHeight;
    if (!cw || !ch) return null;
    const t = this.state.transform;
    const scale = Math.max(cw / vw, ch / vh) * t.scale;
    const dw = vw * scale, dh = vh * scale;
    return { cw, ch, dw, dh, x0: (cw - dw) / 2 + t.x * cw, y0: (ch - dh) / 2 + t.y * ch };
  },

  // `#main-video` is absolutely positioned (see videoBox()), so it no longer contributes any
  // intrinsic size to `#video-container` the way an in-flow, 100%-sized child normally would: the
  // container's own width/height have to be computed here instead of left to CSS aspect-ratio
  // auto-sizing (which needs in-flow content to anchor to, and finds none).
  sizeContainer() {
    const box = this.$('video-container'), parent = box && box.parentElement;
    if (!box || !parent) return;
    const size = this.outputSize();
    const availW = parent.clientWidth, availH = Math.max(0, parent.clientHeight - 50);
    if (!availW || !availH) return;
    const scale = Math.min(availW / size.w, availH / size.h);
    box.style.width = `${Math.max(2, Math.round(size.w * scale))}px`;
    box.style.height = `${Math.max(2, Math.round(size.h * scale))}px`;
  },

  applyPreview() {
    const box = this.$('video-container'), video = Player && Player.video;
    if (!box || !video || !this.state) return;
    box.style.background = this.state.background;
    this.sizeContainer();
    const b = this.videoBox();
    if (!b) return;
    video.style.left = `${b.x0}px`;
    video.style.top = `${b.y0}px`;
    video.style.width = `${b.dw}px`;
    video.style.height = `${b.dh}px`;
    this.applyRotation();
    if (typeof Fx !== 'undefined' && Fx.mounted) Fx.refresh();   // zoom/camera/transitions work on the visible frame
  },

  // Split screen's speaker crop also needs `transform` on the video while it is on screen: it wins
  // then, and this is skipped (the render itself always applies the rotation, unaffected by this).
  applyRotation(t) {
    const video = Player && Player.video;
    if (!video) return;
    const busy = typeof SplitScreen !== 'undefined' && SplitScreen.cfg && SplitScreen.cfg.mode !== 'off'
      && typeof SplitScreen.activeAt === 'function' && SplitScreen.activeAt(t != null ? t : this._lastT);
    if (busy) return;
    const rot = this.state.transform.rotation;
    video.style.transform = rot ? `rotate(${rot}deg)` : '';
  },

  syncAt(t) {
    this._lastT = t;
    this.applyRotation(t);
  }
};
