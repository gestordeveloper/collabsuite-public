// Motion graphics that FOLLOW something: a face, a hand, or any point you click on the picture.
//
// The server (backend/motion_track.py) analyses only the stretches of the video an item is on screen over and keeps, for
// that item, every anchor of the target (above the head, index fingertip...) in source time. This file asks for the
// smoothed path of the chosen anchor and moves the live preview with it (js/motionplayer.js); the final render slides the
// same graphic with ffmpeg along the same path, mapped onto the final frame the same way (backend/motion_track.py FrameMap).
//
// The item keeps its design centred in the frame; following only SHIFTS it, so changing the target, the anchor or the offset
// never needs a new Remotion render.

const MotionTrack = {
  // The server sends the same lists with the template catalog (backend/motion_track.py PARTS); these are only the first guess
  constants: {
    targets: ['face', 'hand', 'point'],
    parts: {
      face: ['head_top', 'forehead', 'center', 'chin', 'left', 'right'],
      hand: ['palm', 'index_tip', 'thumb_tip', 'middle_tip', 'pinky_tip', 'wrist'],
      point: ['point']
    },
    default_part: { face: 'head_top', hand: 'palm', point: 'point' },
    available: { face: true, hand: true, point: true }
  },
  cache: new Map(),          // item id -> { target, seed, covered, path, status, progress, error, part, smooth }
  _poll: new Map(),
  _auto: 0,
  _fetching: new Set(),
  picking: null,             // { itemId, layer }

  PART_LABELS: {
    head_top: 'Acima da cabeça', forehead: 'Testa', center: 'Meio do rosto', chin: 'Queixo', left: 'Lado esquerdo', right: 'Lado direito',
    palm: 'Palma da mão', wrist: 'Pulso', index_tip: 'Ponta do indicador', thumb_tip: 'Ponta do polegar', middle_tip: 'Ponta do dedo médio',
    pinky_tip: 'Ponta do mindinho', point: 'O ponto escolhido'
  },
  TARGET_LABELS: { face: 'o rosto', hand: 'a mão', point: 'o ponto' },

  $(id) { return document.getElementById(id); },
  toast(msg, type = 'info') { if (typeof App !== 'undefined') App.showToast(msg, type); },

  setConstants(follow) {
    if (!follow) return;
    this.constants = { ...this.constants, ...follow, available: { ...this.constants.available, ...(follow.available || {}) } };
  },

  isFollowing(item) { return !!(item && item.follow && ['face', 'hand', 'point'].includes(item.follow.target)); },

  cleanFollow(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const target = ['face', 'hand', 'point'].includes(r.target) ? r.target : 'none';
    const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const out = { target, part: 'center', dx: 0, dy: 0, smooth: 0.4, seed: null };
    if (target === 'none') return out;
    const parts = this.constants.parts[target] || [];
    out.part = parts.includes(r.part) ? r.part : (this.constants.default_part[target] || parts[0] || 'center');
    out.dx = Math.round(num(r.dx, -0.5, 0.5, 0) * 10000) / 10000;
    out.dy = Math.round(num(r.dy, -0.5, 0.5, 0) * 10000) / 10000;
    out.smooth = Math.round(num(r.smooth, 0, 1, 0.4) * 1000) / 1000;
    const s = r.seed;
    if (s && [s.t, s.x, s.y].every(v => Number.isFinite(Number(v)))) out.seed = { t: Number(s.t), x: Number(s.x), y: Number(s.y) };
    return out;
  },

  // ---------------------------------------------------------------------------
  // What has to be analysed, and whether what the server has still fits
  // ---------------------------------------------------------------------------
  // The stretches of the SOURCE video the item is on screen over (output-timeline start/duration -> clips)
  sourceRanges(item) {
    const a = item.start, b = item.start + item.duration, out = [];
    for (const c of (Timeline.clips || [])) {
      if (c.seqStart === undefined) continue;
      const lo = Math.max(a, c.seqStart), hi = Math.min(b, c.seqEnd);
      if (hi - lo > 0.001) {
        const s = c.start + (lo - c.seqStart);
        out.push([Math.max(0, s - 0.25), s + (hi - lo) + 0.25]);
      }
    }
    return out;
  },

  seedKey(s) { return s ? `${s.t.toFixed(3)},${s.x.toFixed(4)},${s.y.toFixed(4)}` : ''; },

  // 'none' (never analysed) | 'running' | 'error' | 'stale' (analysed for something else/another stretch) | 'ready'
  statusOf(item) {
    const st = this.cache.get(item.id);
    if (!st) return 'none';
    if (st.status === 'running') return 'running';
    if (st.status === 'error') return 'error';
    if (!st.analyzed || st.target !== item.follow.target || this.seedKey(st.seed) !== this.seedKey(item.follow.seed)) return 'none';
    const have = st.covered || [];
    const covered = this.sourceRanges(item).every(([a, b]) => have.some(([ca, cb]) => ca - 0.06 <= a && b <= cb + 0.06));
    return covered ? 'ready' : 'stale';
  },

  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------
  async fetchPath(item) {
    if (!Motion.projectId || !this.isFollowing(item) || this._fetching.has(item.id)) return;
    this._fetching.add(item.id);
    try {
      const f = item.follow;
      const res = await fetch(`/studiox/api/projects/${Motion.projectId}/motion/items/${item.id}/track?part=${encodeURIComponent(f.part)}&smooth=${f.smooth}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      this.cache.set(item.id, {
        status: d.status, progress: d.progress, error: d.error, analyzed: d.analyzed, target: d.target || null, seed: d.seed || null,
        covered: d.covered || [], path: d.path || null, part: f.part, smooth: f.smooth
      });
    } catch (err) {
      console.warn('motion track unavailable:', err);
    } finally {
      this._fetching.delete(item.id);
    }
    this.paint();
    if (typeof Fx !== 'undefined' && Fx.refresh) Fx.refresh();
  },

  async analyze(item, quiet = false) {
    if (!Motion.projectId || !this.isFollowing(item)) return;
    const f = item.follow;
    if (f.target === 'point' && !f.seed) { if (!quiet) this.toast('Clique no vídeo, no ponto que o gráfico deve seguir.', 'warning'); return; }
    const ranges = this.sourceRanges(item);
    if (!ranges.length) { if (!quiet) this.toast('Coloque o item sobre um trecho do vídeo (modo Sequência Contínua).', 'warning'); return; }
    this.cache.set(item.id, { ...(this.cache.get(item.id) || {}), status: 'running', progress: 0, error: '' });
    this.paint();
    try {
      const res = await fetch(`/studiox/api/projects/${Motion.projectId}/motion/items/${item.id}/track/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follow: f, ranges })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || `Erro ${res.status}`);
      if (d.status === 'running') this.poll(item); else await this.fetchPath(item);
    } catch (err) {
      this.cache.set(item.id, { ...(this.cache.get(item.id) || {}), status: 'error', error: err.message });
      this.paint();
      if (!quiet) this.toast(`Não foi possível analisar: ${err.message}`, 'error');
    }
  },

  poll(item) {
    clearTimeout(this._poll.get(item.id));
    this._poll.set(item.id, setTimeout(async () => {
      const cur = Motion.cfg && Motion.cfg.items.find(i => i.id === item.id);
      if (!cur) return;
      await this.fetchPath(cur);
      const st = this.cache.get(item.id);
      if (st && st.status === 'running') { this.poll(cur); return; }
      if (st && st.status === 'done') this.toast('Pronto: o gráfico já segue o alvo.', 'success');
      else if (st && st.status === 'error') this.toast(`A análise falhou: ${st.error}`, 'error');
    }, 700));
  },

  // After anything that can change what must be analysed: starts the analysis by itself (debounced), like the face camera does
  ensure(item, delay = 500) {
    clearTimeout(this._auto);
    if (!this.isFollowing(item)) { this.paint(); return; }
    this._auto = setTimeout(async () => {
      const cur = Motion.cfg && Motion.cfg.items.find(i => i.id === item.id);
      if (!cur || !this.isFollowing(cur)) return;
      if (!this.cache.has(cur.id)) await this.fetchPath(cur);
      const status = this.statusOf(cur);
      if ((status === 'none' || status === 'stale') && this.constants.available[cur.follow.target] !== false
          && (cur.follow.target !== 'point' || cur.follow.seed)) this.analyze(cur, true);
      else this.paint();
    }, delay);
  },

  forget(itemId) { this.cache.delete(itemId); clearTimeout(this._poll.get(itemId)); this._poll.delete(itemId); },

  // ---------------------------------------------------------------------------
  // Where the item is in the preview. (x, y) are fractions of the frame; {hidden} while the target is out of sight
  // ---------------------------------------------------------------------------
  positionAt(item, out) {
    if (!this.isFollowing(item)) return null;
    const st = this.cache.get(item.id);
    const p = st && st.path;
    if (!p || !p.t || !p.t.length || this.statusOf(item) === 'none') return null;   // not analysed yet: stays centred
    const src = Timeline.sequenceToSource(out);
    const half = 0.5 / (p.fps || 15);
    let run = null;
    for (const r of p.runs) if (src >= p.t[r[0]] - half && src <= p.t[r[1]] + half) { run = r; break; }
    if (!run) return { hidden: true };
    const t = Math.min(p.t[run[1]], Math.max(p.t[run[0]], src));
    let i = run[0];
    while (i < run[1] - 1 && p.t[i + 1] <= t) i++;
    const i1 = Math.min(run[1], i + 1);
    const u = i1 > i && p.t[i1] > p.t[i] ? (t - p.t[i]) / (p.t[i1] - p.t[i]) : 0;
    const x = p.x[i] + (p.x[i1] - p.x[i]) * u, y = p.y[i] + (p.y[i1] - p.y[i]) * u;
    const m = this.toFrame(x, y, src);
    return m ? { x: m.x + item.follow.dx, y: m.y + item.follow.dy } : null;
  },

  // A point of the source picture (fractions) -> fractions of the frame, through the same stages the render uses: the face
  // camera (js/fx.js trackPass) and the aspect-ratio canvas (js/canvasframe.js videoBox). The punch-in zoom is not modelled.
  toFrame(u, v, src) {
    const b = typeof CanvasFrame !== 'undefined' ? CanvasFrame.videoBox() : null;
    if (!b || !b.dw || !b.dh) return { x: u, y: v };
    let cu = u, cv = v;
    const tk = typeof FaceTrack !== 'undefined' ? FaceTrack.stateAt(src) : null;
    if (tk) {
      const win = Fx.visibleWindow(1, 1);
      const dw = tk.zoom;
      const x = Math.min(win.x, Math.max(win.x + win.w - dw, win.x + win.w * 0.5 - dw * tk.fx));
      const y = Math.min(win.y, Math.max(win.y + win.h - dw, win.y + win.h * tk.anchorY - dw * tk.fy));
      cu = x + dw * u;
      cv = y + dw * v;
    }
    return { x: (b.x0 + cu * b.dw) / b.cw, y: (b.y0 + cv * b.dh) / b.ch };
  },

  // ---------------------------------------------------------------------------
  // Picking the thing to follow on the picture
  // ---------------------------------------------------------------------------
  startPick(item) {
    if (this.picking) { this.stopPick(); return; }
    const wrap = this.$('video-container');
    if (!wrap || !Player.video) return;
    Player.video.pause();
    if (typeof FaceTrack !== 'undefined') { FaceTrack.picking = true; if (typeof Fx !== 'undefined') Fx.refresh(); }   // original framing, so a click lands where it looks
    const layer = document.createElement('div');
    layer.className = 'motion-pick-layer';
    layer.innerHTML = `<div class="motion-pick-hint">Clique em ${this.TARGET_LABELS[item.follow.target] || 'o alvo'} no vídeo</div>`;
    layer.addEventListener('click', e => this.onPick(e, item.id));
    wrap.appendChild(layer);
    this.picking = { itemId: item.id, layer };
    this.paint();
  },

  stopPick() {
    if (!this.picking) return;
    this.picking.layer.remove();
    this.picking = null;
    if (typeof FaceTrack !== 'undefined') { FaceTrack.picking = false; if (typeof Fx !== 'undefined') Fx.refresh(); }
    this.paint();
  },

  onPick(e, itemId) {
    const item = Motion.cfg.items.find(i => i.id === itemId);
    const b = CanvasFrame.videoBox();
    const wr = this.$('video-container').getBoundingClientRect();
    this.stopPick();
    if (!item || !b) return;
    const u = (e.clientX - wr.left - b.x0) / b.dw, v = (e.clientY - wr.top - b.y0) / b.dh;
    if (u < 0 || u > 1 || v < 0 || v > 1) { this.toast('Clique dentro da imagem do vídeo.', 'warning'); return; }
    item.follow.seed = { t: Math.round(Player.video.currentTime * 1000) / 1000, x: Math.round(u * 10000) / 10000, y: Math.round(v * 10000) / 10000 };
    this.cache.delete(item.id);
    Motion.changed();
    this.analyze(item);
  },

  // ---------------------------------------------------------------------------
  // Panel (inside the item box of js/motion.js)
  // ---------------------------------------------------------------------------
  bind() {
    const on = (id, ev, fn) => this.$(id)?.addEventListener(ev, fn);
    this.$('motion-follow-target')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-target]');
      if (b) this.setTarget(b.dataset.target);
    });
    on('motion-follow-part', 'change', e => this.edit({ part: e.target.value }, true));
    on('mo-follow-dx', 'input', e => this.edit({ dx: parseInt(e.target.value, 10) / 100 }));
    on('mo-follow-dy', 'input', e => this.edit({ dy: parseInt(e.target.value, 10) / 100 }));
    on('mo-follow-smooth', 'input', e => { this.edit({ smooth: parseInt(e.target.value, 10) / 100 }); clearTimeout(this._smooth); this._smooth = setTimeout(() => { const it = Motion.selected(); if (it) this.fetchPath(it); }, 250); });
    on('motion-follow-pick', 'click', () => { const it = Motion.selected(); if (it) this.startPick(it); });
    on('motion-follow-analyze', 'click', () => { const it = Motion.selected(); if (it) this.analyze(it); });
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab !== 'tab-motion') this.stopPick(); }));
  },

  setTarget(target) {
    const it = Motion.selected();
    if (!it) return;
    const prev = it.follow;
    it.follow = this.cleanFollow({ ...prev, target, part: this.constants.default_part[target], seed: target === prev.target ? prev.seed : null });
    if (target !== 'none' && this.constants.available[target] === false) this.toast('Este rastreio não está disponível nesta instalação.', 'warning');
    this.cache.set(it.id, { status: 'none', analyzed: false });   // forget an old result or error: what is followed changed
    Motion.changed();
    if (target === 'point') this.startPick(it);
    else this.ensure(it, 50);
  },

  edit(patch, refetch = false) {
    const it = Motion.selected();
    if (!it) return;
    it.follow = this.cleanFollow({ ...it.follow, ...patch });
    Motion.changed();
    if (refetch) this.fetchPath(it);
    this.paintValues(it);
  },

  paintValues(it) {
    const f = it.follow, $ = id => this.$(id);
    if ($('mo-follow-dx')) { $('mo-follow-dx-val').textContent = `${Math.round(f.dx * 100)}%`; }
    if ($('mo-follow-dy')) { $('mo-follow-dy-val').textContent = `${Math.round(f.dy * 100)}%`; }
    if ($('mo-follow-smooth-val')) $('mo-follow-smooth-val').textContent = f.smooth < 0.25 ? 'acompanha tudo' : (f.smooth > 0.7 ? 'bem suave' : 'suave');
  },

  paint() {
    const box = this.$('motion-follow-box');
    if (!box) return;
    const it = typeof Motion !== 'undefined' ? Motion.selected() : null;
    const tpl = it && Motion.template(it.template_id);
    box.classList.toggle('hidden', !(it && tpl && tpl.trackable));
    if (!it || !tpl || !tpl.trackable) return;
    const f = it.follow, $ = id => this.$(id);
    $('motion-follow-target').querySelectorAll('button[data-target]').forEach(b => {
      b.classList.toggle('active', b.dataset.target === f.target);
      b.disabled = b.dataset.target !== 'none' && this.constants.available[b.dataset.target] === false;
    });
    const following = this.isFollowing(it);
    $('motion-follow-cfg').classList.toggle('hidden', !following);
    if (!following) return;

    const partSel = $('motion-follow-part');
    const parts = this.constants.parts[f.target] || [];
    partSel.closest('.form-group').classList.toggle('hidden', parts.length < 2);
    if (partSel.dataset.target !== f.target) {
      partSel.innerHTML = parts.map(p => `<option value="${p}">${Motion.esc(this.PART_LABELS[p] || p)}</option>`).join('');
      partSel.dataset.target = f.target;
    }
    partSel.value = f.part;
    const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
    set('mo-follow-dx', Math.round(f.dx * 100));
    set('mo-follow-dy', Math.round(f.dy * 100));
    set('mo-follow-smooth', Math.round(f.smooth * 100));
    this.paintValues(it);

    const status = this.statusOf(it), st = this.cache.get(it.id) || {};
    const label = this.TARGET_LABELS[f.target];
    let msg, cls = '';
    if (this.constants.available[f.target] === false) { msg = 'Este rastreio não está disponível nesta instalação.'; cls = 'error'; }
    else if (this.picking && this.picking.itemId === it.id) msg = `Clique em ${label} no vídeo…`;
    else if (status === 'running') msg = `Procurando ${label} no vídeo… ${Math.round((st.progress || 0) * 100)}%`;
    else if (status === 'error') { msg = `A análise falhou: ${st.error || 'erro desconhecido'}`; cls = 'error'; }
    else if (f.target === 'point' && !f.seed) msg = 'Escolha o ponto no vídeo para começar.';
    else if (status === 'ready') {
      const p = st.path;
      if (!p || !p.t.length) { msg = `Não achei ${label} neste trecho do vídeo.`; cls = 'error'; }
      else {
        const dur = p.runs.reduce((s, r) => s + (p.t[r[1]] - p.t[r[0]]), 0), need = this.sourceRanges(it).reduce((s, r) => s + (r[1] - r[0] - 0.5), 0);
        msg = `✓ Encontrei ${label} em ${Math.round(Math.min(1, dur / Math.max(0.1, need)) * 100)}% do trecho. O gráfico só aparece enquanto o alvo está na imagem.`;
        cls = 'ok';
      }
    } else if (status === 'stale') msg = 'O item mudou de lugar: analise de novo para o gráfico seguir neste trecho.';
    else msg = `Ainda não analisei ${label} neste trecho.`;
    const stEl = $('motion-follow-status');
    stEl.textContent = msg;
    stEl.className = `track-status ${cls}`;
    const bar = $('motion-follow-progress');
    bar.classList.toggle('hidden', status !== 'running');
    bar.firstElementChild.style.width = `${Math.round((st.progress || 0) * 100)}%`;
    $('motion-follow-analyze').disabled = status === 'running' || (f.target === 'point' && !f.seed);
    $('motion-follow-analyze').textContent = status === 'ready' ? 'Analisar de novo' : 'Analisar';
    const pick = $('motion-follow-pick');
    pick.textContent = this.picking ? 'Cancelar escolha' : (f.target === 'point' ? 'Escolher o ponto' : `Escolher ${label} no vídeo`);
    pick.classList.toggle('active', !!this.picking);
    $('motion-follow-hint').textContent = f.target === 'hand' ? 'Dica: se aparecerem duas mãos, clique na que deve ser seguida.'
      : (f.target === 'face' ? 'Dica: com várias pessoas, clique no rosto da pessoa certa.' : 'Dica: escolha um ponto bem marcado (um objeto, uma gola, um dedo) e pause num quadro em que ele apareça nítido.');
  }
};
