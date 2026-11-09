// Cuts with AI: upload a long video, let the AI pick the best stretches from its transcript, review them, and turn
// the chosen ones into projects that go through the editing queue with a template (subtitles, headline, color...).

const Clips = {
  videos: [],           // long videos already uploaded (GET /api/highlights)
  video: null,          // the selected one (GET /api/highlights/<id>)
  cands: [],            // the picks with the person's edits: { ...pick, sel }
  templates: [],
  defaultId: null,
  ai: null,
  mode: 'viral',
  sort: 'score',
  _timer: null,
  _hydrated: null,      // finished_at of the analysis whose picks are on screen (edits survive polling)
  _busy: false,
  _range: null,         // the stretch the preview is playing

  PRESETS: [
    { label: '30 s', min: 20, max: 40 }, { label: '45 s', min: 30, max: 55 }, { label: '1 min', min: 45, max: 75 },
    { label: '90 s', min: 70, max: 110 }, { label: '2 min', min: 90, max: 150 }
  ],
  DEFAULTS: { viral: { min: 20, max: 40, count: 10 }, topics: { min: 30, max: 300, count: 0 } },
  COUNTS: [3, 5, 10, 15, 20, 30, 50, 0],
  STAGES: { transcribe: 'Transcrevendo o áudio', audio: 'Analisando o áudio', analyze: 'A IA está lendo a transcrição' },
  STATUS: { idle: 'novo', running: 'analisando…', ready: 'analisado', error: 'erro', cancelled: 'cancelado' },
  MODE_HINT: {
    viral: 'Trechos que funcionam sozinhos, com um gancho no começo e uma conclusão, do tamanho que você escolher.',
    topics: 'A IA separa os assuntos que a pessoa aborda e faz um corte para cada um, do tamanho que ele precisar.'
  },
  STORE: 'videoUse.clips.settings',

  $(id) { return document.getElementById(id); },

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  async init() {
    this.bind();
    try {
      await Promise.all([this.loadTemplates(), this.loadAi(), this.loadVideos()]);
    } catch (err) {
      if (err.outdated) this.$('outdated').hidden = false;
      else UI.toast(`Erro ao carregar: ${err.message}`, 'error');
      return;
    }
    this.renderCounts();
    this.renderAiSelect();
    this.renderTemplateSelect();
    this.applyParams(this.loadSaved() || { mode: 'viral' });
    const wanted = new URLSearchParams(location.search).get('video');
    if (wanted && this.videos.some(v => v.id === wanted)) await this.select(wanted);
    UI.refreshNavBadge();
    setInterval(() => { if (!document.hidden) UI.refreshNavBadge(); }, 4000);
  },

  async loadTemplates() {
    const data = await UI.api('/studiox/api/edit-templates');
    this.templates = data.templates;
    this.defaultId = data.default_id;
  },

  async loadAi() {
    try { this.ai = await UI.api('/studiox/api/settings/ai'); } catch (e) { this.ai = { providers: [], default_provider: null }; }
  },

  async loadVideos() {
    this.videos = (await UI.api('/studiox/api/highlights')).videos;
    const sel = this.$('video-select');
    const keep = sel.value;
    sel.innerHTML = '<option value="">Vídeos já enviados…</option>' + this.videos.map(v => {
      const st = (v.highlights && this.STATUS[v.highlights.status]) || 'novo';
      return `<option value="${UI.esc(v.id)}">${UI.esc(v.name)} · ${UI.fmtDuration(v.duration)} · ${st}</option>`;
    }).join('');
    sel.value = this.videos.some(v => v.id === keep) ? keep : '';
  },

  bind() {
    const drop = this.$('dropzone');
    const input = this.$('file-input');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) this.upload(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files.length) this.upload(input.files[0]); input.value = ''; });

    this.$('video-select').addEventListener('change', e => this.select(e.target.value));
    this.$('mode').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) this.setMode(b.dataset.mode); });
    this.$('dur-chips').addEventListener('click', e => {
      const b = e.target.closest('button[data-min]');
      if (b) { this.$('min-s').value = b.dataset.min; this.$('max-s').value = b.dataset.max; this.markChips(); }
    });
    ['min-s', 'max-s'].forEach(id => this.$(id).addEventListener('input', () => this.markChips()));
    this.$('btn-analyze').addEventListener('click', () => this.analyze());
    this.$('btn-cancel').addEventListener('click', () => this.cancelAnalysis());

    this.$('sort').addEventListener('change', e => { this.sort = e.target.value; this.renderCands(); });
    this.$('btn-sel-all').addEventListener('click', () => this.selectWhere(() => true));
    this.$('btn-sel-top').addEventListener('click', () => this.selectWhere(c => c.score >= 80));
    this.$('btn-sel-none').addEventListener('click', () => this.selectWhere(() => false));
    this.$('tpl-select').addEventListener('change', () => this.renderTemplateHint());
    this.$('btn-create').addEventListener('click', () => this.createProjects());

    const list = this.$('cand-list');
    list.addEventListener('click', e => {
      const btn = e.target.closest('[data-act="play"]');
      if (btn) this.playRange(this.cand(btn.closest('.cand').dataset.id));
    });
    list.addEventListener('change', e => this.onField(e, true));
    list.addEventListener('input', e => this.onField(e, false));
    list.addEventListener('keydown', e => this.onNudge(e));

    const v = this.$('preview');
    v.addEventListener('timeupdate', () => {
      if (this._range && v.currentTime >= this._range.end) { v.pause(); this._range = null; }
    });
    v.addEventListener('error', () => {
      this.$('preview-label').textContent = 'O navegador não conseguiu abrir este formato para a prévia. Os cortes funcionam do mesmo jeito.';
    });
  },

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  pad(n) { return String(n).padStart(2, '0'); },
  fmt(t) {
    t = Math.max(0, t || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return h ? `${h}:${this.pad(m)}:${this.pad(s)}` : `${m}:${this.pad(s)}`;
  },
  fmtP(t) { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`; },
  parse(text) {
    const s = String(text).trim().replace(',', '.');
    if (!s) return NaN;
    let secs = 0;
    for (const part of s.split(':')) {
      const n = parseFloat(part);
      if (!Number.isFinite(n) || n < 0) return NaN;
      secs = secs * 60 + n;
    }
    return s.split(':').length > 3 ? NaN : secs;
  },
  cand(id) { return this.cands.find(c => c.id === id); },

  // ---------------------------------------------------------------------------
  // Choosing / uploading the long video
  // ---------------------------------------------------------------------------
  upload(file) {
    const box = this.$('upload-box');
    box.hidden = false;
    this.$('upload-name').textContent = file.name;
    this.$('upload-msg').textContent = 'Enviando… mantenha esta página aberta até terminar.';
    this.$('dropzone').hidden = true;
    const bar = this.$('upload-bar');
    const send = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.upload.addEventListener('progress', ev => {
        if (!ev.lengthComputable) return;
        const pct = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = `${pct}%`;
        this.$('upload-pct').textContent = `${pct}%`;
        if (pct >= 100) this.$('upload-msg').textContent = 'Recebido. O servidor está lendo o vídeo…';
      });
      xhr.addEventListener('load', () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
        else reject(new Error((body && typeof body.detail === 'string' && body.detail) || `Erro ${xhr.status} no envio`));
      });
      xhr.addEventListener('error', () => reject(new Error('Falha de rede no envio')));
      xhr.open('POST', '/studiox/api/highlights/upload');
      xhr.send(form);
    });
    send.then(async res => {
      await this.loadVideos();
      await this.select(res.project_id);
      UI.toast('Vídeo enviado. Escolha o que você quer e clique em “Analisar com IA”.', 'success');
    }).catch(err => {
      UI.toast(`Erro no envio: ${err.message}`, 'error');
    }).finally(() => {
      box.hidden = true;
      bar.style.width = '0%';
      this.$('upload-pct').textContent = '';
      this.$('dropzone').hidden = false;
    });
  },

  async select(id) {
    this.stopPolling();
    this._hydrated = null;
    this.cands = [];
    this.$('preview').removeAttribute('src');
    this._range = null;
    if (!id) {
      this.video = null;
      this.$('video-select').value = '';
      history.replaceState(null, '', location.pathname);
      this.renderVideo();
      return;
    }
    try {
      this.video = await UI.api(`/studiox/api/highlights/${id}`);
    } catch (err) {
      UI.toast(`Não consegui abrir o vídeo: ${err.message}`, 'error');
      return;
    }
    this.$('video-select').value = id;
    history.replaceState(null, '', `?video=${encodeURIComponent(id)}`);
    const v = this.$('preview');
    v.src = this.video.video_url;
    this.$('preview-label').textContent = 'Use “Ver” em um corte para tocar só aquele trecho do vídeo longo.';
    const params = this.video.highlights && this.video.highlights.params;
    if (params) this.applyParams(params);
    this.renderVideo();
    this.syncRun();
  },

  renderVideo() {
    const v = this.video;
    this.$('video-card').hidden = !v;
    this.$('card-config').hidden = !v;
    if (!v) { this.$('card-results').hidden = true; return; }
    this.$('video-thumb').src = v.thumb_url || '';
    this.$('video-name').textContent = v.name;
    this.$('video-meta').textContent = [v.width && v.height ? `${v.width}×${v.height}` : '', UI.fmtDuration(v.duration)].filter(Boolean).join(' · ');
    const h = v.highlights || {};
    const chips = [];
    if (v.has_transcript) chips.push('<span class="chip-info on">Transcrição pronta</span>');
    else chips.push('<span class="chip-info">Ainda sem transcrição</span>');
    if ((h.clips || []).length) chips.push(`<span class="chip-info on">${h.clips.length} projeto(s) criado(s)</span>`);
    this.$('video-chips').innerHTML = chips.join('');
    this.$('analyze-hint').textContent = v.has_transcript
      ? 'A transcrição deste vídeo já existe e será reaproveitada.'
      : 'Este vídeo ainda não tem transcrição: o áudio será transcrito primeiro (leva alguns minutos e pode gastar créditos do motor escolhido).';
  },

  // ---------------------------------------------------------------------------
  // What the person asks for
  // ---------------------------------------------------------------------------
  renderCounts() {
    this.$('count').innerHTML = this.COUNTS.map(n =>
      `<option value="${n}">${n ? `Até ${n} cortes` : 'Todos os que valerem a pena'}</option>`).join('');
  },

  renderAiSelect() {
    const providers = (this.ai.providers || []).filter(p => p.configured);
    this.$('ai-select').innerHTML =
      '<option value="auto">Automática (a IA padrão; sem chave, regras locais)</option>' +
      providers.map(p => `<option value="${UI.esc(p.id)}">${UI.esc(p.name)}${p.model ? ` · ${UI.esc(p.model)}` : ''}</option>`).join('') +
      '<option value="local">Só regras locais (sem IA, bem menos preciso)</option>';
    this.$('ai-hint').innerHTML = providers.length
      ? 'Quanto melhor o modelo, melhores os cortes. As chaves ficam em <a class="link" href="/studiox/settings.html">Configurações</a>.'
      : 'Nenhuma IA configurada: sem chave os cortes saem por regras simples, bem menos precisas. <a class="link" href="/studiox/settings.html">Salve uma chave em Configurações</a> (o Groq tem plano gratuito).';
  },

  setMode(mode, keepValues) {
    this.mode = mode === 'topics' ? 'topics' : 'viral';
    this.$('mode').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === this.mode));
    this.$('mode-hint').textContent = this.MODE_HINT[this.mode];
    this.$('dur-chips').hidden = this.mode !== 'viral';
    this.$('dur-chips').innerHTML = this.PRESETS.map(p =>
      `<button type="button" class="chip" data-min="${p.min}" data-max="${p.max}">${p.label}</button>`).join('');
    if (!keepValues) {
      const d = this.DEFAULTS[this.mode];
      this.$('min-s').value = d.min;
      this.$('max-s').value = d.max;
      this.$('count').value = String(d.count);
    }
    this.markChips();
  },

  markChips() {
    const min = +this.$('min-s').value, max = +this.$('max-s').value;
    this.$('dur-chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', +c.dataset.min === min && +c.dataset.max === max));
  },

  applyParams(p) {
    this.setMode(p.mode, true);
    const d = this.DEFAULTS[this.mode];
    this.$('min-s').value = p.min_s || d.min;
    this.$('max-s').value = p.max_s || d.max;
    const count = p.count != null ? +p.count : d.count;
    const countSel = this.$('count');
    if (![...countSel.options].some(o => +o.value === count)) {   // a value asked for earlier that is not in the list
      countSel.insertAdjacentHTML('beforeend', `<option value="${count}">Até ${count} cortes</option>`);
    }
    countSel.value = String(count);
    this.$('focus').value = p.focus || '';
    this.$('instructions').value = p.instructions || '';
    if (p.language) this.$('language').value = p.language;
    if (p.engine) this.$('engine').value = p.engine;
    const ai = p.ai === 'local' ? 'local' : (p.ai === 'llm' && p.provider ? p.provider : 'auto');
    this.$('ai-select').value = [...this.$('ai-select').options].some(o => o.value === ai) ? ai : 'auto';
    this.markChips();
  },

  collectParams() {
    const min = Math.round(+this.$('min-s').value), max = Math.round(+this.$('max-s').value);
    if (!(min >= 10) || !(max > min)) throw new Error('Confira a duração: o mínimo tem que ser de pelo menos 10 s e menor que o máximo.');
    const ai = this.$('ai-select').value;
    return {
      mode: this.mode, min_s: min, max_s: max, count: +this.$('count').value,
      language: this.$('language').value, engine: this.$('engine').value,
      ai: ai === 'auto' ? 'auto' : ai === 'local' ? 'local' : 'llm', provider: ['auto', 'local'].includes(ai) ? '' : ai,
      focus: this.$('focus').value.trim(), instructions: this.$('instructions').value.trim()
    };
  },

  loadSaved() { try { return JSON.parse(localStorage.getItem(this.STORE)); } catch (e) { return null; } },
  saveSettings(p) { try { localStorage.setItem(this.STORE, JSON.stringify(p)); } catch (e) { /* private mode */ } },

  // ---------------------------------------------------------------------------
  // Running the analysis
  // ---------------------------------------------------------------------------
  async analyze() {
    if (!this.video) return;
    let params;
    try { params = this.collectParams(); } catch (err) { UI.toast(err.message, 'warning'); return; }
    if (this.cands.some(c => c.project_id) && !confirm('Analisar de novo troca a lista de cortes abaixo por uma nova. Os projetos que você já criou continuam salvos. Continuar?')) return;
    try {
      const res = await UI.api(`/studiox/api/highlights/${this.video.id}/analyze`, { method: 'POST', json: params });
      this.video.highlights = res.highlights;
      this.saveSettings(params);
      this._hydrated = null;
      this.cands = [];
      this.syncRun();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  },

  async cancelAnalysis() {
    try { await UI.api(`/studiox/api/highlights/${this.video.id}/cancel`, { method: 'POST' }); } catch (err) { UI.toast(err.message, 'warning'); }
  },

  // Shows what the server says about the analysis and polls while it runs
  syncRun() {
    const h = (this.video && this.video.highlights) || { status: 'idle' };
    const card = this.$('card-results');
    const running = h.status === 'running';
    card.hidden = !(running || h.status === 'ready' || h.status === 'error' || h.status === 'cancelled' || (h.candidates || []).length);
    this.$('run-box').hidden = !running;
    this.$('btn-analyze').disabled = running;

    const err = this.$('error-box');
    err.hidden = !(h.status === 'error' || h.status === 'cancelled');
    if (h.status === 'error') err.textContent = h.error || 'A análise falhou.';
    if (h.status === 'cancelled') err.textContent = 'A análise foi cancelada.';

    if (running) {
      this.$('engine-badge').hidden = true;
      this.$('run-stage').textContent = this.STAGES[h.stage] || 'Analisando';
      this.$('run-msg').textContent = h.message || '';
      this.$('run-bar').style.width = `${h.progress || 0}%`;
      this.$('run-log').textContent = (h.logs || []).join('\n');
      this.$('results').hidden = true;
      this.startPolling();
      return;
    }
    this.stopPolling();

    const cands = h.candidates || [];
    const badge = this.$('engine-badge');
    badge.hidden = !cands.length || !h.engine;
    badge.textContent = h.engine === 'local' ? 'Regras locais (sem IA)' : 'Escolhidos pela IA';
    const warn = this.$('warn-box');
    warn.hidden = !(h.warnings || []).length;
    warn.textContent = (h.warnings || []).join(' · ');

    this.$('results').hidden = !cands.length;
    if (cands.length && this._hydrated !== (h.finished_at || 'x')) {
      this._hydrated = h.finished_at || 'x';
      this.cands = cands.map(c => ({ ...c, sel: !c.project_id }));
    }
    if (cands.length) { this.renderCands(); this.renderTemplateHint(); }
    this.renderVideo();
  },

  startPolling() {
    if (this._timer) return;
    this._timer = setInterval(async () => {
      if (document.hidden || !this.video) return;
      try {
        const v = await UI.api(`/studiox/api/highlights/${this.video.id}`);
        if (!this.video || v.id !== this.video.id) return;
        this.video = v;
        this.syncRun();
        if (v.highlights.status !== 'running') { this.loadVideos(); UI.toast(v.highlights.status === 'ready' ? `${(v.highlights.candidates || []).length} corte(s) encontrados.` : 'A análise terminou sem cortes.', v.highlights.status === 'ready' ? 'success' : 'warning'); }
      } catch (e) { /* server busy: try again on the next tick */ }
    }, 1500);
  },

  stopPolling() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

  // ---------------------------------------------------------------------------
  // The picks
  // ---------------------------------------------------------------------------
  sortedCands() {
    const list = [...this.cands];
    return this.sort === 'time' ? list.sort((a, b) => a.start - b.start) : list.sort((a, b) => b.score - a.score || a.start - b.start);
  },

  renderCands() {
    this.$('cand-list').innerHTML = this.sortedCands().map(c => this.candHtml(c)).join('');
    this.updateCounts();
  },

  candHtml(c) {
    const e = UI.esc;
    const done = !!c.project_id;
    const tone = c.score >= 80 ? 'high' : c.score >= 60 ? 'mid' : 'low';
    return `
      <article class="cand ${done ? 'created' : ''}" data-id="${e(c.id)}">
        <label class="cand-check" title="Incluir este corte"><input type="checkbox" data-f="sel" ${c.sel ? 'checked' : ''} ${done ? 'disabled' : ''}></label>
        <div class="cand-score ${tone}" style="--p:${Math.max(4, c.score)}" title="Nota da IA: potencial do corte"><span>${c.score}</span></div>
        <div class="cand-body">
          <input type="text" class="text-input cand-title" data-f="title" value="${e(c.title)}" maxlength="120" spellcheck="false" ${done ? 'disabled' : ''} title="Vira o headline do vídeo. Use *asteriscos* para destacar palavras.">
          <div class="cand-meta">
            <span class="cand-time">
              <input type="text" class="text-input tinput" data-f="start" value="${this.fmtP(c.start)}" ${done ? 'disabled' : ''} aria-label="Início" title="Início (↑ ↓ ajustam 0,5 s)">
              <span>→</span>
              <input type="text" class="text-input tinput" data-f="end" value="${this.fmtP(c.end)}" ${done ? 'disabled' : ''} aria-label="Fim" title="Fim (↑ ↓ ajustam 0,5 s)">
            </span>
            <span class="mono" data-dur>${Math.round(c.end - c.start)} s</span>
            ${c.tag ? `<span class="badge">${e(c.tag)}</span>` : ''}
            ${done ? '<span class="badge ok">Projeto criado</span>' : ''}
          </div>
          ${c.why ? `<p class="cand-why">${e(c.why)}</p>` : ''}
          <details class="cand-text"><summary>Ver a fala</summary><p>${e(c.text || '')}</p></details>
        </div>
        <div class="cand-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-act="play">▶ Ver</button>
          ${done ? `<a class="btn btn-primary btn-xs" href="/studiox/editor.html?project=${e(c.project_id)}">Abrir</a>` : ''}
        </div>
      </article>`;
  },

  onField(ev, committed) {
    const input = ev.target.closest('[data-f]');
    if (!input) return;
    const row = input.closest('.cand');
    const c = this.cand(row.dataset.id);
    const f = input.dataset.f;
    if (f === 'sel') { c.sel = input.checked; this.updateCounts(); return; }
    if (f === 'title') { c.title = input.value; return; }
    if (!committed) return;
    const secs = this.parse(input.value);
    const dur = (this.video && this.video.duration) || Infinity;
    if (!Number.isFinite(secs)) { input.value = this.fmtP(c[f]); return; }
    let start = f === 'start' ? secs : c.start, end = f === 'end' ? secs : c.end;
    start = Math.max(0, Math.min(start, dur)); end = Math.max(0, Math.min(end, dur));
    if (end - start < 3) { input.value = this.fmtP(c[f]); UI.toast('Um corte precisa ter pelo menos 3 segundos.', 'warning'); return; }
    c.start = Math.round(start * 100) / 100; c.end = Math.round(end * 100) / 100;
    row.querySelector('[data-f="start"]').value = this.fmtP(c.start);
    row.querySelector('[data-f="end"]').value = this.fmtP(c.end);
    row.querySelector('[data-dur]').textContent = `${Math.round(c.end - c.start)} s`;
    this.updateCounts();
  },

  onNudge(ev) {
    const input = ev.target.closest('[data-f="start"], [data-f="end"]');
    if (!input || !['ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();
    const step = (ev.shiftKey ? 5 : 0.5) * (ev.key === 'ArrowUp' ? 1 : -1);
    const cur = this.parse(input.value);
    if (!Number.isFinite(cur)) return;
    input.value = this.fmtP(cur + step);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },

  selectWhere(pred) {
    this.cands.forEach(c => { if (!c.project_id) c.sel = pred(c); });
    this.renderCands();
  },

  updateCounts() {
    const open = this.cands.filter(c => !c.project_id);
    const chosen = open.filter(c => c.sel);
    const secs = chosen.reduce((s, c) => s + (c.end - c.start), 0);
    this.$('res-count').textContent = `${this.cands.length} corte(s)`;
    this.$('res-sel').textContent = chosen.length ? `· ${chosen.length} escolhido(s), ${this.fmt(secs)} no total` : '· nenhum escolhido';
    const btn = this.$('btn-create');
    btn.disabled = this._busy || !chosen.length;
    btn.textContent = chosen.length ? `Criar ${chosen.length} projeto${chosen.length > 1 ? 's' : ''} e enviar para a fila` : 'Escolha ao menos um corte';
  },

  playRange(c) {
    if (!c) return;
    const v = this.$('preview');
    this._range = { start: c.start, end: c.end };
    this.$('preview-label').textContent = `Trecho ${this.fmt(c.start)} → ${this.fmt(c.end)} (${Math.round(c.end - c.start)} s): ${c.title.replace(/\*/g, '')}`;
    const go = () => { v.currentTime = c.start; v.play().catch(() => {}); };
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
    v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  // ---------------------------------------------------------------------------
  // Templates and creating the projects
  // ---------------------------------------------------------------------------
  currentTemplate() { return this.templates.find(t => t.id === this.$('tpl-select').value) || this.templates[0]; },

  renderTemplateSelect() {
    const sel = this.$('tpl-select');
    sel.innerHTML = this.templates.map(t =>
      `<option value="${UI.esc(t.id)}">${UI.esc(t.name)}${t.id === this.defaultId ? ' (padrão)' : ''}${t.builtin ? '' : ' ★'}</option>`).join('');
    sel.value = this.defaultId;
    this.renderTemplateHint();
  },

  renderTemplateHint() {
    const t = this.currentTemplate();
    if (!t) return;
    this.$('tpl-hint').textContent = (t.description ? `${t.description} ` : '') +
      (t.headline.enabled ? 'O título de cada corte vira o headline do vídeo.' : 'Este template não usa headline: o título não aparece no vídeo.');
  },

  async createProjects() {
    if (this._busy || !this.video) return;
    const chosen = this.cands.filter(c => c.sel && !c.project_id);
    if (!chosen.length) return;
    const t = this.currentTemplate();
    this._busy = true;
    this.updateCounts();
    const status = this.$('create-status');
    status.hidden = false;
    const say = html => { status.innerHTML = html; };
    let sent = 0, failed = 0;
    try {
      say('<img src="images/loader.gif" alt="" class="loader"><span>Criando os projetos…</span>');
      const res = await UI.api(`/studiox/api/highlights/${this.video.id}/clips`, {
        method: 'POST',
        json: { items: chosen.map(c => ({ cand_id: c.id, start: c.start, end: c.end, title: c.title, tag: c.tag, score: c.score })) }
      });
      for (const m of res.clips) {
        say(`<img src="images/loader.gif" alt="" class="loader"><span>Enviando para a fila: ${sent + failed + 1} de ${res.clips.length}…</span>`);
        try {
          const text = t.headline.enabled ? (m.title || '') : '';
          let image = null;
          if (text.trim()) {
            image = await HeadlineStyle.renderPng({ style: t.headline.style, text, tag: m.tag, w: m.render_width, h: m.render_height });
          }
          await UI.api(`/studiox/api/queue/${m.project_id}/enqueue`, {
            method: 'POST',
            json: { template_id: t.id, headline_text: text, headline_tag: t.headline.enabled ? m.tag : '', headline_image: image, strict_copy: true }
          });
          const c = this.cand(m.cand_id);
          if (c) { c.project_id = m.project_id; c.sel = false; }
          sent++;
        } catch (err) {
          failed++;
          UI.toast(`Um corte não entrou na fila: ${err.message}`, 'error');
        }
      }
      say(`<span>${sent} projeto(s) na fila com o template “${UI.esc(t.name)}”. Cada um é cortado do vídeo longo, legendado e renderizado sozinho.` +
        `${failed ? ` ${failed} não entrou; ele ficou aguardando na fila.` : ''} <a class="link" href="/studiox/queue.html">Ver a fila</a> · <a class="link" href="/studiox/">Ver os projetos</a></span>`);
      if (sent) UI.toast(`${sent} corte(s) enviados para a fila de edição.`, 'success');
      this.loadVideos();
      try { this.video = await UI.api(`/studiox/api/highlights/${this.video.id}`); this.renderVideo(); } catch (e) { /* the counters catch up on the next visit */ }
    } catch (err) {
      say('');
      status.hidden = true;
      UI.toast(err.message, 'error');
    } finally {
      this._busy = false;
      this.renderCands();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Clips.init());
