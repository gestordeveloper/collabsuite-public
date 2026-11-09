// Choose what is shown of a video in the split screen. The video is laid out as a bar of pieces: cut it with the
// razor ("Dividir na agulha"), remove the pieces you do not want, drag the edges to fine tune. What stays is saved as
// a list of parts [[start, end], ...] in seconds OF THE FILE (backend/split_screen.py: `keep`). The parts play one
// after the other; if they are shorter than the scene they repeat, if longer the end is cut off.
//
// The pure helpers (total, locate, effective) are also used by the split-screen preview, so the preview and the
// render walk through the video the same way.

const MediaCut = {
  MIN: 0.2,          // shortest piece (same as MIN_KEEP_S in the backend)
  STRIP_FRAMES: 14,

  ctx: null,         // { media, keep, sceneDur, title, onSave }
  D: 0,
  pieces: [],        // contiguous [{a, b, keep}] covering the whole video
  sel: 0,
  drag: null,
  _bound: false,
  _stripToken: 0,

  $(id) { return document.getElementById(id); },
  toast(msg, type = 'info') { if (typeof App !== 'undefined') App.showToast(msg, type); },

  // --- Pure helpers ------------------------------------------------------------
  total(keep) { return keep.reduce((s, [a, b]) => s + (b - a), 0); },

  // Same clean-up as sanitize_keep in the backend: sorted, no overlaps, each part at least MIN long
  clean(raw) {
    const pairs = [];
    for (const r of (Array.isArray(raw) ? raw : []).slice(0, 60)) {
      if (!Array.isArray(r) || r.length !== 2) continue;
      const a = Math.min(36000, Math.max(0, Number(r[0]))), b = Math.min(36000, Math.max(0, Number(r[1])));
      if (Number.isFinite(a) && Number.isFinite(b) && b - a >= this.MIN) pairs.push([a, b]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of pairs) {
      const last = out[out.length - 1];
      if (last && a <= last[1] + 0.02) last[1] = Math.max(last[1], b); else out.push([a, b]);
    }
    return out.slice(0, 30).map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
  },

  // The parts of `keep` that exist in a file `duration` s long; [] = play all of it
  effective(keep, duration) {
    let parts = (keep || []).filter(r => Array.isArray(r) && r.length === 2 && r[1] - r[0] >= this.MIN);
    if (!parts.length) return [];
    if (duration > 0) {
      parts = parts.filter(([a]) => a < duration).map(([a, b]) => [a, Math.min(b, duration)]).filter(([a, b]) => b - a >= this.MIN);
      if (parts.length === 1 && parts[0][0] <= 0.05 && parts[0][1] >= duration - 0.05) return [];
    }
    return parts;
  },

  // Where a video that plays only its kept parts is when `local` seconds have passed (it repeats when it ends)
  locate(keep, local) {
    const total = this.total(keep);
    let t = total > 0 ? ((local % total) + total) % total : 0;
    for (const [a, b] of keep) {
      if (t < b - a) return { time: a + t, a, b };
      t -= b - a;
    }
    const [a, b] = keep[keep.length - 1];
    return { time: b, a, b };
  },

  fmt(s) {
    s = Math.max(0, Number(s) || 0);
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`.replace('.', ',');
  },

  // --- Pieces <-> parts ---------------------------------------------------------
  toPieces(keep, D) {
    const parts = this.effective(keep, D);
    if (!parts.length) return [{ a: 0, b: D, keep: true }];
    const out = [];
    let at = 0;
    for (const [a, b] of parts) {
      if (a - at > 0.001) out.push({ a: at, b: a, keep: false });
      out.push({ a, b, keep: true });
      at = b;
    }
    if (D - at > 0.001) out.push({ a: at, b: D, keep: false });
    return out;
  },

  toKeep() {
    const parts = this.pieces.filter(p => p.keep).map(p => [Math.round(p.a * 1000) / 1000, Math.round(p.b * 1000) / 1000]);
    if (parts.length === 1 && parts[0][0] <= 0.05 && parts[0][1] >= this.D - 0.05) return [];
    return parts;
  },

  // After a piece changes state it joins the neighbours that now have the same state (removed parts run together);
  // the other cuts stay where the user made them
  mergeAround(i) {
    const P = this.pieces;
    if (P[i + 1] && P[i + 1].keep === P[i].keep) { P[i].b = P[i + 1].b; P.splice(i + 1, 1); }
    if (P[i - 1] && P[i - 1].keep === P[i].keep) { P[i - 1].b = P[i].b; P.splice(i, 1); i--; }
    this.sel = i;
  },

  // --- Open / close ---------------------------------------------------------------
  init() {
    if (this._bound || !this.$('cut-modal')) return;
    this._bound = true;
    const on = (id, ev, fn) => this.$(id).addEventListener(ev, fn);
    on('cut-close', 'click', () => this.close());
    on('cut-cancel', 'click', () => this.close());
    on('cut-apply', 'click', () => this.apply());
    on('cut-play', 'click', () => this.togglePlay());
    on('cut-split', 'click', () => this.splitAtHead());
    on('cut-toggle', 'click', () => this.toggleSelected());
    on('cut-reset', 'click', () => { this.pieces = [{ a: 0, b: this.D, keep: true }]; this.sel = 0; this.render(); });
    on('cut-from', 'change', e => this.setSelectedEdge('a', parseFloat(e.target.value)));
    on('cut-to', 'change', e => this.setSelectedEdge('b', parseFloat(e.target.value)));

    const bar = this.$('cut-bar');
    bar.addEventListener('pointerdown', e => this.onBarDown(e));
    bar.addEventListener('pointermove', e => this.onBarMove(e));
    bar.addEventListener('pointerup', e => this.onBarUp(e));
    bar.addEventListener('pointercancel', e => this.onBarUp(e));

    const video = this.$('cut-video');
    video.addEventListener('timeupdate', () => this.onTime());
    video.addEventListener('play', () => this.syncPlayButton());
    video.addEventListener('pause', () => this.syncPlayButton());
    video.addEventListener('seeked', () => this.onTime());

    // While the window is open it owns the keyboard (the editor's shortcuts must not react behind it)
    window.addEventListener('keydown', e => this.onKey(e), true);
  },

  // ctx: { media, keep, sceneDur (s on screen, or null), title, onSave(keep) }
  async open(ctx) {
    this.init();
    if (!this.$('cut-modal')) return;
    if (typeof Player !== 'undefined' && Player.isPlaying) Player.togglePlay();
    this.ctx = ctx;
    this.D = 0;
    this.pieces = [];
    this.sel = 0;
    this.$('cut-title').textContent = `Escolher o que aparece: ${ctx.media.name}`;
    this.$('cut-warn').classList.add('hidden');
    this.$('cut-modal').classList.remove('hidden');

    const video = this.$('cut-video');
    const loaded = new Promise(resolve => {
      const done = ok => { video.removeEventListener('loadedmetadata', onOk); video.removeEventListener('error', onErr); resolve(ok); };
      const onOk = () => done(true), onErr = () => done(false);
      video.addEventListener('loadedmetadata', onOk);
      video.addEventListener('error', onErr);
    });
    video.muted = true;
    video.src = ctx.media.url;
    const ok = await loaded;
    if (this.ctx !== ctx) return;   // closed while loading
    let D = ok && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!ok) {
      this.$('cut-warn').textContent = 'O navegador não consegue tocar este formato de vídeo, então não há imagem aqui. Você ainda pode digitar os tempos.';
      this.$('cut-warn').classList.remove('hidden');
    }
    D = D || Number(ctx.media.duration) || 0;
    if (D <= 0) { this.close(); this.toast('Não consegui saber a duração desse vídeo.', 'error'); return; }
    this.D = D;
    this.pieces = this.toPieces(ctx.keep, D);
    this.sel = Math.max(0, this.pieces.findIndex(p => p.keep));
    this.render();
    if (ok) this.buildStrip(video.src, D);
    this.seek(this.pieces[this.sel] ? this.pieces[this.sel].a : 0);
  },

  close() {
    const video = this.$('cut-video');
    this.$('cut-modal').classList.add('hidden');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    this._stripToken++;
    this.ctx = null;
    this.drag = null;
  },

  apply() {
    if (!this.ctx) return;
    if (!this.pieces.some(p => p.keep)) { this.toast('Deixe pelo menos uma parte do vídeo.', 'warning'); return; }
    const { onSave } = this.ctx;
    const keep = this.toKeep();
    this.close();
    if (onSave) onSave(keep);
  },

  onKey(e) {
    if (!this.ctx) return;
    e.stopPropagation();
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      if (e.code === 'Escape') { e.target.blur(); }
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); this.togglePlay(); }
    else if (e.code === 'KeyS') { e.preventDefault(); this.splitAtHead(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.toggleSelected(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); this.seek(this.head() - (e.shiftKey ? 1 : 0.1)); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); this.seek(this.head() + (e.shiftKey ? 1 : 0.1)); }
  },

  // --- Playback -----------------------------------------------------------------
  head() { return this.$('cut-video').currentTime || 0; },

  seek(t) {
    const video = this.$('cut-video');
    t = Math.min(this.D, Math.max(0, t));
    try { video.currentTime = t; } catch (e) { /* no video to seek */ }
    this.selectAt(t);
    this.paintHead(t);
  },

  togglePlay() {
    const video = this.$('cut-video');
    if (!video.paused) { video.pause(); return; }
    if (this.$('cut-skip').checked) this.skipGone(video.currentTime, true);
    video.play().catch(() => {});
  },

  syncPlayButton() {
    const video = this.$('cut-video');
    this.$('cut-play').textContent = video.paused ? '▶ Tocar' : '❚❚ Pausar';
  },

  // With "skip removed parts" on, playback jumps over the removed pieces and stops after the last kept one
  skipGone(t, forStart = false) {
    if (!this.$('cut-skip').checked || !this.pieces.some(p => p.keep)) return false;
    const video = this.$('cut-video');
    const i = this.pieces.findIndex(p => t >= p.a && t < p.b);
    if (i >= 0 && this.pieces[i].keep) return false;
    const next = this.pieces.find((p, k) => k > i && p.keep);
    if (next) { video.currentTime = next.a; return true; }
    if (forStart) { video.currentTime = this.pieces.find(p => p.keep).a; return true; }
    video.pause();
    video.currentTime = this.pieces.find(p => p.keep).a;
    return true;
  },

  onTime() {
    const video = this.$('cut-video');
    if (!video.paused && !video.seeking) this.skipGone(video.currentTime);
    this.paintHead(video.currentTime);
    if (!video.paused) this.selectAt(video.currentTime, true);
  },

  selectAt(t, quiet = false) {
    const i = this.pieces.findIndex(p => t >= p.a && t < p.b + 0.0005);
    if (i >= 0 && i !== this.sel) { this.sel = i; if (quiet) this.paintSelection(); else this.render(); }
  },

  // --- Editing --------------------------------------------------------------------
  splitAtHead() {
    const t = this.head();
    const i = this.pieces.findIndex(p => t >= p.a && t < p.b);
    const p = this.pieces[i];
    if (!p || t - p.a < this.MIN || p.b - t < this.MIN) {
      this.toast('Coloque a agulha (clique na barra) no meio de uma parte, a pelo menos 0,2 s das pontas.', 'info');
      return;
    }
    this.pieces.splice(i, 1, { a: p.a, b: t, keep: p.keep }, { a: t, b: p.b, keep: p.keep });
    this.sel = i + 1;
    this.render();
  },

  toggleSelected() {
    const p = this.pieces[this.sel];
    if (!p) return;
    if (p.keep && this.pieces.filter(x => x.keep).length === 1) {
      this.toast('Pelo menos uma parte do vídeo precisa ficar.', 'warning');
      return;
    }
    p.keep = !p.keep;
    this.mergeAround(this.sel);
    this.render();
  },

  // Double click on a cut between two pieces in the same state: undo that cut
  undoCut(k) {
    const l = this.pieces[k], r = this.pieces[k + 1];
    if (!l || !r) return;
    if (l.keep !== r.keep) { this.toast('Essa ponta separa uma parte removida de outra que fica. Use “Remover” ou “Voltar com esta parte”.', 'info'); return; }
    l.b = r.b;
    this.pieces.splice(k + 1, 1);
    this.sel = k;
    this.render();
  },

  // Moves the edge between pieces k and k+1
  moveEdge(k, t) {
    const l = this.pieces[k], r = this.pieces[k + 1];
    if (!l || !r) return;
    const v = Math.min(r.b - this.MIN, Math.max(l.a + this.MIN, t));
    l.b = v;
    r.a = v;
  },

  setSelectedEdge(which, value) {
    if (!Number.isFinite(value)) { this.render(); return; }
    if (which === 'a' && this.sel > 0) this.moveEdge(this.sel - 1, value);
    if (which === 'b' && this.sel < this.pieces.length - 1) this.moveEdge(this.sel, value);
    this.render();
  },

  // --- Bar interaction -------------------------------------------------------------
  timeAt(e) {
    const r = this.$('cut-bar').getBoundingClientRect();
    return Math.min(this.D, Math.max(0, (e.clientX - r.left) / r.width * this.D));
  },

  onBarDown(e) {
    if (!this.ctx || !this.D) return;
    const bar = this.$('cut-bar');
    const handle = e.target.closest('[data-edge]');
    if (handle) {
      const k = parseInt(handle.dataset.edge, 10), now = performance.now();
      // (a double click is told apart here: with the pointer captured the browser aims click events at the bar)
      if (this._lastEdge && this._lastEdge.k === k && now - this._lastEdge.at < 400) { this._lastEdge = null; this.undoCut(k); e.preventDefault(); return; }
      this._lastEdge = { k, at: now };
      this.drag = { kind: 'edge', k };
    } else { this.drag = { kind: 'scrub' }; this.seek(this.timeAt(e)); }
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  },

  onBarMove(e) {
    if (!this.drag) return;
    const t = this.timeAt(e);
    if (this.drag.kind === 'edge') {
      this.moveEdge(this.drag.k, t);
      const p = this.pieces[this.drag.k];
      const video = this.$('cut-video');
      try { video.currentTime = p.b; } catch (err) { /* no video */ }
      this.layoutBar();
      this.paintHead(p.b);
      this.paintInfo();
    } else {
      this.seek(t);
    }
  },

  onBarUp(e) {
    if (!this.drag) return;
    try { this.$('cut-bar').releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    const wasEdge = this.drag.kind === 'edge';
    this.drag = null;
    if (wasEdge) this.render();
  },

  // --- Drawing ------------------------------------------------------------------------
  pct(t) { return `${(t / this.D * 100).toFixed(4)}%`; },

  // The media-time where the scene ends when the kept parts are longer than it
  cutoff() {
    const dur = this.ctx && this.ctx.sceneDur;
    const keep = this.pieces.filter(p => p.keep).map(p => [p.a, p.b]);
    if (!dur || !keep.length || this.total(keep) <= dur + 0.05) return null;
    return this.locate(keep, dur - 1e-6).time;
  },

  render() {
    if (!this.ctx) return;
    const box = this.$('cut-pieces');
    const cutoff = this.cutoff();
    let html = '';
    this.pieces.forEach((p, i) => {
      html += `<div class="cut-piece ${p.keep ? 'keep' : 'gone'} ${i === this.sel ? 'sel' : ''}" data-piece="${i}"></div>`;
      if (p.keep && cutoff !== null && cutoff < p.b) html += `<div class="cut-over" data-over="${i}"></div>`;
    });
    this.pieces.slice(0, -1).forEach((p, k) => { html += `<div class="cut-edge" data-edge="${k}" title="Arraste para ajustar o corte. Dois cliques desfazem o corte"></div>`; });
    if (cutoff !== null) html += '<div class="cut-end" title="Aqui termina a cena: o que vem depois não aparece"><span>fim da cena</span></div>';
    box.innerHTML = html;
    this.layoutBar();
    this.paintHead(this.head());
    this.paintInfo();
  },

  layoutBar() {
    const box = this.$('cut-pieces');
    const cutoff = this.cutoff();
    this.pieces.forEach((p, i) => {
      const el = box.querySelector(`[data-piece="${i}"]`);
      if (el) { el.style.left = this.pct(p.a); el.style.width = this.pct(p.b - p.a); }
      const over = box.querySelector(`[data-over="${i}"]`);
      if (over && cutoff !== null) { const from = Math.max(p.a, cutoff); over.style.left = this.pct(from); over.style.width = this.pct(p.b - from); }
    });
    box.querySelectorAll('[data-edge]').forEach(el => { el.style.left = this.pct(this.pieces[parseInt(el.dataset.edge, 10)].b); });
    const end = box.querySelector('.cut-end');
    if (end && cutoff !== null) end.style.left = this.pct(cutoff);
  },

  paintSelection() {
    this.$('cut-pieces').querySelectorAll('[data-piece]').forEach(el => el.classList.toggle('sel', parseInt(el.dataset.piece, 10) === this.sel));
    this.paintInfo();
  },

  paintHead(t) {
    if (!this.D) return;
    this.$('cut-head').style.left = this.pct(Math.min(this.D, t));
    this.$('cut-time').textContent = `${this.fmt(t)} / ${this.fmt(this.D)}`;
  },

  paintInfo() {
    const p = this.pieces[this.sel];
    const from = this.$('cut-from'), to = this.$('cut-to');
    if (p) {
      if (document.activeElement !== from) from.value = p.a.toFixed(2);
      if (document.activeElement !== to) to.value = p.b.toFixed(2);
      from.disabled = this.sel === 0;
      to.disabled = this.sel === this.pieces.length - 1;
      this.$('cut-piece-state').textContent = p.keep ? 'Esta parte aparece' : 'Esta parte foi removida';
      this.$('cut-piece-state').className = `cut-state ${p.keep ? 'keep' : 'gone'}`;
      this.$('cut-toggle').textContent = p.keep ? 'Remover esta parte' : '↩ Voltar com esta parte';
    }
    const kept = this.pieces.filter(x => x.keep);
    const total = kept.reduce((s, x) => s + (x.b - x.a), 0);
    const dur = this.ctx && this.ctx.sceneDur;
    let line = `Vai aparecer ${this.fmt(total)} de ${this.fmt(this.D)} (${kept.length} ${kept.length === 1 ? 'parte' : 'partes'}).`;
    if (dur) {
      if (total > dur + 0.05) line += ` A cena dura ${this.fmt(dur)}: o que passa da linha “fim da cena” não entra.`;
      else if (total < dur - 0.05) line += ` A cena dura ${this.fmt(dur)}: o trecho se repete do começo até completar.`;
      else line += ` Cabe certinho na cena de ${this.fmt(dur)}.`;
    }
    this.$('cut-summary').textContent = line;
  },

  // A strip of frames behind the bar, so you can see what is where. Made in the browser with a second video
  // element; if it cannot (unsupported format) the bar just stays plain.
  async buildStrip(src, D) {
    const token = ++this._stripToken;
    const canvas = this.$('cut-strip');
    const n = this.STRIP_FRAMES;
    const fw = 96, fh = 54;
    canvas.width = fw * n;
    canvas.height = fh;
    const g = canvas.getContext('2d');
    g.fillStyle = '#0b1020';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = src;
    try {
      await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = reject; });
      for (let i = 0; i < n; i++) {
        if (token !== this._stripToken) return;
        const at = Math.min(D - 0.05, (i + 0.5) / n * D);
        await new Promise((resolve, reject) => { v.onseeked = resolve; v.onerror = reject; v.currentTime = at; });
        const s = Math.max(fw / v.videoWidth, fh / v.videoHeight);
        const w = v.videoWidth * s, h = v.videoHeight * s;
        g.drawImage(v, i * fw + (fw - w) / 2, (fh - h) / 2, w, h);
      }
    } catch (err) { /* the strip is only a help */ }
    v.removeAttribute('src');
    v.load();
  }
};
