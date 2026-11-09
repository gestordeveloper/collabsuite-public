// Background music for StudioX: layers of clips cut from the shared music library, mixed under the speaker's voice.
//
// The edit lives in `edit.music` (backend/music_mix.py cleans it and mixes it into the render). Times are on the
// OUTPUT timeline (after the cuts), like the headline's "Aparece em". A clip is
//   { id, audio_id, start, in, dur, volume, fade_in, fade_out }
// `in` is where the clip starts INSIDE the song (that is the cut), `start` where it starts in the video.
//
// This file also draws the layers as lanes of the timeline (js/timeline.js calls renderLanes) and plays them in the
// preview with the Web Audio API: each clip is an <audio> element with its own gain (volume, fades, loudness of the
// song), and the voice goes through an analyser that drives the same "lower the music while someone talks" curve
// the render makes with a sidechain compressor (constants come from the server, so both use the same numbers).

const mNum = (v, d, lo, hi) => {
  if (v === null || v === undefined || v === '') return d;
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const mR3 = v => Math.round(v * 1000) / 1000;
const mId = v => (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';

const MOOD_PT = {
  Dark: 'Sombria', Grooving: 'Ritmada', Relaxed: 'Relaxante', Bright: 'Alegre', Bouncy: 'Animada', Driving: 'Energética',
  Calming: 'Calma', Mysterious: 'Misteriosa', Intense: 'Intensa', Eerie: 'Sinistra', Unnerving: 'Tensa', Somber: 'Triste',
  Mystical: 'Mística', Uplifting: 'Inspiradora', Humorous: 'Divertida', Epic: 'Épica', Action: 'Ação',
  Suspenseful: 'Suspense', Aggressive: 'Agressiva', Calm: 'Serena'
};
const OPENVERSE_CHIPS = ['lofi', 'cinematic', 'upbeat', 'ambient', 'piano', 'epic', 'chill', 'acoustic', 'electronic', 'corporate', 'happy', 'sad'];
const SOURCE_PT = { upload: 'Enviada por você', incompetech: 'Kevin MacLeod', openverse: 'Comunidade' };

const Music = {
  // Numbers the render uses; the server sends the real ones with the library (these are the same values)
  K: {
    target_lufs: -14, norm_min_db: -24, norm_max_db: 18, min_fade_s: 0.01, min_clip_s: 0.1, max_tracks: 4,
    duck_ratio: 8, duck_voice_db: -11, duck_attack_s: 0.02, duck_release_s: 0.4, duck_min_db: 3, duck_max_db: 24,
    duck_default_db: 12, layer_volume: 0.2, fade_in: 0.4, fade_out: 0.8
  },
  COLORS: ['#9B7BFF', '#2DD4BF', '#FF5CAE', '#F7B32B'], // layer colors: the design system's tag palette

  cfg: null,              // edit.music
  library: [],            // songs of the shared library
  providers: [],
  formats: [],
  projectId: null,
  sel: null,              // { track, clip } ids
  activeTrack: null,      // layer where "add" puts new clips
  voiceLufs: null,        // loudness of the video's own audio (preview compensates it like the render's loudnorm)
  serverOutdated: false,
  peaks: new Map(),       // audio id -> { rate, data: Uint8Array } | 'loading' | 'none'
  search: { provider: 'incompetech', q: '', mood: '', genre: '', mode: 'credit', page: 1, results: [], total: 0, hasMore: false, loading: false, facets: null, seq: 0, busy: {} },

  _bound: false,
  _lanes: {},
  _laneSig: '',
  _clipEls: new Map(),
  _drag: null,
  _snap: [],
  _trayH: 0,
  _aud: null,
  _audKey: null,
  _chans: new Map(),
  _chansDirty: true,
  eng: null,

  $(id) { return document.getElementById(id); },
  esc(t) { return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  toast(msg, type = 'info') { if (typeof App !== 'undefined') App.showToast(msg, type); },
  uid(p) { return p + Math.random().toString(36).slice(2, 8); },
  fmt(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  total() { return typeof Timeline !== 'undefined' ? Timeline.getTotalSequenceDuration() : 0; },
  item(audioId) { return this.library.find(i => i.id === audioId) || null; },

  // --- Config ---------------------------------------------------------------
  emptyCfg() { return { enabled: true, ducking: { enabled: true, db: this.K.duck_default_db }, tracks: [] }; },

  // Same whitelist and limits as music_mix.sanitize_music (the server has the last word)
  clean(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const K = this.K;
    const duck = raw.ducking && typeof raw.ducking === 'object' ? raw.ducking : {};
    const tracks = [], tids = new Set(), cids = new Set();
    (Array.isArray(raw.tracks) ? raw.tracks : []).slice(0, K.max_tracks).forEach((t, ti) => {
      if (!t || typeof t !== 'object') return;
      let tid = mId(t.id) || `t${ti + 1}`;
      while (tids.has(tid)) tid += 'x';
      tids.add(tid);
      const clips = [];
      (Array.isArray(t.clips) ? t.clips : []).slice(0, 80).forEach((c, ci) => {
        if (!c || typeof c !== 'object' || !mId(c.audio_id)) return;
        const dur = mNum(c.dur, 0, 0, 36000);
        if (dur < K.min_clip_s) return;
        let cid = mId(c.id) || `c${ti + 1}_${ci + 1}`;
        while (cids.has(cid)) cid += 'x';
        cids.add(cid);
        clips.push({
          id: cid, audio_id: mId(c.audio_id), start: mR3(mNum(c.start, 0, 0, 36000)), in: mR3(mNum(c.in, 0, 0, 36000)),
          dur: mR3(dur), volume: mR3(mNum(c.volume, 1, 0, 2)), fade_in: mR3(mNum(c.fade_in, K.fade_in, 0, 60)),
          fade_out: mR3(mNum(c.fade_out, K.fade_out, 0, 60))
        });
      });
      clips.sort((a, b) => a.start - b.start);
      tracks.push({
        id: tid, name: String(t.name || '').trim().slice(0, 40) || `Música ${ti + 1}`,
        volume: mR3(mNum(t.volume, K.layer_volume, 0, 1.5)), muted: !!t.muted, clips
      });
    });
    return {
      enabled: raw.enabled !== false,
      ducking: { enabled: duck.enabled !== false, db: Math.round(mNum(duck.db, K.duck_default_db, K.duck_min_db, K.duck_max_db) * 10) / 10 },
      tracks
    };
  },

  exportConfig() { return this.clean(this.cfg || this.emptyCfg()); },

  applyExternal(saved) {
    this.cfg = this.clean(saved);
    this.sel = null;
    this.activeTrack = this.cfg.tracks[0]?.id || null;
    this._chansDirty = true;
    this._laneSig = '';
    this.renderPanel();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  summary() {
    const c = this.cfg;
    if (!c || !c.enabled) return 'Desligada';
    const layers = c.tracks.filter(t => !t.muted && t.clips.length);
    const n = layers.reduce((s, t) => s + t.clips.length, 0);
    if (!n) return 'Nenhuma música';
    return `${n} trecho(s) em ${layers.length} camada(s)${c.ducking.enabled ? ` · abaixa ${c.ducking.db} dB na fala` : ''}`;
  },

  // --- Setup ----------------------------------------------------------------
  init() {
    if (this._bound || !this.$('tab-music')) return;
    this._bound = true;
    if (!this.cfg) this.cfg = this.emptyCfg();
    const on = (id, ev, fn) => this.$(id)?.addEventListener(ev, fn);

    on('music-enabled', 'change', e => { this.cfg.enabled = e.target.checked; this.touch(); });
    on('music-duck', 'change', e => { this.cfg.ducking.enabled = e.target.checked; this.touch(); });
    on('music-duck-db', 'input', e => { this.cfg.ducking.db = Number(e.target.value); this.touch(); });
    on('music-add-layer', 'click', () => this.addLayer());

    const layers = this.$('music-layers');
    layers.addEventListener('click', e => this.onLayerClick(e));
    layers.addEventListener('input', e => this.onLayerInput(e));
    layers.addEventListener('change', e => this.onLayerInput(e));

    on('mclip-start', 'input', e => this.editClip('start', e.target.value));
    on('mclip-dur', 'input', e => this.editClip('dur', e.target.value));
    on('mclip-in', 'input', e => this.editClip('in', e.target.value));
    on('mclip-vol', 'input', e => this.editClip('volume', Number(e.target.value) / 100));
    on('mclip-fin', 'input', e => this.editClip('fade_in', Number(e.target.value) / 10));
    on('mclip-fout', 'input', e => this.editClip('fade_out', Number(e.target.value) / 10));
    on('mclip-split', 'click', () => this.splitAtPlayhead());
    on('mclip-dup', 'click', () => this.duplicateSelected());
    on('mclip-del', 'click', () => this.deleteSelected());

    on('music-upload-btn', 'click', () => this.$('music-file').click());
    on('music-file', 'change', e => { this.upload([...e.target.files]); e.target.value = ''; });
    on('music-search-toggle', 'click', () => {
      const box = this.$('music-search');
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) this.openSearch();
    });
    this.$('music-library').addEventListener('click', e => this.onLibraryClick(e));
    on('music-credits-copy', 'click', () => this.copyCredits());

    // catalog search
    this.$('ms-provider').addEventListener('click', e => {
      const b = e.target.closest('button[data-provider]');
      if (b) this.setProvider(b.dataset.provider);
    });
    this.$('ms-mode').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) { this.search.mode = b.dataset.mode; this.renderSearchControls(); this.doSearch(1); }
    });
    this.$('ms-chips').addEventListener('click', e => {
      const b = e.target.closest('button[data-chip]');
      if (!b) return;
      if (this.search.provider === 'incompetech') this.search.mood = this.search.mood === b.dataset.chip ? '' : b.dataset.chip;
      else { this.search.q = this.search.q === b.dataset.chip ? '' : b.dataset.chip; this.$('ms-q').value = this.search.q; }
      this.renderSearchControls();
      this.doSearch(1);
    });
    on('ms-genre', 'change', e => { this.search.genre = e.target.value; this.doSearch(1); });
    on('ms-go', 'click', () => { this.search.q = this.$('ms-q').value.trim(); this.doSearch(1); });
    on('ms-q', 'keydown', e => { if (e.key === 'Enter') { this.search.q = e.target.value.trim(); this.doSearch(1); } });
    on('ms-more', 'click', () => this.doSearch(this.search.page + 1));
    this.$('ms-results').addEventListener('click', e => this.onResultClick(e));

    // timeline lanes
    const lanes = this.$('music-lanes');
    if (lanes) {
      lanes.addEventListener('mousedown', e => this.onLaneDown(e));
      lanes.addEventListener('click', e => this.onLaneClick(e));
    }
    window.addEventListener('mousemove', e => this.onDragMove(e));
    window.addEventListener('mouseup', e => this.onDragEnd(e));
    window.addEventListener('blur', () => this.onDragEnd(null));

    this.renderPanel();
    this.loadLibrary();
  },

  // Called when a project is opened
  async attach(projectId) {
    this.projectId = projectId;
    this.voiceLufs = null;
    this.silence(true);
    this._chans.forEach(ch => this.disposeChan(ch));
    this._chans.clear();
    this.loadVoice(projectId);
    if (!this.library.length) this.loadLibrary();
  },

  async loadVoice(projectId) {
    try {
      const res = await fetch(`/studiox/api/projects/${encodeURIComponent(projectId)}/audio-info`);
      if (!res.ok) return;
      const data = await res.json();
      if (projectId === this.projectId) { this.voiceLufs = typeof data.lufs === 'number' ? data.lufs : null; this.applyVoiceGain(); }
    } catch (e) { /* the preview just plays the voice as recorded */ }
  },

  async loadLibrary() {
    try {
      const res = await fetch('/studiox/api/music');
      if (res.status === 404) { this.serverOutdated = true; this.renderLibrary(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.serverOutdated = false;
      this.library = data.items || [];
      this.providers = data.providers || [];
      this.formats = data.formats || [];
      this.K = { ...this.K, ...(data.constants || {}) };
      // stored clips were cleaned with the defaults: nothing to redo, only the panel needs the real numbers
    } catch (err) {
      console.warn('music library failed:', err);
    }
    this.renderPanel();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  // --- Panel -----------------------------------------------------------------
  renderPanel() {
    if (!this.$('tab-music')) return;
    this.renderToggles();
    this.renderLayers();
    this.renderClipBox();
    this.renderLibrary();
    this.renderCredits();
  },

  renderToggles() {
    const c = this.cfg || this.emptyCfg();
    const set = (id, fn) => { const el = this.$(id); if (el) fn(el); };
    set('music-enabled', el => { el.checked = c.enabled; });
    set('music-duck', el => { el.checked = c.ducking.enabled; });
    set('music-duck-db', el => { if (document.activeElement !== el) el.value = c.ducking.db; el.disabled = !c.ducking.enabled; });
    set('music-duck-val', el => { el.textContent = `−${c.ducking.db} dB`; });
  },

  layerColor(i) { return this.COLORS[i % this.COLORS.length]; },

  renderLayers() {
    const host = this.$('music-layers');
    if (!host) return;
    const tracks = this.cfg.tracks;
    if (!tracks.length) {
      host.innerHTML = '<p class="field-hint" style="margin:0">Nenhuma camada ainda: ao adicionar uma música da biblioteca, a primeira camada é criada sozinha.</p>';
    } else {
      host.innerHTML = tracks.map((t, i) => `
        <div class="music-layer${t.id === this.activeTrack ? ' active' : ''}${t.muted ? ' muted' : ''}" data-track="${t.id}" style="--mc:${this.layerColor(i)}">
          <div class="ml-head">
            <span class="ml-dot"></span>
            <input type="text" class="text-input ml-name" data-f="name" value="${this.esc(t.name)}" maxlength="40" spellcheck="false" title="Nome da camada">
            <span class="badge badge-dim">${t.clips.length} trecho${t.clips.length === 1 ? '' : 's'}</span>
            <button type="button" class="ml-btn" data-act="mute" title="${t.muted ? 'Ativar' : 'Silenciar'} esta camada">${t.muted ? Icons.muted : Icons.volume}</button>
            <button type="button" class="ml-btn" data-act="del" title="Remover a camada">✕</button>
          </div>
          <div class="grade-row">
            <div class="grade-row-head"><label>Volume da camada</label><span class="grade-val" data-val>${Math.round(t.volume * 100)}%</span></div>
            <input type="range" data-f="vol" min="0" max="150" step="1" value="${Math.round(t.volume * 100)}">
          </div>
        </div>`).join('');
    }
    const add = this.$('music-add-layer');
    if (add) { add.disabled = tracks.length >= this.K.max_tracks; add.title = add.disabled ? `No máximo ${this.K.max_tracks} camadas` : ''; }
  },

  onLayerClick(e) {
    const layer = e.target.closest('.music-layer');
    if (!layer) return;
    const id = layer.dataset.track;
    const btn = e.target.closest('button[data-act]');
    if (btn && btn.dataset.act === 'mute') { this.toggleMute(id); return; }
    if (btn && btn.dataset.act === 'del') { this.removeLayer(id); return; }
    if (this.activeTrack !== id) this.setActiveTrack(id);
  },

  onLayerInput(e) {
    const layer = e.target.closest('.music-layer');
    const t = layer && this.cfg.tracks.find(x => x.id === layer.dataset.track);
    if (!t) return;
    if (e.target.dataset.f === 'vol') {
      t.volume = Number(e.target.value) / 100;
      layer.querySelector('[data-val]').textContent = `${e.target.value}%`;
      this.touch();
    } else if (e.target.dataset.f === 'name' && e.type === 'change') {
      t.name = e.target.value.trim().slice(0, 40) || t.name;
      this._laneSig = '';
      this.touch();
    }
  },

  setActiveTrack(id) {
    this.activeTrack = id;
    this._laneSig = '';
    this.renderLayers();
    Timeline.requestRender();
  },

  toggleMute(id) {
    const t = this.cfg.tracks.find(x => x.id === id);
    if (!t) return;
    t.muted = !t.muted;
    this._laneSig = '';
    this.changed();
  },

  addLayer() {
    if (this.cfg.tracks.length >= this.K.max_tracks) return null;
    const used = new Set(this.cfg.tracks.map(t => t.name));
    let n = 1;
    while (used.has(`Música ${n}`)) n++;
    const t = { id: this.uid('t'), name: `Música ${n}`, volume: this.K.layer_volume, muted: false, clips: [] };
    this.cfg.tracks.push(t);
    this.activeTrack = t.id;
    this._laneSig = '';
    this.changed();
    return t;
  },

  removeLayer(id) {
    const t = this.cfg.tracks.find(x => x.id === id);
    if (!t) return;
    if (t.clips.length && !confirm(`Remover a camada “${t.name}” e os ${t.clips.length} trecho(s) dela?`)) return;
    this.cfg.tracks = this.cfg.tracks.filter(x => x.id !== id);
    if (this.sel && this.sel.track === id) this.sel = null;
    if (this.activeTrack === id) this.activeTrack = this.cfg.tracks[0]?.id || null;
    this._laneSig = '';
    this.changed();
  },

  // A change of the config: repaint what shows it (panel list, lanes) and the preview picks it up on its next tick
  changed() {
    this._chansDirty = true;
    this.renderPanel();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  // Cheaper: no list is rebuilt (used while dragging a slider or a clip)
  touch() {
    this._chansDirty = true;
    this.renderToggles();
    this.renderClipBox();
    this.renderCredits();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  // --- Clips ------------------------------------------------------------------
  selected() {
    if (!this.sel) return null;
    const track = this.cfg.tracks.find(t => t.id === this.sel.track);
    const clip = track && track.clips.find(c => c.id === this.sel.clip);
    return clip ? { track, clip } : null;
  },

  findClip(id) {
    for (const track of this.cfg.tracks) {
      const clip = track.clips.find(c => c.id === id);
      if (clip) return { track, clip };
    }
    return null;
  },

  select(trackId, clipId) {
    this.sel = { track: trackId, clip: clipId };
    if (this.activeTrack !== trackId) { this.activeTrack = trackId; this._laneSig = ''; this.renderLayers(); }
    this.renderClipBox();
    Timeline.requestRender();
  },

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.renderClipBox();
    Timeline.requestRender();
  },

  selectionActive() { return !!this.selected(); },

  newClip(audioId, o) {
    return {
      id: this.uid('c'), audio_id: audioId, start: mR3(o.start), in: mR3(o.in || 0), dur: mR3(o.dur), volume: 1,
      fade_in: mR3(o.fade_in ?? this.K.fade_in), fade_out: mR3(o.fade_out ?? this.K.fade_out)
    };
  },

  // Where the playhead is on the OUTPUT timeline, whatever the timeline mode
  srcToOut(src) {
    const clips = Timeline.clips;
    if (!clips.length) return src;
    const i = Timeline.clipIndexAtSource(src);
    if (i >= 0 && src <= clips[i].end) return clips[i].seqStart + (src - clips[i].start);
    if (clips[i + 1]) return clips[i + 1].seqStart;
    return Timeline.getTotalSequenceDuration();
  },

  nowOut() { return Player.video ? this.srcToOut(Player.video.currentTime) : 0; },

  layerForAdd() {
    let t = this.cfg.tracks.find(x => x.id === this.activeTrack) || this.cfg.tracks[0];
    if (!t) t = this.addLayer();
    return t;
  },

  // mode 'cursor': from the needle for as long as the song lasts. mode 'cover': the whole video, repeating the song
  // (with a crossfade at each join) when it is shorter, and a fade-out at the very end.
  addClip(audioId, mode = 'cursor') {
    const it = this.item(audioId);
    if (!it) return null;
    const total = this.total();
    if (!App.currentProject || total <= 0) { this.toast('Abra um vídeo primeiro.', 'warning'); return null; }
    const layer = this.layerForAdd();
    if (!layer) return null;
    const song = it.duration || total;
    let made = [];
    if (mode === 'cover') {
      made = this.coverClips(audioId, song, total);
    } else {
      let start = this.nowOut();
      if (start >= total - 0.5) start = 0;
      made = [this.newClip(audioId, { start, in: 0, dur: Math.min(song, total - start) })];
    }
    layer.clips.push(...made);
    layer.clips.sort((a, b) => a.start - b.start);
    this.select(layer.id, made[0].id);
    this.changed();
    this.toast(mode === 'cover' ? 'Música colocada no vídeo todo.' : `“${it.name}” colocada na camada ${layer.name}.`, 'success');
    return made;
  },

  coverClips(audioId, song, total) {
    const K = this.K;
    if (song >= total - 0.05) return [this.newClip(audioId, { start: 0, in: 0, dur: total, fade_out: Math.min(1.5, total / 3) })];
    const X = Math.min(2, song / 4);
    const clips = [];
    let start = 0;
    while (start < total - 0.3 && clips.length < 40) {
      const dur = Math.min(song, total - start);
      clips.push(this.newClip(audioId, {
        start, in: 0, dur, fade_in: clips.length ? Math.min(X, dur / 2) : K.fade_in, fade_out: Math.min(X, dur / 2)
      }));
      start += song - X;
    }
    const last = clips[clips.length - 1];
    last.fade_out = mR3(Math.min(1.5, last.dur / 2));
    return clips;
  },

  // Applies a value typed in the clip panel, inside the limits that keep the clip valid
  editClip(field, raw) {
    const s = this.selected();
    if (!s) return;
    const { clip } = s;
    const K = this.K, total = this.total();
    const song = this.item(clip.audio_id)?.duration || Infinity;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    if (field === 'start') clip.start = mR3(Math.min(Math.max(0, v), Math.max(0, total - K.min_clip_s)));
    else if (field === 'dur') clip.dur = mR3(Math.min(Math.max(K.min_clip_s, v), song - clip.in, Math.max(K.min_clip_s, total - clip.start)));
    else if (field === 'in') {
      clip.in = mR3(Math.min(Math.max(0, v), Math.max(0, song - K.min_clip_s)));
      clip.dur = mR3(Math.min(clip.dur, song - clip.in));
    } else if (field === 'volume') clip.volume = mR3(Math.min(2, Math.max(0, v)));
    else if (field === 'fade_in') clip.fade_in = mR3(Math.min(Math.max(0, v), Math.max(0, clip.dur - clip.fade_out)));
    else if (field === 'fade_out') clip.fade_out = mR3(Math.min(Math.max(0, v), Math.max(0, clip.dur - clip.fade_in)));
    this.clampFades(clip);
    this.touch();
  },

  clampFades(clip) {
    if (clip.fade_in + clip.fade_out > clip.dur) {
      const k = clip.dur / (clip.fade_in + clip.fade_out);
      clip.fade_in = mR3(clip.fade_in * k);
      clip.fade_out = mR3(clip.fade_out * k);
    }
  },

  splitAtPlayhead() {
    const t = this.nowOut();
    let s = this.selected();
    if (!s || !(t > s.clip.start + 0.1 && t < s.clip.start + s.clip.dur - 0.1)) {
      // nothing selected there: the clip under the needle in the active layer
      const track = this.cfg.tracks.find(x => x.id === this.activeTrack) || this.cfg.tracks[0];
      const clip = track && track.clips.find(c => t > c.start + 0.1 && t < c.start + c.dur - 0.1);
      s = clip ? { track, clip } : null;
    }
    if (!s) { this.toast('Posicione a agulha dentro de um trecho de música para dividir.', 'warning'); return; }
    const { track, clip } = s;
    const cut = mR3(t - clip.start);
    const right = { ...clip, id: this.uid('c'), start: mR3(t), in: mR3(clip.in + cut), dur: mR3(clip.dur - cut), fade_in: 0 };
    clip.dur = mR3(cut);
    clip.fade_out = 0;                                   // a cut is seamless: only the outer edges keep their fades
    right.fade_out = mR3(Math.min(right.fade_out, right.dur));
    clip.fade_in = mR3(Math.min(clip.fade_in, clip.dur));
    track.clips.push(right);
    track.clips.sort((a, b) => a.start - b.start);
    this.select(track.id, right.id);
    this.changed();
    this.toast('Música dividida na agulha.', 'success');
  },

  duplicateSelected() {
    const s = this.selected();
    if (!s) return;
    const { track, clip } = s;
    const copy = { ...clip, id: this.uid('c'), start: mR3(clip.start + clip.dur) };
    track.clips.push(copy);
    track.clips.sort((a, b) => a.start - b.start);
    this.select(track.id, copy.id);
    this.changed();
  },

  deleteSelected() {
    const s = this.selected();
    if (!s) return;
    s.track.clips = s.track.clips.filter(c => c.id !== s.clip.id);
    this.sel = null;
    this.changed();
  },

  renderClipBox() {
    const box = this.$('music-clip-box');
    if (!box) return;
    const s = this.selected();
    if (!s) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const { clip, track } = s;
    const it = this.item(clip.audio_id);
    this.$('mclip-name').textContent = it ? it.name : '(música removida)';
    this.$('mclip-layer').textContent = track.name;
    const set = (id, v) => { const el = this.$(id); if (el && document.activeElement !== el) el.value = v; };
    set('mclip-start', mR3(clip.start));
    set('mclip-dur', mR3(clip.dur));
    set('mclip-in', mR3(clip.in));
    set('mclip-vol', Math.round(clip.volume * 100));
    set('mclip-fin', Math.round(clip.fade_in * 10));
    set('mclip-fout', Math.round(clip.fade_out * 10));
    this.$('mclip-vol-val').textContent = `${Math.round(clip.volume * 100)}%`;
    this.$('mclip-fin-val').textContent = `${clip.fade_in.toFixed(1)} s`;
    this.$('mclip-fout-val').textContent = `${clip.fade_out.toFixed(1)} s`;
    const songDur = it ? it.duration : null;
    this.$('mclip-in').max = songDur ? Math.max(0, songDur - this.K.min_clip_s) : '';
  },

  // --- Library ------------------------------------------------------------------
  usedIds() {
    const ids = new Set();
    for (const t of this.cfg.tracks) for (const c of t.clips) ids.add(c.audio_id);
    return ids;
  },

  renderLibrary() {
    const host = this.$('music-library');
    if (!host) return;
    if (this.serverOutdated) {
      host.innerHTML = '<p class="field-hint warn">O servidor do StudioX ainda está rodando a versão antiga e não tem a função de música. Feche a janela do servidor e abra o <strong>start.bat</strong> de novo.</p>';
      return;
    }
    if (!this.library.length) {
      host.innerHTML = '<p class="field-hint" style="margin:0">Sua biblioteca está vazia. Envie um MP3/WAV/M4A seu ou use “Buscar músicas grátis”. As músicas ficam guardadas e servem para qualquer vídeo.</p>';
      return;
    }
    const used = this.usedIds();
    host.innerHTML = this.library.map(it => `
      <div class="mrow${used.has(it.id) ? ' used' : ''}" data-id="${it.id}">
        <button type="button" class="mrow-play" data-play="lib:${it.id}" data-url="${this.esc(it.url)}" title="Ouvir">▶</button>
        <div class="mrow-info">
          <div class="mrow-title" title="${this.esc(it.name)}">${this.esc(it.name)}</div>
          <div class="mrow-meta">${this.fmt(it.duration)} · ${this.esc(SOURCE_PT[it.source] || it.source)}${it.artist && it.source !== 'incompetech' ? ' · ' + this.esc(it.artist) : ''}</div>
          <div class="mrow-lic">${it.credit_required ? '<span class="badge mbadge credit" title="Exige crédito ao autor: o texto aparece em Créditos">exige crédito</span>' : ''}${used.has(it.id) ? '<span class="badge mbadge used">em uso</span>' : ''}</div>
        </div>
        <div class="mrow-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-act="add" title="Coloca a música a partir de onde está a agulha">＋ Agulha</button>
          <button type="button" class="btn btn-secondary btn-xs" data-act="cover" title="Cobre o vídeo inteiro (repete a música se for mais curta que o vídeo)">Vídeo todo</button>
          <button type="button" class="mrow-del" data-act="del" title="Apagar da biblioteca">✕</button>
        </div>
      </div>`).join('');
    this.paintAudition();
  },

  onLibraryClick(e) {
    const row = e.target.closest('.mrow');
    if (!row) return;
    const id = row.dataset.id;
    const play = e.target.closest('[data-play]');
    if (play) { this.toggleAudition(play.dataset.play, play.dataset.url); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add') this.addClip(id, 'cursor');
    else if (btn.dataset.act === 'cover') this.addClip(id, 'cover');
    else if (btn.dataset.act === 'del') this.deleteFromLibrary(id);
  },

  async upload(files) {
    if (!files.length) return;
    const btn = this.$('music-upload-btn');
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      btn.disabled = true;
      btn.textContent = `Enviando ${i + 1}/${files.length}…`;
      const form = new FormData();
      form.append('file', files[i]);
      try {
        const res = await fetch('/studiox/api/music', { method: 'POST', body: form });
        if (!res.ok) throw await API.failure(res, `Erro ${res.status}`);
        this.library.unshift(await res.json());
        ok++;
      } catch (err) {
        this.toast(`${files[i].name}: ${err.outdated ? 'reinicie o servidor (start.bat) para ativar a música' : err.message}`, 'error');
      }
    }
    btn.disabled = false;
    btn.innerHTML = `${Icons.upload}Enviar música`;
    if (ok) this.toast(`${ok} música(s) adicionada(s) à biblioteca.`, 'success');
    this.renderLibrary();
  },

  async deleteFromLibrary(id) {
    const it = this.item(id);
    if (!it) return;
    let used = 0;
    try {
      const res = await fetch(`/studiox/api/music/${id}/usage`);
      if (res.ok) used = (await res.json()).projects || 0;
    } catch (e) { /* the delete itself will report a real problem */ }
    const ask = used
      ? `“${it.name}” está sendo usada em ${used} projeto(s). Apagar mesmo assim? Os trechos dela saem desses vídeos.`
      : `Apagar “${it.name}” da biblioteca?`;
    if (!confirm(ask)) return;
    try {
      const res = await fetch(`/studiox/api/music/${id}?force=true`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw await API.failure(res, `Erro ${res.status}`);
      this.library = this.library.filter(i => i.id !== id);
      this.peaks.delete(id);
      for (const t of this.cfg.tracks) t.clips = t.clips.filter(c => c.audio_id !== id);
      if (this.sel && !this.selected()) this.sel = null;
      this._laneSig = '';
      this.changed();
      // results of the search that pointed at it are no longer "in the library"
      this.search.results.forEach(r => { if (r.in_library === id) r.in_library = null; });
      this.renderResults();
    } catch (err) {
      this.toast(`Não foi possível apagar: ${err.message}`, 'error');
    }
  },

  // --- Listening to a song in the library or the catalog -------------------------------
  toggleAudition(key, url) {
    if (!this._aud) {
      this._aud = new Audio();
      this._aud.preload = 'none';
      this._aud.addEventListener('ended', () => { this._audKey = null; this.paintAudition(); });
      this._aud.addEventListener('error', () => { if (this._audKey) this.toast('Não consegui tocar essa música.', 'error'); this._audKey = null; this.paintAudition(); });
    }
    if (this._audKey === key && !this._aud.paused) { this._aud.pause(); this._audKey = null; this.paintAudition(); return; }
    if (Player.video && !Player.video.paused) Player.video.pause();   // one thing at a time
    this._audKey = key;
    this._aud.src = url;
    this._aud.play().catch(() => { this._audKey = null; this.paintAudition(); });
    this.paintAudition();
  },

  paintAudition() {
    document.querySelectorAll('#tab-music [data-play]').forEach(b => {
      const on = b.dataset.play === this._audKey;
      b.textContent = on ? '⏸' : '▶';
      b.classList.toggle('playing', on);
    });
  },

  stopAudition() {
    if (this._aud && !this._aud.paused) this._aud.pause();
    if (this._audKey) { this._audKey = null; this.paintAudition(); }
  },

  // --- Free-music catalogs --------------------------------------------------------------
  openSearch() {
    if (!this.providers.length) { this.loadLibrary().then(() => this.openSearch()); return; }
    this.renderSearchControls();
    if (!this.search.results.length && !this.search.loading) this.doSearch(1);
  },

  setProvider(id) {
    if (this.search.provider === id) return;
    this.search = { ...this.search, provider: id, q: '', mood: '', genre: '', page: 1, results: [], total: 0, hasMore: false, facets: null };
    this.$('ms-q').value = '';
    this.renderSearchControls();
    this.doSearch(1);
  },

  renderSearchControls() {
    const s = this.search;
    const prov = this.providers.find(p => p.id === s.provider);
    this.$('ms-provider').innerHTML = this.providers.map(p => `<button type="button" data-provider="${p.id}" class="${p.id === s.provider ? 'active' : ''}">${this.esc(p.name)}</button>`).join('');
    this.$('ms-note').textContent = prov ? prov.note : '';
    const inc = s.provider === 'incompetech';
    this.$('ms-mode').classList.toggle('hidden', inc);
    this.$('ms-mode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
    const chips = inc
      ? (s.facets ? s.facets.moods.slice(0, 14).map(m => ({ id: m, label: MOOD_PT[m] || m, on: s.mood === m })) : [])
      : OPENVERSE_CHIPS.map(c => ({ id: c, label: c, on: s.q === c }));
    this.$('ms-chips').innerHTML = chips.map(c => `<button type="button" class="ms-chip${c.on ? ' on' : ''}" data-chip="${this.esc(c.id)}">${this.esc(c.label)}</button>`).join('');
    const genre = this.$('ms-genre');
    genre.classList.toggle('hidden', !(inc && s.facets));
    if (inc && s.facets) {
      genre.innerHTML = '<option value="">Todos os estilos</option>' + s.facets.genres.map(g => `<option value="${this.esc(g)}"${g === s.genre ? ' selected' : ''}>${this.esc(g)}</option>`).join('');
    }
  },

  async doSearch(page = 1) {
    const s = this.search;
    const seq = ++s.seq;
    s.loading = true;
    s.page = page;
    this.$('ms-status').textContent = 'Buscando…';
    if (page === 1) { s.results = []; this.renderResults(); }
    const q = new URLSearchParams({ provider: s.provider, q: s.q, mood: s.mood, genre: s.genre, mode: s.mode, page });
    try {
      const res = await fetch(`/studiox/api/music/catalog/search?${q}`);
      if (!res.ok) throw await API.failure(res, `Erro ${res.status}`);
      const data = await res.json();
      if (seq !== s.seq) return;
      s.results = page === 1 ? data.results : s.results.concat(data.results);
      s.total = data.total;
      s.hasMore = data.has_more;
      if (data.facets) s.facets = data.facets;
      this.$('ms-status').textContent = s.results.length
        ? `${data.total} música(s) encontrada(s)${data.total >= 240 && s.provider === 'openverse' ? ' (o catálogo mostra no máximo 240 por busca: refine o termo)' : ''}.`
        : 'Nenhuma música encontrada. Tente outra palavra ou tire um filtro.';
    } catch (err) {
      if (seq !== s.seq) return;
      this.$('ms-status').textContent = err.outdated ? 'Reinicie o servidor (start.bat) para ativar a busca de músicas.' : err.message;
    } finally {
      if (seq === s.seq) { s.loading = false; this.renderSearchControls(); this.renderResults(); }
    }
  },

  renderResults() {
    const host = this.$('ms-results');
    if (!host) return;
    const s = this.search;
    host.innerHTML = s.results.map((r, i) => {
      const busy = s.busy[i];
      const meta = [r.artist && r.provider !== 'incompetech' ? this.esc(r.artist) : '', this.fmt(r.duration), r.bpm ? `${r.bpm} BPM` : '',
        (r.tags || []).slice(0, 3).map(t => this.esc(MOOD_PT[t] || t)).join(', ')].filter(Boolean).join(' · ');
      return `<div class="mrow" data-i="${i}">
        <button type="button" class="mrow-play" data-play="res:${r.provider}:${this.esc(r.key)}" data-url="${this.esc(r.preview_url)}" title="Ouvir (vem direto do site da música)">▶</button>
        <div class="mrow-info">
          <div class="mrow-title" title="${this.esc(r.title)}">${this.esc(r.title)}</div>
          <div class="mrow-meta">${meta}</div>
          <div class="mrow-lic"><span class="badge mbadge ${r.credit_required ? 'credit' : 'free'}" title="${r.credit_required ? 'Exige crédito ao autor (o texto sai na aba, em Créditos)' : 'Não exige crédito'}">${this.esc(r.license)}${r.credit_required ? ' · exige crédito' : ' · sem crédito'}</span></div>
        </div>
        <div class="mrow-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-act="use" ${busy ? 'disabled' : ''} title="Baixa para a biblioteca e coloca na timeline, na agulha">${busy ? 'Baixando…' : '＋ Usar'}</button>
          <button type="button" class="btn btn-ghost btn-xs" data-act="save" ${busy || r.in_library ? 'disabled' : ''} title="Só baixa para a biblioteca">${r.in_library ? '✓ Salva' : `${Icons.download}Salvar`}</button>
        </div>
      </div>`;
    }).join('');
    this.$('ms-more').classList.toggle('hidden', !s.hasMore);
    this.paintAudition();
  },

  onResultClick(e) {
    const row = e.target.closest('.mrow');
    if (!row) return;
    const i = Number(row.dataset.i);
    const play = e.target.closest('[data-play]');
    if (play) { this.toggleAudition(play.dataset.play, play.dataset.url); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === 'use') this.importResult(i, true);
    else if (btn.dataset.act === 'save') this.importResult(i, false);
  },

  async importResult(i, andUse) {
    const r = this.search.results[i];
    if (!r || this.search.busy[i]) return;
    this.search.busy[i] = true;
    this.renderResults();
    try {
      const res = await fetch('/studiox/api/music/catalog/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: r.provider, key: r.key })
      });
      if (!res.ok) throw await API.failure(res, `Erro ${res.status}`);
      const data = await res.json();
      if (!this.item(data.item.id)) this.library.unshift(data.item);
      r.in_library = data.item.id;
      this.renderLibrary();
      if (andUse) this.addClip(data.item.id, 'cursor');
      else this.toast(`“${data.item.name}” salva na biblioteca.`, 'success');
    } catch (err) {
      this.toast(err.outdated ? 'Reinicie o servidor (start.bat) para ativar a música.' : err.message, 'error');
    } finally {
      delete this.search.busy[i];
      this.renderResults();
    }
  },

  // --- Credits ------------------------------------------------------------------
  creditText() {
    if (!this.cfg.enabled) return '';
    const seen = new Set(), lines = [];
    for (const t of this.cfg.tracks) {
      if (t.muted) continue;
      for (const c of t.clips) {
        const it = this.item(c.audio_id);
        if (it && it.credit_required && it.attribution && !seen.has(it.id)) { seen.add(it.id); lines.push(it.attribution); }
      }
    }
    return lines.join('\n\n');
  },

  renderCredits() {
    const box = this.$('music-credits-box');
    if (!box) return;
    const text = this.creditText();
    box.classList.toggle('hidden', !text);
    const ta = this.$('music-credits');
    if (text && ta.value !== text) ta.value = text;
  },

  async copyCredits() {
    const text = this.creditText();
    try { await navigator.clipboard.writeText(text); this.toast('Créditos copiados. Cole na legenda do vídeo.', 'success'); }
    catch (e) { const ta = this.$('music-credits'); ta.select(); document.execCommand('copy'); this.toast('Créditos copiados.', 'success'); }
  },

  // --- Waveforms ------------------------------------------------------------------
  peaksFor(audioId) {
    const p = this.peaks.get(audioId);
    if (p && p !== 'loading' && p !== 'none') return p;
    if (!p && this.item(audioId)) {
      this.peaks.set(audioId, 'loading');
      fetch(`/studiox/api/music/${audioId}/peaks`).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))).then(d => {
        const bin = atob(d.peaks || '');
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        this.peaks.set(audioId, data.length ? { rate: d.rate || 50, data } : 'none');
        Timeline.requestRender();
      }).catch(() => this.peaks.set(audioId, 'none'));
    }
    return null;
  },

  // --- Timeline lanes -----------------------------------------------------------------
  laneHeight(n) { return n <= 2 ? 44 : 34; },

  // Shares --timeline-tray-height with Motion's own single lane (js/motion.js): both compute the
  // same total so whichever runs last in Timeline.flush() leaves the correct final value.
  motionH() { return ((typeof Motion !== 'undefined' && Motion.laneActive()) ? Motion.LANE_H : 0) + ((typeof SplitScreen !== 'undefined') ? SplitScreen.laneH() : 0); },

  syncTray(n) {
    const h = 244 + n * this.laneHeight(n) + this.motionH();
    if (h === this._trayH) return;
    this._trayH = h;
    const root = document.documentElement.style;
    root.setProperty('--timeline-tray-height', `${h}px`);
    root.setProperty('--music-lane-h', `${this.laneHeight(n)}px`);
  },

  ensureLanes(host) {
    const sig = this.cfg.tracks.map(t => `${t.id}|${t.name}|${t.muted ? 1 : 0}|${t.id === this.activeTrack ? 1 : 0}`).join(';');
    if (sig === this._laneSig) return;
    this._laneSig = sig;
    host.innerHTML = '';
    this._lanes = {};
    this._clipEls.clear();
    this.cfg.tracks.forEach((t, i) => {
      const lane = document.createElement('div');
      lane.className = `track-lane track-music${t.muted ? ' muted' : ''}${t.id === this.activeTrack ? ' active' : ''}`;
      lane.dataset.track = t.id;
      lane.style.setProperty('--mc', this.layerColor(i));
      lane.innerHTML = `<div class="track-label" title="${this.esc(t.name)} (clique para escolher esta camada)">
          <span class="tl-name">♪ ${this.esc(t.name.length > 9 ? t.name.slice(0, 8) + '…' : t.name)}</span>
          <button type="button" class="tl-mute" data-lane-mute="${t.id}" title="${t.muted ? 'Ativar' : 'Silenciar'} a camada">${t.muted ? Icons.muted : Icons.volume}</button>
        </div><div class="track-content"></div>`;
      host.appendChild(lane);
      this._lanes[t.id] = { el: lane, content: lane.querySelector('.track-content') };
    });
  },

  // Called by Timeline.flush() with the visible window in track pixels
  renderLanes(vis) {
    const host = this.$('music-lanes');
    if (!host || !this.cfg) return;
    const n = this.cfg.tracks.length;
    const show = n > 0 && Timeline.mode === 'sequence';
    host.style.display = show ? '' : 'none';
    this.syncTray(show ? n : 0);
    if (!show) return;
    this.ensureLanes(host);

    const pps = Timeline.pixelsPerSecond;
    const H = this.laneHeight(n) - 6;
    const seen = new Set();
    this.cfg.tracks.forEach((track, ti) => {
      const lane = this._lanes[track.id];
      if (!lane) return;
      const color = this.layerColor(ti);
      for (const c of track.clips) {
        const left = c.start * pps, width = Math.max(3, c.dur * pps);
        if (left + width < vis.l || left > vis.r) continue;
        seen.add(c.id);
        let el = this._clipEls.get(c.id);
        if (!el) { el = this.createClipEl(c); this._clipEls.set(c.id, el); }
        if (el.parentNode !== lane.content) lane.content.appendChild(el);
        el.style.left = `${left}px`;
        el.style.width = `${width}px`;
        const sel = !!this.sel && this.sel.clip === c.id;
        el.classList.toggle('selected', sel);
        el.classList.toggle('tiny', width < 18);
        el.classList.toggle('missing', !this.item(c.audio_id));
        const it = this.item(c.audio_id);
        el._lbl.textContent = it ? it.name : 'música removida';
        el.title = `${it ? it.name : 'música removida'}\nComeça em ${c.start.toFixed(1)}s · dura ${c.dur.toFixed(1)}s · música a partir de ${c.in.toFixed(1)}s\nVolume ${Math.round(c.volume * 100)}%`;
        el._fi.style.left = `${Math.min(width - 12, Math.max(0, c.fade_in * pps))}px`;
        el._fo.style.right = `${Math.min(width - 12, Math.max(0, c.fade_out * pps))}px`;
        this.drawClip(el, c, track, left, width, vis, H, color);
      }
    });
    for (const [id, el] of this._clipEls) {
      if (!seen.has(id)) { el.remove(); this._clipEls.delete(id); }
    }
  },

  createClipEl(c) {
    const el = document.createElement('div');
    el.className = 'music-clip';
    el.dataset.id = c.id;
    el.innerHTML = '<canvas class="mc-wave"></canvas><div class="mc-label"></div>' +
      '<div class="mc-handle left" data-h="left" title="Arraste para cortar o começo"></div>' +
      '<div class="mc-handle right" data-h="right" title="Arraste para cortar o fim"></div>' +
      '<div class="mc-fade in" data-h="fadein" title="Arraste para ajustar a entrada suave"></div>' +
      '<div class="mc-fade out" data-h="fadeout" title="Arraste para ajustar a saída suave"></div>';
    el._cv = el.querySelector('canvas');
    el._lbl = el.querySelector('.mc-label');
    el._fi = el.querySelector('.mc-fade.in');
    el._fo = el.querySelector('.mc-fade.out');
    return el;
  },

  // Draws the part of the clip that is on screen: the waveform of exactly the seconds of the song it plays, and
  // dark corners where the fades lower it
  drawClip(el, c, track, left, width, vis, h, color) {
    const pps = Timeline.pixelsPerSecond;
    const off = Math.max(0, Math.floor(vis.l - left));
    const end = Math.min(Math.ceil(width), Math.ceil(vis.r - left));
    const w = Math.max(1, end - off);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pk = this.peaksFor(c.audio_id);
    const key = [off, w, pps.toFixed(3), c.in, c.dur, c.fade_in, c.fade_out, h, dpr, pk ? 1 : 0, color].join('|');
    if (el._key === key) return;
    el._key = key;
    const cv = el._cv;
    cv.style.left = `${off}px`;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    if (pk) {
      const COL = 2;
      for (let x = 0; x < w; x += COL) {
        const t0 = c.in + (off + x) / pps, t1 = c.in + (off + x + COL) / pps;
        const i0 = Math.max(0, Math.floor(t0 * pk.rate)), i1 = Math.max(i0 + 1, Math.ceil(t1 * pk.rate));
        let m = 0;
        for (let i = i0; i < Math.min(pk.data.length, i1); i++) if (pk.data[i] > m) m = pk.data[i];
        const bh = Math.max(1, Math.pow(m / 255, 0.75) * h * 0.86);
        ctx.fillRect(x, (h - bh) / 2, COL - 0.6, bh);
      }
    } else {
      ctx.fillRect(0, h / 2 - 1, w, 2);
    }
    // fades: the triangle above the ramp is dimmed
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#05070c';
    const fi = c.fade_in * pps, fo = c.fade_out * pps;
    if (fi > 1 && off < fi) {
      ctx.beginPath(); ctx.moveTo(-off, 0); ctx.lineTo(fi - off, 0); ctx.lineTo(-off, h); ctx.closePath(); ctx.fill();
    }
    const fromRight = width - off - w;      // distance from the drawn slice to the clip's right edge
    if (fo > 1 && fromRight < fo) {
      const rx = width - off;               // clip's right edge in slice coordinates
      ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx - fo, 0); ctx.lineTo(rx, h); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  onLaneClick(e) {
    const mute = e.target.closest('[data-lane-mute]');
    if (mute) { this.toggleMute(mute.dataset.laneMute); return; }
    const label = e.target.closest('.track-label');
    if (label) { const lane = label.closest('.track-music'); if (lane) this.setActiveTrack(lane.dataset.track); }
  },

  // --- Dragging clips in the timeline -------------------------------------------------------
  snapPoints(excludeId) {
    const pts = [0, this.total(), this.nowOut()];
    for (const c of Timeline.clips) pts.push(c.seqStart, c.seqEnd);
    try {
      const h = HeadlineStyle.timing();
      if (h.enabled) pts.push(h.start, h.start + h.duration);
    } catch (e) { /* no headline yet */ }
    for (const t of this.cfg.tracks) for (const c of t.clips) if (c.id !== excludeId) pts.push(c.start, c.start + c.dur);
    return pts;
  },

  snapTo(t) {
    if (!Timeline.snapping) return null;
    const tol = 8 / Timeline.pixelsPerSecond;
    let best = null, bd = tol;
    for (const p of this._snap) {
      const d = Math.abs(p - t);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  onLaneDown(e) {
    if (e.button !== 0) return;
    const laneEl = e.target.closest('.track-music');
    const clipEl = e.target.closest('.music-clip');
    if (laneEl && !clipEl && !e.target.closest('.track-label') && this.activeTrack !== laneEl.dataset.track) {
      this.activeTrack = laneEl.dataset.track;
      this._laneSig = '';
      this.renderLayers();
      Timeline.requestRender();
    }
    if (!clipEl) return;                 // empty lane: the timeline moves the needle
    const found = this.findClip(clipEl.dataset.id);
    if (!found) return;
    e.stopPropagation();
    e.preventDefault();
    if (typeof Timeline !== 'undefined') Timeline.selectedClipId = null;
    this.select(found.track.id, found.clip.id);
    this.showTab();                      // its settings are in the Música tab
    const h = e.target.dataset.h;
    const type = ['left', 'right', 'fadein', 'fadeout'].includes(h) ? h : 'move';
    this._snap = this.snapPoints(found.clip.id);
    this._drag = {
      type, clip: found.clip, track: found.track, x0: e.clientX, y0: e.clientY, moved: false,
      orig: { start: found.clip.start, in: found.clip.in, dur: found.clip.dur, fade_in: found.clip.fade_in, fade_out: found.clip.fade_out },
      song: this.item(found.clip.audio_id)?.duration || Infinity
    };
  },

  showTab() {
    const btn = document.querySelector('[data-tab=tab-music]');
    if (btn && !btn.classList.contains('active')) btn.click();
  },

  laneAt(y) {
    for (const t of this.cfg.tracks) {
      const l = this._lanes[t.id];
      if (!l) continue;
      const r = l.el.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) return t;
    }
    return null;
  },

  onDragMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    d.moved = true;
    const K = this.K, total = this.total(), c = d.clip, o = d.orig;
    let dt = (e.clientX - d.x0) / Timeline.pixelsPerSecond;
    const edge = t => { const s = this.snapTo(t); return s === null ? t : s; };

    if (d.type === 'move') {
      let start = Math.min(Math.max(0, o.start + dt), Math.max(0, total - K.min_clip_s));
      const a = this.snapTo(start), b = this.snapTo(start + o.dur);
      if (a !== null && (b === null || Math.abs(a - start) <= Math.abs(b - (start + o.dur)))) start = a;
      else if (b !== null) start = b - o.dur;
      c.start = mR3(Math.max(0, start));
      const lane = this.laneAt(e.clientY);
      if (lane && lane.id !== d.track.id) {              // dragged onto another layer
        d.track.clips = d.track.clips.filter(x => x.id !== c.id);
        lane.clips.push(c);
        d.track = lane;
        this.sel = { track: lane.id, clip: c.id };
        this.activeTrack = lane.id;
        this._laneSig = '';
        this.renderLayers();
      }
    } else if (d.type === 'left') {
      const lo = -Math.min(o.start, o.in), hi = o.dur - K.min_clip_s;
      let ns = edge(o.start + Math.min(hi, Math.max(lo, dt)));
      dt = Math.min(hi, Math.max(lo, ns - o.start));
      c.start = mR3(o.start + dt); c.in = mR3(o.in + dt); c.dur = mR3(o.dur - dt);
    } else if (d.type === 'right') {
      const maxDur = Math.max(K.min_clip_s, Math.min(d.song - o.in, total - o.start));
      let end = edge(o.start + o.dur + dt);
      c.dur = mR3(Math.min(maxDur, Math.max(K.min_clip_s, end - o.start)));
    } else if (d.type === 'fadein') {
      c.fade_in = mR3(Math.min(Math.max(0, o.fade_in + dt), Math.max(0, c.dur - c.fade_out)));
    } else if (d.type === 'fadeout') {
      c.fade_out = mR3(Math.min(Math.max(0, o.fade_out - dt), Math.max(0, c.dur - c.fade_in)));
    }
    this.clampFades(c);
    this._chansDirty = true;
    this.renderClipBox();
    Timeline.requestRender();
  },

  onDragEnd(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (!d.moved && e && d.type === 'move') {             // a plain click also puts the needle there
      Timeline.scrubTo(e.clientX);
      Timeline.flushSeek(true);
      const box = this.$('music-clip-box');
      if (box && !box.classList.contains('hidden')) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (d.moved) this.changed();
  },

  // --- Preview (Web Audio) ----------------------------------------------------------------
  audible() {
    const c = this.cfg;
    return !!c && c.enabled && c.tracks.some(t => !t.muted && t.volume > 0 && t.clips.some(x => x.volume > 0 && this.item(x.audio_id)));
  },

  normGain(lufs) {
    if (typeof lufs !== 'number' || !Number.isFinite(lufs)) return 1;
    const K = this.K;
    return Math.pow(10, Math.min(K.norm_max_db, Math.max(K.norm_min_db, K.target_lufs - lufs)) / 20);
  },

  // Gain of a clip at output time t: volume x layer x loudness of the song x the two fades (same as the render)
  gainAt(clip, track, item, t) {
    const local = t - clip.start;
    if (local < 0 || local > clip.dur) return 0;
    const K = this.K;
    let fi = clip.fade_in, fo = clip.fade_out;
    if (fi + fo > clip.dur) { const k = clip.dur / (fi + fo); fi *= k; fo *= k; }
    fi = Math.max(fi, K.min_fade_s); fo = Math.max(fo, K.min_fade_s);
    const gi = local < fi ? local / fi : 1;
    const go = local > clip.dur - fo ? Math.max(0, (clip.dur - local) / fo) : 1;
    return clip.volume * track.volume * this.normGain(item.lufs) * gi * go;
  },

  // One step of the voice-keyed compressor (the render's sidechaincompress): returns the new reduction in dB
  duckStep(red, levelDb, dt, db) {
    const K = this.K;
    const thr = K.duck_voice_db - db / (1 - 1 / K.duck_ratio);
    const target = Math.max(0, (levelDb - thr) * (1 - 1 / K.duck_ratio));
    const tau = target > red ? K.duck_attack_s : K.duck_release_s;
    return red + (target - red) * (1 - Math.exp(-Math.max(0, dt) / tau));
  },

  ensureEngine() {
    if (this.eng) return this.eng;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !Player.video) return null;
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      const voice = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      const duck = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();     // like the render's alimiter: only stops peaks
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.1;
      const src = ctx.createMediaElementSource(Player.video);   // from now on the video's sound goes through this graph
      src.connect(voice);
      voice.connect(analyser);
      voice.connect(limiter);
      duck.connect(limiter);
      limiter.connect(ctx.destination);
      this.eng = { ctx, voice, analyser, duck, out: limiter, buf: new Float32Array(analyser.fftSize), red: 0, last: 0 };
      this.applyVoiceGain();
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {});
        const again = () => { if (this.eng && this.eng.ctx.state !== 'running') this.eng.ctx.resume().catch(() => {}); };
        document.addEventListener('click', again, { once: true });
      }
    } catch (err) {
      console.warn('preview audio engine failed:', err);
      this.toast('O navegador não deixou tocar a música no preview. O vídeo final terá a música do mesmo jeito.', 'warning');
      return null;
    }
    return this.eng;
  },

  // The render normalises the voice to -14 LUFS before the music is added: the preview does the same to the voice
  applyVoiceGain() {
    if (!this.eng) return;
    let g = 1;
    if (this.audible() && this.voiceLufs !== null) {
      g = Math.pow(10, Math.min(12, Math.max(-12, this.K.target_lufs - this.voiceLufs)) / 20);
    }
    this.eng.voice.gain.value = g;
  },

  chan(clip, item) {
    let ch = this._chans.get(clip.id);
    if (ch) return ch;
    const eng = this.eng;
    const el = new Audio();
    el.preload = 'auto';
    el.src = item.url;
    const node = eng.ctx.createMediaElementSource(el);
    const gain = eng.ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(eng.duck);
    ch = { el, node, gain, warm: false };
    this._chans.set(clip.id, ch);
    return ch;
  },

  disposeChan(ch) {
    try { ch.el.pause(); ch.el.removeAttribute('src'); ch.el.load(); ch.node.disconnect(); ch.gain.disconnect(); } catch (e) { /* already gone */ }
  },

  silence(reset = false) {
    for (const ch of this._chans.values()) {
      if (!ch.el.paused) ch.el.pause();
      ch.gain.gain.value = 0;
      ch.warm = false;
    }
    if (this.eng) {
      this.eng.red = 0;
      this.eng.last = 0;
      this.eng.duck.gain.value = 1;
      if (reset || !this.audible()) this.eng.voice.gain.value = 1;
    }
  },

  // Runs with every video frame while playing (js/player.js): keeps each clip's <audio> where the video is
  syncAt() {
    if (!this.cfg || !Player.video) return;
    const playing = !Player.video.paused && !Player.video.ended;
    if (playing && this._audKey) this.stopAudition();
    if (!playing || !this.audible()) { this.silence(); return; }
    const eng = this.ensureEngine();
    if (!eng) return;
    if (this._chansDirty) {
      this._chansDirty = false;
      this.applyVoiceGain();
      const live = new Set();
      this.cfg.tracks.forEach(t => t.clips.forEach(c => live.add(c.id)));
      for (const [id, ch] of this._chans) if (!live.has(id)) { this.disposeChan(ch); this._chans.delete(id); }
    }

    const t = this.srcToOut(Player.video.currentTime);
    const now = performance.now();

    // the voice's level -> how much the music is lowered
    let red = 0;
    if (this.cfg.ducking.enabled) {
      eng.analyser.getFloatTimeDomainData(eng.buf);
      let sum = 0;
      for (let i = 0; i < eng.buf.length; i++) sum += eng.buf[i] * eng.buf[i];
      const db = 20 * Math.log10(Math.max(Math.sqrt(sum / eng.buf.length), 1e-6));
      eng.red = this.duckStep(eng.red, db, eng.last ? (now - eng.last) / 1000 : 0, this.cfg.ducking.db);
      red = eng.red;
    } else {
      eng.red = 0;
    }
    eng.last = now;
    eng.duck.gain.value = Math.pow(10, -red / 20);

    for (const track of this.cfg.tracks) {
      for (const clip of track.clips) {
        const item = this.item(clip.audio_id);
        if (!item || track.muted || track.volume <= 0 || clip.volume <= 0) {
          const dead = this._chans.get(clip.id);
          if (dead && !dead.el.paused) { dead.el.pause(); dead.gain.gain.value = 0; }
          continue;
        }
        const end = clip.start + clip.dur;
        const active = t >= clip.start && t < end;
        if (!active && !(t < clip.start && clip.start - t < 3)) {
          const idle = this._chans.get(clip.id);
          if (idle) { if (!idle.el.paused) idle.el.pause(); idle.gain.gain.value = 0; idle.warm = false; }
          continue;
        }
        const ch = this.chan(clip, item);
        if (active) {
          const want = clip.in + (t - clip.start);
          if (ch.el.paused) {
            try { ch.el.currentTime = want; } catch (e) { /* not loaded yet: it starts from the beginning of the cut */ }
            ch.el.play().catch(() => {});
          } else if (Math.abs(ch.el.currentTime - want) > 0.25) {
            ch.el.currentTime = want;
          }
          ch.gain.gain.value = this.gainAt(clip, track, item, t);
        } else {
          // about to start: get the file loaded and positioned so it starts on time
          if (!ch.warm) { ch.warm = true; try { ch.el.currentTime = clip.in; } catch (e) { /* ignore */ } }
          ch.gain.gain.value = 0;
        }
      }
    }
  }
};
