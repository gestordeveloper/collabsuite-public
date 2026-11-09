// Subtitle styling for StudioX: style state, Google Fonts picker, editor
// controls and the live preview.
//
// Mirrors backend/subtitles.py so the preview shows what the render burns in:
// same style schema, same cue/word rules and the same units ("reference pixels":
// the video's SHORT side is always 1080).

const SubtitleStyle = {
  REF: 1080,
  PUNCT_BREAK: '.,!?;:',
  STRIP_RE: /[.,;:!?…"“”()]/g,
  UNSAFE_RE: /[{}\\]/g,
  MIN_CUE: 0.35,
  STORAGE_KEY: 'videoUse.subtitleStyle.v2', // v1 was saved while a stale server made every preset the default style
  OUTDATED_MSG: 'O servidor do StudioX está rodando uma versão antiga e não tem o editor de legendas novo. Feche a janela do servidor (start.bat / run.py) e abra de novo; depois recarregue esta página com Ctrl+F5.',
  RECENT_KEY: 'videoUse.recentFonts.v1',

  DEFAULT: {
    font_family: 'Montserrat', font_weight: 800, italic: false, font_size: 78,
    uppercase: true, letter_spacing: 0, words_per_cue: 2, strip_punctuation: false,
    text_color: '#FFFFFF', highlight_enabled: true, highlight_color: '#FFE600',
    border_style: 'outline', outline_color: '#000000', outline_width: 6,
    box_color: '#000000', box_opacity: 0.6, box_padding: 14,
    shadow_distance: 0, shadow_color: '#000000', shadow_opacity: 0.6,
    position_y: 0.7, margin_x: 0.08,
    text_align: 'center', layout: 'inline', emphasis: 'keyword', emphasis_scale: 2.4, reveal: 'phrase'
  },

  LIMITS: {
    font_weight: [100, 900], font_size: [16, 260], letter_spacing: [-10, 40], words_per_cue: [1, 12],
    outline_width: [0, 40], box_opacity: [0, 1], box_padding: [0, 80], shadow_distance: [0, 30],
    shadow_opacity: [0, 1], position_y: [0, 1], margin_x: [0, 0.45], emphasis_scale: [1, 4]
  },

  WEIGHT_NAMES: { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' },
  CATEGORY_NAMES: { 'sans-serif': 'Sans', serif: 'Serif', display: 'Display', handwriting: 'Manuscrita', monospace: 'Mono' },
  SAMPLE_WORDS: ['Sua', 'legenda', 'aparece', 'assim', 'no', 'vídeo', 'com', 'este', 'estilo'],

  // Editor layout: one section per group, controls are built from this table
  SECTIONS: [
    {
      title: 'Texto',
      controls: [
        { key: 'layout', type: 'segmented', label: 'Formato', options: [['inline', 'Corrido'], ['stack', 'Em pilha']] },
        { key: 'reveal', type: 'segmented', label: 'Entrada', options: [['phrase', 'Frase inteira'], ['word', 'Palavra por palavra']] },
        { key: 'emphasis', type: 'segmented', label: 'Palavra em destaque (grande)', options: [['keyword', 'Maior palavra'], ['spoken', 'Falada'], ['none', 'Nenhuma']], showIf: s => s.layout === 'stack' },
        { key: 'emphasis_scale', type: 'range', label: 'Tamanho do destaque', min: 1, max: 4, step: 0.1, unit: '×', showIf: s => s.layout === 'stack' && s.emphasis !== 'none' },
        { key: 'font_size', type: 'range', label: 'Tamanho', min: 20, max: 220, step: 1, unit: 'px' },
        { key: 'uppercase', type: 'toggle', label: 'CAIXA ALTA' },
        { key: 'letter_spacing', type: 'range', label: 'Espaço entre letras', min: -5, max: 30, step: 0.5, unit: 'px' },
        { key: 'words_per_cue', type: 'range', label: 'Palavras por legenda', min: 1, max: 8, step: 1 },
        { key: 'strip_punctuation', type: 'toggle', label: 'Remover pontuação (. , ! ?)' }
      ]
    },
    {
      title: 'Cores',
      controls: [
        { key: 'text_color', type: 'color', label: 'Cor do texto' },
        { key: 'highlight_enabled', type: 'toggle', label: 'Destacar a palavra falada' },
        { key: 'highlight_color', type: 'color', label: 'Cor do destaque', showIf: s => s.highlight_enabled }
      ]
    },
    {
      title: 'Contorno e fundo',
      controls: [
        { key: 'border_style', type: 'segmented', options: [['outline', 'Contorno'], ['box', 'Caixa'], ['none', 'Nenhum']] },
        { key: 'outline_color', type: 'color', label: 'Cor do contorno', showIf: s => s.border_style === 'outline' },
        { key: 'outline_width', type: 'range', label: 'Espessura', min: 0, max: 30, step: 0.5, unit: 'px', showIf: s => s.border_style === 'outline' },
        { key: 'box_color', type: 'color', label: 'Cor da caixa', showIf: s => s.border_style === 'box' },
        { key: 'box_opacity', type: 'range', label: 'Opacidade da caixa', min: 0, max: 100, step: 1, unit: '%', scale: 100, showIf: s => s.border_style === 'box' },
        { key: 'box_padding', type: 'range', label: 'Margem interna', min: 0, max: 60, step: 1, unit: 'px', showIf: s => s.border_style === 'box' }
      ]
    },
    {
      title: 'Sombra',
      controls: [
        { key: 'shadow_distance', type: 'range', label: 'Distância', min: 0, max: 24, step: 0.5, unit: 'px' },
        { key: 'shadow_color', type: 'color', label: 'Cor da sombra', showIf: s => s.shadow_distance > 0 },
        { key: 'shadow_opacity', type: 'range', label: 'Opacidade da sombra', min: 0, max: 100, step: 1, unit: '%', scale: 100, showIf: s => s.shadow_distance > 0 }
      ]
    },
    {
      title: 'Posição',
      hint: 'Dica: arraste a legenda direto no vídeo, ou clique nela e use as setas ↑ ↓ (Shift = ajuste fino).',
      controls: [
        { key: 'text_align', type: 'segmented', label: 'Alinhamento', options: [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']] },
        { key: 'position_y', type: 'range', label: 'Vertical (0% = topo)', min: 0, max: 100, step: 0.5, unit: '%', scale: 100 },
        { key: 'margin_x', type: 'range', label: 'Margem lateral', min: 0, max: 40, step: 1, unit: '%', scale: 100 }
      ]
    }
  ],

  presets: [],
  presetId: null,
  style: null,
  scale: 0.35,              // preview px per reference px (displayed short side / 1080)
  fontCatalog: [],
  fontsByName: new Map(),
  catalogSource: '',
  catalogState: 'loading',  // loading | ok | error
  catalogError: '',
  outdated: false,          // the server predates this editor (missing routes / presets without `style`)
  recents: [],
  cellFactors: new Map(),   // 'family|weight|italic' -> { cell, ascent } as reported by the server
  ctl: {},

  _links: new Map(),
  _previewLoaded: new Set(),
  _previewQueue: [],
  _previewTimer: 0,
  _cues: null,
  _cueWords: null,
  _cueLen: -1,
  _cueKey: '',
  _cueRev: 0,
  _sig: null,
  _fontKey: '',
  _fontFilter: { q: '', cat: 'all' },
  _fontResults: [],
  _fontShown: 0,
  _persistTimer: 0,

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  init(presets) {
    // Presets without a `style` come from a server that still runs the old code: showing
    // them would render every card as the default style, so say so instead.
    this.presets = (presets || []).filter(p => p.style);
    if (this.presets.length !== (presets || []).length) this.markOutdated();
    this.el = document.getElementById('live-subtitles');
    this.mainEl = document.getElementById('sub-main');
    this.shadowEl = document.getElementById('sub-shadow');
    this.badgeEl = document.getElementById('sub-sample-badge');
    this.layer = document.getElementById('overlay-layer');
    this.editor = document.getElementById('sub-editor');

    this.loadState();
    this.buildEditor();
    this.renderPresetCards();
    this.bindPreview();
    this.observeLayout();
    this.syncControls();
    this.loadFont();
    this.loadFontCatalog();
    this.fitOverlay();
  },

  clone(obj) { return JSON.parse(JSON.stringify(obj)); },

  sanitize(raw) {
    const s = { ...this.DEFAULT };
    for (const [key, def] of Object.entries(this.DEFAULT)) {
      const v = raw ? raw[key] : undefined;
      if (v === undefined || v === null) continue;
      if (typeof def === 'boolean') s[key] = !!v;
      else if (/_color$/.test(key)) { if (/^#[0-9a-f]{6}$/i.test(String(v).trim())) s[key] = String(v).trim().toUpperCase(); }
      else if (typeof def === 'string') s[key] = String(v).trim() || def;
      else if (Number.isFinite(Number(v))) s[key] = Number(v);
      const lim = this.LIMITS[key];
      if (lim) s[key] = Math.min(lim[1], Math.max(lim[0], s[key]));
    }
    if (!['outline', 'box', 'none'].includes(s.border_style)) s.border_style = 'outline';
    if (!['left', 'center', 'right'].includes(s.text_align)) s.text_align = 'center';
    if (!['inline', 'stack'].includes(s.layout)) s.layout = 'inline';
    if (!['phrase', 'word'].includes(s.reveal)) s.reveal = 'phrase';
    if (!['keyword', 'spoken', 'none'].includes(s.emphasis)) s.emphasis = 'keyword';
    s.font_weight = Math.round(s.font_weight / 100) * 100;
    s.words_per_cue = Math.round(s.words_per_cue);
    return s;
  },

  loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
      if (saved && saved.style) {
        this.style = this.sanitize(saved.style);
        this.presetId = saved.presetId || null;
      }
      this.recents = JSON.parse(localStorage.getItem(this.RECENT_KEY) || '[]').slice(0, 8);
    } catch (e) { /* storage unavailable: start from the default preset */ }

    if (!this.style) {
      const p = this.presets.find(x => x.id === 'tiktok_bold') || this.presets[0];
      this.style = this.sanitize(p ? p.style : this.DEFAULT);
      this.presetId = p ? p.id : null;
    }
    this.syncTemplatesManager();
  },

  markOutdated() {
    if (this.outdated) return;
    this.outdated = true;
    const tab = document.getElementById('tab-subtitles');
    if (!tab) return;
    const box = document.createElement('div');
    box.className = 'info-alert sub-notice warn';
    box.textContent = `⚠ ${this.OUTDATED_MSG}`;
    tab.prepend(box);
  },

  persist() {
    if (this.outdated) return; // don't save a style built on top of missing server data
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ style: this.style, presetId: this.presetId })); } catch (e) { /* ignore */ }
    }, 150);
  },

  syncTemplatesManager() {
    if (typeof TemplatesManager !== 'undefined') TemplatesManager.selectedSubtitle = this.presetId;
  },

  exportStyle() { return this.clone(this.style); },

  presetName() {
    const p = this.presets.find(x => x.id === this.presetId);
    return p ? p.name : 'Personalizado';
  },

  // ---------------------------------------------------------------------------
  // Style changes
  // ---------------------------------------------------------------------------
  set(patch) {
    const before = this.style;
    // The stacked layout is made to be built word by word: choosing it turns that entry on (it can still be changed after)
    if (patch.layout === 'stack' && before.layout !== 'stack' && !('reveal' in patch)) patch = { ...patch, reveal: 'word' };
    this.style = this.sanitize({ ...before, ...patch });

    const changed = k => this.style[k] !== before[k];
    const fontChanged = changed('font_family') || changed('font_weight') || changed('italic');
    if (['words_per_cue', 'uppercase', 'strip_punctuation'].some(changed)) this._cueRev++;

    this.persist();
    this.syncControls();
    if (fontChanged) this.loadFont();
    this.refresh();
  },

  refresh() {
    this.applyStyle();
    this.renderAt(Player.currentTime || 0, true);
  },

  applyPreset(id) {
    const p = this.presets.find(x => x.id === id);
    if (!p) return;
    const before = this.style;
    this.presetId = id;
    this.style = this.sanitize(p.style);
    this._cueRev++;
    this.syncTemplatesManager();
    this.persist();
    this.syncControls();
    this.renderPresetCards();
    if (before.font_family !== this.style.font_family || before.font_weight !== this.style.font_weight || before.italic !== this.style.italic) {
      this.loadFont();
    }
    this.refresh();
  },

  // Style + preset restored from a saved project (or a template) instead of picked by the user
  applyExternal(presetId, style) {
    const before = this.style;
    this.presetId = presetId || null;
    this.style = this.sanitize(style || before);
    this._cueRev++;
    this.syncTemplatesManager();
    this.persist();
    this.syncControls();
    this.renderPresetCards();
    if (before.font_family !== this.style.font_family || before.font_weight !== this.style.font_weight || before.italic !== this.style.italic) {
      this.loadFont();
    }
    this.refresh();
  },

  isModified() {
    const p = this.presets.find(x => x.id === this.presetId);
    if (!p) return false; // nothing to compare against (no preset chosen / presets unavailable)
    return JSON.stringify(this.sanitize(p.style)) !== JSON.stringify(this.style);
  },

  // ---------------------------------------------------------------------------
  // Fonts
  // ---------------------------------------------------------------------------
  fontCssUrl(items) {
    const fams = items.map(({ family, weight, italic }) =>
      `family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`);
    return `https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap`;
  },

  injectCss(url) {
    if (this._links.has(url)) return this._links.get(url);
    const p = new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      document.head.appendChild(link);
    });
    this._links.set(url, p);
    return p;
  },

  fontKey(s = this.style) { return `${s.font_family}|${s.font_weight}|${s.italic ? 1 : 0}`; },

  // Loads the current font in the browser and asks the server to fetch the TTF the
  // render will use (which also reports libass's line metrics for this font).
  async loadFont() {
    const s = this.style;
    const key = this.fontKey();
    this._fontKey = key;
    this.updateFontButton();
    this.setFontStatus('loading');

    await this.injectCss(this.fontCssUrl([{ family: s.font_family, weight: s.font_weight, italic: s.italic }]));
    try {
      await document.fonts.load(`${s.italic ? 'italic ' : ''}${s.font_weight} 64px "${s.font_family}"`, 'AaÁÍÇÃÕéÊ0123');
    } catch (e) { /* the fallback font still renders */ }
    if (this._fontKey !== key) return;
    this.applyStyle();
    this.renderAt(Player.currentTime || 0, true);

    if (!this.cellFactors.has(key)) {
      try {
        const info = await API.resolveFont(s.font_family, s.font_weight, s.italic);
        this.cellFactors.set(key, { cell: info.cell_factor, ascent: info.ascent_factor });
      } catch (err) {
        // A stale server is transient (fixed by restarting it): don't cache that as "this font is bad"
        if (err.outdated) this.markOutdated();
        else this.cellFactors.set(key, { error: err.message });
        if (this._fontKey !== key) return;
        this.setFontStatus(err.outdated ? 'outdated' : 'error', err.message);
        return;
      }
    }
    if (this._fontKey !== key) return;
    const info = this.cellFactors.get(key);
    this.setFontStatus(info.error ? 'error' : 'ready', info.error);
    this.applyStyle();
    this.renderAt(Player.currentTime || 0, true);
  },

  setFontStatus(state, detail = '') {
    const el = document.getElementById('font-status');
    if (!el) return;
    el.className = `font-status ${state === 'outdated' ? 'error' : state}`;
    el.textContent = {
      loading: 'Carregando fonte…',
      ready: '✓ Fonte pronta para o preview e para o render',
      error: `⚠ ${detail || 'Fonte indisponível'}. O render usará Arial no lugar.`,
      outdated: '⚠ Servidor desatualizado: reinicie o StudioX (veja o aviso no topo desta aba).'
    }[state];
  },

  async loadFontCatalog() {
    this.catalogState = 'loading';
    this.filterFonts();
    try {
      const res = await API.getFonts();
      this.fontCatalog = res.fonts || [];
      this.catalogSource = res.source;
      this.catalogState = 'ok';
    } catch (err) {
      this.fontCatalog = [];
      this.catalogState = 'error';
      this.catalogError = err.outdated ? 'servidor desatualizado' : err.message;
      if (err.outdated) this.markOutdated();
    }
    this.fontsByName = new Map(this.fontCatalog.map(f => [f.f, f]));
    this.updateFontButton();
    this.syncControls();
    this.filterFonts();
    document.dispatchEvent(new CustomEvent('fontcatalog')); // the headline editor shares this catalog
  },

  fontEntry(name = this.style.font_family) { return this.fontsByName.get(name) || null; },

  pickPreviewFace(entry) {
    if (!entry) return { weight: 400, italic: false };
    if (!entry.w.length) return { weight: entry.i[0] || 400, italic: true };
    const weight = entry.w.includes(400) ? 400 : entry.w.reduce((a, b) => (Math.abs(b - 400) < Math.abs(a - 400) ? b : a));
    return { weight, italic: false };
  },

  queuePreview(family) {
    if (this._previewLoaded.has(family)) return;
    this._previewLoaded.add(family);
    this._previewQueue.push(family);
    if (!this._previewTimer) this._previewTimer = setTimeout(() => this.flushPreviewQueue(), 60);
  },

  flushPreviewQueue() {
    this._previewTimer = 0;
    const batch = this._previewQueue.splice(0, 10);
    if (!batch.length) return;
    const items = batch.map(family => ({ family, ...this.pickPreviewFace(this.fontEntry(family)) }));
    this.injectCss(this.fontCssUrl(items)).then(ok => {
      if (ok) return;
      // One unknown style would fail the whole batch: retry family by family
      items.forEach(it => this.injectCss(this.fontCssUrl([it])));
    });
    if (this._previewQueue.length) this._previewTimer = setTimeout(() => this.flushPreviewQueue(), 60);
  },

  // ---------------------------------------------------------------------------
  // Editor UI
  // ---------------------------------------------------------------------------
  esc(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  buildEditor() {
    if (!this.editor) return;

    const controlHtml = c => {
      const id = `subctl-${c.key}`;
      if (c.type === 'range') {
        return `<div class="sub-ctl" data-key="${c.key}">
          <label for="${id}">${c.label}</label>
          <div class="sub-range">
            <input type="range" id="${id}" min="${c.min}" max="${c.max}" step="${c.step}">
            <input type="number" class="num" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label} (valor exato)">
            <span class="unit">${c.unit || ''}</span>
          </div></div>`;
      }
      if (c.type === 'color') {
        return `<div class="sub-ctl sub-ctl-inline" data-key="${c.key}">
          <label for="${id}">${c.label}</label>
          <div class="sub-color">
            <input type="color" id="${id}">
            <input type="text" class="hex" maxlength="7" spellcheck="false" aria-label="${c.label} (hexadecimal)">
          </div></div>`;
      }
      if (c.type === 'toggle') {
        return `<div class="sub-ctl sub-ctl-inline" data-key="${c.key}">
          <label class="toggle-switch"><input type="checkbox" id="${id}"><span class="switch-slider"></span>
          <span class="switch-label">${c.label}</span></label></div>`;
      }
      return `<div class="sub-ctl" data-key="${c.key}">${c.label ? `<label>${c.label}</label>` : ''}<div class="segmented" role="group">
        ${c.options.map(([v, l]) => `<button type="button" data-value="${v}">${l}</button>`).join('')}
        </div></div>`;
    };

    this.editor.innerHTML = `
      <section class="sub-section" id="sub-font-section">
        <h4 class="sub-section-title">Fonte <span class="sub-count" id="font-count"></span></h4>
        <button type="button" class="font-picker-btn" id="font-btn" aria-haspopup="listbox" aria-expanded="false">
          <span class="font-btn-name" id="font-btn-name"></span>
          <span class="font-btn-meta" id="font-btn-meta"></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="font-panel hidden" id="font-panel">
          <input type="search" id="font-search" class="text-input" placeholder="Buscar fonte (ex.: Poppins, Bebas, Pacifico)…" autocomplete="off" spellcheck="false">
          <div class="font-cats" id="font-cats"></div>
          <div class="font-list" id="font-list" role="listbox"></div>
          <div class="font-foot" id="font-foot"></div>
        </div>
        <div class="sub-grid-2">
          <div class="form-group"><label for="font-weight">Peso</label><select id="font-weight" class="text-input"></select></div>
          <div class="sub-ctl-inline sub-italic"><label class="toggle-switch"><input type="checkbox" id="font-italic"><span class="switch-slider"></span><span class="switch-label">Itálico</span></label></div>
        </div>
        <div class="font-status" id="font-status"></div>
      </section>
      ${this.SECTIONS.map(sec => `
        <section class="sub-section">
          <h4 class="sub-section-title">${sec.title}</h4>
          ${sec.controls.map(controlHtml).join('')}
          ${sec.hint ? `<span class="field-hint">${sec.hint}</span>` : ''}
        </section>`).join('')}
      <div class="sub-actions">
        <button type="button" class="btn btn-ghost btn-xs" id="btn-reset-style">↺ Restaurar estilo pronto</button>
      </div>`;

    // Range / color / toggle / segmented bindings, all from the same table
    for (const sec of this.SECTIONS) {
      for (const c of sec.controls) {
        const row = this.editor.querySelector(`.sub-ctl[data-key="${c.key}"]`);
        this.ctl[c.key] = { row, def: c };
        if (c.type === 'range') this.bindRange(row, c);
        else if (c.type === 'color') this.bindColor(row, c);
        else if (c.type === 'toggle') row.querySelector('input').addEventListener('change', e => this.set({ [c.key]: e.target.checked }));
        else row.querySelectorAll('button').forEach(b => b.addEventListener('click', () => this.set({ [c.key]: b.dataset.value })));
      }
    }

    document.getElementById('btn-reset-style').addEventListener('click', () => this.applyPreset(this.presetId || (this.presets[0] && this.presets[0].id)));
    this.bindFontPicker();
  },

  bindRange(row, c) {
    const scale = c.scale || 1;
    const range = row.querySelector('input[type=range]');
    const num = row.querySelector('input.num');
    range.addEventListener('input', () => this.set({ [c.key]: parseFloat(range.value) / scale }));
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v) && v >= c.min && v <= c.max) this.set({ [c.key]: v / scale });
    });
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      this.set({ [c.key]: (Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : c.min) / scale });
      this.syncControls(true);
    });
  },

  bindColor(row, c) {
    const picker = row.querySelector('input[type=color]');
    const hex = row.querySelector('input.hex');
    picker.addEventListener('input', () => this.set({ [c.key]: picker.value.toUpperCase() }));
    const commit = () => {
      let v = hex.value.trim();
      if (/^#?[0-9a-f]{3}$/i.test(v)) v = v.replace('#', '').split('').map(ch => ch + ch).join('');
      v = '#' + v.replace('#', '');
      if (/^#[0-9a-f]{6}$/i.test(v)) this.set({ [c.key]: v.toUpperCase() });
      else this.syncControls(true);
    };
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) commit(); });
    hex.addEventListener('change', commit);
  },

  // Pushes the current style into every control (skipping the one being typed in)
  syncControls(force = false) {
    if (!this.editor) return;
    const s = this.style;
    const active = document.activeElement;

    for (const { row, def } of Object.values(this.ctl)) {
      if (!row) continue;
      const v = s[def.key];
      row.hidden = def.showIf ? !def.showIf(s) : false;

      if (def.type === 'range') {
        const shown = Math.round(v * (def.scale || 1) * 100) / 100;
        const range = row.querySelector('input[type=range]');
        const num = row.querySelector('input.num');
        range.value = shown;
        if (force || num !== active) num.value = shown;
      } else if (def.type === 'color') {
        const picker = row.querySelector('input[type=color]');
        const hex = row.querySelector('input.hex');
        picker.value = v.toLowerCase();
        if (force || hex !== active) hex.value = v;
      } else if (def.type === 'toggle') {
        row.querySelector('input').checked = !!v;
      } else {
        row.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === v));
      }
    }

    this.syncWeightControls();
    this.updateFontButton();
    const reset = document.getElementById('btn-reset-style');
    if (reset) reset.disabled = !this.isModified();
    const tag = document.getElementById('preset-modified');
    if (tag) tag.classList.toggle('hidden', !this.isModified());
  },

  syncWeightControls() {
    const sel = document.getElementById('font-weight');
    const ital = document.getElementById('font-italic');
    if (!sel || !ital) return;
    const s = this.style;
    const entry = this.fontEntry();
    const weights = entry && entry.w.length ? entry.w : [s.font_weight];
    sel.innerHTML = weights.map(w => `<option value="${w}">${w} · ${this.WEIGHT_NAMES[w] || ''}</option>`).join('');
    sel.value = String(s.font_weight);
    const hasItalic = entry ? entry.i.includes(s.font_weight) : true;
    ital.disabled = !hasItalic;
    ital.checked = !!s.italic;
    ital.closest('.sub-italic').classList.toggle('disabled', !hasItalic);
    sel.onchange = () => this.setWeight(parseInt(sel.value, 10));
    ital.onchange = () => this.set({ italic: ital.checked });
  },

  setWeight(weight) {
    const entry = this.fontEntry();
    const italic = entry ? this.style.italic && entry.i.includes(weight) : this.style.italic;
    this.set({ font_weight: weight, italic });
  },

  updateFontButton() {
    const name = document.getElementById('font-btn-name');
    if (!name) return;
    const s = this.style;
    name.textContent = s.font_family;
    name.style.fontFamily = `"${s.font_family}", sans-serif`;
    const entry = this.fontEntry();
    const cat = entry ? this.CATEGORY_NAMES[entry.c] : '';
    document.getElementById('font-btn-meta').textContent = `${s.font_weight}${s.italic ? ' itálico' : ''}${cat ? ' · ' + cat : ''}`;
    const count = document.getElementById('font-count');
    if (count) count.textContent = this.fontCatalog.length ? `${this.fontCatalog.length.toLocaleString('pt-BR')} no Google Fonts` : '';
  },

  // --- Font picker ------------------------------------------------------------
  bindFontPicker() {
    const btn = document.getElementById('font-btn');
    const panel = document.getElementById('font-panel');
    const search = document.getElementById('font-search');
    const list = document.getElementById('font-list');

    this._io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        this.queuePreview(en.target.dataset.family);
        this._io.unobserve(en.target);
      });
    }, { root: list, rootMargin: '160px' });

    btn.addEventListener('click', () => {
      const open = panel.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
      if (open) {
        this.filterFonts();
        search.focus();
        const sel = list.querySelector('.font-row.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      }
    });

    search.addEventListener('input', () => { this._fontFilter.q = search.value; this.filterFonts(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter' && this._fontResults[0]) this.pickFamily(this._fontResults[0].f);
      if (e.key === 'Escape') { panel.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    });
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 240) this.appendFontRows();
    });
    list.addEventListener('click', e => {
      const row = e.target.closest('.font-row');
      if (row) this.pickFamily(row.dataset.family);
    });
    document.getElementById('font-foot').addEventListener('click', e => {
      if (e.target.closest('#font-retry')) this.loadFontCatalog();
    });
    document.getElementById('font-cats').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      this._fontFilter.cat = chip.dataset.cat;
      this.filterFonts();
    });
  },

  renderCategoryChips() {
    const cats = [['all', 'Todas']];
    if (this.recents.length) cats.push(['recent', 'Recentes']);
    cats.push(['sans-serif', 'Sans'], ['serif', 'Serif'], ['display', 'Display'], ['handwriting', 'Manuscrita'], ['monospace', 'Mono']);
    document.getElementById('font-cats').innerHTML = cats.map(([id, label]) =>
      `<button type="button" class="chip${this._fontFilter.cat === id ? ' active' : ''}" data-cat="${id}">${label}</button>`).join('');
  },

  filterFonts() {
    const list = document.getElementById('font-list');
    if (!list) return;
    const { q, cat } = this._fontFilter;
    const needle = q.trim().toLowerCase();

    let pool = this.fontCatalog;
    if (cat === 'recent') pool = this.recents.map(n => this.fontsByName.get(n)).filter(Boolean);
    else if (cat !== 'all') pool = pool.filter(f => f.c === cat);
    if (needle) pool = pool.filter(f => f.f.toLowerCase().includes(needle));

    this._fontResults = pool;
    this._fontShown = 0;
    list.innerHTML = '';
    list.scrollTop = 0;
    this.renderCategoryChips();
    this.appendFontRows();

    const typed = q.trim();
    if (this.catalogState === 'error' && typed) {
      // No catalog to search: let the user type any Google Fonts family name and use it anyway
      const row = document.createElement('div');
      row.className = 'font-row';
      row.dataset.family = typed;
      row.innerHTML = `<span class="font-row-name">Usar “${this.esc(typed)}”</span><span class="font-row-cat">digitada</span>`;
      list.prepend(row);
    }

    const foot = document.getElementById('font-foot');
    if (foot) {
      if (this.catalogState === 'loading') {
        foot.textContent = 'Carregando o catálogo do Google Fonts…';
      } else if (this.catalogState === 'error') {
        foot.innerHTML = `<span class="font-foot-error">⚠ Não foi possível carregar o catálogo (${this.esc(this.catalogError)}).</span> <button type="button" class="btn btn-ghost btn-xs" id="font-retry">Tentar de novo</button>`;
      } else {
        const warn = this.catalogSource === 'fallback' ? ' · sem conexão: lista reduzida' : '';
        foot.textContent = pool.length ? `${pool.length.toLocaleString('pt-BR')} fonte(s)${warn}` : 'Nenhuma fonte encontrada';
      }
    }
  },

  appendFontRows() {
    const list = document.getElementById('font-list');
    if (!list || this._fontShown >= this._fontResults.length) return;
    const chunk = this._fontResults.slice(this._fontShown, this._fontShown + 60);
    this._fontShown += chunk.length;

    const frag = document.createDocumentFragment();
    for (const f of chunk) {
      const face = this.pickPreviewFace(f);
      const row = document.createElement('div');
      row.className = `font-row${f.f === this.style.font_family ? ' selected' : ''}`;
      row.dataset.family = f.f;
      row.setAttribute('role', 'option');
      row.innerHTML = `<span class="font-row-name" style="font-family:'${this.esc(f.f)}',sans-serif;font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'}">${this.esc(f.f)}</span>
        <span class="font-row-cat">${this.CATEGORY_NAMES[f.c] || ''}</span>`;
      frag.appendChild(row);
      this._io.observe(row);
    }
    list.appendChild(frag);
  },

  pickFamily(name) {
    const entry = this.fontEntry(name);
    const s = this.style;
    let weight = s.font_weight;
    let italic = s.italic;
    if (entry) {
      const avail = entry.w.length ? entry.w : entry.i;
      if (!avail.includes(weight)) weight = avail.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), avail[0] || 400);
      italic = italic ? entry.i.includes(weight) : (!entry.w.length && entry.i.length > 0);
    }
    this.recents = [name, ...this.recents.filter(n => n !== name)].slice(0, 8);
    try { localStorage.setItem(this.RECENT_KEY, JSON.stringify(this.recents)); } catch (e) { /* ignore */ }

    document.getElementById('font-panel').classList.add('hidden');
    document.getElementById('font-btn').setAttribute('aria-expanded', 'false');
    document.getElementById('font-search').value = '';
    this._fontFilter.q = '';
    this.set({ font_family: name, font_weight: weight, italic });
  },

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------
  renderPresetCards() {
    const container = document.getElementById('subtitle-template-list');
    if (!container) return;

    container.innerHTML = this.presets.map(p => {
      const st = this.sanitize(p.style);
      this.injectCss(this.fontCssUrl([{ family: st.font_family, weight: st.font_weight, italic: st.italic }]));
      const words = (st.uppercase ? ['CORTES', 'PRECISOS'] : ['Cortes', 'precisos']);
      const css = this.textCss(st, 0.2, 1.3);
      const html = st.layout === 'stack'
        ? this.captionHtml((st.uppercase ? ['SÓ QUE', 'ISSO', 'ACONTECE'] : ['Só que', 'isso', 'acontece']), 1, true, { ...st, emphasis: 'spoken' })
        : words.map((w, i) =>
          `<span${st.highlight_enabled && i === 1 ? ` style="color:${st.highlight_color}"` : ''}>${w}</span>`).join(' ');
      return `<div class="template-card preset-card ${p.id === this.presetId ? 'active' : ''}" data-id="${p.id}" data-type="subtitle" title="${this.esc(p.description)}">
        <div class="template-card-header">
          <span class="template-card-title">${this.esc(p.name)}</span>
        </div>
        <div class="preset-sample"><div style="${this.esc(this.cssText(css.main))}">${html}</div></div>
        <span class="badge badge-subtle">${p.preview_badge || p.category}</span>
      </div>`;
    }).join('');
  },

  cssText(obj) {
    return Object.entries(obj).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';');
  },

  // ---------------------------------------------------------------------------
  // Style -> CSS (shared by the live caption and the preset cards)
  // ---------------------------------------------------------------------------
  ring(radius, color, dx = 0, dy = 0) {
    if (radius <= 0.05) return [];
    const radii = radius > 3 ? [radius, radius * 0.66, radius * 0.33] : [radius];
    const out = [];
    for (const r of radii) {
      const n = Math.min(40, Math.max(12, Math.ceil(2 * Math.PI * r)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push(`${(dx + r * Math.cos(a)).toFixed(2)}px ${(dy + r * Math.sin(a)).toFixed(2)}px 0 ${color}`);
      }
    }
    return out;
  },

  hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  },

  // k = preview px per reference px; cell = libass line height / em for this font
  textCss(s, k, cell) {
    const main = {
      fontFamily: `"${s.font_family}", sans-serif`,
      fontWeight: s.font_weight,
      fontStyle: s.italic ? 'italic' : 'normal',
      fontSize: `${s.font_size * k}px`,
      letterSpacing: `${s.letter_spacing * k}px`,
      lineHeight: cell,
      color: s.text_color
    };
    const shadow = { ...main, color: s.shadow_color, opacity: s.shadow_opacity };

    if (s.border_style === 'box') {
      const pad = s.box_padding * k;
      Object.assign(main, {
        background: this.hexToRgba(s.box_color, s.box_opacity),
        padding: `${pad}px`,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone'
      });
      if (s.shadow_distance > 0) {
        main.boxShadow = `${s.shadow_distance * k}px ${s.shadow_distance * k}px 0 ${this.hexToRgba(s.shadow_color, s.shadow_opacity)}`;
      }
    } else if (s.border_style === 'outline') {
      main.textShadow = this.ring(s.outline_width * k, s.outline_color).join(',') || 'none';
      shadow.textShadow = this.ring(s.outline_width * k, s.shadow_color).concat(this.ring(0.1, s.shadow_color)).join(',') || 'none';
    }
    return { main, shadow };
  },

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------
  fontMetrics() {
    return this.cellFactors.get(this.fontKey()) || {};
  },

  applyStyle() {
    if (!this.el) return;
    const s = this.style;
    const m = this.fontMetrics();
    const cell = m.cell || 1.25;
    const css = this.textCss(s, this.scale, cell);

    const stack = s.layout === 'stack';
    this.el.classList.toggle('stack', stack);
    this.el.style.textAlign = s.text_align;
    this.mainEl.removeAttribute('style');
    Object.assign(this.mainEl.style, css.main);

    const useShadow = s.border_style !== 'box' && s.shadow_distance > 0;
    this.shadowEl.classList.toggle('hidden', !useShadow);
    if (useShadow) {
      this.shadowEl.removeAttribute('style');
      Object.assign(this.shadowEl.style, css.shadow);
      const d = s.shadow_distance * this.scale;
      this.shadowEl.style.transform = `translate(${d}px, ${d}px)`;
    }

    // libass anchors the first baseline at the win-ascent; CSS uses the font's own
    // ascent/descent. Compensate so the caption sits at the same height as the render.
    let dy = 0;
    if (m.ascent) {
      try {
        const px = s.font_size * this.scale;
        const ctx = (this._ctx = this._ctx || document.createElement('canvas').getContext('2d'));
        ctx.font = `${s.italic ? 'italic ' : ''}${s.font_weight} ${px}px "${s.font_family}"`;
        const tm = ctx.measureText('Hg');
        if (tm.fontBoundingBoxAscent !== undefined) {
          const a = tm.fontBoundingBoxAscent;
          const d = tm.fontBoundingBoxDescent;
          const lineH = cell * px;
          dy = m.ascent * px - ((lineH - (a + d)) / 2 + a);
        }
      } catch (e) { dy = 0; }
    }

    Object.assign(this.el.style, {
      left: `${s.margin_x * 100}%`,
      right: `${s.margin_x * 100}%`,
      top: `${s.position_y * 100}%`,
      transform: `translateY(calc(-50% + ${dy.toFixed(2)}px))`
    });
  },

  // Size the overlay to the picture actually shown (the player letterboxes it)
  fitOverlay() {
    const container = document.getElementById('video-container');
    const layer = this.layer;
    if (!container || !layer) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const meta = (typeof App !== 'undefined' && App.currentProject && App.currentProject.meta) || {};
    const v = Player.video;
    const vw = (v && v.videoWidth) || meta.width || 16;
    const vh = (v && v.videoHeight) || meta.height || 9;
    // The container IS the output frame (js/canvasframe.js sizes it to the chosen aspect ratio), so captions, headline
    // and motion graphics are laid out on all of it, not on the shape of the file (a 16:9 video in a 9:16 frame).
    const framed = typeof CanvasFrame !== 'undefined' && CanvasFrame.state;
    const fit = framed ? 1 : Math.min(cw / vw, ch / vh);
    const dw = framed ? cw : vw * fit;
    const dh = framed ? ch : vh * fit;

    Object.assign(layer.style, { left: `${(cw - dw) / 2}px`, top: `${(ch - dh) / 2}px`, width: `${dw}px`, height: `${dh}px` });
    this.scale = Math.min(dw, dh) / this.REF;
    this.applyStyle();
    this.renderAt(Player.currentTime || 0, true);
  },

  observeLayout() {
    const container = document.getElementById('video-container');
    if (container && 'ResizeObserver' in window) new ResizeObserver(() => this.fitOverlay()).observe(container);
    if (Player.video) Player.video.addEventListener('loadedmetadata', () => this.fitOverlay());
    document.getElementById('toggle-subtitles')?.addEventListener('change', () => this.refresh());
  },

  sampleWords() {
    const n = Math.min(this.style.words_per_cue, this.SAMPLE_WORDS.length);
    return this.SAMPLE_WORDS.slice(0, n).map(w => this.cleanWord(w, false));
  },

  hide() {
    if (this.el) this.el.classList.add('hidden');
    if (this.badgeEl) this.badgeEl.classList.add('hidden');
    this._sig = null;
  },

  renderAt(time, force = false) {
    if (!this.el) return;
    if (!document.getElementById('toggle-subtitles')?.checked) { this.hide(); return; }

    const found = this.findCue(time);
    let words;
    let active;
    let sig;
    let sample = false;

    if (found) {
      words = found.cue.words.map(w => w.text);
      active = found.active;
      sig = `${found.cue.id}:${active}`;
    } else if (Player.video && Player.video.paused && Player.video.currentSrc) {
      sample = true;
      words = this.sampleWords();
      active = Math.min(1, words.length - 1);
      sig = 'sample';
    } else {
      this.hide();
      return;
    }

    if (!force && sig === this._sig && !this.el.classList.contains('hidden')) return;
    this._sig = sig;

    const shown = !sample && this.style.reveal === 'word' ? active + 1 : null;
    this.mainEl.innerHTML = this.captionHtml(words, active, true, this.style, shown);
    this.shadowEl.innerHTML = this.captionHtml(words, active, false, this.style, shown);

    this.el.classList.remove('hidden');
    this.el.classList.toggle('is-sample', sample);
    if (this.badgeEl) this.badgeEl.classList.toggle('hidden', !sample);
  },

  // Which word of a stacked caption is drawn big (same rule as emphasis_index in backend/subtitles.py)
  emphasisIndex(words, active, s = this.style) {
    if (s.layout !== 'stack' || s.emphasis === 'none' || s.emphasis_scale <= 1 || !words.length) return null;
    if (s.emphasis === 'spoken') return active;
    const letters = words.map(w => w.replace(/[^\p{L}\p{N}_]/gu, '').length);
    return letters.indexOf(Math.max(...letters));
  },

  // The caption's HTML: one block of text, or (stack) the words before / the big word / the words after, one per line
  // `shown` = how many words have been spoken so far (word-by-word entry): the rest keep their place but are invisible
  captionHtml(words, active, colored, s = this.style, shown = null) {
    const hl = colored && s.highlight_enabled && s.highlight_color !== s.text_color;
    const parts = words.map((w, i) => {
      const t = hl && i === active ? `<span style="color:${s.highlight_color}">${this.esc(w)}</span>` : this.esc(w);
      if (shown === null) return t;
      if (i >= shown) return `<span style="visibility:hidden">${t}</span>`;
      return i === shown - 1 ? `<span class="sub-enter">${t}</span>` : t;
    });
    const emph = this.emphasisIndex(words, active, s);
    if (emph === null) return parts.join(' ');
    const line = (items, style = '') => (items.length ? `<span class="sub-line"${style ? ` style="${style}"` : ''}>${items.join(' ')}</span>` : '');
    return line(parts.slice(0, emph)) + line([parts[emph]], `font-size:${s.emphasis_scale}em`) + line(parts.slice(emph + 1));
  },

  // --- Cues (same rules as backend/subtitles.py build_cues) -------------------
  cleanWord(text, isLast) {
    const s = this.style;
    let t = text;
    if (s.strip_punctuation) t = t.replace(this.STRIP_RE, '');
    else if (isLast) t = t.replace(/[,;:]+$/, '');
    t = t.replace(this.UNSAFE_RE, '').trim();
    return s.uppercase ? t.toUpperCase() : t;
  },

  getCues() {
    const words = Player.transcriptionCues || [];
    const key = `${typeof Timeline !== 'undefined' ? Timeline.revision : 0}|${this._cueRev}`;
    if (this._cues && this._cueWords === words && this._cueLen === words.length && this._cueKey === key) return this._cues;

    const perCue = Math.max(1, Math.round(this.style.words_per_cue));
    const clips = (typeof Timeline !== 'undefined' && Timeline.clips && Timeline.clips.length)
      ? Timeline.clips
      : (words.length ? [{ start: 0, end: words[words.length - 1].end + 1 }] : []);
    const cues = [];

    for (const clip of clips) {
      // first word that can overlap the clip (words are ordered by start time)
      let lo = 0;
      let hi = words.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].start < clip.start - 10) lo = mid + 1; else hi = mid;
      }

      const seg = [];
      for (let i = lo; i < words.length && words[i].start < clip.end; i++) {
        const w = words[i];
        if ((w.type === undefined || w.type === 'word') && String(w.text || '').trim() && w.end > clip.start) seg.push(w);
      }

      const chunks = [];
      let cur = [];
      for (const w of seg) {
        cur.push(w);
        const t = String(w.text).trim();
        if (cur.length >= perCue || this.PUNCT_BREAK.includes(t[t.length - 1])) { chunks.push(cur); cur = []; }
      }
      if (cur.length) chunks.push(cur);

      for (const chunk of chunks) {
        const shown = [];
        chunk.forEach((w, i) => {
          const text = this.cleanWord(String(w.text).trim(), i === chunk.length - 1);
          if (!text) return;
          shown.push({ text, src: w, start: Math.max(clip.start, w.start), end: Math.min(clip.end, w.end) });
        });
        if (!shown.length) continue;
        const start = shown[0].start;
        let end = shown[shown.length - 1].end;
        if (end <= start) end = start + this.MIN_CUE;
        cues.push({ start, end, words: shown });
      }
    }

    cues.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < cues.length; i++) {
      if (cues[i + 1].start > cues[i].start && cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
    }
    cues.forEach((c, i) => {
      c.id = i;
      const bounds = [c.start];
      for (let j = 1; j < c.words.length; j++) bounds.push(Math.max(bounds[j - 1], c.words[j].start));
      bounds.push(Math.max(c.end, bounds[bounds.length - 1] + 0.02));
      c.bounds = bounds;
    });

    this._cues = cues;
    this._cueWords = words;
    this._cueLen = words.length;
    this._cueKey = key;
    this._sig = null;
    return cues;
  },

  findCue(time) {
    const cues = this.getCues();
    let lo = 0;
    let hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= time) lo = mid + 1; else hi = mid;
    }
    const cue = lo > 0 ? cues[lo - 1] : null;
    if (!cue || time >= cue.end) return null;

    let active = 0;
    for (let i = 0; i < cue.words.length; i++) if (cue.bounds[i] <= time) active = i;
    return { cue, active };
  },

  // ---------------------------------------------------------------------------
  // Direct manipulation: drag / arrow keys move the caption vertically
  // ---------------------------------------------------------------------------
  bindPreview() {
    const el = this.el;
    if (!el) return;
    let dragging = false;

    const moveTo = clientY => {
      const r = this.layer.getBoundingClientRect();
      if (!r.height) return;
      const y = Math.round(Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * 1000) / 1000;
      this.set({ position_y: y });
    };

    el.addEventListener('pointerdown', e => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => { if (dragging) moveTo(e.clientY); });
    const end = () => { dragging = false; el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = e.shiftKey ? 0.001 : 0.005;
      this.set({ position_y: Math.round((this.style.position_y + (e.key === 'ArrowUp' ? -step : step)) * 1000) / 1000 });
    });
  }
};
