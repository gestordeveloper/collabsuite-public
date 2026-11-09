// Queue screen: pick a template, drop several videos, and follow each one through its own
// pipeline (analysis -> cuts -> transcription -> render) on the server.

const Queue = {
  catalog: null,
  templates: [],
  defaultId: null,
  pending: [],          // videos chosen but not yet sent: { uid, file, text, tag, copy, strict, state, msg }
  items: [],
  paused: false,
  expanded: new Set(),  // queue items whose log is open
  _uid: 0,
  _sig: '',
  _adding: false,

  STEP_LABELS: { analyze: 'Análise', cuts: 'Cortes', transcribe: 'Transcrição', review: 'Revisão IA', render: 'Render' },
  STEP_MARK: { pending: '○', running: '◐', done: '✓', skipped: '–', warning: '!', error: '✕' },
  STATUS_LABEL: { queued: 'Na fila', running: 'Processando', awaiting: 'Enviando', done: 'Concluído', error: 'Erro', cancelled: 'Cancelado' },

  async init() {
    this.bind();
    try {
      [this.catalog] = await Promise.all([UI.api('/studiox/api/templates'), this.loadTemplates(), this.loadAi(), this.loadLuts()]);
    } catch (err) {
      if (err.outdated) document.getElementById('outdated').hidden = false;
      else UI.toast(`Erro ao carregar: ${err.message}`, 'error');
      return;
    }
    this.renderTemplateSelect();
    this.renderTemplates();
    await this.refreshQueue();
    setInterval(() => { if (!document.hidden) this.refreshQueue(); }, 1800);
  },

  async loadLuts() {
    try { this.luts = (await UI.api('/studiox/api/luts')).luts || []; } catch (e) { this.luts = []; }
  },

  async loadAi() {
    try { this.ai = await UI.api('/studiox/api/settings/ai'); } catch (e) { this.ai = { providers: [], default_provider: null }; }
  },

  async loadTemplates() {
    const data = await UI.api('/studiox/api/edit-templates');
    this.templates = data.templates;
    this.defaultId = data.default_id;
    this.hiddenBuiltins = data.hidden || [];
  },

  tpl(id) { return this.templates.find(t => t.id === id); },
  currentTemplate() { return this.tpl(document.getElementById('tpl-select').value) || this.templates[0]; },

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  presetName(list, id) { const p = (this.catalog[list] || []).find(x => x.id === id); return p ? p.name : 'Personalizado'; },
  gradeName(id) { const g = this.catalog.color_grades.find(x => x.id === id); return g ? g.name : id; },

  chips(t) {
    const e = UI.esc;
    const s = t.subtitles, h = t.headline, p = t.pipeline;
    const chip = (text, on = true) => `<span class="chip-info ${on ? 'on' : 'off'}">${e(text)}</span>`;
    return [
      chip(s.enabled ? `Legenda: ${this.presetName('subtitles', s.preset_id)} (${s.style.font_family})` : 'Sem legenda', s.enabled),
      chip(h.enabled ? `Headline: ${this.presetName('headlines', h.preset_id)}` : 'Sem headline', h.enabled),
      chip(`Grade: ${this.gradeName(t.grade).replace(/ \(.*\)/, '')}`),
      ...(Grade.isNeutral(t.grade_adjust) ? [] : [chip('Cor ajustada', true)]),
      ...(t.lut && t.lut.id ? [chip(`LUT: ${((this.luts || []).find(l => l.id === t.lut.id) || { name: 'removido' }).name}`)] : []),
      ...(t.transition && t.transition !== 'micro_fade_30ms' ? [chip(`Transição: ${((this.catalog.transitions || []).find(x => x.id === t.transition) || { name: t.transition }).name}`)] : []),
      ...(t.zoom && t.zoom.enabled ? [chip(`Zoom nos cortes: ${{ alternate: 'alternado', punch: 'impacto', push: 'aproximar' }[t.zoom.style] || t.zoom.style}`)] : []),
      chip(p.auto_cut ? 'Corta silêncios' : 'Sem cortes', p.auto_cut),
      chip(p.transcribe ? `Transcreve (${p.engine === 'auto' ? 'auto' : p.engine}, ${p.language})` : 'Sem transcrição', p.transcribe),
      ...(this.reviewChip(p) ? [chip(this.reviewChip(p))] : []),
      chip(p.render_mode === 'preview' ? 'Render prévia' : 'Render final')
    ].join('');
  },

  reviewChip(p) {
    const name = id => (this.ai && this.ai.providers.find(x => x.id === id) || {}).name || id;
    if (p.ai_review === 'llm') return `Revisão por IA: ${p.ai_provider ? name(p.ai_provider) : 'provedor padrão'}`;
    if (p.ai_review === 'auto') return 'Revisão por IA (automática)';
    if (p.ai_review === 'local') return 'Revisão por regras locais';
    return '';
  },

  renderTemplateSelect() {
    const sel = document.getElementById('tpl-select');
    const keep = sel.value || this.defaultId;
    sel.innerHTML = this.templates.map(t =>
      `<option value="${UI.esc(t.id)}">${UI.esc(t.name)}${t.id === this.defaultId ? ' (padrão)' : ''}${t.builtin ? '' : ' ★'}</option>`).join('');
    sel.value = this.tpl(keep) ? keep : this.defaultId;
    this.renderSummary();
  },

  renderSummary() {
    const t = this.currentTemplate();
    if (!t) return;
    document.getElementById('tpl-summary').innerHTML =
      (t.description ? `<span class="muted" style="flex-basis:100%;font-size:11px">${UI.esc(t.description)}</span>` : '') + this.chips(t);
    this.renderPending();
  },

  renderTemplates() {
    const e = UI.esc;
    document.getElementById('tpl-list').innerHTML = this.templates.map(t => `
      <div class="tpl-item ${t.id === this.defaultId ? 'default' : ''}">
        <div class="tpl-item-head">
          <span class="tpl-item-name">${e(t.name)}</span>
          <span class="tpl-badges">
            ${t.id === this.defaultId ? '<span class="badge badge-accent">Padrão</span>' : ''}
            ${t.builtin ? `<span class="badge badge-subtle">${t.customized ? 'pronto · editado' : 'pronto'}</span>` : '<span class="badge badge-subtle">meu</span>'}
          </span>
        </div>
        ${t.description ? `<div class="tpl-item-desc">${e(t.description)}</div>` : ''}
        <div class="tpl-summary" style="margin-top:6px">${this.chips(t)}</div>
        <div class="tpl-item-actions">
          <button class="btn btn-secondary btn-xs" data-tpl-act="use" data-id="${e(t.id)}">Usar</button>
          <button class="btn btn-ghost btn-xs" data-tpl-act="edit" data-id="${e(t.id)}">Editar</button>
          <button class="btn btn-ghost btn-xs" data-tpl-act="copy" data-id="${e(t.id)}" title="Cria um template novo a partir deste, para você ajustar">Duplicar</button>
          ${t.id !== this.defaultId ? `<button class="btn btn-ghost btn-xs" data-tpl-act="default" data-id="${e(t.id)}">Tornar padrão</button>` : ''}
          ${t.customized ? `<button class="btn btn-ghost btn-xs" data-tpl-act="restore" data-id="${e(t.id)}" title="Volta ao template pronto original, sem as suas alterações">Restaurar original</button>` : ''}
          <button class="btn btn-ghost btn-xs icon-danger" data-tpl-act="delete" data-id="${e(t.id)}">Excluir</button>
        </div>
      </div>`).join('');
    this.renderRestoreBar();
  },

  renderRestoreBar() {
    const bar = document.getElementById('tpl-restore-bar');
    const n = (this.hiddenBuiltins || []).length;
    bar.classList.toggle('hidden', n === 0);
    document.getElementById('tpl-restore-text').textContent =
      n === 1 ? '1 template pronto foi excluído.' : `${n} templates prontos foram excluídos.`;
  },

  async templateAction(ev) {
    const btn = ev.target.closest('[data-tpl-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      if (btn.dataset.tplAct === 'use') {
        document.getElementById('tpl-select').value = id;
        this.renderSummary();
        UI.toast(`Template “${this.tpl(id).name}” selecionado.`, 'info');
        return;
      }
      if (btn.dataset.tplAct === 'edit') { this.openTemplateModal(this.tpl(id), false); return; }
      if (btn.dataset.tplAct === 'copy') { this.openTemplateModal(this.tpl(id), true); return; }
      if (btn.dataset.tplAct === 'default') await UI.api(`/studiox/api/edit-templates/${id}/default`, { method: 'POST' });
      if (btn.dataset.tplAct === 'restore') {
        if (!confirm(`Voltar “${this.tpl(id).name}” ao original? As suas alterações neste template serão perdidas.`)) return;
        await UI.api(`/studiox/api/edit-templates/${id}/restore`, { method: 'POST' });
      }
      if (btn.dataset.tplAct === 'delete') {
        const t = this.tpl(id);
        const note = t.builtin ? ' Por ser um template pronto, você poderá trazê-lo de volta em “Restaurar templates prontos”.' : '';
        if (!confirm(`Excluir o template “${t.name}”? Vídeos que já estão na fila não são afetados.${note}`)) return;
        await UI.api(`/studiox/api/edit-templates/${id}`, { method: 'DELETE' });
      }
      await this.loadTemplates();
      this.renderTemplateSelect();
      this.renderTemplates();
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  // --- Template form: new, edit (own templates) or duplicate (any) ---------------------------------
  // The style objects (fonts, colours) come from a preset or from the editor; here the size can be changed and
  // the grade fine-tuned. Editing keeps a style customised in the editor unless another preset is picked.
  tm: { editingId: null, subStyle: null, hlStyle: null, adj: { adj: { ...Grade.DEFAULT } }, gradeUi: null },
  SWATCHES: ['#e0ac8f', '#c98a6a', '#8a5a44', '#87b6e6', '#3f7fbf', '#5f9e4a', '#2f6b34', '#d9433a', '#f2c94c', '#f5f5f5', '#9a9a9a', '#2a2a2a'],

  openTemplateModal(tpl = null, asCopy = false) {
    const $ = id => document.getElementById(id);
    const c = this.catalog;
    const opts = (list, extra = '') => list.map(x => `<option value="${UI.esc(x.id)}">${UI.esc(x.name)}${extra}</option>`).join('');
    $('tm-sub-preset').innerHTML = opts(c.subtitles);
    $('tm-hl-preset').innerHTML = opts(c.headlines);
    $('tm-grade').innerHTML = opts(c.color_grades);
    $('tm-transition').innerHTML = opts(c.transitions);
    this.fillAiProviders();

    const editing = !!tpl && !asCopy;
    this.tm.editingId = editing ? tpl.id : null;
    $('tm-title').textContent = editing ? `Editar template “${tpl.name}”` : (tpl ? 'Novo template a partir de outro' : 'Novo template de edição');
    $('tm-save').textContent = editing ? 'Salvar alterações' : 'Salvar template';
    $('tm-builtin-note').hidden = !(editing && tpl.builtin);

    const sub = tpl ? tpl.subtitles : { enabled: true, preset_id: c.subtitles[0].id, style: c.subtitles[0].style };
    const hl = tpl ? tpl.headline : { enabled: true, preset_id: c.headlines[0].id, style: c.headlines[0].style, text: '', tag: '', duration: 4 };
    const presetOf = (list, id) => list.find(p => p.id === id) || list[0];
    const subPreset = presetOf(c.subtitles, sub.preset_id), hlPreset = presetOf(c.headlines, hl.preset_id);

    $('tm-name').value = tpl ? (asCopy ? `${tpl.name} (cópia)` : tpl.name) : '';
    $('tm-sub-on').checked = !!sub.enabled;
    $('tm-sub-preset').value = subPreset.id;
    this.tm.subStyle = { ...sub.style };
    // a style that no longer matches its preset was tuned in the editor
    $('tm-sub-custom').hidden = JSON.stringify({ ...subPreset.style, font_size: 0 }) === JSON.stringify({ ...sub.style, font_size: 0 });
    this.setSize('sub', sub.style.font_size);

    $('tm-hl-on').checked = !!hl.enabled;
    $('tm-hl-preset').value = hlPreset.id;
    this.tm.hlStyle = { ...hl.style };
    $('tm-hl-custom').hidden = JSON.stringify({ ...hlPreset.style, font_size: 0 }) === JSON.stringify({ ...hl.style, font_size: 0 });
    this.setSize('hl', hl.style.font_size);
    $('tm-hl-text').value = hl.text || '';
    $('tm-hl-tag').value = hl.tag || '';
    $('tm-hl-dur').value = hl.duration || 4;

    $('tm-grade').value = tpl ? tpl.grade : 'warm_cinematic';
    $('tm-transition').value = tpl ? tpl.transition : 'micro_fade_30ms';
    const lut = (tpl && tpl.lut) || { id: '', intensity: 1 };
    const zoom = (tpl && tpl.zoom) || { enabled: false, style: 'alternate', amount: 1.15, focus: 0.4 };
    $('tm-lut').innerHTML = '<option value="">Nenhum</option>' + (this.luts || []).map(l => `<option value="${UI.esc(l.id)}">${UI.esc(l.name)}</option>`).join('');
    $('tm-lut').value = (this.luts || []).some(l => l.id === lut.id) ? lut.id : '';
    $('tm-lut-int').value = Math.round((lut.intensity ?? 1) * 100);
    $('tm-tx-scale').value = Math.round(((tpl && tpl.transition_scale) || 1) * 100);
    $('tm-zoom-on').checked = !!zoom.enabled;
    $('tm-zoom-style').value = zoom.style || 'alternate';
    $('tm-zoom-amount').value = Math.round((zoom.amount - 1) * 100);
    $('tm-zoom-focus').value = Math.round(zoom.focus * 100);
    this.paintLook();
    this.tm.adj = { adj: Grade.clean(tpl && tpl.grade_adjust) };
    this.tm.gradeUi = Grade.mountControls($('tm-grade-controls'), this.tm.adj, () => this.paintSwatches());
    this.paintSwatches();

    const p = tpl ? tpl.pipeline : null;
    if (p) {
      $('tm-auto-cut').checked = p.auto_cut; $('tm-transcribe').checked = p.transcribe;
      $('tm-ai-review').value = p.ai_review; $('tm-ai-provider').value = p.ai_provider || '';
      $('tm-ai-model').value = p.ai_model || ''; $('tm-ai-fix').checked = p.ai_fix_words;
      $('tm-language').value = p.language; $('tm-engine').value = p.engine; $('tm-render').value = p.render_mode;
    } else {
      $('tm-auto-cut').checked = true; $('tm-transcribe').checked = true; $('tm-ai-model').value = ''; $('tm-ai-fix').checked = true;
      $('tm-language').value = 'pt'; $('tm-engine').value = 'auto'; $('tm-render').value = 'final';
    }
    $('tm-default').checked = !!(editing && tpl.id === this.defaultId);
    $('tpl-modal').classList.remove('hidden');
    $('tm-name').focus();
  },

  // Labels and visibility of the LUT / zoom / transition controls of the template form
  paintLook() {
    const $ = id => document.getElementById(id);
    $('tm-lut-row').hidden = !$('tm-lut').value;
    $('tm-lut-int-val').textContent = `${$('tm-lut-int').value}%`;
    const sc = parseInt($('tm-tx-scale').value, 10) / 100;
    $('tm-tx-scale-val').textContent = `${sc.toFixed(2).replace(/\.?0+$/, '')}×`;
    $('tm-zoom-cfg').hidden = !$('tm-zoom-on').checked;
    $('tm-zoom-amount-val').textContent = `+${$('tm-zoom-amount').value}%`;
    const f = parseInt($('tm-zoom-focus').value, 10);
    $('tm-zoom-focus-val').textContent = f < 34 ? 'mais no topo' : (f > 66 ? 'mais embaixo' : 'centro');
  },

  setSize(which, value) {
    const input = document.getElementById(`tm-${which}-size`);
    input.value = value;
    document.getElementById(`tm-${which}-size-val`).textContent = `${Math.round(input.value)} px`;
  },

  paintSwatches() {
    const preset = this.catalog.color_grades.find(g => g.id === document.getElementById('tm-grade').value);
    const strip = document.getElementById('tm-swatches');
    if (!strip.children.length) strip.innerHTML = this.SWATCHES.map(c => `<span style="background:${c}"></span>`).join('');
    strip.style.filter = Grade.css(preset ? preset.css_filter : 'none', this.tm.adj.adj, 'tm');
  },

  onPresetChange(which) {
    const list = which === 'sub' ? this.catalog.subtitles : this.catalog.headlines;
    const preset = list.find(p => p.id === document.getElementById(`tm-${which}-preset`).value);
    if (!preset) return;
    this.tm[which === 'sub' ? 'subStyle' : 'hlStyle'] = { ...preset.style };   // another preset replaces the whole style
    document.getElementById(`tm-${which}-custom`).hidden = true;
    this.setSize(which, preset.style.font_size);
  },

  fillAiProviders() {
    const ready = (this.ai.providers || []).filter(p => p.configured);
    const def = this.ai.default_provider;
    document.getElementById('tm-ai-provider').innerHTML =
      `<option value="">Padrão${def ? ` (${UI.esc((ready.find(p => p.id === def) || {}).name || def)})` : ''}</option>` +
      ready.map(p => `<option value="${UI.esc(p.id)}">${UI.esc(p.name)}</option>`).join('');
    document.getElementById('tm-ai-review').value = 'auto';
    document.getElementById('tm-ai-hint').innerHTML = ready.length
      ? 'A IA lê a transcrição, remove erros de gravação, retakes e gagueiras, e ajusta cada corte pelo áudio.'
      : 'Nenhuma IA configurada ainda: <a class="link" href="/studiox/settings.html">salve uma chave em Configurações</a> para usar a revisão por IA.';
  },

  async saveNewTemplate() {
    const $ = id => document.getElementById(id);
    const name = $('tm-name').value.trim();
    if (!name) { UI.toast('Dê um nome ao template.', 'warning'); $('tm-name').focus(); return; }
    const sub = this.catalog.subtitles.find(p => p.id === $('tm-sub-preset').value);
    const hl = this.catalog.headlines.find(p => p.id === $('tm-hl-preset').value);
    const text = $('tm-hl-text').value;
    const body = {
      id: this.tm.editingId || undefined,
      name,
      subtitles: { enabled: $('tm-sub-on').checked, preset_id: sub.id, style: { ...this.tm.subStyle, font_size: parseFloat($('tm-sub-size').value) } },
      headline: {
        enabled: $('tm-hl-on').checked, preset_id: hl.id, style: { ...this.tm.hlStyle, font_size: parseFloat($('tm-hl-size').value) },
        text, tag: text.trim() ? $('tm-hl-tag').value : ($('tm-hl-tag').value || hl.default_tag),
        start: 0, duration: parseFloat($('tm-hl-dur').value) || 4
      },
      grade: $('tm-grade').value,
      grade_adjust: Grade.clean(this.tm.adj.adj),
      transition: $('tm-transition').value,
      transition_scale: parseInt($('tm-tx-scale').value, 10) / 100,
      lut: { id: $('tm-lut').value, intensity: parseInt($('tm-lut-int').value, 10) / 100 },
      zoom: {
        enabled: $('tm-zoom-on').checked, style: $('tm-zoom-style').value,
        amount: 1 + parseInt($('tm-zoom-amount').value, 10) / 100, focus: parseInt($('tm-zoom-focus').value, 10) / 100
      },
      pipeline: {
        auto_cut: $('tm-auto-cut').checked, transcribe: $('tm-transcribe').checked,
        ai_review: $('tm-ai-review').value, ai_provider: $('tm-ai-provider').value, ai_model: $('tm-ai-model').value.trim(),
        ai_fix_words: $('tm-ai-fix').checked,
        language: $('tm-language').value, engine: $('tm-engine').value, render_mode: $('tm-render').value
      },
      make_default: $('tm-default').checked
    };
    try {
      const saved = await UI.api('/studiox/api/edit-templates', { method: 'POST', json: body });
      await this.loadTemplates();
      this.renderTemplateSelect();
      document.getElementById('tpl-select').value = saved.id;
      this.renderSummary();
      this.renderTemplates();
      document.getElementById('tpl-modal').classList.add('hidden');
      UI.toast(`Template “${saved.name}” ${this.tm.editingId ? 'atualizado' : 'criado'}.`, 'success');
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  // ---------------------------------------------------------------------------
  // Choosing files
  // ---------------------------------------------------------------------------
  bind() {
    const drop = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { this.addFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => this.addFiles(e.dataTransfer.files));
    // Dropping anywhere on the page also works
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => { if (!drop.contains(e.target)) { e.preventDefault(); this.addFiles(e.dataTransfer.files); } });

    ['tm-lut', 'tm-lut-int', 'tm-tx-scale', 'tm-zoom-on', 'tm-zoom-amount', 'tm-zoom-focus']
      .forEach(id => document.getElementById(id).addEventListener('input', () => this.paintLook()));
    document.getElementById('tpl-select').addEventListener('change', () => this.renderSummary());
    document.getElementById('btn-add').addEventListener('click', () => this.addToQueue());
    document.getElementById('btn-clear-pending').addEventListener('click', () => {
      if (this._adding) return;
      this.pending = this.pending.filter(p => p.state === 'uploading');
      this.renderPending();
    });
    document.getElementById('pending').addEventListener('input', e => this.onPendingInput(e));
    document.getElementById('pending').addEventListener('click', e => {
      const rm = e.target.closest('[data-remove]');
      if (rm && !this._adding) { this.pending = this.pending.filter(p => p.uid !== Number(rm.dataset.remove)); this.renderPending(); }
    });

    document.getElementById('tpl-list').addEventListener('click', e => this.templateAction(e));
    document.getElementById('btn-new-template').addEventListener('click', () => this.openTemplateModal());
    document.getElementById('btn-restore-builtins').addEventListener('click', async () => {
      try {
        await UI.api('/studiox/api/edit-templates/restore-builtins', { method: 'POST' });
        await this.loadTemplates();
        this.renderTemplateSelect();
        this.renderTemplates();
        UI.toast('Templates prontos restaurados.', 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    const closeTm = () => document.getElementById('tpl-modal').classList.add('hidden');
    document.getElementById('tm-close').addEventListener('click', closeTm);
    document.getElementById('tm-cancel').addEventListener('click', closeTm);
    document.getElementById('tm-save').addEventListener('click', () => this.saveNewTemplate());
    document.getElementById('tm-sub-preset').addEventListener('change', () => this.onPresetChange('sub'));
    document.getElementById('tm-hl-preset').addEventListener('change', () => this.onPresetChange('hl'));
    document.getElementById('tm-grade').addEventListener('change', () => this.paintSwatches());
    document.getElementById('tm-sub-size').addEventListener('input', e => this.setSize('sub', e.target.value));
    document.getElementById('tm-hl-size').addEventListener('input', e => this.setSize('hl', e.target.value));

    document.getElementById('queue').addEventListener('click', e => this.queueAction(e));
    document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-clear-done').addEventListener('click', () => this.clearFinished());
    window.addEventListener('beforeunload', e => { if (this._adding) { e.preventDefault(); e.returnValue = ''; } });
  },

  addFiles(fileList) {
    const t = this.currentTemplate();
    const ok = /\.(mp4|mov|m4v|mkv|webm|avi)$/i;
    let rejected = 0;
    for (const file of fileList || []) {
      if (!ok.test(file.name)) { rejected++; continue; }
      this.pending.push({ uid: ++this._uid, file, text: t.headline.text || '', tag: t.headline.tag || '', copy: '', strict: true, state: 'idle', msg: '' });
    }
    if (rejected) UI.toast(`${rejected} arquivo(s) ignorado(s): só vídeo (MP4, MOV, MKV, WEBM, AVI).`, 'warning');
    this.renderPending();
  },

  onPendingInput(e) {
    const row = e.target.closest('[data-uid]');
    if (!row) return;
    const p = this.pending.find(x => x.uid === Number(row.dataset.uid));
    if (!p) return;
    if (e.target.matches('textarea[data-copy]')) p.copy = e.target.value;
    else if (e.target.matches('textarea')) p.text = e.target.value;
    if (e.target.matches('input[data-tag]')) p.tag = e.target.value;
    if (e.target.matches('input[data-strict]')) p.strict = e.target.checked;
  },

  renderPending() {
    const t = this.currentTemplate();
    const useHeadline = t && t.headline.enabled;
    const e = UI.esc;
    document.getElementById('pending').innerHTML = this.pending.map(p => `
      <div class="pending-row" data-uid="${p.uid}">
        <div>
          <div class="pending-name">${e(p.file.name)}</div>
          <div class="pending-sub">${e(UI.fmtSize(p.file.size / 1048576))}</div>
          <div class="pending-status ${p.state === 'error' ? 'err' : p.state === 'done' ? 'ok' : ''}" data-status>${e(p.msg)}</div>
        </div>
        <div class="pending-fields">
          ${useHeadline ? `
            <textarea class="text-input" rows="2" placeholder="Headline deste vídeo (vazio = sem headline). Use *asteriscos* para destacar palavras."
              ${p.state !== 'idle' ? 'disabled' : ''}>${e(p.text)}</textarea>
            <input type="text" class="text-input" data-tag maxlength="40" placeholder="Tag (opcional)" value="${e(p.tag)}" ${p.state !== 'idle' ? 'disabled' : ''}>`
        : `<span class="muted" style="font-size:11px">Este template não usa headline.</span>`}
          <textarea class="text-input" data-copy rows="3" maxlength="20000" ${p.state !== 'idle' ? 'disabled' : ''}
            placeholder="Copy (roteiro) deste vídeo, opcional. Cole o texto que você leu: a IA segue o roteiro, mantém cada fala uma vez na melhor gravação e corta erros, repetições e o que não está nele.">${e(p.copy)}</textarea>
          <label class="pending-strict" title="Desmarque se você improvisa e quer manter comentários que não estão na copy">
            <input type="checkbox" data-strict ${p.strict ? 'checked' : ''} ${p.state !== 'idle' ? 'disabled' : ''}>
            Cortar falas que não estão na copy
          </label>
        </div>
        <button class="btn btn-ghost btn-xs icon-danger" data-remove="${p.uid}" title="Tirar da lista" ${p.state === 'uploading' ? 'disabled' : ''}>✕</button>
      </div>`).join('');

    const idle = this.pending.filter(p => p.state === 'idle').length;
    document.getElementById('add-bar').hidden = this.pending.length === 0;
    document.getElementById('btn-add').disabled = this._adding || idle === 0;
    document.getElementById('btn-add').textContent = idle > 1 ? `Adicionar ${idle} vídeos à fila` : 'Adicionar à fila';
    document.getElementById('add-hint').textContent = this._adding
      ? 'Enviando… mantenha esta página aberta até terminar. Depois a fila trabalha sozinha, mesmo com a página fechada.'
      : 'O envio começa quando você clicar em “Adicionar à fila”.';
  },

  setPendingStatus(p, state, msg) {
    p.state = state;
    p.msg = msg;
    const row = document.querySelector(`.pending-row[data-uid="${p.uid}"] [data-status]`);
    if (row) {
      row.textContent = msg;
      row.className = `pending-status ${state === 'error' ? 'err' : state === 'done' ? 'ok' : ''}`;
    }
  },

  // ---------------------------------------------------------------------------
  // Sending: upload -> headline image at the render's frame size -> enqueue
  // ---------------------------------------------------------------------------
  upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.upload.addEventListener('progress', ev => { if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100)); });
      xhr.addEventListener('load', () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
        else reject(new Error((body && typeof body.detail === 'string' && body.detail) || `Erro ${xhr.status} no envio`));
      });
      xhr.addEventListener('error', () => reject(new Error('Falha de rede no envio')));
      xhr.open('POST', '/studiox/api/queue/upload');
      xhr.send(form);
    });
  },

  async addToQueue() {
    if (this._adding) return;
    const t = this.currentTemplate();
    this._adding = true;
    this.renderPending();
    let sent = 0;

    for (const p of this.pending.filter(x => x.state === 'idle')) {
      try {
        this.setPendingStatus(p, 'uploading', 'Enviando… 0%');
        const up = await this.upload(p.file, pct => this.setPendingStatus(p, 'uploading', `Enviando… ${pct}%`));

        let image = null;
        const text = (p.text || '').trim();
        if (t.headline.enabled && text) {
          this.setPendingStatus(p, 'uploading', 'Desenhando o headline…');
          image = await HeadlineStyle.renderPng({
            style: t.headline.style, text: p.text, tag: p.tag, w: up.render_width, h: up.render_height
          });
        }

        this.setPendingStatus(p, 'uploading', 'Entrando na fila…');
        await UI.api(`/studiox/api/queue/${up.project_id}/enqueue`, {
          method: 'POST',
          json: {
            template_id: t.id, headline_text: t.headline.enabled ? p.text : '', headline_tag: p.tag, headline_image: image,
            copy_text: p.copy || '', strict_copy: p.strict !== false
          }
        });
        this.setPendingStatus(p, 'done', '✓ Na fila');
        sent++;
      } catch (err) {
        this.setPendingStatus(p, 'error', `Erro: ${err.message}`);
      }
      await this.refreshQueue();
    }

    this._adding = false;
    this.pending = this.pending.filter(p => p.state !== 'done');
    this.renderPending();
    if (sent) UI.toast(`${sent} vídeo(s) na fila. Eles serão editados sozinhos, um de cada vez.`, 'success');
  },

  // ---------------------------------------------------------------------------
  // The queue
  // ---------------------------------------------------------------------------
  async refreshQueue() {
    try {
      const q = await UI.api('/studiox/api/queue');
      this.paused = q.paused;
      this.items = q.items;
      const sig = JSON.stringify(q);
      if (sig !== this._sig) {
        this._sig = sig;
        this.renderQueue();
      }
      const n = q.items.filter(i => i.status === 'queued' || i.status === 'running').length;
      document.getElementById('nav-queue-count').textContent = n ? String(n) : '';
    } catch (e) { /* server restarting: try again on the next tick */ }
  },

  renderQueue() {
    const e = UI.esc;
    const pill = document.getElementById('pause-pill');
    pill.textContent = this.paused ? 'Fila pausada' : 'Fila ativa';
    pill.classList.toggle('paused', this.paused);
    document.getElementById('btn-pause').textContent = this.paused ? 'Continuar a fila' : 'Pausar a fila';

    document.getElementById('queue-count').textContent = this.items.length;
    document.getElementById('queue-empty').hidden = this.items.length > 0;
    document.getElementById('btn-clear-done').hidden = !this.items.some(i => ['done', 'cancelled'].includes(i.status));

    document.getElementById('queue').innerHTML = this.items.map(i => {
      const steps = Object.keys(this.STEP_LABELS).map(s => {
        const st = (i.steps || {})[s] || (i.status === 'done' ? 'skipped' : 'pending');
        return `<span class="step-chip ${st}" title="${st}">${this.STEP_MARK[st] || '○'} ${this.STEP_LABELS[s]}</span>`;
      }).join('');
      const dims = i.width && i.height ? `${i.width}×${i.height}` : '';
      const meta = [dims, UI.fmtDuration(i.duration), i.template_name ? `template ${i.template_name}` : ''].filter(Boolean).join(' · ');
      const running = i.status === 'running';
      const bar = ['running', 'queued'].includes(i.status)
        ? `<div class="mini-progress"><div style="width:${Math.max(running ? 4 : 0, i.progress || 0)}%"></div></div>` : '';
      const isErr = i.status === 'error';
      const actions = [];
      if (['queued', 'running', 'awaiting'].includes(i.status)) {
        actions.push(`<button class="btn btn-ghost btn-xs" data-q="cancel" data-id="${e(i.id)}">${i.cancel_requested ? 'Cancelando…' : 'Cancelar'}</button>`);
      }
      if (['error', 'cancelled'].includes(i.status)) actions.push(`<button class="btn btn-secondary btn-xs" data-q="retry" data-id="${e(i.id)}">Tentar de novo</button>`);
      actions.push(`<a class="btn btn-primary btn-xs" href="/studiox/editor.html?project=${e(i.id)}">Abrir no editor</a>`);
      if (i.status === 'done' && i.has_final) {
        actions.push(`<a class="btn btn-secondary btn-xs" href="/studiox/api/projects/${e(i.id)}/video/final.mp4" target="_blank" rel="noopener">▶ Ver</a>`);
        actions.push(`<a class="btn btn-secondary btn-xs" href="/studiox/api/projects/${e(i.id)}/download/final">${Icons.download}Baixar</a>`);
      }
      if (['done', 'error', 'cancelled', 'awaiting'].includes(i.status)) actions.push(`<button class="btn btn-ghost btn-xs" data-q="clear" data-id="${e(i.id)}" title="Tira da lista; o projeto continua salvo">Remover da lista</button>`);
      actions.push(`<button class="btn btn-ghost btn-xs" data-q="log" data-id="${e(i.id)}">${this.expanded.has(i.id) ? 'Ocultar log' : 'Ver log'}</button>`);

      return `
        <div class="queue-item ${e(i.status)}">
          <div class="qi-thumb">${i.thumb_url ? `<img src="${e(i.thumb_url)}" alt="" loading="lazy">` : ''}</div>
          <div>
            <div class="qi-head">
              <span class="qi-name">${e(i.name)}</span>
              <span class="badge st-${i.status === 'running' ? 'processing' : i.status === 'done' ? 'rendered' : i.status}">${e(this.STATUS_LABEL[i.status] || i.status)}</span>
            </div>
            <div class="qi-meta">${e(meta)}</div>
            <div class="qi-steps">${steps}</div>
            ${bar}
            ${this.reviewHtml(i.review)}
            <div class="qi-msg ${isErr ? 'err' : ''}">${e(isErr ? (i.error || i.message) : (i.message || ''))}</div>
            <div class="qi-actions">${actions.join('')}</div>
            <div class="qi-log" data-log="${e(i.id)}" ${this.expanded.has(i.id) ? '' : 'hidden'}>${e((i.logs || []).join('\n'))}</div>
          </div>
        </div>`;
    }).join('');

    document.querySelectorAll('.qi-log:not([hidden])').forEach(el => { el.scrollTop = el.scrollHeight; });
  },

  reviewHtml(r) {
    if (!r) return '';
    const e = UI.esc;
    const who = r.engine && r.engine.startsWith('llm_')
      ? `IA ${e(r.engine.slice(4))}${r.model ? ' · ' + e(r.model) : ''}`
      : (r.engine === 'copy_align' ? 'regras locais + copy' : 'regras locais');
    const parts = [`${r.removed} trecho(s) removido(s)`];
    if (r.retakes || r.stutters || r.fillers) parts.push(`${r.retakes} retake(s)/erro(s), ${r.stutters} gagueira(s), ${r.fillers} hesitação(ões)`);
    if (r.fixes) parts.push(`${r.fixes} palavra(s) corrigida(s)`);
    if (r.rule_cuts) parts.push(`${r.rule_cuts} palavra(s) de erro claro removidas pelas regras de segurança`);
    if (r.verify_cuts) parts.push(`${r.verify_cuts} sobra(s) tirada(s) na leitura final do roteiro`);
    parts.push(`${r.time_saved_s}s a menos`);
    const sc = r.script;
    if (sc && sc.used) {
      const bad = [];
      if ((sc.lines_missing || []).length) bad.push(`sem gravação: linha(s) ${sc.lines_missing.join(', ')}`);
      if ((sc.lines_partial || []).length) bad.push(`incompleta(s): ${sc.lines_partial.join(', ')}`);
      if ((sc.lines_free || []).length) bad.push(`dita(s) com outras palavras: ${sc.lines_free.join(', ')}`);
      if ((sc.out_of_order || []).length) bad.push(`fora de ordem: ${sc.out_of_order.join(', ')}`);
      parts.push(`copy: ${sc.lines_ok}/${sc.lines_total} linhas${bad.length ? ' (' + bad.join('; ') + ')' : ''}`);
    }
    parts.push(r.edges === 'audio' ? 'bordas ajustadas pelo áudio' : 'bordas com margem fixa');
    const warn = (r.warnings || []).map(w => `<div class="warn">⚠ ${e(w)}</div>`).join('');
    return `<div class="qi-review"><strong>Revisão por ${who}:</strong> ${parts.join(' · ')}${r.notes ? `<div>${e(r.notes)}</div>` : ''}${warn}</div>`;
  },

  async queueAction(ev) {
    const btn = ev.target.closest('[data-q]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.q;
    if (act === 'log') {
      if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
      this._sig = '';
      this.renderQueue();
      return;
    }
    try {
      await UI.api(`/studiox/api/queue/${id}/${act}`, { method: 'POST' });
      await this.refreshQueue();
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  async togglePause() {
    try {
      await UI.api(`/studiox/api/queue/${this.paused ? 'resume' : 'pause'}`, { method: 'POST' });
      await this.refreshQueue();
      UI.toast(this.paused ? 'Fila pausada: o vídeo em andamento termina e os outros esperam.' : 'Fila retomada.', 'info');
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  async clearFinished() {
    for (const i of this.items.filter(x => ['done', 'cancelled'].includes(x.status))) {
      try { await UI.api(`/studiox/api/queue/${i.id}/clear`, { method: 'POST' }); } catch (e) { /* skip */ }
    }
    await this.refreshQueue();
  }
};

document.addEventListener('DOMContentLoaded', () => Queue.init());
