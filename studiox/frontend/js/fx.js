// Live preview of the look: LUT (WebGL), zoom on the cuts and the transitions between cuts.
//
// The curves are the ones of backend/looks.py + backend/transitions.py, formula for formula (the render draws them
// with ffmpeg expressions, this file with a canvas), and the transitions' parameters come from the same catalog
// (TemplatesManager.catalog.transitions), so a change there changes both. Order of the picture, as in the render:
//   LUT -> [CSS filter of the grade preset + fine adjustments] -> zoom -> held frame of the transition
//   -> split screen -> whole-frame pulses (black/white veil) -> headline -> captions.
//
// While nothing needs it (no LUT, no zoom, the default transition) the <video> is shown as it always was: the canvas
// only takes over when there is something to draw.

const Fx = {
  MIN: 0.02,            // seconds: shortest effect (backend/transitions.py MIN_SPAN)
  EDGE: 1 / 60,         // half a frame: the first frame of a new clip counts as inside its window
  MAX_SIDE: 1280,       // longest side of the preview canvas, in pixels
  K: { altEase: 0.12, punchSettle: 0.8, blurLevels: 3 },
  mounted: false,
  _on: false,
  _layout: null,
  _lk: '',
  _fxKey: '',
  _fx: [],
  luts: new Map(),      // id -> { size, data } (RGBA8 for a 3D texture)
  _lutReq: new Map(),
  stillCv: null,
  stillFor: -1,
  _stopAt: 0,

  setConstants(c) {
    if (!c) return;
    this.K = { altEase: c.alt_ease ?? 0.12, punchSettle: c.punch_settle ?? 0.8, blurLevels: c.blur_levels ?? 3 };
  },

  // ---------------------------------------------------------------------------
  // The maths (mirror of backend/looks.py)
  // ---------------------------------------------------------------------------
  effects(tid, scale = 1) {
    const t = ((typeof TemplatesManager !== 'undefined' && TemplatesManager.catalog && TemplatesManager.catalog.transitions) || [])
      .find(x => x.id === tid);
    return (t ? t.fx : []).map(fx => {
      const o = { ...fx };
      for (const k of ['pre', 'post', 'dur']) if (k in o && o.type !== 'overlay') o[k] = Math.max(this.MIN, Math.round(o[k] * scale * 1e4) / 1e4);
      return o;
    });
  },

  // Start and length of every clip on the OUTPUT timeline, and the cuts between them
  layoutOf(clips) {
    const starts = [], lens = [];
    let acc = 0;
    for (const c of clips) {
      starts.push(acc);
      const d = Math.max(0.001, c.end - c.start);
      lens.push(d);
      acc += d;
    }
    const cuts = [];
    for (let i = 0; i < starts.length - 1; i++) cuts.push({ t: starts[i + 1], lenA: lens[i], lenB: lens[i + 1] });
    return { starts, lens, cuts };
  },

  // The zoom feature's factor at output time t
  zoomFeature(cfg, starts, lens, t) {
    let i = 0;
    for (let k = starts.length - 1; k >= 0; k--) if (t >= starts[k] - this.EDGE) { i = k; break; }
    const z = cfg.amount, s = starts[i];
    if (cfg.style === 'alternate') {
      const level = i % 2 ? z : 1;
      if (i === 0) return level;
      const prev = (i - 1) % 2 ? z : 1;
      return level + (prev - level) * Math.pow(Math.max(0, 1 - (t - s) / this.K.altEase), 3);
    }
    if (cfg.style === 'punch') return 1 + (z - 1) * Math.pow(Math.max(0, 1 - (t - s) / this.K.punchSettle), 2);
    return 1 + (z - 1) * Math.min(1, Math.max(0, (t - s) / Math.max(lens[i], 0.05)));   // push
  },

  // Bands of the stepped blur around a cut: [from, to, level], half-open, moved a quarter frame like the render's
  blurBands(fx, c) {
    const L = this.K.blurLevels, shift = 0.25 / 30;
    const pre = Math.min(fx.pre, c.lenA), post = Math.min(fx.post, c.lenB), t = c.t + shift;
    const bands = [];
    for (let k = 1; k < L; k++) {
      bands.push([t - pre * (1 - (k - 1) / L), t - pre * (1 - k / L), k]);
      bands.push([t + post * (1 - k / L), t + post * (1 - (k - 1) / L), k]);
    }
    bands.push([t - pre * (1 - (L - 1) / L), t + post * (1 - (L - 1) / L), L]);
    return bands;
  },

  // Everything that is drawn at output time t: { zoom, veil, still, rgb, blur }.
  // `effects` = one list of effects per cut (or one flat list that every cut shares: the demo)
  stateAt(effects, zoomCfg, lay, t) {
    const st = { zoom: 1, veil: null, still: null, rgb: 0, blur: 0 };
    if (zoomCfg && zoomCfg.enabled && lay.starts.length) st.zoom = this.zoomFeature(zoomCfg, lay.starts, lay.lens, t);
    let zt = 0, veilP = 0, veilColor = null;
    const L = this.K.blurLevels;
    const perCut = Array.isArray(effects[0]);
    lay.cuts.forEach((c, i) => {
      for (const fx of (perCut ? (effects[i] || []) : effects)) {
        if (fx.type === 'veil') {
          const a = Math.max(this.MIN, Math.min(fx.pre, c.lenA)), b = Math.max(this.MIN, Math.min(fx.post, c.lenB));
          veilP += t < c.t ? Math.max(0, 1 - (c.t - t) / a) : Math.max(0, 1 - (t - c.t) / b);
          veilColor = fx.color;
        } else if (fx.type === 'zoom') {
          const d = Math.min(fx.dur, c.lenB);
          if (d >= this.MIN && t >= c.t - this.EDGE) zt += fx.amount * Math.pow(Math.max(0, 1 - (t - c.t) / d), 2);
        } else if (fx.type === 'still') {
          const d = Math.min(fx.dur, c.lenB);
          if (d >= this.MIN && t >= c.t - this.EDGE && t <= c.t + d + this.EDGE) {
            st.still = { cut: i, fx, u: Math.min(1, Math.max(0, (t - c.t) / d)) };
          }
        } else if (fx.type === 'rgb') {
          if (t >= c.t - Math.min(fx.pre, c.lenA) && t <= c.t + Math.min(fx.post, c.lenB)) st.rgb = fx.amount;
        } else if (fx.type === 'blur') {
          for (const [from, to, k] of this.blurBands(fx, c)) {
            if (t >= from && t < to) st.blur = Math.max(st.blur, fx.sigma * k / L);
          }
        }
      }
    });
    if (zt) st.zoom *= 1 + zt;
    if (veilColor) st.veil = { color: veilColor, alpha: Math.min(1, veilP) };
    return st;
  },

  // ---------------------------------------------------------------------------
  // Painting (shared by the player and by the demo of the transitions)
  // ---------------------------------------------------------------------------
  _size(cv, w, h) {
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
  },

  // The follow-the-face camera: the frame scaled by `zoom`, shifted so the face lands on (centre, anchorY) without ever
  // showing the edge of the picture (backend/face_track.py draws the same with ffmpeg)
  // `win` = the part of the picture the frame really shows ({x, y, w, h} in canvas px): all of it for the original aspect
  // ratio, a vertical slice of a horizontal video in 9:16. The face is centred in THAT window, never in the whole picture.
  trackPass(live, W, H, tk, o, win) {
    o.trk = o.trk || document.createElement('canvas');
    this._size(o.trk, W, H);
    const c = o.trk.getContext('2d');
    const dw = W * tk.zoom, dh = H * tk.zoom;
    const x = Math.min(win.x, Math.max(win.x + win.w - dw, win.x + win.w * 0.5 - dw * tk.fx));
    const y = Math.min(win.y, Math.max(win.y + win.h - dh, win.y + win.h * tk.anchorY - dh * tk.fy));
    c.clearRect(0, 0, W, H);
    c.drawImage(live, x, y, dw, dh);
    return o.trk;
  },

  // Draws one frame into ctx (W x H): `live` zoomed about (centre, focus), the held frame `still` over it, then blur / RGB split
  paint(ctx, W, H, live, still, st, o) {
    const win = o.win || { x: 0, y: 0, w: W, h: H };
    if (st.track) live = this.trackPass(live, W, H, st.track, o, win);
    const post = st.blur > 0 || st.rgb > 0;
    let dst = ctx;
    if (post) {
      o.work = o.work || document.createElement('canvas');
      this._size(o.work, W, H);
      dst = o.work.getContext('2d');
    }
    dst.globalAlpha = 1;
    dst.filter = 'none';
    dst.globalCompositeOperation = 'source-over';
    dst.clearRect(0, 0, W, H);
    const z = st.zoom, dw = W * z, dh = H * z;
    const px = win.x + win.w * 0.5, py = win.y + win.h * o.focus;   // the zoom pivots on the visible frame
    dst.drawImage(live, px * (1 - z), py * (1 - z), dw, dh);
    if (still && st.still) {
      const { fx, u } = st.still, ref = Math.min(win.w, win.h) / 1080;
      dst.save();
      if (fx.mode === 'fade') {
        dst.globalAlpha = 1 - u;
        dst.drawImage(still, 0, 0, W, H);
      } else {
        const p = u * u, dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[fx.dir] || [-1, 0];
        if (fx.blur > 0) dst.filter = `blur(${(fx.blur * ref).toFixed(2)}px)`;   // the render blurs along the motion only
        dst.drawImage(still, dir[0] * win.w * p, dir[1] * win.h * p, W, H);
      }
      dst.restore();
    }
    if (!post) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (st.blur > 0) {
      ctx.filter = `blur(${(st.blur * Math.min(win.w, win.h) / 1080).toFixed(2)}px)`;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(o.work, 0, 0);
    } else {
      const shift = Math.max(2, Math.round(st.rgb * win.w));
      o.ch = o.ch || [0, 1, 2].map(() => document.createElement('canvas'));
      const cols = ['#ff0000', '#00ff00', '#0000ff'];
      o.ch.forEach((cv, i) => {
        this._size(cv, W, H);
        const c = cv.getContext('2d');
        c.globalCompositeOperation = 'source-over';
        c.clearRect(0, 0, W, H);
        c.drawImage(o.work, 0, 0);
        c.globalCompositeOperation = 'multiply';   // keeps one channel
        c.fillStyle = cols[i];
        c.fillRect(0, 0, W, H);
      });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';    // adds the three channels back, red and blue moved apart
      ctx.drawImage(o.ch[0], -shift, 0);
      ctx.drawImage(o.ch[1], 0, 0);
      ctx.drawImage(o.ch[2], shift, 0);
    }
    ctx.restore();
  },

  // ---------------------------------------------------------------------------
  // LUT (WebGL2): the video frame goes through a 3D texture of the .cube
  // ---------------------------------------------------------------------------
  parseCube(text) {
    let size = 0;
    const rgb = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      const c = line.charCodeAt(0);
      if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
        const p = line.split(/\s+/);
        rgb.push(parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]));
      } else if (/^LUT_3D_SIZE/i.test(line)) size = parseInt(line.split(/\s+/)[1], 10);
    }
    if (!size || rgb.length !== size * size * size * 3) throw new Error('LUT inválido');
    const data = new Uint8Array(size * size * size * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      data[j] = Math.round(Math.min(1, Math.max(0, rgb[i])) * 255);
      data[j + 1] = Math.round(Math.min(1, Math.max(0, rgb[i + 1])) * 255);
      data[j + 2] = Math.round(Math.min(1, Math.max(0, rgb[i + 2])) * 255);
      data[j + 3] = 255;
    }
    return { size, data };
  },

  // Fetches and parses a LUT (once); resolves to false when the browser cannot draw it
  loadLut(id) {
    if (!id) return Promise.resolve(false);
    if (this.luts.has(id)) return Promise.resolve(true);
    if (this._lutReq.has(id)) return this._lutReq.get(id);
    const req = fetch(`/studiox/api/luts/${encodeURIComponent(id)}/cube`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(t => { this.luts.set(id, this.parseCube(t)); return true; })
      .catch(err => { console.warn('LUT preview unavailable:', err); return false; })
      .finally(() => this._lutReq.delete(id));
    this._lutReq.set(id, req);
    return req;
  },

  _glInit() {
    if (this._gl !== undefined) return this._gl;
    this._gl = null;
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) return null;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
        out vec2 vUv;
        void main() {
          vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
          vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }`));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; precision highp sampler3D;
        uniform sampler2D uVideo; uniform sampler3D uLut; uniform float uSize; uniform float uMix;
        in vec2 vUv; out vec4 o;
        void main() {
          vec3 c = texture(uVideo, vUv).rgb;
          vec3 p = c * ((uSize - 1.0) / uSize) + 0.5 / uSize;   // centres of the texels: the corners of the cube
          o = vec4(mix(c, texture(uLut, p).rgb, uMix), 1.0);
        }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const tex = (unit, target) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(target, t);
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return t;
      };
      this._gl = { cv, gl, prog, vtex: tex(0, gl.TEXTURE_2D), ltex: tex(1, gl.TEXTURE_3D), lutId: null,
                   u: { video: gl.getUniformLocation(prog, 'uVideo'), lut: gl.getUniformLocation(prog, 'uLut'),
                        size: gl.getUniformLocation(prog, 'uSize'), mix: gl.getUniformLocation(prog, 'uMix') } };
      gl.uniform1i(this._gl.u.video, 0);
      gl.uniform1i(this._gl.u.lut, 1);
    } catch (err) {
      console.warn('WebGL2 unavailable, LUT preview off:', err);
      this._gl = null;
    }
    return this._gl;
  },

  lutReady() {
    const l = Looks.state.lut;
    return !!(l.id && l.intensity > 0.005 && this.luts.has(l.id) && this._glInit());
  },

  // The frame through the LUT, as a canvas the size of the preview
  lutPass(video, W, H) {
    const g = this._gl, gl = g.gl, l = Looks.state.lut;
    this._size(g.cv, W, H);
    gl.viewport(0, 0, W, H);
    if (g.lutId !== l.id) {
      const d = this.luts.get(l.id);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, g.ltex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);   // WebGL2 rejects a flip on 3D textures
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, d.size, d.size, d.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.data);
      gl.uniform1f(g.u.size, d.size);
      g.lutId = l.id;
    }
    gl.uniform1f(g.u.mix, l.intensity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.vtex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return g.cv;
  },

  // ---------------------------------------------------------------------------
  // The player's canvas
  // ---------------------------------------------------------------------------
  mount() {
    if (this.mounted) return;
    const v = document.getElementById('main-video');
    if (!v) return;
    this.mounted = true;
    const cv = this.canvas = document.createElement('canvas');
    cv.id = 'fx-canvas';
    cv.className = 'fx-canvas hidden';
    v.insertAdjacentElement('afterend', cv);
    const veil = this.veilEl = document.createElement('div');
    veil.id = 'fx-veil';
    veil.className = 'fx-veil hidden';
    cv.insertAdjacentElement('afterend', veil);
    const ov = this.ovCanvas = document.createElement('canvas');
    ov.id = 'fx-overlay';
    ov.className = 'fx-overlay hidden';
    veil.insertAdjacentElement('afterend', ov);
    this.ctx = cv.getContext('2d');
    this._paintOpts = { focus: 0.4 };
    // The split screen and the grade write clip-path / transform / filter on the <video>: the canvas copies them
    new MutationObserver(() => this.mirrorStyle()).observe(v, { attributes: true, attributeFilter: ['style'] });
    v.addEventListener('loadedmetadata', () => this.refresh());
    v.addEventListener('pause', () => { this._stopAt = 0; });
  },

  mirrorStyle() {
    const v = Player.video, cv = this.canvas;
    if (!v || !cv) return;
    cv.style.filter = v.style.filter;
    cv.style.clipPath = v.style.clipPath;
    cv.style.transform = v.style.transform;
    // js/canvasframe.js positions the video (aspect ratio + scale/position) with these, not `transform`
    cv.style.left = v.style.left;
    cv.style.top = v.style.top;
    cv.style.width = v.style.width;
    cv.style.height = v.style.height;
  },

  // The effects of every cut: one list per cut (cached; the transition chosen for the video, the ones chosen for single
  // cuts and the durations change rarely). Cut i is the one between clip i and clip i + 1.
  effectsNow() {
    const clips = Timeline.clips || [];
    const key = `${clips.map(c => c.start).join(',')}|${TemplatesManager.selectedTransition}|${Looks.state.transitionScale}|${Transitions.version}`;
    if (key !== this._fxKey) { this._fxKey = key; this._fx = clips.slice(1).map(c => Transitions.resolveCut(c.start).effects); }
    return this._fx;
  },

  // Effects the canvas draws (imported overlays have their own layer)
  hasCanvasEffects() {
    return this.effectsNow().some(list => list.some(fx => fx.type !== 'overlay'));
  },

  wantCanvas() {
    return this.lutReady() || Looks.state.zoom.enabled || this.hasCanvasEffects() || FaceTrack.wanted();
  },

  // ---------------------------------------------------------------------------
  // Imported overlays (backend/looks.py::overlay_plan): a video or a PNG laid over the cut
  // ---------------------------------------------------------------------------
  _ov: new Map(),          // media id -> { el, info, key }

  _ovMedia(id) {
    let m = this._ov.get(id);
    if (m) return m;
    const info = Transitions.mediaInfo(id);
    if (!info) return null;
    let el;
    if (info.kind === 'image') {
      el = new Image();
      el.addEventListener('load', () => this.refresh());
    } else {
      el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.addEventListener('seeked', () => this.refresh());
      el.addEventListener('loadeddata', () => this.refresh());
    }
    el.src = info.url;
    m = { el, info, key: null };
    this._ov.set(id, m);
    return m;
  },

  _overlayList(perCut, lay) {
    const out = [];
    perCut.forEach((list, i) => {
      const c = lay.cuts[i];
      if (!c) return;
      for (const fx of list) {
        if (fx.type !== 'overlay') continue;
        const start = fx.align === 'start' ? c.t : fx.align === 'end' ? c.t - fx.dur : c.t - fx.dur / 2;
        out.push({ fx, start: Math.max(0, start), cut: i });
      }
    });
    return out;
  },

  // Draws one overlay into ctx (W x H), `cover`-fitted, keyed by its mode; returns false while the file is not ready
  _drawOverlay(ctx, W, H, e, t, playing) {
    const m = this._ovMedia(e.fx.media);
    if (!m) return false;
    const el = m.el, isVideo = m.info.kind !== 'image';
    const local = Math.max(0, Math.min(t - e.start, e.fx.dur));
    if (isVideo) {
      if (el.readyState < 2) return false;
      const dur = Math.max(0.05, (m.info.duration || e.fx.dur) - 0.04);
      const want = Math.min(local, dur);
      if (playing) {
        if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.03) el.currentTime = want;
      }
    } else if (!el.complete || !el.naturalWidth) return false;
    const vw = isVideo ? el.videoWidth : el.naturalWidth, vh = isVideo ? el.videoHeight : el.naturalHeight;
    if (!vw || !vh) return false;
    const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k;
    let alpha = 1;
    if (e.fx.fade > 0) {
      const f = Math.max(0.03, Math.min(e.fx.dur / 2, e.fx.fade * e.fx.dur));
      alpha = Math.max(0, Math.min(1, local / f, (e.fx.dur - local) / f));
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.fx.mode === 'green') {
      const kw = Math.min(480, Math.round(W)), kh = Math.max(2, Math.round(kw * dh / dw));
      m.key = m.key || document.createElement('canvas');
      this._size(m.key, kw, kh);
      const kc = m.key.getContext('2d', { willReadFrequently: true });
      kc.drawImage(el, 0, 0, kw, kh);
      const img = kc.getImageData(0, 0, kw, kh), d = img.data;
      for (let p = 0; p < d.length; p += 4) {
        const diff = d[p + 1] - Math.max(d[p], d[p + 2]);
        if (diff > 25) d[p + 3] = diff > 70 ? 0 : Math.round((70 - diff) / 45 * d[p + 3]);
      }
      kc.putImageData(img, 0, 0);
      ctx.drawImage(m.key, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      if (e.fx.mode === 'screen' && ctx.canvas.dataset.blend !== 'css') ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    ctx.restore();
    return true;
  },

  _pauseOverlays(except) {
    for (const [id, m] of this._ov) if (!except.has(id) && m.info.kind !== 'image' && !m.el.paused) m.el.pause();
  },

  // The overlay layer of the player: only exists while an overlay is on screen
  overlayTick(t) {
    const cv = this.ovCanvas;
    if (!cv) return;
    const lay = this._layout;
    const active = lay ? this._overlayList(this.effectsNow(), lay).filter(e => t >= e.start - 0.001 && t <= e.start + e.fx.dur) : [];
    if (!active.length) {
      if (!cv.classList.contains('hidden')) cv.classList.add('hidden');
      this._pauseOverlays(new Set());
      return;
    }
    const box = cv.parentElement;
    const W = Math.max(2, Math.round(Math.min(box.clientWidth, 960))), H = Math.max(2, Math.round(W * box.clientHeight / Math.max(1, box.clientWidth)));
    this._size(cv, W, H);
    const allScreen = active.every(e => e.fx.mode === 'screen');
    cv.style.mixBlendMode = allScreen ? 'screen' : '';
    cv.dataset.blend = allScreen ? 'css' : '';
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const playing = !!(Player.video && !Player.video.paused);
    let drawn = false;
    for (const e of active) drawn = this._drawOverlay(ctx, W, H, e, t, playing) || drawn;
    cv.classList.toggle('hidden', !drawn);
    this._pauseOverlays(new Set(active.map(e => e.fx.media)));
  },

  // ---------------------------------------------------------------------------
  // The sound of the cuts: played while the video plays, when the playhead crosses where the sound starts
  // ---------------------------------------------------------------------------
  _lastOut: -1,
  _sfxAudio: new Map(),

  playSound(id, volume) {
    const url = Transitions.soundUrl(id);
    if (!url) return;
    let a = this._sfxAudio.get(id);
    if (!a) { a = new Audio(url); a.preload = 'auto'; this._sfxAudio.set(id, a); }
    const one = a.cloneNode();
    one.volume = Math.max(0, Math.min(1, volume));
    one.play().catch(() => {});
  },

  soundTick(t) {
    const prev = this._lastOut;
    this._lastOut = t;
    const v = Player.video;
    if (!v || v.paused || prev < 0 || t < prev || t - prev > 0.35) return;   // only normal forward playback
    const lay = this._layout;
    if (!lay) return;
    lay.cuts.forEach((c, i) => {
      const clip = (Timeline.clips || [])[i + 1];
      const snd = clip && Transitions.resolveCut(clip.start).sound;
      if (!snd) return;
      const start = c.t - Transitions.peakOf(snd.id) + snd.offset;
      if (prev < start && t >= start) this.playSound(snd.id, snd.volume);
    });
  },

  show() {
    this._on = true;
    this.canvas.classList.remove('hidden');
    Player.video.style.opacity = '0';
    this.mirrorStyle();
  },

  hide() {
    this._on = false;
    this.canvas.classList.add('hidden');
    this.veilEl.classList.add('hidden');
    if (Player.video) Player.video.style.opacity = '';
  },

  // Output-timeline position of the video's current source time (own mapping: it works in both timeline modes)
  outTime() {
    const clips = Timeline.clips || [], lay = this._layout;
    if (!lay || !clips.length) return 0;
    const t = Player.video.currentTime;
    const i = Timeline.clipIndexAtSource(t);
    if (i < 0) return 0;
    return lay.starts[i] + Math.max(0, Math.min(t - clips[i].start, lay.lens[i]));
  },

  // Source time of an output time
  srcTime(out) {
    const clips = Timeline.clips || [], lay = this._layout;
    if (!lay || !clips.length) return 0;
    let i = 0;
    for (let k = lay.starts.length - 1; k >= 0; k--) if (out >= lay.starts[k]) { i = k; break; }
    return clips[i].start + Math.min(out - lay.starts[i], lay.lens[i]);
  },

  layout() {
    const clips = Timeline.clips || [];
    const key = clips.map(c => `${c.start}:${c.end}`).join('|');
    if (key !== this._lk || !this._layout) { this._lk = key; this._layout = this.layoutOf(clips); }
    return this._layout;
  },

  // Called by the player at every tick (playing, seeking, paused)
  sync() {
    if (!this.mounted) return;
    this.layout();
    this.soundTick(this.outTime());
    this.overlayTick(this.outTime());
    if (!this.wantCanvas()) {
      if (this._on) this.hide();
      return;
    }
    const v = Player.video;
    if (!v || !v.videoWidth || v.readyState < 2) return;
    if (!this._on) this.show();
    const s = Math.min(1, this.MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const W = Math.round(v.videoWidth * s), H = Math.round(v.videoHeight * s);
    this._size(this.canvas, W, H);

    const lay = this.layout();
    const t = this.outTime();
    const st = this.stateAt(this.effectsNow(), Looks.state.zoom, lay, t);
    st.track = FaceTrack.stateAt(v.currentTime);   // the follow-the-face camera (source time)
    const live = this.lutReady() ? this.lutPass(v, W, H) : v;
    const still = st.still && this.stillFor === st.still.cut ? this.stillCv : null;
    this._paintOpts.focus = Looks.state.zoom.focus;
    this._paintOpts.win = this.visibleWindow(W, H);
    this.paint(this.ctx, W, H, live, still, st, this._paintOpts);
    this.paintVeil(st.veil);

    if (this._stopAt && t >= this._stopAt) {
      this._stopAt = 0;
      v.pause();
    }
  },

  // The part of the video's canvas that the chosen frame (e.g. 9:16) really shows, in canvas px. The video is laid out
  // "cover" over the frame (js/canvasframe.js::videoBox), so with another aspect ratio only a slice of it is visible and
  // zoom, held frames, blur and the face camera have to work on that slice, as the render does on the framed picture.
  visibleWindow(W, H) {
    const b = typeof CanvasFrame !== 'undefined' ? CanvasFrame.videoBox() : null;
    if (!b || !b.dw || !b.dh) return { x: 0, y: 0, w: W, h: H };
    const x = Math.max(0, -b.x0 / b.dw * W), y = Math.max(0, -b.y0 / b.dh * H);
    return { x, y, w: Math.min(W - x, b.cw / b.dw * W), h: Math.min(H - y, b.ch / b.dh * H) };
  },

  paintVeil(veil) {
    const el = this.veilEl;
    if (!veil || veil.alpha < 0.002) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.style.background = veil.color;
    el.style.opacity = String(veil.alpha);
  },

  refresh() {
    if (!this.mounted) return;
    this._fxKey = '';
    this.sync();
  },

  // The player is about to jump from the clip `clipIndex` to the next one: keep its last frame for the transition
  beforeJump(clipIndex) {
    if (!this._on || !(this.effectsNow()[clipIndex] || []).some(fx => fx.type === 'still')) return;
    this.stillCv = this.stillCv || document.createElement('canvas');
    this._size(this.stillCv, this.canvas.width, this.canvas.height);
    this.stillCv.getContext('2d').drawImage(this.canvas, 0, 0);
    this.stillFor = clipIndex;
  },

  // Plays the stretch around a cut so the transition can be judged on the real video
  previewCut(index) {
    const lay = this.layout();
    if (!lay.cuts.length) {
      App.showToast('Para ver a transição são precisos pelo menos 2 cortes na timeline.', 'warning');
      return;
    }
    const now = this.outTime();
    const cut = Number.isInteger(index) && lay.cuts[index] ? lay.cuts[index] : (lay.cuts.find(c => c.t > now + 0.05) || lay.cuts[0]);
    const fx = this.effectsNow()[lay.cuts.indexOf(cut)] || [];
    const tail = Math.max(0.5, ...fx.map(f => f.dur || f.post || 0)) + 0.8;
    this._stopAt = cut.t + tail;
    const from = Math.max(0, cut.t - 1.2);
    Player.seek(this.srcTime(from));
    if (Player.video.paused) Player.video.play().catch(() => {});
    this.refresh();
  },

  // ---------------------------------------------------------------------------
  // Demo of a transition (the big preview in the Transições tab): two invented shots and one cut
  // ---------------------------------------------------------------------------
  DEMO_CUT: 1.4,
  _demoFrames(w, h) {
    const key = `${w}x${h}`;
    if (this._df && this._df.key === key) return this._df;
    const make = (hueA, hueB, label) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, hueA);
      g.addColorStop(1, hueB);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.14)';
      for (let i = 0; i < 6; i++) c.fillRect(0, (h / 6) * i, w, 1);
      const cx = w / 2, cy = h * 0.48, r = Math.min(w, h) * 0.2;
      c.fillStyle = 'rgba(15,23,42,.55)';
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();                       // head
      c.beginPath(); c.ellipse(cx, cy + r * 2.1, r * 1.6, r * 1.15, 0, Math.PI, 0, true); c.fill();   // shoulders
      c.fillStyle = '#fff';
      c.font = `700 ${Math.round(Math.min(w, h) * 0.34)}px Sora, Geist, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, cx, h * 0.2 + r * 0.2);
      return cv;
    };
    this._df = { key, a: make('#1F5FBF', '#4C9BFF', 'A'), b: make('#A00B5B', '#EC1889', 'B') };
    return this._df;
  },

  // A controller for one <canvas>: show(tid, scale) loops that transition; poster() draws it frozen just after the cut
  demo(canvas, veilEl) {
    const self = this;
    const o = { focus: 0.4 };
    const T = this.DEMO_CUT;
    const lay = { starts: [0, T], lens: [T, T], cuts: [{ t: T, lenA: T, lenB: T }] };
    let raf = 0, tid = null, scale = 1;
    const fxList = () => Array.isArray(tid) ? tid : self.effects(tid, scale);   // an id of the catalog, or the effects themselves
    const frame = (t) => {
      const w = canvas.width, h = canvas.height, f = self._demoFrames(w, h);
      const list = fxList();
      const st = self.stateAt(list, { enabled: false }, lay, t);
      self.paint(canvas.getContext('2d'), w, h, t < T ? f.a : f.b, f.a, st, o);
      const entries = self._overlayList([list], { cuts: [{ t: T }] }).filter(e => t >= e.start && t <= e.start + e.fx.dur);
      for (const e of entries) self._drawOverlay(canvas.getContext('2d'), w, h, e, t, true);
      if (!entries.length) self._pauseOverlays(new Set());
      if (veilEl) {
        const v = st.veil;
        veilEl.style.background = v ? v.color : 'transparent';
        veilEl.style.opacity = v ? String(v.alpha) : '0';
      }
    };
    const span = () => Math.max(0.5, ...fxList().map(f => f.dur || f.post || 0)) + 0.35;
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    return {
      show(id, s = 1) {
        stop();
        tid = id; scale = s;
        const t0 = performance.now(), from = T - 0.7, len = 0.7 + span() + 0.5;
        const tick = () => {
          const el = ((performance.now() - t0) / 1000) % (len + 0.4);
          frame(from + Math.min(el, len));
          raf = requestAnimationFrame(tick);
        };
        tick();
      },
      poster(id, s = 1) { stop(); tid = id; scale = s; frame(T + Math.min(0.12, span() / 3)); },
      stop
    };
  }
};
