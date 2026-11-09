// Saved projects for the editor: autosave of the editing state (cuts, subtitle style, headline,
// grade, transition), restoring it when a project is opened, and "save as template".
//
// The state lives in storage/projects/<id>/project_state.json (backend/projects.py). The
// automatic queue writes the same structure, so a project the queue edited opens here with
// its template already applied and can be fine-tuned like any other.

const ProjectState = {
  AUTOSAVE_MS: 2000,
  projectId: null,
  _last: '',
  _timer: 0,
  _saving: false,
  _failed: false,

  // --- Snapshot -------------------------------------------------------------
  collect() {
    if (!App.currentProject || !Timeline.clips) return null;
    const hl = HeadlineStyle;
    return {
      clips: Timeline.clips.map(c => ({
        start: Math.round(c.start * 1000) / 1000,
        end: Math.round(c.end * 1000) / 1000,
        beat: c.beat || '',
        source: c.source || App.currentProject.source_name
      })),
      grade: TemplatesManager.selectedGrade,
      grade_adjust: Grade.clean(TemplatesManager.gradeState.adj),
      split: SplitScreen.exportConfig(),
      music: Music.exportConfig(),
      motion: Motion.exportConfig(),
      canvas: CanvasFrame.exportConfig(),
      track: FaceTrack.exportConfig(),
      ...Looks.exportConfig(),   // lut, zoom, transition_scale
      ...Transitions.exportConfig(),   // transition_sound, cut_transitions
      transition: TemplatesManager.selectedTransition,
      subtitles: {
        enabled: !!document.getElementById('toggle-subtitles')?.checked,
        preset_id: SubtitleStyle.presetId,
        style: SubtitleStyle.exportStyle()
      },
      headline: {
        enabled: !!document.getElementById('toggle-headline')?.checked,
        preset_id: hl.presetId,
        style: hl.style,
        text: hl.text,
        tag: hl.tag,
        start: hl.start,
        duration: hl.duration
      }
    };
  },

  // --- Restore --------------------------------------------------------------
  apply(edit) {
    if (!edit) return;
    if (edit.grade) {
      TemplatesManager.selectedGrade = edit.grade;
      TemplatesManager.renderGradingCards();
    }
    TemplatesManager.setGradeAdjust(edit.grade_adjust);  // also repaints the video
    if (edit.transition) {
      TemplatesManager.selectedTransition = edit.transition;
      TemplatesManager.renderTransitionCards();
    }
    if (edit.subtitles) {
      const toggle = document.getElementById('toggle-subtitles');
      if (toggle) toggle.checked = !!edit.subtitles.enabled;
      SubtitleStyle.applyExternal(edit.subtitles.preset_id, edit.subtitles.style);
    }
    if (edit.headline) HeadlineStyle.applyExternal(edit.headline);
  },

  // --- Autosave -------------------------------------------------------------
  // Starts watching a freshly opened project. The baseline is taken AFTER the saved state was
  // applied, so opening a project never overwrites it with defaults.
  attach(project) {
    this.detach();
    this.projectId = project.id;
    this._last = JSON.stringify(this.collect());
    this._timer = setInterval(() => this.tick(), this.AUTOSAVE_MS);
    document.getElementById('btn-save-template')?.removeAttribute('disabled');
    document.getElementById('btn-tab-save-template')?.removeAttribute('disabled');
    this.renderTemplateList();   // the Apply buttons need an open project
    // A project that never had a saved state gets one right away, so it shows up as "saved"
    if (!project.state || !project.state.edit) this.save();
    else this.setStatus('saved', project.state.saved_at);
  },

  detach() {
    clearInterval(this._timer);
    this._timer = 0;
    this.projectId = null;
    this.setStatus('');
  },

  tick() {
    if (!this.projectId || this._saving) return;
    const snap = this.collect();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json !== this._last) this.save(snap, json);
  },

  async save(snap = this.collect(), json = null) {
    if (!this.projectId || !snap) return;
    this._saving = true;
    this.setStatus('saving');
    const id = this.projectId;
    const body = json || JSON.stringify(snap);
    try {
      const res = await fetch(`/studiox/api/projects/${id}/state`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit: snap })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (id === this.projectId) this._last = body;
      this.setStatus('saved', new Date().toISOString());
    } catch (err) {
      console.warn('Autosave failed:', err);
      this.setStatus('error');
    } finally {
      this._saving = false;
    }
  },

  // Last chance when the tab closes: sendBeacon survives page unloads
  flushOnExit() {
    if (!this.projectId) return;
    const snap = this.collect();
    if (!snap || JSON.stringify(snap) === this._last) return;
    try {
      navigator.sendBeacon(`/studiox/api/projects/${this.projectId}/state`,
        new Blob([JSON.stringify({ edit: snap })], { type: 'application/json' }));
    } catch (e) { /* nothing else to do */ }
  },

  setStatus(kind, iso) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = `save-status ${kind}`;
    if (kind === 'saving') el.textContent = 'Salvando…';
    else if (kind === 'error') el.textContent = '⚠ Não foi possível salvar';
    else if (kind === 'saved') {
      const d = iso ? new Date(iso) : new Date();
      el.textContent = `✓ Salvo às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } else el.textContent = '';
  },

  // --- Templates ------------------------------------------------------------
  bindTemplateModal() {
    const modal = document.getElementById('template-modal');
    if (!modal) return;
    const close = () => modal.classList.add('hidden');
    document.getElementById('btn-save-template')?.addEventListener('click', async () => {
      await this.fillAiProviders();
      const name = document.getElementById('tpl-name');
      if (name && !name.value) name.value = (App.currentProject?.display_name || '').slice(0, 40);
      modal.classList.remove('hidden');
      name?.focus();
    });
    document.getElementById('btn-close-template-modal')?.addEventListener('click', close);
    document.getElementById('btn-cancel-template')?.addEventListener('click', close);
    document.getElementById('btn-confirm-template')?.addEventListener('click', () => this.saveTemplate(close));
  },

  async fillAiProviders() {
    const select = document.getElementById('tpl-ai-provider');
    if (!select) return;
    try {
      const data = await API.getAiSettings();
      const ready = data.providers.filter(p => p.configured);
      select.innerHTML = '<option value="">Padrão das Configurações</option>' +
        ready.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } catch (e) { select.innerHTML = '<option value="">Padrão das Configurações</option>'; }
  },

  async saveTemplate(done) {
    const snap = this.collect();
    if (!snap) return;
    const $ = id => document.getElementById(id);
    const name = $('tpl-name').value.trim();
    if (!name) { App.showToast('Dê um nome ao template.', 'warning'); $('tpl-name').focus(); return; }

    const headline = { ...snap.headline };
    if (!$('tpl-keep-text').checked) { headline.text = ''; headline.tag = ''; }

    const body = {
      name,
      subtitles: snap.subtitles,
      headline,
      grade: snap.grade,
      grade_adjust: snap.grade_adjust,
      transition: snap.transition,
      transition_scale: snap.transition_scale,
      transition_sound: snap.transition_sound,
      lut: snap.lut,
      zoom: snap.zoom,
      pipeline: {
        auto_cut: $('tpl-auto-cut').checked,
        transcribe: $('tpl-transcribe').checked,
        ai_review: $('tpl-ai-review').value,
        ai_provider: $('tpl-ai-provider').value,
        ai_model: $('tpl-ai-model').value.trim(),
        ai_fix_words: $('tpl-ai-fix').checked,
        language: $('tpl-language').value,
        engine: $('tpl-engine').value,
        render_mode: $('tpl-render-mode').value
      },
      make_default: $('tpl-make-default').checked
    };

    const btn = $('btn-confirm-template');
    btn.disabled = true;
    try {
      const res = await fetch('/studiox/api/edit-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) {
        let detail = 'erro ao salvar';
        try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
        throw new Error(detail);
      }
      done();
      App.showToast(`Template “${name}” salvo. Escolha-o na tela Fila de edição.`, 'success');
      this.loadTemplates();
    } catch (err) {
      App.showToast(`Erro ao salvar o template: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  // --- Apply a saved template to the open video -------------------------------------
  // Everything the template stores about the look (subtitles, headline, grade, LUT, transition, zoom); the cuts, the
  // text of the headline (when the template has none), the split screen and the music are the video's own and stay.
  templates: [],

  async loadTemplates() {
    const list = document.getElementById('editor-tpl-list');
    if (!list) return;
    try {
      const res = await fetch('/studiox/api/edit-templates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.templates = data.templates || [];
      this.defaultTemplateId = data.default_id;
    } catch (err) {
      console.warn('Templates list failed:', err);
      list.innerHTML = '<p class="field-hint">Não foi possível carregar os templates.</p>';
      return;
    }
    this.renderTemplateList();
  },

  templateInfo(tpl) {
    const p = tpl.pipeline || {};
    const ai = { auto: 'revisão por IA se houver chave', llm: 'revisão por IA', local: 'revisão local', off: 'sem revisão' }[p.ai_review] || 'sem revisão';
    const bits = [
      p.auto_cut ? 'corta os silêncios' : 'mantém o vídeo inteiro',
      p.transcribe ? `transcreve (${{ auto: 'automático', elevenlabs: 'ElevenLabs', groq: 'Groq Whisper', groq_turbo: 'Groq Whisper turbo', whisper: 'Whisper local' }[p.engine] || p.engine})` : 'não transcreve',
      ai, p.render_mode === 'preview' ? 'renderiza a prévia' : 'renderiza o vídeo final'
    ];
    return `Na fila: ${bits.join(' · ')}.`;
  },

  renderTemplateList() {
    const list = document.getElementById('editor-tpl-list');
    if (!list) return;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!this.templates.length) {
      list.innerHTML = '<p class="field-hint">Nenhum template salvo. Use “Salvar visual atual como template”.</p>';
      return;
    }
    const canApply = App.currentProject ? '' : ' disabled';
    list.innerHTML = this.templates.map(t => {
      const def = t.id === this.defaultTemplateId;
      return `<div class="tpl-card${def ? ' is-default' : ''}">
        <div class="tpl-card-head"><span class="tpl-card-name" title="${esc(t.name)}">${esc(t.name)}</span>${def ? '<span class="tpl-badge">padrão</span>' : ''}</div>
        <p class="tpl-card-info">${esc(this.templateInfo(t))}</p>
        <div class="tpl-card-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-tpl-act="apply" data-id="${esc(t.id)}"${canApply}>Aplicar</button>
          ${def ? '' : `<button type="button" class="btn btn-ghost btn-xs" data-tpl-act="default" data-id="${esc(t.id)}">Tornar padrão</button>`}
          <button type="button" class="btn btn-ghost btn-xs icon-danger" data-tpl-act="delete" data-id="${esc(t.id)}">Excluir</button>
        </div>
      </div>`;
    }).join('');
  },

  async templateAction(ev) {
    const btn = ev.target.closest('[data-tpl-act]');
    if (!btn) return;
    const tpl = this.templates.find(t => t.id === btn.dataset.id);
    if (!tpl) return;
    try {
      if (btn.dataset.tplAct === 'apply') { this.applyTemplate(tpl); return; }
      if (btn.dataset.tplAct === 'default') {
        const res = await fetch(`/studiox/api/edit-templates/${encodeURIComponent(tpl.id)}/default`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      if (btn.dataset.tplAct === 'delete') {
        if (!confirm(`Excluir o template “${tpl.name}”? Vídeos que já estão na fila não são afetados.`)) return;
        const res = await fetch(`/studiox/api/edit-templates/${encodeURIComponent(tpl.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
          throw new Error(detail);
        }
      }
      await this.loadTemplates();
    } catch (err) {
      App.showToast(`Erro: ${err.message}`, 'error');
    }
  },

  applyTemplate(tpl) {
    if (!tpl || !App.currentProject) return;
    const hl = { ...tpl.headline };
    // the template's own text wins; without one, the video keeps the headline it already has
    if (!(hl.text || '').trim()) { hl.text = HeadlineStyle.text; hl.tag = hl.tag || HeadlineStyle.tag; }
    this.apply({
      grade: tpl.grade, grade_adjust: tpl.grade_adjust, transition: tpl.transition,
      subtitles: tpl.subtitles, headline: hl
    });
    Looks.applyExternal(tpl);
    Transitions.applyExternal(tpl, true);   // the template's default sound; the cuts the user changed stay
    const mode = tpl.pipeline && tpl.pipeline.render_mode;
    const radio = mode && document.querySelector(`input[name="render-mode"][value="${mode}"]`);
    if (radio) { radio.checked = true; document.querySelectorAll('.render-mode-selector .radio-card').forEach(c => c.classList.toggle('active', c.contains(radio))); }
    const note = !(hl.text || '').trim() && tpl.headline && tpl.headline.enabled
      ? ' O template tem headline: escreva o texto na aba Headlines para vê-lo.' : '';
    App.showToast(`Template “${tpl.name}” aplicado.${note}`, 'success');
  },

  bindTemplatePicker() {
    const list = document.getElementById('editor-tpl-list');
    if (!list) return;
    list.addEventListener('click', ev => this.templateAction(ev));
    document.getElementById('btn-tab-save-template')?.addEventListener('click', () => document.getElementById('btn-save-template')?.click());
    // fetched again whenever the tab is opened, so a template saved in the queue screen shows up
    document.querySelector('.tab-btn[data-tab="tab-templates"]')?.addEventListener('click', () => this.loadTemplates());
    this.loadTemplates();
  },

  init() {
    this.bindTemplateModal();
    this.bindTemplatePicker();
    window.addEventListener('pagehide', () => this.flushOnExit());
  }
};
