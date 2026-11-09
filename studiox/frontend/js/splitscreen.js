// Split screen: the speaker keeps one half of the frame, an image or video fills the other half, for the whole
// video or only for chosen scenes. Media comes from the project's library: files the user uploads, or pictures
// and clips made by an AI provider (OpenAI, with the key saved in Configurações). The render is done by
// backend/split_screen.py; the preview here does the same layout with CSS.
//
// Times are on the OUTPUT timeline (after the cuts), like the headline's "Aparece em".

const SplitScreen = {
  MODES: ['off', 'full', 'scenes'],
  LAYOUTS: ['top', 'bottom', 'left', 'right'],
  cfg: { mode: 'off', layout: 'top', ratio: 0.5, focus: 0.3, media_ids: [], items: [], keep: {} },
  media: [],
  ai: { openai: false, image_models: [], video_models: [], video_seconds: ['4', '8', '12'] },
  projectId: null,
  activeItem: null,
  genKind: 'image',
  jobs: {},
  _timers: {},
  _targets: {},
  _shown: null,
  _geoKey: '',
  _bound: false,

  $(id) { return document.getElementById(id); },
  esc(t) { return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  toast(msg, type = 'info') { if (typeof App !== 'undefined') App.showToast(msg, type); },

  // --- Config ---------------------------------------------------------------
  clean(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const ids = [];
    for (const m of raw.media_ids || []) if (typeof m === 'string' && m && !ids.includes(m)) ids.push(m);
    const items = [];
    for (const it of (raw.items || []).slice(0, 40)) {
      if (!it || typeof it.media_id !== 'string') continue;
      const start = num(it.start, 0, 0, 36000), end = num(it.end, 0, 0, 36000);
      if (end - start < 0.1) continue;
      const item = { id: String(it.id || `s${items.length + 1}`), media_id: it.media_id, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
      const keep = MediaCut.clean(it.keep);
      if (keep.length) item.keep = keep;
      items.push(item);
    }
    const keeps = {};
    for (const [id, value] of Object.entries(raw.keep && typeof raw.keep === 'object' ? raw.keep : {}).slice(0, 40)) {
      const keep = MediaCut.clean(value);
      if (id && keep.length) keeps[id] = keep;
    }
    return {
      mode: this.MODES.includes(raw.mode) ? raw.mode : 'off',
      layout: this.LAYOUTS.includes(raw.layout) ? raw.layout : 'top',
      ratio: Math.round(num(raw.ratio, 0.5, 0.3, 0.7) * 1000) / 1000,
      focus: Math.round(num(raw.focus, 0.3, 0, 1) * 1000) / 1000,
      media_ids: ids, items, keep: keeps
    };
  },

  exportConfig() { return this.clean(this.cfg); },

  applyExternal(saved) {
    this.cfg = this.clean(saved);
    this.activeItem = null;
    this.render();
  },

  // --- Setup ----------------------------------------------------------------
  init() {
    if (this._bound || !this.$('tab-split')) return;
    this._bound = true;
    const on = (id, ev, fn) => this.$(id)?.addEventListener(ev, fn);

    this.$('split-mode').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) this.setMode(b.dataset.mode);
    });
    this.$('split-layout').addEventListener('click', e => {
      const b = e.target.closest('button[data-layout]');
      if (b) { this.cfg.layout = b.dataset.layout; this.changed(); }
    });
    on('split-ratio', 'input', e => { this.cfg.ratio = parseInt(e.target.value, 10) / 100; this.changed(); });
    on('split-focus', 'input', e => { this.cfg.focus = parseInt(e.target.value, 10) / 100; this.changed(); });

    on('split-upload-btn', 'click', () => this.$('split-file').click());
    on('split-file', 'change', e => { this.upload([...e.target.files]); e.target.value = ''; });
    on('split-ai-toggle', 'click', () => {
      const box = this.$('split-ai');
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) this.renderAi();
    });
    this.$('gen-kind').addEventListener('click', e => {
      const b = e.target.closest('button[data-kind]');
      if (b) { this.genKind = b.dataset.kind; this.renderAi(); }
    });
    on('gen-suggest', 'click', () => this.suggest());
    on('gen-go', 'click', () => this.generate());

    this.$('split-media-grid').addEventListener('click', e => this.onMediaClick(e));
    this.$('split-scene-list').addEventListener('click', e => this.onSceneClick(e));
    this.$('split-scene-list').addEventListener('change', e => this.onSceneChange(e));
    this.$('split-full-list').addEventListener('click', e => {
      const b = e.target.closest('[data-full-cut]');
      if (b) this.cutFull(b.dataset.fullCut);
    });
    on('split-add-clip', 'click', () => this.addSceneForClip());
    on('split-add-here', 'click', () => this.addSceneHere());

    this.$('split-lanes')?.addEventListener('mousedown', e => this.onLaneDown(e));
    window.addEventListener('mousemove', e => this.onLaneMove(e));
    window.addEventListener('mouseup', e => this.onLaneUp(e));
    window.addEventListener('blur', () => this.onLaneUp(null));

    if ('ResizeObserver' in window && this.$('video-container')) new ResizeObserver(() => { this._geoKey = ''; this.syncNow(); }).observe(this.$('video-container'));
    if (Player.video) Player.video.addEventListener('loadedmetadata', () => { this._geoKey = ''; this.syncNow(); });
  },

  // Called when a project is opened: the library lives on the server, the config in the editing state
  async attach(projectId) {
    this.projectId = projectId;
    this.media = [];
    this.jobs = {};
    Object.values(this._timers).forEach(clearInterval);
    this._timers = {};
    this.render();
    await this.loadMedia();
  },

  async loadMedia() {
    if (!this.projectId) return;
    const pid = this.projectId;
    try {
      const res = await fetch(`/studiox/api/projects/${pid}/media`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (pid !== this.projectId) return;
      this.media = data.media || [];
      this.ai = data.ai || this.ai;
      // a generation that was running when the page was closed keeps going on the server
      for (const j of data.jobs || []) {
        this.jobs[j.id] = j;
        if (j.status === 'running' && !this._timers[j.id]) this.poll(j.id);
      }
    } catch (err) {
      console.warn('media list failed:', err);
    }
    this.render();
  },

  // --- Mode / layout ----------------------------------------------------------
  setMode(mode) {
    this.cfg.mode = mode;
    this.changed();
  },

  changed() {
    this.cfg = this.clean(this.cfg);
    this.render();
    this._geoKey = '';
    this.syncNow();
  },

  // --- Media library ----------------------------------------------------------
  async upload(files) {
    if (!files.length || !this.projectId) return;
    const btn = this.$('split-upload-btn');
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      btn.disabled = true;
      btn.textContent = `Enviando ${i + 1}/${files.length}…`;
      const form = new FormData();
      form.append('file', files[i]);
      try {
        const res = await fetch(`/studiox/api/projects/${this.projectId}/media`, { method: 'POST', body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Erro ${res.status}`);
        const item = await res.json();
        this.media.push(item);
        this.afterNewMedia(item);
        ok++;
      } catch (err) {
        this.toast(`${files[i].name}: ${err.message}`, 'error');
      }
    }
    btn.disabled = false;
    btn.innerHTML = `${Icons.upload}Enviar imagem ou vídeo`;
    if (ok) this.toast(`${ok} arquivo(s) adicionado(s) à biblioteca.`, 'success');
    this.render();
  },

  // A new file is put to use right away: in the whole-video mode it joins the list, in scene mode it fills
  // the scene being edited
  afterNewMedia(item, targetItemId) {
    if (this.cfg.mode === 'full' && !this.cfg.media_ids.includes(item.id)) this.cfg.media_ids.push(item.id);
    const target = this.cfg.items.find(i => i.id === (targetItemId || this.activeItem));
    if (this.cfg.mode === 'scenes' && target) this.setSceneMedia(target, item.id);
    else if (this.cfg.mode === 'scenes' || (this.cfg.mode === 'off' && !this.cfg.items.length)) this.autoScene(item);
    this.changed();
  },

  // A media with no scene to fill gets one now, so it shows up on the timeline: on the selected clip, or from the
  // cursor for a few seconds (the first free stretch)
  autoScene(item) {
    const total = this.totalDuration();
    if (!total) return;
    const clip = (Timeline.clips || []).find(c => c.id === Timeline.selectedClipId);
    const free = (a, b) => b - a >= 0.5 && !this.cfg.items.some(i => a < i.end - 0.05 && b > i.start + 0.05);
    const tries = [];
    if (clip) tries.push([clip.seqStart, clip.seqEnd]);
    const t = this.nowSeq();
    tries.push([t, Math.min(total, t + 4)], [0, Math.min(total, 4)]);
    for (const [a, b] of tries) {
      if (!free(a, b)) continue;
      let n = this.cfg.items.length + 1;
      while (this.cfg.items.some(i => i.id === `s${n}`)) n++;
      this.cfg.items.push({ id: `s${n}`, media_id: item.id, start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100 });
      this.cfg.items.sort((x, y) => x.start - y.start);
      this.activeItem = `s${n}`;
      this.cfg.mode = 'scenes';
      this.toast('A mídia entrou na timeline como uma cena: arraste o bloco para posicioná-la.', 'info');
      return;
    }
    this.toast('Não achei um espaço livre para a cena: crie uma pela aba Tela dividida.', 'warning');
  },

  // The parts chosen for a video mean nothing for another one
  setSceneMedia(it, mediaId) {
    if (it.media_id !== mediaId) delete it.keep;
    it.media_id = mediaId;
  },

  async removeMedia(id) {
    const item = this.media.find(m => m.id === id);
    const used = this.cfg.items.some(i => i.media_id === id) || this.cfg.media_ids.includes(id);
    if (!confirm(`Apagar “${item ? item.name : id}” da biblioteca?${used ? ' Ela está sendo usada e sairá da tela dividida.' : ''}`)) return;
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/media/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Erro ${res.status}`);
      this.media = this.media.filter(m => m.id !== id);
      this.cfg.media_ids = this.cfg.media_ids.filter(m => m !== id);
      this.cfg.items = this.cfg.items.filter(i => i.media_id !== id);
      delete this.cfg.keep[id];
      this.changed();
    } catch (err) {
      this.toast(`Não foi possível apagar: ${err.message}`, 'error');
    }
  },

  onMediaClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) { this.removeMedia(del.dataset.del); return; }
    const card = e.target.closest('[data-media]');
    if (!card) return;
    const id = card.dataset.media;
    if (this.cfg.mode === 'full') {
      const i = this.cfg.media_ids.indexOf(id);
      if (i >= 0) this.cfg.media_ids.splice(i, 1); else this.cfg.media_ids.push(id);
      this.changed();
    } else if (this.cfg.mode === 'scenes') {
      const target = this.cfg.items.find(i => i.id === this.activeItem);
      if (!target) { this.toast('Escolha uma cena na lista (ou crie uma) para trocar a mídia dela.', 'info'); return; }
      this.setSceneMedia(target, id);
      this.changed();
    }
  },

  // --- Scenes -------------------------------------------------------------------
  totalDuration() { return Timeline.getTotalSequenceDuration ? Timeline.getTotalSequenceDuration() : 0; },
  nowSeq() { return Timeline.sourceToSequence(Player.video ? Player.video.currentTime : 0); },

  newScene(start, end) {
    const total = this.totalDuration();
    start = Math.max(0, start);
    end = Math.min(total || end, end);
    if (end - start < 0.5) { this.toast('Esse trecho é curto demais para uma cena (mínimo 0,5 s).', 'warning'); return; }
    if (!this.media.length) { this.toast('Envie ou gere uma imagem/vídeo na biblioteca primeiro.', 'warning'); return; }
    if (this.cfg.items.some(i => start < i.end - 0.05 && end > i.start + 0.05)) {
      this.toast('Já existe uma cena nesse trecho. Ajuste o tempo dela ou escolha outro trecho.', 'warning');
      return;
    }
    let n = this.cfg.items.length + 1;
    while (this.cfg.items.some(i => i.id === `s${n}`)) n++;
    const item = { id: `s${n}`, media_id: this.media[this.media.length - 1].id, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
    this.cfg.items.push(item);
    this.cfg.items.sort((a, b) => a.start - b.start);
    this.activeItem = item.id;
    if (this.cfg.mode !== 'scenes') this.cfg.mode = 'scenes';
    this.changed();
  },

  addSceneForClip() {
    const clip = (Timeline.clips || []).find(c => c.id === Timeline.selectedClipId);
    if (!clip) { this.toast('Clique num clipe da timeline para usá-lo como cena.', 'info'); return; }
    this.newScene(clip.seqStart, clip.seqEnd);
  },

  addSceneHere() {
    const t = this.nowSeq();
    this.newScene(t, t + 4);
  },

  onSceneClick(e) {
    const row = e.target.closest('[data-scene]');
    if (!row) return;
    const id = row.dataset.scene;
    if (e.target.closest('[data-scene-cut]')) {
      const it = this.cfg.items.find(i => i.id === id);
      const media = it && this.media.find(m => m.id === it.media_id);
      this.activeItem = id;
      if (media) {
        const total = this.totalDuration();
        this.openCut(media, it.keep, Math.max(0.5, Math.min(it.end, total || it.end) - it.start), keep => {
          if (keep.length) it.keep = keep; else delete it.keep;
          this.changed();
        });
      }
    } else if (e.target.closest('[data-scene-del]')) {
      this.cfg.items = this.cfg.items.filter(i => i.id !== id);
      if (this.activeItem === id) this.activeItem = null;
      this.changed();
    } else if (e.target.closest('[data-scene-go]')) {
      const it = this.cfg.items.find(i => i.id === id);
      if (it) Player.seek(Timeline.sequenceToSource(it.start + 0.05));
      this.activeItem = id;
      this.render();
    } else if (!e.target.closest('input, select')) {
      this.activeItem = id;
      this.render();
    }
  },

  onSceneChange(e) {
    const row = e.target.closest('[data-scene]');
    const it = row && this.cfg.items.find(i => i.id === row.dataset.scene);
    if (!it) return;
    if (e.target.matches('select')) this.setSceneMedia(it, e.target.value);
    if (e.target.matches('input[data-t]')) {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) it[e.target.dataset.t] = Math.max(0, Math.round(v * 100) / 100);
      if (it.end - it.start < 0.5) { it.end = it.start + 0.5; this.toast('Uma cena precisa ter ao menos 0,5 s.', 'info'); }
    }
    this.activeItem = it.id;
    this.cfg.items.sort((a, b) => a.start - b.start);
    this.changed();
  },

  // --- Segments (what is on screen when) ----------------------------------------
  segments() {
    const total = this.totalDuration();
    const byId = new Map(this.media.map(m => [m.id, m]));
    if (this.cfg.mode === 'full') {
      const ids = this.cfg.media_ids.filter(id => byId.has(id));
      return ids.map((id, i) => ({ start: i * total / ids.length, end: (i + 1) * total / ids.length, media: byId.get(id),
        keep: this.keepOf(byId.get(id), this.cfg.keep[id]) }));
    }
    if (this.cfg.mode === 'scenes') {
      const out = [];
      let last = 0;
      for (const it of [...this.cfg.items].sort((a, b) => a.start - b.start)) {
        const media = byId.get(it.media_id);
        const start = Math.max(it.start, last), end = Math.min(it.end, total);
        if (!media || end - start < 0.5) continue;
        out.push({ id: it.id, start, end, media, keep: this.keepOf(media, it.keep) });
        last = end;
      }
      return out;
    }
    return [];
  },

  // The parts to play of a video ([] = all of it); images have none
  keepOf(media, keep) {
    return media && media.kind === 'video' ? MediaCut.effective(keep, media.duration || 0) : [];
  },

  openCut(media, keep, sceneDur, onSave) {
    MediaCut.open({ media, keep: keep || [], sceneDur, onSave });
  },

  // Whole-video mode: the seconds each media gets on screen
  fullShare() {
    const usable = this.cfg.media_ids.filter(id => this.media.some(m => m.id === id)).length;
    return usable ? this.totalDuration() / usable : null;
  },

  cutFull(id) {
    const media = this.media.find(m => m.id === id);
    if (!media) return;
    this.openCut(media, this.cfg.keep[id], this.fullShare(), keep => {
      if (keep.length) this.cfg.keep[id] = keep; else delete this.cfg.keep[id];
      this.changed();
    });
  },

  activeAt(t) { return this.segments().find(s => t >= s.start && t < s.end) || null; },

  // --- Preview -------------------------------------------------------------------
  layerEl() {
    let el = this.$('split-layer');
    if (!el) {
      const box = this.$('video-container');
      if (!box) return null;
      el = document.createElement('div');
      el.id = 'split-layer';
      el.className = 'split-layer hidden';
      Player.video.insertAdjacentElement('afterend', el);
    }
    return el;
  },

  syncNow() { this.syncAt(Timeline.sourceToSequence(Player.video ? Player.video.currentTime : 0)); },

  // The picture as the player shows it inside the container, in container px. js/canvasframe.js owns
  // this geometry (its frame's aspect ratio and the user's own scale/position live there); fall back
  // to a plain contain-fit if it is not loaded.
  pictureBox() {
    if (typeof CanvasFrame !== 'undefined') {
      const b = CanvasFrame.videoBox();
      if (b) return b;
    }
    const box = this.$('video-container'), v = Player.video;
    const meta = (App.currentProject && App.currentProject.meta) || {};
    const vw = (v && v.videoWidth) || meta.width || 16, vh = (v && v.videoHeight) || meta.height || 9;
    const cw = box.clientWidth, ch = box.clientHeight;
    const fit = Math.min(cw / vw, ch / vh);
    const dw = vw * fit, dh = vh * fit;
    return { cw, ch, x0: (cw - dw) / 2, y0: (ch - dh) / 2, dw, dh };
  },

  // Rectangles [x, y, w, h] (px inside the video container) of the media half and of the speaker half
  regions() {
    const { x0, y0, dw, dh } = this.pictureBox();
    const r = this.cfg.ratio, L = this.cfg.layout;
    if (L === 'top') return { m: [x0, y0, dw, dh * r], s: [x0, y0 + dh * r, dw, dh * (1 - r)] };
    if (L === 'bottom') return { m: [x0, y0 + dh * (1 - r), dw, dh * r], s: [x0, y0, dw, dh * (1 - r)] };
    if (L === 'left') return { m: [x0, y0, dw * r, dh], s: [x0 + dw * r, y0, dw * (1 - r), dh] };
    return { m: [x0 + dw * (1 - r), y0, dw * r, dh], s: [x0, y0, dw * (1 - r), dh] };
  },

  place(el, [x, y, w, h]) {
    Object.assign(el.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  },

  // The speaker keeps his pixels 1:1 (like the render's crop): a band of the picture, chosen by `focus`,
  // is clipped out of the video and slid into his half. The video stays in the layout flow, so the
  // container keeps its size.
  showSpeaker(spk) {
    const v = Player.video, p = this.pictureBox();
    const vertical = this.cfg.layout === 'top' || this.cfg.layout === 'bottom';
    const [sx, sy, sw, sh] = spk;
    let bx = p.x0, by = p.y0, bw = p.dw, bh = p.dh;
    if (vertical) { bh = sh; by = p.y0 + this.cfg.focus * (p.dh - sh); }
    else { bw = sw; bx = p.x0 + this.cfg.focus * (p.dw - sw); }
    v.style.clipPath = `inset(${by}px ${p.cw - (bx + bw)}px ${p.ch - (by + bh)}px ${bx}px)`;
    v.style.transform = `translate(${sx - bx}px, ${sy - by}px)`;
  },

  releaseSpeaker() {
    const v = Player.video;
    if (!v) return;
    v.style.clipPath = '';
    v.style.transform = '';
  },

  syncAt(t) {
    const layer = this.layerEl();
    if (!layer || !Player.video || !App.currentProject) return;
    const seg = this.cfg.mode !== 'off' ? this.activeAt(t) : null;
    if (!seg) {
      if (!layer.classList.contains('hidden')) {
        layer.classList.add('hidden');
        this.releaseSpeaker();
        const old = layer.querySelector('video');
        if (old) old.pause();
        this._geoKey = '';
      }
      return;
    }

    const box = this.$('video-container');
    const key = [box.clientWidth, box.clientHeight, Player.video.videoWidth, this.cfg.layout, this.cfg.ratio, this.cfg.focus].join('|');
    if (key !== this._geoKey || layer.classList.contains('hidden')) {
      this._geoKey = key;
      const reg = this.regions();
      this.place(layer, reg.m);
      this.showSpeaker(reg.s);
      layer.classList.remove('hidden');
    }

    // the media element of this segment (rebuilt only when the media changes)
    if (!this._shown || this._shown.id !== seg.media.id) {
      layer.innerHTML = '';
      let el;
      if (seg.media.kind === 'video') {
        el = document.createElement('video');
        Object.assign(el, { muted: true, loop: true, playsInline: true, preload: 'auto' });
      } else {
        el = document.createElement('img');
        el.alt = '';
      }
      el.src = seg.media.url;
      layer.appendChild(el);
      this._shown = { id: seg.media.id, el };
    }
    const el = this._shown.el;
    if (el.tagName === 'VIDEO') {
      const dur = el.duration || seg.media.duration || 0;
      if (seg.keep && seg.keep.length) {
        // only the chosen parts, one after the other (and repeating): leave a part as soon as it ends
        const pos = MediaCut.locate(seg.keep, t - seg.start);
        const cur = el.currentTime;
        const outside = cur < pos.a - 0.05 || cur > pos.b + 0.03;
        if (outside || Math.abs(cur - pos.time) > (Player.isPlaying ? 0.4 : 0.04)) { try { el.currentTime = pos.time; } catch (e) { /* not ready */ } }
      } else if (dur > 0) {
        const want = (t - seg.start) % dur;
        if (Math.abs(el.currentTime - want) > 0.4) { try { el.currentTime = want; } catch (e) { /* not ready */ } }
      }
      if (Player.isPlaying && el.paused) el.play().catch(() => {});
      if (!Player.isPlaying && !el.paused) el.pause();
    }
  },

  // --- AI generation ---------------------------------------------------------------
  // The scene the description is about: the scene being edited, else the selected clip, else the cursor
  targetRange() {
    const it = this.cfg.items.find(i => i.id === this.activeItem);
    if (this.cfg.mode === 'scenes' && it) return [it.start, it.end];
    const clip = (Timeline.clips || []).find(c => c.id === Timeline.selectedClipId);
    if (clip) return [clip.seqStart, clip.seqEnd];
    const t = this.nowSeq();
    return [t, t + 6];
  },

  sceneText([a, b]) {
    return (Player.transcriptionCues || [])
      .filter(w => (w.type === undefined || w.type === 'word') && w.text)
      .filter(w => { const s = Timeline.sourceToSequence(w.start); return s >= a - 0.05 && s <= b; })
      .map(w => String(w.text).trim()).join(' ');
  },

  async suggest() {
    const btn = this.$('gen-suggest');
    const text = this.sceneText(this.targetRange());
    if (!text) { this.toast('Não achei fala nesse trecho (a transcrição já foi feita?). Escreva a descrição você mesmo.', 'warning'); return; }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Pensando…';
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/media/suggest-prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: this.genKind, text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);
      this.$('gen-prompt').value = data.prompt;
    } catch (err) {
      this.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  },

  async generate() {
    const prompt = this.$('gen-prompt').value.trim();
    if (prompt.length < 3) { this.toast('Descreva o que você quer ver.', 'warning'); return; }
    const isVideo = this.genKind === 'video';
    const seconds = this.$('gen-seconds').value;
    const what = isVideo ? `um vídeo de ${seconds}s (custa mais e demora alguns minutos)` : 'uma imagem';
    if (!confirm(`Gerar ${what} com a OpenAI?\n\nIsso é cobrado na sua conta da OpenAI a cada geração.`)) return;
    const btn = this.$('gen-go');
    btn.disabled = true;
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/media/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: this.genKind, prompt, layout: this.cfg.layout, ratio: this.cfg.ratio, seconds, model: this.$('gen-model').value.trim() || null })
      });
      const job = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(job.detail || `Erro ${res.status}`);
      this.jobs[job.id] = job;
      this._targets[job.id] = this.cfg.mode === 'scenes' ? this.activeItem : null;
      this.poll(job.id);
      this.renderJobs();
    } catch (err) {
      this.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  poll(jobId) {
    clearInterval(this._timers[jobId]);
    const pid = this.projectId;
    const tick = async () => {
      try {
        const res = await fetch(`/studiox/api/projects/${pid}/media/jobs/${jobId}`);
        if (pid !== this.projectId) { clearInterval(this._timers[jobId]); return; }
        if (res.status === 404) { delete this.jobs[jobId]; clearInterval(this._timers[jobId]); this.renderJobs(); return; }
        const job = await res.json();
        this.jobs[jobId] = job;
        if (job.status !== 'running') {
          clearInterval(this._timers[jobId]);
          delete this._timers[jobId];
          if (job.status === 'done' && job.media) {
            if (!this.media.some(m => m.id === job.media.id)) this.media.push(job.media);
            this.afterNewMedia(job.media, this._targets[jobId]);
            this.toast('Mídia gerada e adicionada à biblioteca.', 'success');
          } else if (job.status === 'error') {
            this.toast(job.error || 'A geração falhou.', 'error');
          }
        }
        this.renderJobs();
      } catch (err) { /* offline for a moment: try again on the next tick */ }
    };
    this._timers[jobId] = setInterval(tick, this.jobs[jobId] && this.jobs[jobId].kind === 'video' ? 5000 : 2000);
  },

  // --- Rendering the panel -----------------------------------------------------------
  render() {
    if (!this.$('tab-split')) return;
    const c = this.cfg;
    const hints = {
      off: 'O vídeo fica em tela cheia.',
      full: 'A tela fica dividida o vídeo todo. Com mais de uma mídia, cada uma aparece por um tempo igual, na ordem.',
      scenes: 'A tela só se divide nas cenas que você marcar. O resto do vídeo fica em tela cheia.'
    };
    this.$('split-mode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === c.mode));
    this.$('split-mode-hint').textContent = hints[c.mode];
    this.$('split-config').classList.toggle('hidden', c.mode === 'off');
    this.$('split-layout').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.layout === c.layout));
    this.$('split-ratio').value = Math.round(c.ratio * 100);
    this.$('split-ratio-val').textContent = `${Math.round(c.ratio * 100)}%`;
    this.$('split-focus').value = Math.round(c.focus * 100);
    this.$('split-focus-val').textContent = `${Math.round(c.focus * 100)}%`;
    this.$('split-scenes-box').classList.toggle('hidden', c.mode !== 'scenes');
    this.renderMedia();
    this.renderScenes();
    this.renderFullList();
    this.renderAi();
    this.renderJobs();
    if (typeof Timeline !== 'undefined' && Timeline.requestRender) Timeline.requestRender();   // the lane follows the scenes
  },

  renderMedia() {
    const grid = this.$('split-media-grid');
    if (!this.media.length) {
      grid.innerHTML = '<div class="media-empty">Nenhuma mídia ainda. Envie imagens ou vídeos seus, ou gere com IA.</div>';
      return;
    }
    const full = this.cfg.mode === 'full';
    const sceneMedia = (this.cfg.items.find(i => i.id === this.activeItem) || {}).media_id;
    grid.innerHTML = this.media.map(m => {
      const order = this.cfg.media_ids.indexOf(m.id);
      const picked = full ? order >= 0 : (this.cfg.mode === 'scenes' && m.id === sceneMedia);
      return `
      <div class="media-card ${picked ? 'picked' : ''}" data-media="${this.esc(m.id)}" title="${this.esc(m.prompt || m.name)}">
        <img src="${this.esc(m.thumb_url)}" alt="" loading="lazy">
        <span class="media-kind">${m.kind === 'video' ? '▶ vídeo' : 'imagem'}${m.source === 'ai' ? ' · IA' : ''}</span>
        ${full && order >= 0 ? `<span class="media-order">${order + 1}</span>` : ''}
        <button class="media-del" data-del="${this.esc(m.id)}" title="Apagar da biblioteca">✕</button>
        <span class="media-name">${this.esc(m.name)}</span>
      </div>`;
    }).join('');
  },

  renderScenes() {
    const list = this.$('split-scene-list');
    if (!this.cfg.items.length) {
      list.innerHTML = '<div class="media-empty">Nenhuma cena. Clique num clipe da timeline e use “+ No clipe selecionado”, ou posicione o cursor e use “+ A partir do cursor”.</div>';
      return;
    }
    const byId = new Map(this.media.map(m => [m.id, m]));
    const opts = sel => this.media.map(m => `<option value="${this.esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${this.esc(m.name)} (${m.kind === 'video' ? 'vídeo' : 'imagem'})</option>`).join('');
    list.innerHTML = this.cfg.items.map((it, i) => `
      <div class="scene-row ${it.id === this.activeItem ? 'active' : ''}" data-scene="${this.esc(it.id)}">
        <div class="scene-head"><strong>Cena ${i + 1}</strong>
          <button class="btn btn-ghost btn-xs" data-scene-go title="Ir para o início da cena">Ver</button>
          <button class="btn btn-ghost btn-xs icon-danger" data-scene-del title="Remover cena">✕</button></div>
        <div class="scene-times">
          <label>de <input type="number" class="text-input" data-t="start" min="0" step="0.1" value="${it.start}"></label>
          <label>até <input type="number" class="text-input" data-t="end" min="0" step="0.1" value="${it.end}"></label><span>s</span>
        </div>
        <select class="text-input">${opts(it.media_id)}</select>
        ${this.cutLine(byId.get(it.media_id), it.keep, 'data-scene-cut')}
      </div>`).join('');
  },

  // "Escolher trechos" line of a video: what is chosen now and the button that opens the cut window
  cutLine(media, keep, attr) {
    if (!media || media.kind !== 'video') return '';
    const all = media.duration || 0;
    const eff = MediaCut.effective(keep, all);
    const label = eff.length
      ? `✂ ${eff.length} ${eff.length === 1 ? 'trecho' : 'trechos'}: ${MediaCut.fmt(MediaCut.total(eff))} de ${MediaCut.fmt(all)}`
      : `Aparece o vídeo todo (${MediaCut.fmt(all)})`;
    return `<div class="scene-cut ${eff.length ? 'on' : ''}"><span>${label}</span>
      <button type="button" class="btn btn-secondary btn-xs" ${attr} title="Cortar e escolher quais partes do vídeo aparecem">✂ Escolher trechos</button></div>`;
  },

  // Whole-video mode: one line per video that is on screen
  renderFullList() {
    const box = this.$('split-full-box');
    const videos = this.cfg.mode === 'full'
      ? this.cfg.media_ids.map(id => this.media.find(m => m.id === id)).filter(m => m && m.kind === 'video') : [];
    box.classList.toggle('hidden', !videos.length);
    this.$('split-full-list').innerHTML = videos.map(m => `
      <div class="scene-row"><div class="scene-head"><strong>${this.esc(m.name)}</strong></div>
        ${this.cutLine(m, this.cfg.keep[m.id], `data-full-cut="${this.esc(m.id)}"`)}</div>`).join('');
  },

  renderAi() {
    const isVideo = this.genKind === 'video';
    this.$('gen-kind').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.kind === this.genKind));
    this.$('gen-video-opts').classList.toggle('hidden', !isVideo);
    this.$('gen-prompt').placeholder = isVideo
      ? 'Ex.: câmera lenta sobre uma mesa de escritório com gráficos de vendas subindo numa tela, luz suave'
      : 'Ex.: painel de controle de estoque em um tablet, sobre uma bancada de madeira, luz natural';
    const seconds = this.$('gen-seconds');
    if (!seconds.options.length) seconds.innerHTML = (this.ai.video_seconds || ['4', '8', '12']).map(s => `<option value="${s}">${s} segundos</option>`).join('');
    const go = this.$('gen-go');
    go.textContent = isVideo ? 'Gerar vídeo' : 'Gerar imagem';
    const configured = this.ai.openai;
    this.$('gen-key-warning').classList.toggle('hidden', configured);
    go.disabled = !configured;
  },

  renderJobs() {
    const el = this.$('gen-jobs');
    const jobs = Object.values(this.jobs).sort((a, b) => b.created_at - a.created_at).slice(0, 6);
    el.innerHTML = jobs.map(j => `
      <div class="gen-job ${j.status}">
        <span>${j.kind === 'video' ? 'Vídeo' : 'Imagem'} · ${this.esc(j.status === 'error' ? (j.error || 'Falhou') : (j.message || ''))}</span>
        ${j.status === 'running' ? `<div class="gen-bar"><div style="width:${j.progress || 5}%"></div></div>` : ''}
      </div>`).join('');
  },

  // ---------------------------------------------------------------------------
  // Timeline lane: one block per scene (or per media, in the whole-video mode), with the media's thumbnail.
  // Same pattern as Motion's lane (js/motion.js); Timeline.flush() calls renderLanes() on every repaint.
  // ---------------------------------------------------------------------------
  LANE_H: 44,
  _lane: null,
  _laneEls: new Map(),
  _laneSel: false,
  _drag: null,

  laneActive() { return !!this.cfg && this.cfg.mode !== 'off' && typeof Timeline !== 'undefined' && Timeline.mode === 'sequence'; },
  laneH() { return this.laneActive() ? this.LANE_H : 0; },

  ensureLane(host) {
    if (this._lane && this._lane.el.parentNode === host) return;
    host.innerHTML = '';
    this._laneEls.clear();
    const lane = document.createElement('div');
    lane.className = 'track-lane track-split';
    lane.innerHTML = '<div class="track-label" title="Imagens e vídeos da tela dividida"><span class="tl-name">▥ TELA DIV.</span></div><div class="track-content"></div>';
    host.appendChild(lane);
    this._lane = { el: lane, content: lane.querySelector('.track-content') };
  },

  // Called by Timeline.flush() with the visible window in track pixels
  renderLanes(vis) {
    const host = this.$('split-lanes');
    if (!host || !this.cfg) return;
    const show = this.laneActive();
    host.style.display = show ? '' : 'none';
    if (!show) return;
    this.ensureLane(host);

    const pps = Timeline.pixelsPerSecond;
    const H = this.LANE_H - 6;
    const segs = this.segments();
    this._lane.content.classList.toggle('empty', !segs.length);
    this._lane.content.dataset.hint = this.cfg.mode === 'scenes'
      ? 'Nenhuma cena: use “+ No clipe selecionado” ou “+ A partir do cursor” na aba Tela dividida'
      : 'Escolha mídias na biblioteca da aba Tela dividida';
    const seen = new Set();
    for (const s of segs) {
      const key = s.id ? `s:${s.id}` : `m:${s.media.id}`;
      const left = s.start * pps, width = Math.max(3, (s.end - s.start) * pps);
      if (left + width < vis.l || left > vis.r) continue;
      seen.add(key);
      let el = this._laneEls.get(key);
      if (!el) { el = this.createLaneEl(s); this._laneEls.set(key, el); }
      if (el.parentNode !== this._lane.content) this._lane.content.appendChild(el);
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.style.height = `${H}px`;
      el.dataset.id = s.id || '';
      el.dataset.media = s.media.id;
      el.classList.toggle('selected', !!s.id && s.id === this.activeItem && this._laneSel);
      el.classList.toggle('tiny', width < 40);
      if (el._src !== s.media.thumb_url) { el._src = s.media.thumb_url; el._img.src = s.media.thumb_url; }
      const text = `${s.media.kind === 'video' ? '▶ ' : ''}${s.media.name}`;
      if (el._text !== text) { el._text = text; el._lbl.textContent = text; }
      const cut = s.keep && s.keep.length ? ' · trechos escolhidos' : '';
      el.title = `${s.media.name}${cut}\n${s.id ? 'Cena' : 'Parte do vídeo todo'}: ${s.start.toFixed(1)}s a ${s.end.toFixed(1)}s (${(s.end - s.start).toFixed(1)}s)`
        + (s.id ? '\nArraste para mover; as bordas ajustam o início e o fim.' : '');
      el.classList.toggle('fixed', !s.id);
    }
    for (const [key, el] of this._laneEls) {
      if (!seen.has(key)) { el.remove(); this._laneEls.delete(key); }
    }
  },

  createLaneEl() {
    const el = document.createElement('div');
    el.className = 'split-clip';
    el.innerHTML = '<img alt="" draggable="false"><div class="sc-label"></div>' +
      '<div class="sc-handle left" data-h="left"></div><div class="sc-handle right" data-h="right"></div>';
    el._img = el.querySelector('img');
    el._lbl = el.querySelector('.sc-label');
    return el;
  },

  showTab() {
    const btn = document.querySelector('[data-tab=tab-split]');
    if (btn && !btn.classList.contains('active')) btn.click();
  },

  selectionActive() { return this._laneSel && !!this.cfg.items.find(i => i.id === this.activeItem); },

  clearSelection() {
    if (!this._laneSel) return;
    this._laneSel = false;
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  deleteSelected() {
    if (!this.selectionActive()) return;
    this.cfg.items = this.cfg.items.filter(i => i.id !== this.activeItem);
    this.activeItem = null;
    this._laneSel = false;
    this.changed();
  },

  laneSnapPoints(excludeId) {
    const pts = [0, this.totalDuration()];
    for (const c of Timeline.clips) pts.push(c.seqStart, c.seqEnd);
    for (const it of this.cfg.items) if (it.id !== excludeId) pts.push(it.start, it.end);
    return pts;
  },

  laneSnap(t) {
    if (!Timeline.snapping) return null;
    const tol = 8 / Timeline.pixelsPerSecond;
    let best = null, bd = tol;
    for (const p of this._snap || []) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
    return best;
  },

  onLaneDown(e) {
    if (e.button !== 0) return;
    const el = e.target.closest('.split-clip');
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    if (typeof Timeline !== 'undefined') Timeline.selectedClipId = null;
    if (typeof Music !== 'undefined') Music.clearSelection();
    if (typeof Motion !== 'undefined') Motion.clearSelection();
    this.showTab();
    const it = this.cfg.items.find(x => x.id === el.dataset.id);
    if (!it) { Timeline.requestRender(); return; }   // a part of the whole-video mode: nothing to drag
    this.activeItem = it.id;
    this._laneSel = true;
    this.renderScenes();
    this.renderMedia();
    Timeline.requestRender();
    const h = e.target.dataset.h;
    this._snap = this.laneSnapPoints(it.id);
    this._drag = { type: ['left', 'right'].includes(h) ? h : 'move', item: it, x0: e.clientX, moved: false, orig: { start: it.start, end: it.end } };
  },

  onLaneMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const it = d.item, o = d.orig, total = this.totalDuration() || o.end;
    const others = this.cfg.items.filter(i => i !== it).sort((a, b) => a.start - b.start);
    const prevEnd = Math.max(0, ...others.filter(i => i.end <= o.start + 0.001).map(i => i.end));
    const next = others.find(i => i.start >= o.end - 0.001);
    const maxEnd = Math.min(total, next ? next.start : total);
    const dt = (e.clientX - d.x0) / Timeline.pixelsPerSecond;
    const snap = t => { const s = this.laneSnap(t); return s === null ? t : s; };
    const r2 = v => Math.round(v * 100) / 100;
    const len = o.end - o.start;
    if (d.type === 'move') {
      let start = o.start + dt;
      const a = this.laneSnap(start), b = this.laneSnap(start + len);
      if (a !== null) start = a; else if (b !== null) start = b - len;
      start = Math.min(maxEnd - len, Math.max(prevEnd, start));
      it.start = r2(start);
      it.end = r2(start + len);
    } else if (d.type === 'left') {
      it.start = r2(Math.min(o.end - 0.5, Math.max(prevEnd, snap(o.start + dt))));
    } else {
      it.end = r2(Math.max(o.start + 0.5, Math.min(maxEnd, snap(o.end + dt))));
    }
    this.renderScenes();
    this._geoKey = '';
    this.syncNow();
    Timeline.requestRender();
  },

  onLaneUp(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (!d.moved && e && d.type === 'move') { Timeline.scrubTo(e.clientX); Timeline.flushSeek(true); }
    if (d.moved) this.changed();
  }
};
