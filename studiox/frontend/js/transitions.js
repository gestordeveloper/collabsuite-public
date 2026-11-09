// Transitions of the cuts: the library (ready-made + the ones the user builds or imports), the sound of the cuts, and the
// choice of a transition / sound for a SINGLE cut.
//
// What is saved with the project (edit.*), and with the templates for the first one:
//   transition (all the cuts)  +  transition_sound {id, volume, offset} (the sound every cut plays by default)
//   cut_transitions { "<source start of the clip after the cut>": { transition, scale, sound } } — only the cuts the user
//   changed; every other cut follows the video's default. Splitting or moving other clips keeps these choices.
//
// The render (backend/transitions.py::resolve_cuts) and the preview (js/fx.js) resolve a cut the same way: resolveCut().

const Transitions = {
  DEFAULT_SOUND: { id: '', volume: 0.8, offset: 0 },
  FX: {   // what the builder offers (backend/transitions.py::sanitize_fx keeps the same ranges)
    veil: { label: 'Clarão ou fade', hint: 'A imagem vai a uma cor no corte e volta.', add: { type: 'veil', color: 'white', pre: 0.07, post: 0.17 }, params: [
      { k: 'color', label: 'Cor', opts: [['black', 'Preto'], ['white', 'Branco']] },
      { k: 'pre', label: 'Antes do corte', min: 0, max: 1.5, step: 0.01, fmt: v => `${v.toFixed(2)} s` },
      { k: 'post', label: 'Depois do corte', min: 0, max: 1.5, step: 0.01, fmt: v => `${v.toFixed(2)} s` }] },
    still: { label: 'Fusão ou deslize', hint: 'O último quadro do clipe anterior se dissolve ou sai deslizando.', add: { type: 'still', mode: 'slide', dir: 'left', dur: 0.3, blur: 20 }, params: [
      { k: 'mode', label: 'Como sai', opts: [['fade', 'Dissolve'], ['slide', 'Desliza']] },
      { k: 'dir', label: 'Para onde', opts: [['left', 'Esquerda'], ['right', 'Direita'], ['up', 'Cima'], ['down', 'Baixo']], when: f => f.mode === 'slide' },
      { k: 'dur', label: 'Duração', min: 0.05, max: 2, step: 0.01, fmt: v => `${v.toFixed(2)} s` },
      { k: 'blur', label: 'Borrão de movimento', min: 0, max: 60, step: 1, fmt: v => `${Math.round(v)} px`, when: f => f.mode === 'slide' }] },
    zoom: { label: 'Zoom de entrada', hint: 'O novo clipe entra ampliado e assenta.', add: { type: 'zoom', amount: 0.25, dur: 0.3 }, params: [
      { k: 'amount', label: 'Quanto amplia', min: 0.02, max: 1, step: 0.01, fmt: v => `+${Math.round(v * 100)}%` },
      { k: 'dur', label: 'Duração', min: 0.05, max: 1.5, step: 0.01, fmt: v => `${v.toFixed(2)} s` }] },
    rgb: { label: 'Glitch RGB', hint: 'As cores se separam por um instante.', add: { type: 'rgb', amount: 0.02, pre: 0.05, post: 0.15 }, params: [
      { k: 'amount', label: 'Separação', min: 0.002, max: 0.08, step: 0.002, fmt: v => `${(v * 100).toFixed(1)}%` },
      { k: 'pre', label: 'Antes do corte', min: 0, max: 1, step: 0.01, fmt: v => `${v.toFixed(2)} s` },
      { k: 'post', label: 'Depois do corte', min: 0, max: 1, step: 0.01, fmt: v => `${v.toFixed(2)} s` }] },
    blur: { label: 'Desfoque', hint: 'A imagem desfoca até o corte e volta a focar.', add: { type: 'blur', sigma: 14, pre: 0.2, post: 0.2 }, params: [
      { k: 'sigma', label: 'Intensidade', min: 1, max: 40, step: 1, fmt: v => `${Math.round(v)}` },
      { k: 'pre', label: 'Antes do corte', min: 0, max: 1, step: 0.01, fmt: v => `${v.toFixed(2)} s` },
      { k: 'post', label: 'Depois do corte', min: 0, max: 1, step: 0.01, fmt: v => `${v.toFixed(2)} s` }] },
    overlay: { label: 'Vídeo ou PNG importado', hint: 'Um arquivo seu (light leak, glitch, fumaça…) sobreposto ao corte.', add: { type: 'overlay', media: '', mode: 'alpha', dur: 1, align: 'center', fade: 0 }, params: [
      { k: 'mode', label: 'Como o fundo é tratado', opts: [['alpha', 'Já tem transparência'], ['screen', 'Fundo preto some (soma luz)'], ['green', 'Fundo verde some']] },
      { k: 'dur', label: 'Tempo na tela', min: 0.1, max: 6, step: 0.05, fmt: v => `${v.toFixed(2)} s` },
      { k: 'align', label: 'Posição no corte', opts: [['center', 'Centrada no corte'], ['start', 'Começa no corte'], ['end', 'Termina no corte']] },
      { k: 'fade', label: 'Entrada e saída suaves', min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` }] }
  },

  state: null,
  lib: { transitions: [], media: [], sounds: [], limits: {}, soundRanges: {} },
  version: 0,       // bumped by every change: the preview caches things per version
  draft: null,      // the transition being built
  _cutPop: null,
  _builderDemo: null,

  $(id) { return document.getElementById(id); },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  keyOf(start) { return (Math.round(Number(start) * 1000) / 1000).toFixed(3); },
  num(v, lo, hi, d) { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; },

  // --- Config -----------------------------------------------------------------
  cleanSound(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id === 'none' ? 'none' : (/^[a-z0-9_]{1,60}$/.test(raw.id || '') ? raw.id : '');
    return { id, volume: this.num(raw.volume, 0, 1.5, 0.8), offset: this.num(raw.offset, -0.6, 0.6, 0) };
  },

  clean(src) {
    const s = src && typeof src === 'object' ? src : {};
    const cuts = {};
    const raw = s.cut_transitions && typeof s.cut_transitions === 'object' ? s.cut_transitions : {};
    for (const [key, o] of Object.entries(raw)) {
      if (!/^\d{1,7}(\.\d{1,3})?$/.test(key) || !o || typeof o !== 'object') continue;
      const entry = {
        transition: typeof o.transition === 'string' ? o.transition : '',
        scale: o.scale == null ? null : this.num(o.scale, 0.5, 2, 1),
        sound: this.cleanSound(o.sound)
      };
      if (entry.sound && !entry.sound.id) entry.sound = null;
      if (entry.transition || entry.scale != null || entry.sound) cuts[Number(key).toFixed(3)] = entry;
    }
    return { sound: this.cleanSound(s.transition_sound) || { ...this.DEFAULT_SOUND }, cuts };
  },

  exportConfig() {
    return { transition_sound: { ...this.state.sound }, cut_transitions: JSON.parse(JSON.stringify(this.state.cuts)) };
  },

  // From a saved edit or a template (nothing saved = no sound, no cut with its own transition). `keepCuts`: a template
  // only carries the video's default sound; the cuts the user changed belong to the video
  applyExternal(src, keepCuts = false) {
    const next = this.clean(src);
    if (keepCuts && this.state) next.cuts = this.state.cuts;
    this.state = next;
    this.touch();
  },

  touch() {
    this.version++;
    this.paintPanel();
    this.paintBadges();
    if (typeof Fx !== 'undefined') Fx.refresh();
    if (typeof Looks !== 'undefined' && Looks.demoRestart) Looks.demoRestart();
  },

  // --- Library ------------------------------------------------------------------
  async init() {
    this.state = this.clean(null);
    this.bind();
    await this.load();
  },

  async load() {
    try {
      const res = await fetch('/studiox/api/transitions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.lib = { transitions: data.transitions || [], media: data.media || [], sounds: data.sounds || [], limits: data.limits || {},
                   soundRanges: data.sound_defaults || {} };
      if (TemplatesManager.catalog) TemplatesManager.catalog.transitions = this.lib.transitions;
    } catch (err) {
      console.warn('Transition library failed:', err);
    }
    if (!this.def(TemplatesManager.selectedTransition)) TemplatesManager.selectedTransition = 'micro_fade_30ms';
    for (const [key, o] of Object.entries(this.state.cuts)) {   // a transition that was deleted since: the cut follows the video
      if (o.transition && !this.def(o.transition)) { o.transition = ''; if (!o.scale && !o.sound) delete this.state.cuts[key]; }
    }
    TemplatesManager.renderTransitionCards();
    this.version++;
    this.paintPanel();
    this.paintBadges();
    if (typeof Fx !== 'undefined') Fx.refresh();
  },

  def(id) { return (this.lib.transitions.length ? this.lib.transitions : ((TemplatesManager.catalog && TemplatesManager.catalog.transitions) || [])).find(t => t.id === id) || null; },
  mediaInfo(id) { return this.lib.media.find(m => m.id === id) || null; },
  soundDef(id) { return this.lib.sounds.find(s => s.id === id) || null; },
  soundUrl(id) { return this.soundDef(id) ? `/studiox/api/sfx/${encodeURIComponent(id)}/audio` : ''; },
  peakOf(id) { const s = this.soundDef(id); return s ? Number(s.peak) || 0 : 0; },

  // --- What a cut gets (mirror of backend/transitions.py::resolve_cuts) ---------------
  resolveCut(nextStart) {
    if (!this.state) this.state = this.clean(null);
    const o = this.state.cuts[this.keyOf(nextStart)] || null;
    const base = TemplatesManager.selectedTransition;
    const tid = o && o.transition && this.def(o.transition) ? o.transition : (this.def(base) ? base : 'micro_fade_30ms');
    const scale = o && o.scale != null ? o.scale : Looks.state.transitionScale;
    let snd = null;
    if (o && o.sound && o.sound.id) snd = o.sound;
    else if (this.state.sound.id) snd = this.state.sound;
    else { const own = (this.def(tid) || {}).sound; if (own && own.id) snd = own; }
    if (snd && (snd.id === 'none' || !snd.id || !this.soundDef(snd.id))) snd = null;
    return { id: tid, scale, effects: Fx.effects(tid, scale), sound: snd, custom: !!o };
  },

  setCut(nextStart, patch) {
    const key = this.keyOf(nextStart);
    const cur = this.state.cuts[key] || { transition: '', scale: null, sound: null };
    const next = { ...cur, ...patch };
    if (next.sound && !next.sound.id) next.sound = null;
    if (next.transition || next.scale != null || next.sound) this.state.cuts[key] = next; else delete this.state.cuts[key];
    this.touch();
    if (this._cutPop) this.paintCutPop();
  },

  clearAllCuts() {
    this.state.cuts = {};
    this.touch();
  },

  // --- Timeline badges ----------------------------------------------------------------
  badgeFor(nextClip) {
    if (!nextClip) return { icon: '⚡', title: '', cls: '', key: '' };
    const r = this.resolveCut(nextClip.start);
    const d = this.def(r.id);
    const name = d ? d.name : 'Corte seco';
    const snd = r.sound ? ` + som “${(this.soundDef(r.sound.id) || {}).name || ''}”` : '';
    const title = `${r.custom ? 'Transição deste corte' : 'Transição'}: ${name}${snd}. Clique para trocar só este corte.`;
    const icon = d ? d.icon : '⚡';
    return { icon: r.sound && !r.effects.length ? '🔊' : icon, title, cls: r.custom ? 'custom' : '', key: `${icon}|${title}|${r.custom}` };
  },

  paintBadges() {
    if (typeof Timeline !== 'undefined' && Timeline.requestRender) Timeline.requestRender();
  },

  // --- Panel of the Transições tab ----------------------------------------------------------
  soundOptions(selected, first) {
    const mk = (v, name) => `<option value="${this.esc(v)}"${v === selected ? ' selected' : ''}>${this.esc(name)}</option>`;
    const own = this.lib.sounds.filter(s => s.kind === 'user');
    return first.map(([v, n]) => mk(v, n)).join('')
      + `<optgroup label="Sons prontos">${this.lib.sounds.filter(s => s.kind !== 'user').map(s => mk(s.id, s.name)).join('')}</optgroup>`
      + (own.length ? `<optgroup label="Meus sons">${own.map(s => mk(s.id, s.name)).join('')}</optgroup>` : '');
  },

  paintPanel() {
    if (!this.state) return;
    const $ = id => this.$(id);
    const snd = this.state.sound;
    const sel = $('tx-sound');
    if (sel) {
      const html = this.soundOptions(snd.id, [['', 'Automático (o som da própria transição, se tiver)'], ['none', 'Sem som']]);
      if (sel._html !== html) { sel._html = html; sel.innerHTML = html; }
      sel.value = snd.id;
    }
    const picked = snd.id && snd.id !== 'none';
    $('tx-sound-box')?.classList.toggle('has-sound', !!picked);
    if ($('tx-sound-volume') && document.activeElement !== $('tx-sound-volume')) $('tx-sound-volume').value = Math.round(snd.volume * 100);
    if ($('tx-sound-volume-val')) $('tx-sound-volume-val').textContent = `${Math.round(snd.volume * 100)}%`;
    if ($('tx-sound-offset') && document.activeElement !== $('tx-sound-offset')) $('tx-sound-offset').value = Math.round(snd.offset * 100);
    if ($('tx-sound-offset-val')) $('tx-sound-offset-val').textContent = `${snd.offset > 0 ? '+' : ''}${snd.offset.toFixed(2)} s`;
    const mine = picked && (this.soundDef(snd.id) || {}).kind === 'user';
    if ($('btn-tx-sound-del')) $('btn-tx-sound-del').classList.toggle('hidden', !mine);
    const n = Object.keys(this.state.cuts).length;
    if ($('tx-cuts-summary')) $('tx-cuts-summary').textContent = n
      ? `${n} corte${n > 1 ? 's' : ''} com transição ou som próprio (aparecem em destaque na timeline).`
      : 'Todos os cortes seguem a transição escolhida acima. Para mudar só um corte, clique na bolinha dele na timeline.';
    $('btn-tx-cuts-clear')?.classList.toggle('hidden', !n);
  },

  bind() {
    const on = (id, ev, fn) => this.$(id) && this.$(id).addEventListener(ev, fn);
    // sound of the cuts
    on('tx-sound', 'change', e => { this.state.sound.id = e.target.value; this.touch(); });
    on('tx-sound-volume', 'input', e => { this.state.sound.volume = parseInt(e.target.value, 10) / 100; this.touch(); });
    on('tx-sound-offset', 'input', e => { this.state.sound.offset = parseInt(e.target.value, 10) / 100; this.touch(); });
    on('btn-tx-sound-play', 'click', () => {
      const s = this.state.sound;
      if (s.id && s.id !== 'none') Fx.playSound(s.id, s.volume); else App.showToast('Escolha um som para ouvir.', 'warning');
    });
    on('btn-tx-sound-upload', 'click', () => this.$('tx-sound-file').click());
    on('tx-sound-file', 'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.uploadSound(f).then(id => { if (id) { this.state.sound.id = id; this.touch(); } }); });
    on('btn-tx-sound-del', 'click', () => this.deleteSound(this.state.sound.id));
    on('btn-tx-cuts-clear', 'click', () => { if (confirm('Voltar todos os cortes para a transição e o som padrão do vídeo?')) this.clearAllCuts(); });
    // library
    on('btn-tx-new', 'click', () => this.openBuilder(null));
    on('btn-tx-import', 'click', () => this.$('tx-media-file').click());
    on('tx-media-file', 'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.importMedia(f); });
    this.$('transition-template-list')?.addEventListener('click', e => {
      const b = e.target.closest('[data-tx-act]');
      if (!b) return;
      e.stopPropagation();   // the card itself must not be chosen
      const id = b.dataset.id;
      if (b.dataset.txAct === 'edit') this.openBuilder(this.def(id));
      else if (b.dataset.txAct === 'dup') this.openBuilder({ ...this.def(id), id: null, name: `${this.def(id).name} (cópia)` });
      else if (b.dataset.txAct === 'del') this.deleteTransition(id);
    });
    this.bindBuilder();
    document.addEventListener('mousedown', e => {
      if (this._cutPop && !e.target.closest('#cut-pop') && !e.target.closest('.clip-transition-badge')) this.closeCutPop();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { this.closeCutPop(); this.closeBuilder(); } });
  },

  // Buttons of a card of the catalog (TemplatesManager.renderTransitionCards asks for them)
  cardActions(tpl) {
    const b = (act, label, title) => `<button type="button" class="tx-card-btn" data-tx-act="${act}" data-id="${this.esc(tpl.id)}" title="${title}">${label}</button>`;
    if (tpl.kind === 'custom') return `<div class="tx-card-actions">${b('edit', '✎ Editar', 'Editar esta transição')}${b('dup', '⧉ Duplicar', 'Criar uma cópia para alterar')}${b('del', '✕', 'Excluir esta transição')}</div>`;
    return `<div class="tx-card-actions">${b('dup', '⧉ Personalizar', 'Cria uma cópia desta transição para você alterar')}</div>`;
  },

  // --- Sounds ------------------------------------------------------------------------------
  async uploadSound(file) {
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/studiox/api/sfx', { method: 'POST', body });
      if (!res.ok) { let d = `erro ${res.status}`; try { d = (await res.json()).detail || d; } catch (e) { /* not JSON */ } throw new Error(d); }
      const item = await res.json();
      await this.load();
      App.showToast(`Som “${item.name}” adicionado.`, 'success');
      return item.id;
    } catch (err) {
      App.showToast(`Não foi possível usar este som: ${err.message}`, 'error');
      return '';
    }
  },

  async deleteSound(id) {
    const item = this.soundDef(id);
    if (!item || !confirm(`Excluir o som “${item.name}”? Cortes que o usam ficam sem som.`)) return;
    try {
      const res = await fetch(`/studiox/api/sfx/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`erro ${res.status}`);
      if (this.state.sound.id === id) this.state.sound.id = '';
      for (const o of Object.values(this.state.cuts)) if (o.sound && o.sound.id === id) o.sound = null;
      await this.load();
      this.touch();
    } catch (err) {
      App.showToast(`Não foi possível excluir: ${err.message}`, 'error');
    }
  },

  // --- Imported media and the transitions of the library -------------------------------------------
  async uploadMedia(file) {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/studiox/api/transitions/media', { method: 'POST', body });
    if (!res.ok) { let d = `erro ${res.status}`; try { d = (await res.json()).detail || d; } catch (e) { /* not JSON */ } throw new Error(d); }
    return res.json();
  },

  // "Importar vídeo/PNG": uploads the file and opens the builder with it already laid over the cut
  async importMedia(file) {
    try {
      App.showToast('Enviando…', 'info');
      const item = await this.uploadMedia(file);
      await this.load();
      const fx = { ...this.FX.overlay.add, media: item.id, mode: item.alpha ? 'alpha' : 'screen', dur: Math.min(6, item.kind === 'image' ? 0.6 : Math.max(0.1, item.duration)) };
      this.openBuilder({ id: null, name: item.name, icon: '🎞️', fx: [fx] });
    } catch (err) {
      App.showToast(`Não foi possível importar: ${err.message}`, 'error');
    }
  },

  async deleteTransition(id) {
    const d = this.def(id);
    if (!d || !confirm(`Excluir a transição “${d.name}”? Cortes que a usam voltam à transição do vídeo.`)) return;
    try {
      const res = await fetch(`/studiox/api/transitions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`erro ${res.status}`);
      if (TemplatesManager.selectedTransition === id) TemplatesManager.selectedTransition = 'micro_fade_30ms';
      await this.load();
      this.touch();
      Looks.changed();
    } catch (err) {
      App.showToast(`Não foi possível excluir: ${err.message}`, 'error');
    }
  },

  // --- The builder ---------------------------------------------------------------------------------
  openBuilder(base) {
    const b = base || { id: null, name: '', icon: '🎞️', fx: [], sound: null };
    this.draft = {
      id: b.id && String(b.id).startsWith('c_') ? b.id : null,
      name: b.name || '', icon: b.icon || '🎞️',
      fx: JSON.parse(JSON.stringify(b.fx || [])),
      sound: this.cleanSound(b.sound) || { ...this.DEFAULT_SOUND }
    };
    this.$('tx-builder').classList.remove('hidden');
    this.$('tx-b-title').textContent = this.draft.id ? 'Editar transição' : 'Criar transição';
    this.$('tx-b-name').value = this.draft.name;
    this.$('tx-b-icon').value = this.draft.icon;
    this.$('tx-b-error').textContent = '';
    this.paintBuilder();
    this.$('tx-b-name').focus();
  },

  closeBuilder() {
    const el = this.$('tx-builder');
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    if (this._builderDemo) this._builderDemo.stop();
    this.draft = null;
  },

  bindBuilder() {
    const on = (id, ev, fn) => this.$(id) && this.$(id).addEventListener(ev, fn);
    on('tx-b-close', 'click', () => this.closeBuilder());
    on('tx-b-cancel', 'click', () => this.closeBuilder());
    on('tx-b-name', 'input', e => { this.draft.name = e.target.value; });
    on('tx-b-icon', 'input', e => { this.draft.icon = e.target.value; });
    on('tx-b-add-btn', 'click', () => {
      const kind = this.$('tx-b-add').value;
      if (!kind || this.draft.fx.length >= (this.lib.limits.max_fx || 6)) { if (kind) App.showToast('Uma transição aceita até 6 efeitos.', 'warning'); return; }
      this.draft.fx.push({ ...this.FX[kind].add });
      this.paintBuilder();
    });
    on('tx-b-sound', 'change', e => { this.draft.sound.id = e.target.value; this.paintBuilder(false); });
    on('tx-b-sound-volume', 'input', e => { this.draft.sound.volume = parseInt(e.target.value, 10) / 100; this.paintBuilder(false); });
    on('btn-tx-b-play', 'click', () => {
      const s = this.draft.sound;
      if (s.id && s.id !== 'none') Fx.playSound(s.id, s.volume); else App.showToast('Escolha um som para ouvir.', 'warning');
    });
    on('tx-b-restart', 'click', () => this.restartBuilderDemo());
    on('tx-b-save', 'click', () => this.saveBuilder());
    on('tx-b-upload', 'change', async e => {
      const f = e.target.files[0]; const i = Number(e.target.dataset.fx); e.target.value = '';
      if (!f || !this.draft || !this.draft.fx[i]) return;
      try {
        const item = await this.uploadMedia(f);
        await this.load();
        Object.assign(this.draft.fx[i], { media: item.id, mode: item.alpha ? 'alpha' : this.draft.fx[i].mode,
          dur: Math.min(6, item.kind === 'image' ? 0.6 : Math.max(0.1, item.duration)) });
        this.paintBuilder();
      } catch (err) { App.showToast(`Não foi possível importar: ${err.message}`, 'error'); }
    });
    const list = this.$('tx-b-fx');
    list?.addEventListener('input', e => {
      const el = e.target.closest('[data-k][type="range"]');
      if (!el || !this.draft) return;
      const row = el.closest('.tx-fx'), fx = this.draft.fx[Number(row.dataset.i)], p = this.FX[fx.type].params.find(q => q.k === el.dataset.k);
      fx[el.dataset.k] = parseFloat(el.value);
      const out = row.querySelector(`[data-val="${el.dataset.k}"]`);
      if (out && p) out.textContent = p.fmt(fx[el.dataset.k]);
      this.restartBuilderDemo();
    });
    list?.addEventListener('change', e => {
      const el = e.target.closest('select[data-k]');
      if (!el || !this.draft) return;
      const fx = this.draft.fx[Number(el.closest('.tx-fx').dataset.i)];
      fx[el.dataset.k] = el.value;
      if (el.dataset.k === 'media') {
        const m = this.mediaInfo(el.value);
        if (m) { fx.dur = Math.min(6, m.kind === 'image' ? 0.6 : Math.max(0.1, m.duration)); if (m.alpha) fx.mode = 'alpha'; }
      }
      this.paintBuilder();
    });
    list?.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !this.draft) return;
      const i = Number(b.closest('.tx-fx').dataset.i);
      if (b.dataset.act === 'rm') { this.draft.fx.splice(i, 1); this.paintBuilder(); }
      else if (b.dataset.act === 'upload') { const inp = this.$('tx-b-upload'); inp.dataset.fx = String(i); inp.click(); }
    });
  },

  paintBuilder() {
    const d = this.draft;
    if (!d) return;
    const rows = d.fx.map((fx, i) => {
      const def = this.FX[fx.type];
      const params = def.params.filter(p => !p.when || p.when(fx)).map(p => p.opts
        ? `<div class="form-group"><label>${p.label}</label><select class="text-input" data-k="${p.k}">${p.opts.map(([v, n]) => `<option value="${v}"${fx[p.k] === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`
        : `<div class="grade-row"><div class="grade-row-head"><label>${p.label}</label><span class="grade-val" data-val="${p.k}">${p.fmt(fx[p.k])}</span></div>
             <input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${fx[p.k]}"></div>`).join('');
      let media = '';
      if (fx.type === 'overlay') {
        const m = this.mediaInfo(fx.media);
        const opts = this.lib.media.map(x => `<option value="${this.esc(x.id)}"${x.id === fx.media ? ' selected' : ''}>${this.esc(x.name)} (${x.kind === 'image' ? 'imagem' : x.duration.toFixed(1) + ' s'})</option>`).join('');
        const warn = m && fx.mode === 'alpha' && !m.alpha ? '<p class="field-hint tx-warn">Este arquivo parece não ter transparência: escolha “Fundo preto some” ou “Fundo verde some”, senão ele cobre a imagem toda.</p>' : '';
        media = `<div class="form-group"><label>Arquivo</label>
          <div class="tx-media-row"><select class="text-input" data-k="media"><option value="">Escolha um arquivo…</option>${opts}</select>
          <button type="button" class="btn btn-secondary btn-sm" data-act="upload">⬆ Enviar</button></div>${warn}</div>`;
      }
      return `<div class="tx-fx" data-i="${i}"><div class="tx-fx-head"><strong>${def.label}</strong><button type="button" class="tx-card-btn" data-act="rm" title="Remover este efeito">✕</button></div>
        <p class="field-hint" style="margin:0 0 6px">${def.hint}</p>${media}${params}</div>`;
    }).join('');
    this.$('tx-b-fx').innerHTML = rows || '<p class="field-hint">Nenhum efeito ainda. Escolha um abaixo e clique em “Adicionar”.</p>';
    const add = this.$('tx-b-add');
    if (!add.options.length) add.innerHTML = Object.entries(this.FX).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const sel = this.$('tx-b-sound');
    sel.innerHTML = this.soundOptions(d.sound.id, [['', 'Sem som']]);
    sel.value = d.sound.id;
    this.$('tx-b-sound-volume').value = Math.round(d.sound.volume * 100);
    this.$('tx-b-sound-volume-val').textContent = `${Math.round(d.sound.volume * 100)}%`;
    this.restartBuilderDemo();
  },

  cleanDraftFx() { return this.draft.fx.filter(f => f.type !== 'overlay' || (f.media && this.mediaInfo(f.media))); },

  restartBuilderDemo() {
    const cv = this.$('tx-b-demo');
    if (!cv || !this.draft) return;
    const portrait = !!(App.currentProject && App.currentProject.meta && App.currentProject.meta.is_portrait);
    const w = portrait ? 180 : 320, h = portrait ? 320 : 180;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (!this._builderDemo) this._builderDemo = Fx.demo(cv, this.$('tx-b-demo-veil'));
    const fx = this.cleanDraftFx();
    if (fx.length) this._builderDemo.show(fx, 1); else this._builderDemo.stop();
  },

  async saveBuilder() {
    const d = this.draft;
    const err = this.$('tx-b-error');
    err.textContent = '';
    const fx = this.cleanDraftFx();
    if (!d.name.trim()) { err.textContent = 'Dê um nome à transição.'; this.$('tx-b-name').focus(); return; }
    if (!fx.length) { err.textContent = 'Adicione pelo menos um efeito (e escolha o arquivo, se usar vídeo ou PNG).'; return; }
    const body = { name: d.name.trim(), icon: (d.icon || '🎞️').trim().slice(0, 4), fx, sound: d.sound.id && d.sound.id !== 'none' ? d.sound : null };
    try {
      const res = await fetch(d.id ? `/studiox/api/transitions/${encodeURIComponent(d.id)}` : '/studiox/api/transitions', {
        method: d.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) { let m = `erro ${res.status}`; try { m = (await res.json()).detail || m; } catch (e) { /* not JSON */ } throw new Error(m); }
      const saved = await res.json();
      const creating = !d.id;
      this.closeBuilder();
      await this.load();
      if (creating) TemplatesManager.selectedTransition = saved.id;   // a new transition is applied right away
      TemplatesManager.renderTransitionCards();
      this.touch();
      Looks.changed();
      App.showToast(`Transição “${saved.name}” ${creating ? 'criada e aplicada' : 'atualizada'}.`, 'success');
    } catch (e) {
      err.textContent = `Não foi possível salvar: ${e.message}`;
    }
  },

  // --- Popover of ONE cut (the dot on the timeline) ---------------------------------------------------
  cutInfo(clipId) {
    const clips = Timeline.clips || [];
    const i = clips.findIndex(c => c.id === clipId);
    return i >= 0 && clips[i + 1] ? { i, next: clips[i + 1] } : null;
  },

  openCutPopover(clipId, anchor) {
    const info = this.cutInfo(clipId);
    if (!info) return;
    this.closeCutPop();
    const el = document.createElement('div');
    el.id = 'cut-pop';
    el.className = 'cut-pop';
    document.body.appendChild(el);
    this._cutPop = { el, i: info.i, start: info.next.start, anchor };
    el.addEventListener('input', e => this.onCutPopInput(e));
    el.addEventListener('change', e => this.onCutPopInput(e));
    el.addEventListener('click', e => this.onCutPopClick(e));
    this.paintCutPop();
    const r = anchor.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2))}px`;
    el.style.top = `${Math.max(8, r.top - ph - 10)}px`;
  },

  closeCutPop() {
    if (this._cutPop) { this._cutPop.el.remove(); this._cutPop = null; }
  },

  paintCutPop() {
    const p = this._cutPop;
    if (!p) return;
    const o = this.state.cuts[this.keyOf(p.start)] || { transition: '', scale: null, sound: null };
    const eff = this.resolveCut(p.start);
    const base = this.def(TemplatesManager.selectedTransition) || { name: 'Corte seco' };
    const trOpt = (t) => `<option value="${this.esc(t.id)}"${o.transition === t.id ? ' selected' : ''}>${this.esc(t.icon)} ${this.esc(t.name)}</option>`;
    const ready = this.lib.transitions.filter(t => t.kind !== 'custom'), mine = this.lib.transitions.filter(t => t.kind === 'custom');
    const sound = o.sound || { id: '', volume: this.state.sound.volume, offset: 0 };
    const defaultSound = this.state.sound.id && this.state.sound.id !== 'none' ? `som padrão: ${(this.soundDef(this.state.sound.id) || {}).name || ''}` : 'sem som padrão';
    const hasSound = sound.id && sound.id !== 'none';
    const active = this._cutPop.el.contains(document.activeElement) ? document.activeElement.id : '';
    this._cutPop.el.innerHTML = `
      <div class="cut-pop-head"><strong>Corte ${p.i + 1} → ${p.i + 2}</strong><button type="button" class="tx-card-btn" data-act="close" title="Fechar">✕</button></div>
      <p class="field-hint" style="margin:0 0 8px">${o.transition || o.scale != null || o.sound ? 'Este corte tem escolhas próprias.' : 'Este corte segue o padrão do vídeo.'}</p>
      <div class="form-group"><label for="cp-tr">Transição</label>
        <select id="cp-tr" class="text-input"><option value="">Padrão do vídeo (${this.esc(base.name)})</option>
          <optgroup label="Prontas">${ready.map(trOpt).join('')}</optgroup>${mine.length ? `<optgroup label="Minhas">${mine.map(trOpt).join('')}</optgroup>` : ''}</select></div>
      <div class="grade-row"><div class="grade-row-head"><label><input type="checkbox" id="cp-scale-on"${o.scale != null ? ' checked' : ''}> Duração própria</label>
        <span class="grade-val" id="cp-scale-val">${(o.scale != null ? o.scale : eff.scale).toFixed(2).replace(/\.?0+$/, '')}×</span></div>
        <input type="range" id="cp-scale" min="50" max="200" step="5" value="${Math.round((o.scale != null ? o.scale : eff.scale) * 100)}"${o.scale != null ? '' : ' disabled'}></div>
      <div class="form-group"><label for="cp-sound">Som neste corte</label>
        <select id="cp-sound" class="text-input">${this.soundOptions(o.sound ? o.sound.id : '', [['', `Padrão (${defaultSound})`], ['none', 'Sem som']])}</select></div>
      ${hasSound ? `<div class="grade-row"><div class="grade-row-head"><label for="cp-vol">Volume</label><span class="grade-val" id="cp-vol-val">${Math.round(sound.volume * 100)}%</span></div>
        <input type="range" id="cp-vol" min="0" max="150" step="5" value="${Math.round(sound.volume * 100)}"></div>
        <div class="grade-row"><div class="grade-row-head"><label for="cp-off">Ajuste de tempo</label><span class="grade-val" id="cp-off-val">${sound.offset > 0 ? '+' : ''}${sound.offset.toFixed(2)} s</span></div>
        <input type="range" id="cp-off" min="-60" max="60" step="5" value="${Math.round(sound.offset * 100)}"></div>` : ''}
      <div class="cut-pop-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-act="see">▶ Ver este corte</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="reset"${o.transition || o.scale != null || o.sound ? '' : ' disabled'}>Voltar ao padrão</button>
      </div>`;
    if (active) this._cutPop.el.querySelector(`#${active}`)?.focus();
  },

  onCutPopInput(e) {
    const p = this._cutPop;
    if (!p) return;
    const id = e.target.id, cur = this.state.cuts[this.keyOf(p.start)] || { transition: '', scale: null, sound: null };
    if (id === 'cp-tr') this.setCut(p.start, { transition: e.target.value });
    else if (id === 'cp-scale-on') this.setCut(p.start, { scale: e.target.checked ? this.resolveCut(p.start).scale : null });
    else if (id === 'cp-scale') this.setCut(p.start, { scale: parseInt(e.target.value, 10) / 100 });
    else if (id === 'cp-sound') this.setCut(p.start, { sound: e.target.value ? { id: e.target.value, volume: (cur.sound && cur.sound.volume) || this.state.sound.volume || 0.8, offset: (cur.sound && cur.sound.offset) || 0 } : null });
    else if (id === 'cp-vol' && cur.sound) this.setCut(p.start, { sound: { ...cur.sound, volume: parseInt(e.target.value, 10) / 100 } });
    else if (id === 'cp-off' && cur.sound) this.setCut(p.start, { sound: { ...cur.sound, offset: parseInt(e.target.value, 10) / 100 } });
  },

  onCutPopClick(e) {
    const b = e.target.closest('[data-act]');
    const p = this._cutPop;
    if (!b || !p) return;
    if (b.dataset.act === 'close') this.closeCutPop();
    else if (b.dataset.act === 'see') Fx.previewCut(p.i);
    else if (b.dataset.act === 'reset') this.setCut(p.start, { transition: '', scale: null, sound: null });
  }
};

Transitions.state = Transitions.clean(null);
