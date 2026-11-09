// Face tracking ("câmera que segue o rosto"): the panel of the Rastrear tab and the camera of the live preview.
//
// The server (backend/face_track.py) finds the faces once per video and builds the SMOOTHED camera path; this file asks
// for that same path, so the preview moves exactly like the render. The camera is a zoom + pan: the picture is scaled by
// `zoom` and shifted so the face sits on (centre, anchor_y), never showing the edge of the picture. Fx (js/fx.js) draws it.
//
// Saved with the project (edit.track). Which cuts follow the face is kept as SOURCE-time ranges, so splitting or
// moving cuts later keeps the choice (a cut follows when its middle falls inside a range).

const FaceTrack = {
  DEFAULTS: { enabled: false, mode: 'all', ranges: [], zoom: 1.35, smooth: 0.5, anchor_y: 0.45, seed: null },
  state: null,
  projectId: null,
  info: { available: true, status: 'none', progress: 0, error: '', analyzed: false, faces_found: 0 },
  path: null,            // { fps, t, x, y } smoothed camera, source time
  _pathKey: '',
  _pathReq: 0,
  _poll: 0,
  _refetch: 0,
  picking: false,

  $(id) { return document.getElementById(id); },

  clean(src) {
    const s = src && typeof src === 'object' ? src : {};
    const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const D = this.DEFAULTS;
    const ranges = (Array.isArray(s.ranges) ? s.ranges : [])
      .map(r => [Number(r && r[0]), Number(r && r[1])]).filter(r => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] - r[0] > 0.01)
      .map(r => [Math.round(Math.max(0, r[0]) * 1000) / 1000, Math.round(r[1] * 1000) / 1000]);
    const seed = s.seed && [s.seed.t, s.seed.x, s.seed.y].every(v => Number.isFinite(Number(v)))
      ? { t: Number(s.seed.t), x: Number(s.seed.x), y: Number(s.seed.y) } : null;
    return {
      enabled: !!s.enabled, mode: s.mode === 'ranges' ? 'ranges' : 'all', ranges,
      zoom: num(s.zoom, 1.05, 2.5, D.zoom), smooth: num(s.smooth, 0, 1, D.smooth), anchor_y: num(s.anchor_y, 0.25, 0.65, D.anchor_y), seed
    };
  },

  exportConfig() { return JSON.parse(JSON.stringify(this.state || this.clean(null))); },

  // From a saved edit (nothing saved = off)
  applyExternal(src) {
    this.state = this.clean(src);
    this.path = null;
    this._pathKey = '';
    this.paint();
    this.refresh();
  },

  init() {
    this.state = this.clean(null);
    this.bind();
    this.paint();
  },

  // A project was opened: look at what the server knows about its analysis
  async attach(projectId) {
    this.projectId = projectId;
    this.path = null;
    this._pathKey = '';
    this.picking = false;
    clearTimeout(this._poll);
    await this.fetchPath(true);
    if (this.info.status === 'running') this.pollAnalysis();
    this.paint();
  },

  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------
  async fetchPath(force = false) {
    if (!this.projectId) return;
    const s = this.state;
    const seed = s.seed ? `&seed_t=${s.seed.t}&seed_x=${s.seed.x}&seed_y=${s.seed.y}` : '';
    const key = `${this.projectId}|${s.smooth}|${s.seed ? [s.seed.t, s.seed.x, s.seed.y].join(',') : ''}`;
    if (!force && key === this._pathKey && this.path) return;
    const req = ++this._pathReq;
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/track?smooth=${s.smooth}${seed}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (req !== this._pathReq) return;
      this.info = { available: data.available, status: data.status, progress: data.progress, error: data.error,
                    analyzed: data.analyzed, faces_found: data.faces_found };
      this.path = data.path || null;
      this._pathKey = key;
    } catch (err) {
      console.warn('Face track unavailable:', err);
      if (req === this._pathReq) this.info = { ...this.info, available: false, error: String(err.message || err) };
    }
    this.refresh();
  },

  async analyze() {
    if (!this.projectId) return;
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/track/analyze`, { method: 'POST' });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
        throw new Error(detail);
      }
      const data = await res.json();
      this.info = { ...this.info, status: data.status, progress: data.progress, error: '' };
      this.paint();
      this.pollAnalysis();
    } catch (err) {
      this.info = { ...this.info, status: 'error', error: err.message };
      this.paint();
    }
  },

  pollAnalysis() {
    clearTimeout(this._poll);
    this._poll = setTimeout(async () => {
      await this.fetchPath(true);
      if (this.info.status === 'running') this.pollAnalysis();
      else if (this.info.status === 'done') App.showToast('Rosto analisado: a câmera já pode seguir.', 'success');
      else if (this.info.status === 'error') App.showToast(`Análise do rosto falhou: ${this.info.error}`, 'error');
      this.paint();
    }, 700);
  },

  // ---------------------------------------------------------------------------
  // The camera (preview). Same maths as backend/face_track.py: scale by zoom, pan so the face lands on (0.5, anchor_y)
  // ---------------------------------------------------------------------------
  wanted() { return !!(this.state && this.state.enabled && this.path && this.path.t.length); },

  clipActive(clip) {
    const s = this.state;
    if (s.mode === 'all') return true;
    const mid = (clip.start + clip.end) / 2;
    return s.ranges.some(r => r[0] <= mid && mid <= r[1]);
  },

  // { fx, fy, zoom, anchorY } for the video's source time t, or null when the camera is not on there
  stateAt(t) {
    if (!this.wanted() || this.picking) return null;
    const clips = (typeof Timeline !== 'undefined' && Timeline.clips) || [];
    if (this.state.mode === 'ranges') {
      const i = Timeline.clipIndexAtSource(t);
      if (i < 0 || !this.clipActive(clips[i])) return null;
    }
    const p = this.path;
    const pos = Math.min(p.t.length - 1, Math.max(0, t * p.fps));
    const i0 = Math.floor(pos), i1 = Math.min(p.t.length - 1, i0 + 1), u = pos - i0;
    return { fx: p.x[i0] + (p.x[i1] - p.x[i0]) * u, fy: p.y[i0] + (p.y[i1] - p.y[i0]) * u,
             zoom: this.state.zoom, anchorY: this.state.anchor_y };
  },

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  bind() {
    const on = (id, ev, fn) => this.$(id) && this.$(id).addEventListener(ev, fn);
    on('track-enabled', 'change', e => {
      this.state.enabled = e.target.checked;
      if (this.state.enabled && this.projectId && !this.info.analyzed && this.info.status !== 'running') this.analyze();
      this.changed();
    });
    on('track-analyze', 'click', () => this.analyze());
    this.$('track-mode')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      this.state.mode = b.dataset.mode;
      if (this.state.mode === 'ranges' && !this.state.ranges.length) this.addSelectedClip();   // start from the cut being looked at
      this.changed();
    });
    on('track-add', 'click', () => this.addSelectedClip());
    on('track-remove', 'click', () => this.removeSelectedClip());
    on('track-zoom', 'input', e => { this.state.zoom = 1 + parseInt(e.target.value, 10) / 100; this.changed(); });
    on('track-anchor', 'input', e => { this.state.anchor_y = parseInt(e.target.value, 10) / 100; this.changed(); });
    on('track-smooth', 'input', e => {
      this.state.smooth = parseInt(e.target.value, 10) / 100;
      this.changed();
      clearTimeout(this._refetch);
      this._refetch = setTimeout(() => this.fetchPath(), 250);   // the smoothing is done by the server
    });
    on('track-pick', 'click', () => this.togglePick());
    on('track-auto', 'click', () => { this.state.seed = null; this.paint(); this.fetchPath(); });
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.tab !== 'tab-track') this.stopPick();
      setTimeout(() => this.paint(), 0);
    }));
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.timeline-tray')) setTimeout(() => this.paintClipInfo(), 0); });
  },

  changed() {
    this.paint();
    this.refresh();
  },

  refresh() {
    if (typeof Fx !== 'undefined') Fx.refresh();
  },

  selectedClip() {
    const clips = (typeof Timeline !== 'undefined' && Timeline.clips) || [];
    return clips.find(c => c.id === Timeline.selectedClipId) || null;
  },

  addSelectedClip() {
    const c = this.selectedClip();
    if (!c) { App.showToast('Selecione um corte na timeline primeiro.', 'warning'); return; }
    this.state.ranges = this.merge([...this.state.ranges, [c.start, c.end]]);
    this.state.mode = 'ranges';
    this.changed();
  },

  removeSelectedClip() {
    const c = this.selectedClip();
    if (!c) { App.showToast('Selecione um corte na timeline primeiro.', 'warning'); return; }
    const out = [];
    for (const [a, b] of this.state.ranges) {
      if (b <= c.start || a >= c.end) { out.push([a, b]); continue; }
      if (a < c.start) out.push([a, c.start]);
      if (b > c.end) out.push([c.end, b]);
    }
    this.state.ranges = this.merge(out);
    this.changed();
  },

  merge(ranges) {
    const sorted = ranges.map(r => [Math.round(r[0] * 1000) / 1000, Math.round(r[1] * 1000) / 1000]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of sorted) {
      if (out.length && r[0] <= out[out.length - 1][1] + 0.002) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
      else out.push([...r]);
    }
    return out;
  },

  // ---------------------------------------------------------------------------
  // Pick the person to follow: boxes over the faces seen at the current moment
  // ---------------------------------------------------------------------------
  async togglePick() {
    if (this.picking) { this.stopPick(); return; }
    if (!this.info.analyzed) { App.showToast('Analise o rosto primeiro.', 'warning'); return; }
    Player.video.pause();
    this.picking = true;
    this.refresh();            // the picture goes back to the original framing so the boxes land on the faces
    this.paint();
    await this.drawPick();
  },

  stopPick() {
    if (!this.picking && !this.pickLayer) return;
    this.picking = false;
    if (this.pickLayer) { this.pickLayer.remove(); this.pickLayer = null; }
    this.refresh();
    this.paint();
  },

  async drawPick() {
    const t = Player.video.currentTime;
    let faces = [];
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/track/faces?t=${t}`);
      faces = (await res.json()).faces || [];
    } catch (err) { /* nothing to draw */ }
    if (!this.picking) return;
    const wrap = this.$('video-container');
    const v = Player.video;
    const wr = wrap.getBoundingClientRect(), vr = v.getBoundingClientRect();
    if (!this.pickLayer) {
      this.pickLayer = document.createElement('div');
      this.pickLayer.className = 'track-pick-layer';
      wrap.appendChild(this.pickLayer);
    }
    const layer = this.pickLayer;
    layer.style.cssText = `left:${vr.left - wr.left}px;top:${vr.top - wr.top}px;width:${vr.width}px;height:${vr.height}px`;
    layer.innerHTML = faces.length ? '' : '<div class="track-pick-empty">Nenhum rosto neste momento: mova o vídeo para um ponto em que a pessoa apareça.</div>';
    for (const [cx, cy, h] of faces) {
      const bh = h * 1.25, bw = h * (vr.height / vr.width) * 1.0;
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'track-pick-box';
      box.title = 'Seguir esta pessoa';
      box.style.cssText = `left:${(cx - bw / 2) * 100}%;top:${(cy - bh / 2) * 100}%;width:${bw * 100}%;height:${bh * 100}%`;
      box.addEventListener('click', () => this.pickFace(t, cx, cy));
      layer.appendChild(box);
    }
  },

  async pickFace(t, x, y) {
    this.state.seed = { t: Math.round(t * 1000) / 1000, x, y };
    this.stopPick();
    await this.fetchPath(true);
    App.showToast('A câmera agora segue a pessoa escolhida.', 'success');
    this.paint();
  },

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------
  paint() {
    if (!this.state || !this.$('tab-track')) return;
    const $ = id => this.$(id);
    const s = this.state, info = this.info;
    $('track-enabled').checked = s.enabled;
    $('track-cfg').classList.toggle('hidden', !s.enabled);

    let msg;
    if (!info.available) msg = 'O rastreador de rosto não está disponível nesta instalação.';
    else if (!this.projectId) msg = 'Abra um vídeo para analisar.';
    else if (info.status === 'running') msg = `Procurando o rosto no vídeo… ${Math.round((info.progress || 0) * 100)}%`;
    else if (info.status === 'error') msg = `A análise falhou: ${info.error}`;
    else if (info.analyzed && !this.path) msg = 'Nenhum rosto foi encontrado neste vídeo.';
    else if (info.analyzed) msg = `✓ Rosto encontrado em ${Math.round((this.path.coverage || 0) * 100)}% do vídeo.`;
    else msg = 'O vídeo ainda não foi analisado. É feito uma vez só e leva poucos segundos.';
    $('track-status').textContent = msg;
    $('track-status').className = `track-status ${info.status === 'error' || !info.available ? 'error' : (info.analyzed ? 'ok' : '')}`;
    const bar = $('track-progress');
    bar.classList.toggle('hidden', info.status !== 'running');
    bar.firstElementChild.style.width = `${Math.round((info.progress || 0) * 100)}%`;
    const btn = $('track-analyze');
    btn.disabled = !info.available || !this.projectId || info.status === 'running';
    btn.textContent = info.analyzed ? '↻ Analisar de novo' : '🔍 Analisar rosto';

    document.querySelectorAll('#track-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
    $('track-ranges').classList.toggle('hidden', s.mode !== 'ranges');
    $('track-zoom').value = Math.round((s.zoom - 1) * 100);
    $('track-zoom-val').textContent = `+${Math.round((s.zoom - 1) * 100)}%`;
    $('track-smooth').value = Math.round(s.smooth * 100);
    $('track-smooth-val').textContent = s.smooth < 0.25 ? 'acompanha tudo' : (s.smooth > 0.75 ? 'bem suave' : 'suave');
    $('track-anchor').value = Math.round(s.anchor_y * 100);
    $('track-anchor-val').textContent = s.anchor_y < 0.4 ? 'mais no alto' : (s.anchor_y > 0.55 ? 'mais embaixo' : 'no meio');
    $('track-pick').textContent = this.picking ? 'Cancelar escolha' : '👤 Escolher a pessoa no vídeo';
    $('track-pick').classList.toggle('active', this.picking);
    $('track-auto').hidden = !s.seed;
    $('track-who').textContent = s.seed ? 'Seguindo a pessoa que você escolheu.' : 'Seguindo o maior rosto do vídeo.';
    this.paintClipInfo();
  },

  paintClipInfo() {
    const el = this.$('track-ranges-info');
    if (!el || !this.state) return;
    const clips = (typeof Timeline !== 'undefined' && Timeline.clips) || [];
    const on = clips.filter(c => this.clipActive(c)).length;
    const sel = this.selectedClip();
    const here = sel ? (this.clipActive(sel) ? 'O corte selecionado está LIGADO.' : 'O corte selecionado está desligado.') : 'Selecione um corte na timeline.';
    el.textContent = `Ligado em ${on} de ${clips.length} corte(s). ${here}`;
  }
};
