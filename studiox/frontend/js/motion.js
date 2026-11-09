// Motion graphics via Remotion for StudioX: a small catalog of pre-built React compositions
// (backend/motion_graphics.py MOTION_TEMPLATES) rendered server-side into a cached transparent
// video, then overlaid by the final render exactly where split/music/headline already are.
//
// The edit lives in `edit.motion` = { enabled, items: [{ id, template_id, scope, clip_id, start,
// duration, props }] }. Times are on the OUTPUT timeline (after the cuts), like the headline's
// "Aparece em". Unlike music, there is only ONE lane in the timeline (the user asked for a single
// layer reflecting just these items), not one lane per template.
//
// Server-side render status (`status/cache_key/asset_file/error`) is NOT part of edit.motion — it
// lives in state["motion_renders"] (backend/motion_render.py owns it) and is fetched here only to
// show "renderizando.../pronto" and to know whether the item is ready to show in a full render.

const moId = v => (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
const moR3 = v => Math.round(v * 1000) / 1000;

const PROP_LABELS = {
  text: 'Texto', color: 'Cor do texto', highlightColor: 'Cor de destaque', fontSize: 'Tamanho da fonte', align: 'Alinhamento',
  name: 'Nome', subtitle: 'Subtítulo (cargo, canal...)', accentColor: 'Cor de destaque', textColor: 'Cor do texto',
  value: 'Valor final', prefix: 'Prefixo (ex.: R$)', suffix: 'Sufixo (ex.: %)', label: 'Rótulo', bgColor: 'Cor de fundo',
  direction: 'A etiqueta fica', chars: 'Caracteres que caem', speed: 'Velocidade', density: 'Densidade (%)', emoji: 'Emoji', animation: 'Animação', scale: 'Tamanho (%)', size: 'Diâmetro do anel (px)'
};
// Labels that differ from PROP_LABELS for one template
const TEMPLATE_PROP_LABELS = {
  'focus-ring': { color: 'Cor do anel', label: 'Texto embaixo do anel (opcional)' },
  callout: { bgColor: 'Cor da etiqueta' },
  sticker: {},
  custom: { prompt: 'O que você pediu', code: 'Código (escrito pela IA)' },
  'data-rain': { color: 'Cor dos caracteres', fontSize: 'Tamanho dos caracteres', direction: 'Direção' }
};
const ALIGN_LABELS = {
  left: 'Esquerda', center: 'Centro', right: 'Direita', up: 'Acima', down: 'Abaixo',
  pop: 'Pop', bounce: 'Pula', pulse: 'Pulsa', spin: 'Gira'
};
const STATUS_PT = { none: 'Não renderizado', queued: 'Na fila…', rendering: 'Renderizando…', done: 'Pronto', error: 'Erro' };

const Motion = {
  LANE_H: 44,

  cfg: null,                 // edit.motion
  catalog: [],                // GET /api/motion/templates
  projectId: null,
  sel: null,                  // selected item id
  renders: {},                 // item_id -> {status, cache_key, asset_file, error} (server-owned, polled)

  _bound: false,
  _lane: null,
  _itemEls: new Map(),
  _laneSig: '',
  _drag: null,
  _snap: [],
  _pollTimers: new Map(),

  $(id) { return document.getElementById(id); },
  esc(t) { return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  toast(msg, type = 'info') { if (typeof App !== 'undefined') App.showToast(msg, type); },
  uid(p) { return p + Math.random().toString(36).slice(2, 8); },
  total() { return typeof Timeline !== 'undefined' ? Timeline.getTotalSequenceDuration() : 0; },
  template(id) { return this.catalog.find(t => t.id === id) || null; },
  laneActive() { return !!(this.cfg && this.cfg.enabled && this.cfg.items.length); },

  // --- Config -----------------------------------------------------------------
  emptyCfg() { return { enabled: true, items: [] }; },

  // Lenient mirror of backend/motion_graphics.py sanitize_motion: the server has the last word.
  clean(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const items = [], ids = new Set();
    (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).forEach((it, i) => {
      if (!it || typeof it !== 'object' || !it.template_id) return;
      let id = moId(it.id) || `motion_${i + 1}`;
      while (ids.has(id)) id += 'x';
      ids.add(id);
      const tpl = this.template(it.template_id);
      items.push({
        id, template_id: it.template_id,
        scope: it.scope === 'clip' ? 'clip' : 'project',
        clip_id: it.scope === 'clip' ? (moId(it.clip_id) || null) : null,
        start: moR3(Math.max(0, Number(it.start) || 0)),
        duration: moR3(Math.min(60, Math.max(0.3, Number(it.duration) || (tpl ? tpl.default_duration : 3.5)))),
        props: it.props && typeof it.props === 'object' ? { ...it.props } : {},
        follow: MotionTrack.cleanFollow(tpl && tpl.trackable === false ? null : it.follow)
      });
    });
    return { enabled: raw.enabled !== false, items };
  },

  exportConfig() { return this.clean(this.cfg || this.emptyCfg()); },

  applyExternal(saved) {
    this.cfg = this.clean(saved);
    this.sel = null;
    this._laneSig = '';
    this.renderPanel();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  // --- Setup --------------------------------------------------------------------
  init() {
    if (this._bound || !this.$('tab-motion')) return;
    this._bound = true;
    if (!this.cfg) this.cfg = this.emptyCfg();
    const on = (id, ev, fn) => this.$(id)?.addEventListener(ev, fn);

    on('motion-enabled', 'change', e => { this.cfg.enabled = e.target.checked; this._laneSig = ''; this.changed(); });
    on('motion-add-item', 'click', () => this.addItem(this.$('motion-add-template')?.value));

    this.$('motion-items')?.addEventListener('click', e => this.onItemListClick(e));

    on('mo-start', 'input', e => this.editField('start', Number(e.target.value)));
    on('mo-dur', 'input', e => this.editField('duration', Number(e.target.value)));
    on('motion-clip-pick', 'change', e => this.setClip(e.target.value));
    on('motion-render-btn', 'click', () => this.triggerRender());
    on('motion-del-item', 'click', () => this.deleteSelected());
    on('motion-ai-btn', 'click', () => this.suggestWithAI());

    this.$('motion-scope-toggle')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-scope]');
      if (b) this.setScope(b.dataset.scope);
    });
    this.$('motion-props')?.addEventListener('input', e => this.onPropInput(e));
    this.$('motion-props')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-prop-enum]');
      if (b) this.setProp(b.closest('[data-prop]').dataset.prop, b.dataset.val);
    });

    const lanes = this.$('motion-lanes');
    if (lanes) {
      lanes.addEventListener('mousedown', e => this.onLaneDown(e));
    }
    window.addEventListener('mousemove', e => this.onDragMove(e));
    window.addEventListener('mouseup', e => this.onDragEnd(e));
    window.addEventListener('blur', () => this.onDragEnd(null));

    on('motion-create-btn', 'click', () => this.createWithAI());
    MotionTrack.bind();
    on('motion-ai-provider', 'change', () => { this.$('motion-ai-model').value = ''; this.saveAiChoice(); this.loadAiModels(); });
    on('motion-ai-model', 'change', () => this.saveAiChoice());
    this.loadAiChoice();

    this.loadCatalog();
    this.renderPanel();
  },

  async attach(projectId) {
    this.projectId = projectId;
    this.renders = {};
    for (const t of this._pollTimers.values()) clearInterval(t);
    this._pollTimers.clear();
    MotionTrack.cache.clear();
    await this.fetchRenders();
    this.renderPanel();
    this.cfg.items.filter(it => MotionTrack.isFollowing(it)).forEach(it => MotionTrack.fetchPath(it));
  },

  async loadCatalog() {
    try {
      const res = await fetch('/studiox/api/motion/templates');
      if (!res.ok) return;
      const data = await res.json();
      this.catalog = data.items || [];
      MotionTrack.setConstants(data.follow);
    } catch (e) { console.warn('motion templates failed:', e); }
    this.renderAddPicker();
    this.renderItemBox();
  },

  async fetchRenders() {
    if (!this.projectId || !this.cfg) return;
    await Promise.all(this.cfg.items.map(async it => {
      try {
        const res = await fetch(`/studiox/api/projects/${this.projectId}/motion/items/${it.id}/render`);
        if (res.ok) this.renders[it.id] = await res.json();
      } catch (e) { /* keep whatever we had */ }
    }));
  },

  changed() {
    this.renderPanel();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  // --- Panel ----------------------------------------------------------------------
  renderPanel() {
    if (!this.$('tab-motion')) return;
    const en = this.$('motion-enabled');
    if (en) en.checked = !!(this.cfg && this.cfg.enabled);
    this.renderItemList();
    this.renderItemBox();
  },

  renderAddPicker() {
    const sel = this.$('motion-add-template');
    if (!sel) return;
    sel.innerHTML = this.catalog.map(t => `<option value="${t.id}">${this.esc(t.name)}</option>`).join('');
  },

  statusBadge(itemId) {
    const r = this.renders[itemId];
    const status = r ? r.status : 'none';
    return `<span class="badge badge-dim mo-status mo-status-${status}">${STATUS_PT[status] || status}</span>`;
  },

  renderItemList() {
    const host = this.$('motion-items');
    if (!host || !this.cfg) return;
    if (!this.cfg.items.length) {
      host.innerHTML = '<p class="field-hint" style="margin:0">Nenhum motion graphic ainda. Escolha um modelo abaixo e clique em “Adicionar”.</p>';
      return;
    }
    host.innerHTML = this.cfg.items.map(it => {
      const tpl = this.template(it.template_id);
      return `<div class="motion-row${it.id === this.sel ? ' active' : ''}" data-id="${it.id}">
        <span class="mo-dot"></span>
        <span class="mo-row-name">${this.esc(tpl ? tpl.name : it.template_id)}</span>
        <span class="badge badge-dim">${it.scope === 'clip' ? 'corte' : 'projeto'}</span>
        ${this.statusBadge(it.id)}
        <button type="button" class="ml-btn" data-act="del" title="Remover">✕</button>
      </div>`;
    }).join('');
  },

  onItemListClick(e) {
    const row = e.target.closest('.motion-row');
    if (!row) return;
    const id = row.dataset.id;
    const btn = e.target.closest('button[data-act]');
    if (btn && btn.dataset.act === 'del') { this.deleteItem(id); return; }
    this.select(id);
  },

  selected() { return this.cfg && this.cfg.items.find(it => it.id === this.sel) || null; },
  selectionActive() { return !!this.selected(); },

  select(id) {
    this.sel = id;
    this.renderItemList();
    this.renderItemBox();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.renderItemList();
    this.renderItemBox();
    if (typeof Timeline !== 'undefined') Timeline.requestRender();
  },

  showTab() {
    const btn = document.querySelector('[data-tab=tab-motion]');
    if (btn && !btn.classList.contains('active')) btn.click();
  },

  addItem(templateId) {
    const tpl = this.template(templateId);
    if (!tpl) { this.toast('Escolha um modelo de motion graphic.', 'warning'); return; }
    if (this.cfg.items.length >= 40) { this.toast('Limite de 40 itens de motion graphics.', 'warning'); return; }
    const props = {};
    for (const [k, spec] of Object.entries(tpl.props)) props[k] = spec.default;
    const item = {
      id: this.uid('motion_'), template_id: tpl.id, scope: 'project', clip_id: null,
      start: moR3(this.total() > 0 ? Math.min(this.total() - 0.1, Music.nowOut()) : 0),
      duration: tpl.default_duration, props, follow: MotionTrack.cleanFollow(null)
    };
    this.cfg.items.push(item);
    this._laneSig = '';
    this.select(item.id);
    this.showTab();
    this.changed();
  },

  deleteItem(id) {
    if (!this.cfg) return;
    this.cfg.items = this.cfg.items.filter(it => it.id !== id);
    delete this.renders[id];
    MotionTrack.forget(id);
    if (this.sel === id) this.sel = null;
    this._laneSig = '';
    if (typeof MotionPlayer !== 'undefined') MotionPlayer.remove(id);
    this.changed();
  },

  deleteSelected() { if (this.sel) this.deleteItem(this.sel); },

  editField(field, value) {
    const it = this.selected();
    if (!it || !Number.isFinite(value)) return;
    const total = this.total();
    if (field === 'start') it.start = moR3(Math.max(0, Math.min(value, Math.max(0, total - 0.3))));
    else if (field === 'duration') it.duration = moR3(Math.max(0.3, Math.min(60, value)));
    this.changed();
    MotionTrack.ensure(it, 900);
  },

  setScope(scope) {
    const it = this.selected();
    if (!it) return;
    it.scope = scope === 'clip' ? 'clip' : 'project';
    if (it.scope === 'clip' && !it.clip_id && Timeline.clips[0]) { it.clip_id = Timeline.clips[0].id; this.snapToClip(); }
    this.renderItemBox();
    this.changed();
  },

  setClip(clipId) {
    const it = this.selected();
    if (!it) return;
    it.clip_id = clipId || null;
    this.snapToClip();
  },

  snapToClip() {
    const it = this.selected();
    if (!it || it.scope !== 'clip' || !it.clip_id) return;
    const clip = Timeline.clips.find(c => c.id === it.clip_id);
    if (!clip || clip.seqStart === undefined) return;
    it.start = moR3(clip.seqStart);
    it.duration = moR3(Math.max(0.3, Math.min(60, clip.seqEnd - clip.seqStart)));
    this.renderItemBox();
    this.changed();
    MotionTrack.ensure(it, 700);
  },

  onPropInput(e) {
    const row = e.target.closest('[data-prop]');
    if (!row) return;
    this.setProp(row.dataset.prop, e.target.value, row);
  },

  setProp(key, value, rowEl) {
    const it = this.selected();
    const tpl = it && this.template(it.template_id);
    const spec = tpl && tpl.props[key];
    if (!it || !spec) return;
    if (spec.type === 'number') value = Number(value);
    it.props[key] = value;
    const valEl = (rowEl || this.$('motion-props')?.querySelector(`[data-prop="${key}"]`))?.querySelector('[data-val]');
    if (valEl) valEl.textContent = value;
    if (spec.type === 'enum') {
      this.$('motion-props')?.querySelectorAll(`[data-prop="${key}"] button[data-prop-enum]`)
        .forEach(b => b.classList.toggle('active', b.dataset.val === value));
    }
    this.touchRenderHint();
    this.changed();
  },

  // A text/prop/duration change invalidates whatever was already rendered (the cache key changes):
  // nudges the user back to "Renderizar" instead of silently showing a stale video in the final render.
  touchRenderHint() {
    const it = this.selected();
    if (it) this.renders[it.id] = { ...(this.renders[it.id] || {}), status: 'none' };
  },

  renderItemBox() {
    const box = this.$('motion-item-box');
    if (!box) return;
    const it = this.selected();
    if (!it) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const tpl = this.template(it.template_id);
    this.$('motion-item-name').textContent = tpl ? tpl.name : it.template_id;
    this.$('motion-item-status').innerHTML = this.statusBadge(it.id);

    this.$('motion-scope-toggle')?.querySelectorAll('button[data-scope]').forEach(b => b.classList.toggle('active', b.dataset.scope === it.scope));
    const clipBox = this.$('motion-clip-pick-box');
    if (clipBox) clipBox.classList.toggle('hidden', it.scope !== 'clip');
    const clipSel = this.$('motion-clip-pick');
    if (clipSel && it.scope === 'clip') {
      clipSel.innerHTML = (Timeline.clips || []).map(c => `<option value="${c.id}"${c.id === it.clip_id ? ' selected' : ''}>${this.esc(c.beat || c.id)}</option>`).join('');
    }

    const set = (id, v) => { const el = this.$(id); if (el && document.activeElement !== el) el.value = v; };
    set('mo-start', it.start);
    set('mo-dur', it.duration);

    this.renderPropsForm(tpl, it);
    MotionTrack.paint();

    const r = this.renders[it.id];
    const hint = this.$('motion-render-hint');
    if (hint) {
      hint.className = 'field-hint';
      if (r && r.status === 'error') { hint.textContent = `Erro no render: ${r.error || 'desconhecido'}`; hint.classList.add('warn'); }
      else if (r && r.status === 'done') hint.textContent = 'Pronto: já pode renderizar o vídeo final com este item.';
      else if (r && (r.status === 'queued' || r.status === 'rendering')) hint.textContent = 'Renderizando no Remotion (pode levar alguns segundos)…';
      else hint.textContent = 'Opcional: “Renderizar” gera este item agora. Ao renderizar o vídeo final, o que faltar é gerado sozinho.';
    }
    const btn = this.$('motion-render-btn');
    if (btn) btn.disabled = !!(r && (r.status === 'queued' || r.status === 'rendering'));
  },

  renderPropsForm(tpl, it) {
    const host = this.$('motion-props');
    if (!host || !tpl) { if (host) host.innerHTML = ''; return; }
    // Typing in a field must not rebuild the form (it would drop the focus after every keystroke)
    if (host.contains(document.activeElement) && host.dataset.key === it.id + tpl.id) return;
    host.dataset.key = it.id + tpl.id;
    host.innerHTML = Object.entries(tpl.props).map(([key, spec]) => {
      const label = (TEMPLATE_PROP_LABELS[tpl.id] || {})[key] || PROP_LABELS[key] || key;
      const val = it.props[key] !== undefined ? it.props[key] : spec.default;
      if (spec.type === 'text') {
        const hint = tpl.id === 'kinetic-title' && key === 'text' ? ' placeholder="Use *palavra* para destacar"' : '';
        return `<div class="form-group" data-prop="${key}"><label>${this.esc(label)}</label>
          <input type="text" class="text-input" maxlength="${spec.max || 300}" value="${this.esc(val)}"${hint}></div>`;
      }
      if (spec.type === 'code') {
        return `<div class="form-group" data-prop="${key}"><label>${this.esc(label)}</label>
          <textarea class="text-input mo-code" rows="8" spellcheck="false" maxlength="${spec.max || 24000}">${this.esc(val)}</textarea>
          <p class="field-hint">Este modelo roda código escrito pela IA, isolado do editor (sem rede e sem acesso à página). Confira antes de renderizar; para refazer, descreva de novo acima e use “Gerar com IA”.</p></div>`;
      }
      if (spec.type === 'color') {
        return `<div class="form-group" data-prop="${key}"><label>${this.esc(label)}</label>
          <input type="color" value="${this.esc(val)}"></div>`;
      }
      if (spec.type === 'number') {
        return `<div class="grade-row" data-prop="${key}">
          <div class="grade-row-head"><label>${this.esc(label)}</label><span class="grade-val" data-val>${val}</span></div>
          <input type="range" min="${spec.min}" max="${spec.max}" step="1" value="${val}"></div>`;
      }
      if (spec.type === 'enum') {
        return `<div class="form-group" data-prop="${key}"><label>${this.esc(label)}</label>
          <div class="seg-toggle">${spec.values.map(v => `<button type="button" data-prop-enum data-val="${v}" class="${v === val ? 'active' : ''}">${this.esc(ALIGN_LABELS[v] || v)}</button>`).join('')}</div></div>`;
      }
      return '';
    }).join('');
  },

  // --- AI (backend/motion_llm.py) ---------------------------------------------------------
  // What is said while this item is on screen: optional context for the LLM, same idea as
  // SplitScreen.sceneText (duplicated here on purpose: a small, single-use helper per module).
  sceneText(it) {
    const a = it.start, b = it.start + it.duration;
    return (Player.transcriptionCues || [])
      .filter(w => (w.type === undefined || w.type === 'word') && w.text)
      .filter(w => { const s = Timeline.sourceToSequence(w.start); return s >= a - 0.05 && s <= b; })
      .map(w => String(w.text).trim()).join(' ');
  },

  // --- Which AI creates the motion graphics (any provider with a key in Configurações, and any of its models) -----------
  aiChoice() {
    return { provider: this.$('motion-ai-provider')?.value || '', model: (this.$('motion-ai-model')?.value || '').trim() };
  },

  saveAiChoice() {
    try { localStorage.setItem('studiox.motion.ai', JSON.stringify(this.aiChoice())); } catch (e) { /* private window: just not remembered */ }
  },

  async loadAiChoice() {
    const sel = this.$('motion-ai-provider');
    if (!sel) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('studiox.motion.ai') || '{}') || {}; } catch (e) { saved = {}; }
    try {
      const data = await API.getAiSettings();
      const ready = data.providers.filter(p => p.configured);
      sel.innerHTML = `<option value="">Padrão das Configurações${data.default_provider ? ` (${this.esc((ready.find(p => p.id === data.default_provider) || {}).name || data.default_provider)})` : ''}</option>` +
        ready.map(p => `<option value="${p.id}">${this.esc(p.name)} · ${this.esc(p.model)}</option>`).join('');
      if (!ready.length) this.$('motion-ai-hint').textContent = 'Nenhuma IA configurada: salve uma chave em Configurações para criar motions com IA.';
    } catch (e) { return; }
    if ([...sel.options].some(o => o.value === saved.provider)) sel.value = saved.provider;
    const model = this.$('motion-ai-model');
    if (model && saved.model) model.value = saved.model;
    await this.loadAiModels();
  },

  async loadAiModels() {
    const list = this.$('motion-ai-models'), provider = this.$('motion-ai-provider')?.value;
    if (!list) return;
    list.innerHTML = '';
    if (!provider) return;
    try {
      const res = await fetch(`/studiox/api/settings/ai/${provider}/models`);
      if (!res.ok) return;
      const data = await res.json();
      list.innerHTML = (data.models || []).map(m => `<option value="${this.esc(m)}"></option>`).join('');
    } catch (e) { /* the box still accepts any model name typed by hand */ }
  },

  // One request: the AI picks (or keeps) the model, fills its fields and says what it follows (backend/motion_llm.py suggest_item)
  async askPlan(text, templateId, scene) {
    const res = await fetch(`/studiox/api/projects/${this.projectId}/motion/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, scene_text: scene || '', template_id: templateId || '', ...this.aiChoice() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Erro ${res.status}`);
    return data;
  },

  // Fills the selected item from a sentence (keeps its model)
  async suggestWithAI() {
    const it = this.selected();
    const input = this.$('motion-ai-text');
    const text = (input?.value || '').trim();
    if (!it) return;
    if (!text) { this.toast('Descreva o que você quer no motion graphic.', 'warning'); return; }
    const btn = this.$('motion-ai-btn');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Pensando…';
    try {
      const data = await this.askPlan(text, it.template_id, this.sceneText(it));
      it.props = { ...it.props, ...data.props };
      const tpl = this.template(it.template_id);
      if (tpl && tpl.trackable) { it.follow = MotionTrack.cleanFollow({ ...data.follow, seed: null }); MotionTrack.cache.delete(it.id); }
      this.touchRenderHint();
      this.renderItemBox();
      this.changed();
      MotionTrack.ensure(it, 100);
      this.toast('A IA preencheu os campos. Confira o resultado na prévia.', 'success');
    } catch (err) {
      this.toast(`Não foi possível gerar com IA: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  },

  // A sentence in, a whole new item out (model + text + what it follows), placed where the playhead is (or on the selected cut)
  async createWithAI() {
    const input = this.$('motion-create-text');
    const text = (input?.value || '').trim();
    if (!this.projectId) { this.toast('Abra um vídeo primeiro.', 'warning'); return; }
    if (!text) { this.toast('Descreva o que você quer ver no vídeo.', 'warning'); return; }
    if (this.cfg.items.length >= 40) { this.toast('Limite de 40 itens de motion graphics.', 'warning'); return; }
    const btn = this.$('motion-create-btn');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Pensando…';
    try {
      const now = this.total() > 0 ? Math.min(this.total() - 0.1, Music.nowOut()) : 0;
      const clip = (Timeline.clips || []).find(c => c.id === Timeline.selectedClipId);
      const scene = this.sceneText({ start: clip ? clip.seqStart : now, duration: clip ? clip.seqEnd - clip.seqStart : 4 });
      const data = await this.askPlan(text, '', scene);
      const tpl = this.template(data.template_id);
      if (!tpl) throw new Error('A IA escolheu um modelo desconhecido.');
      const item = {
        id: this.uid('motion_'), template_id: tpl.id, scope: 'project', clip_id: null, start: moR3(now),
        duration: tpl.default_duration, props: { ...Object.fromEntries(Object.entries(tpl.props).map(([k, s]) => [k, s.default])), ...data.props },
        follow: MotionTrack.cleanFollow(tpl.trackable ? { ...data.follow, seed: null } : null)
      };
      this.cfg.items.push(item);
      if (clip) { this.sel = item.id; item.scope = 'clip'; item.clip_id = clip.id; this.snapToClip(); }
      this._laneSig = '';
      this.select(item.id);
      this.showTab();
      this.changed();
      MotionTrack.ensure(item, 100);
      if (input) input.value = '';
      const what = MotionTrack.isFollowing(item) ? ` Ele vai seguir ${MotionTrack.TARGET_LABELS[item.follow.target]}.` : '';
      this.toast(`Criado: ${tpl.name}.${what} Ajuste o que quiser abaixo.`, 'success');
    } catch (err) {
      this.toast(`Não foi possível criar com IA: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  },

  // --- Render job (backend/motion_render.py) ----------------------------------------------
  async triggerRender() {
    const it = this.selected();
    if (!it || !this.projectId) return;
    const btn = this.$('motion-render-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/studiox/api/projects/${this.projectId}/motion/render`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: it.id, template_id: it.template_id, props: it.props, duration: it.duration })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.renders[it.id] = { status: 'rendering' };
      this.renderItemBox();
      this.renderItemList();
      this.pollRender(it.id);
    } catch (err) {
      this.toast(`Não foi possível iniciar o render: ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  },

  pollRender(itemId) {
    if (this._pollTimers.has(itemId)) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/studiox/api/projects/${this.projectId}/motion/items/${itemId}/render`);
        if (res.ok) {
          this.renders[itemId] = await res.json();
          if (this.sel === itemId) this.renderItemBox();
          this.renderItemList();
          if (['done', 'error'].includes(this.renders[itemId].status)) {
            clearInterval(t);
            this._pollTimers.delete(itemId);
            if (this.renders[itemId].status === 'done') this.toast('Motion graphic renderizado.', 'success');
            else this.toast(`Erro ao renderizar: ${this.renders[itemId].error || ''}`, 'error');
          }
        }
      } catch (e) { /* try again on the next tick */ }
    }, 1500);
    this._pollTimers.set(itemId, t);
  },

  // --- Timeline lane (single lane, see module docstring) -----------------------------------
  ensureLane(host) {
    const sig = this.cfg.items.map(it => it.id).join(';');
    if (sig === this._laneSig && this._lane) return;
    this._laneSig = sig;
    host.innerHTML = '';
    this._itemEls.clear();
    const lane = document.createElement('div');
    lane.className = 'track-lane track-motion';
    lane.innerHTML = '<div class="track-label" title="Motion graphics (Remotion)"><span class="tl-name">◆ MOTION</span></div><div class="track-content"></div>';
    host.appendChild(lane);
    this._lane = { el: lane, content: lane.querySelector('.track-content') };
  },

  // Called by Timeline.flush() with the visible window in track pixels
  renderLanes(vis) {
    const host = this.$('motion-lanes');
    if (!host || !this.cfg) return;
    const show = this.laneActive() && Timeline.mode === 'sequence';
    host.style.display = show ? '' : 'none';
    this.syncTray(show);   // Music.renderLanes() already calls its own syncTray() every flush too (see music.js)
    if (!show) return;
    this.ensureLane(host);

    const pps = Timeline.pixelsPerSecond;
    const H = this.LANE_H - 6;
    const seen = new Set();
    for (const it of this.cfg.items) {
      const left = it.start * pps, width = Math.max(3, it.duration * pps);
      if (left + width < vis.l || left > vis.r) continue;
      seen.add(it.id);
      let el = this._itemEls.get(it.id);
      if (!el) { el = this.createItemEl(it); this._itemEls.set(it.id, el); }
      if (el.parentNode !== this._lane.content) this._lane.content.appendChild(el);
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
      el.style.height = `${H}px`;
      el.classList.toggle('selected', it.id === this.sel);
      el.classList.toggle('tiny', width < 18);
      const r = this.renders[it.id];
      el.classList.toggle('mo-not-ready', !r || r.status !== 'done');
      const tpl = this.template(it.template_id);
      el._lbl.textContent = tpl ? tpl.name : it.template_id;
      el.title = `${tpl ? tpl.name : it.template_id}\nComeça em ${it.start.toFixed(1)}s · dura ${it.duration.toFixed(1)}s\n${STATUS_PT[r ? r.status : 'none']}`;
    }
    for (const [id, el] of this._itemEls) {
      if (!seen.has(id)) { el.remove(); this._itemEls.delete(id); }
    }
  },

  syncTray(active) {
    const musicN = (typeof Music !== 'undefined' && Music.cfg) ? Music.cfg.tracks.length : 0;
    const musicH = (typeof Music !== 'undefined' && musicN) ? musicN * Music.laneHeight(musicN) : 0;
    const h = 244 + musicH + (active ? this.LANE_H : 0) + ((typeof SplitScreen !== 'undefined') ? SplitScreen.laneH() : 0);
    if (h === this._trayH) return;
    this._trayH = h;
    document.documentElement.style.setProperty('--timeline-tray-height', `${h}px`);
  },

  createItemEl(it) {
    const el = document.createElement('div');
    el.className = 'motion-clip';
    el.dataset.id = it.id;
    el.innerHTML = '<div class="mc-label"></div>' +
      '<div class="mc-handle left" data-h="left" title="Arraste para ajustar o início"></div>' +
      '<div class="mc-handle right" data-h="right" title="Arraste para ajustar a duração"></div>';
    el._lbl = el.querySelector('.mc-label');
    return el;
  },

  // --- Dragging ---------------------------------------------------------------------------
  snapPoints(excludeId) {
    const pts = [0, this.total()];
    for (const c of Timeline.clips) pts.push(c.seqStart, c.seqEnd);
    for (const it of this.cfg.items) if (it.id !== excludeId) pts.push(it.start, it.start + it.duration);
    return pts;
  },

  snapTo(t) {
    if (!Timeline.snapping) return null;
    const tol = 8 / Timeline.pixelsPerSecond;
    let best = null, bd = tol;
    for (const p of this._snap) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
    return best;
  },

  onLaneDown(e) {
    if (e.button !== 0) return;
    const itemEl = e.target.closest('.motion-clip');
    if (!itemEl) return;
    const it = this.cfg.items.find(x => x.id === itemEl.dataset.id);
    if (!it) return;
    e.stopPropagation();
    e.preventDefault();
    if (typeof Timeline !== 'undefined') Timeline.selectedClipId = null;
    if (typeof Music !== 'undefined') Music.clearSelection();
    this.select(it.id);
    this.showTab();
    const h = e.target.dataset.h;
    const type = ['left', 'right'].includes(h) ? h : 'move';
    this._snap = this.snapPoints(it.id);
    this._drag = { type, item: it, x0: e.clientX, moved: false, orig: { start: it.start, duration: it.duration } };
  },

  onDragMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const total = this.total(), it = d.item, o = d.orig;
    const dt = (e.clientX - d.x0) / Timeline.pixelsPerSecond;
    const edge = t => { const s = this.snapTo(t); return s === null ? t : s; };

    if (d.type === 'move') {
      let start = Math.min(Math.max(0, o.start + dt), Math.max(0, total - 0.3));
      const a = this.snapTo(start);
      if (a !== null) start = a;
      it.start = moR3(start);
    } else if (d.type === 'left') {
      let ns = edge(o.start + dt);
      ns = Math.min(o.start + o.duration - 0.3, Math.max(0, ns));
      it.start = moR3(ns);
      it.duration = moR3(o.duration - (ns - o.start));
    } else if (d.type === 'right') {
      let end = edge(o.start + o.duration + dt);
      it.duration = moR3(Math.max(0.3, Math.min(60, Math.min(total, end) - o.start)));
    }
    this.renderItemBox();
    Timeline.requestRender();
  },

  onDragEnd(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (!d.moved && e && d.type === 'move') { Timeline.scrubTo(e.clientX); Timeline.flushSeek(true); }
    if (d.moved) { this.changed(); MotionTrack.ensure(d.item, 700); }
  }
};
