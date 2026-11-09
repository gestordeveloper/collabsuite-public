// Headline styling for StudioX: style state, presets, editor controls, the live
// preview and the PNG that goes into the render.
//
// The headline is drawn on a <canvas> by ONE function (paint). The live preview calls it
// at the size of the player, the render calls it at the size of the video and uploads the
// resulting transparent PNG, so what you see is what gets burned in (fonts, emoji, line
// breaks, shadows...). backend/headlines.py only places that PNG with the chosen animation.
//
// Units are "reference pixels": the video's SHORT side is always 1080 (same as subtitles.js).
// Text markup: a real line break breaks the line; *asterisks* draw a word in the highlight colour.

const HeadlineStyle = {
  REF: 1080,
  SLIDE_REF: 64,            // slide animations travel this many reference px (same as the server)
  STORAGE_KEY: 'videoUse.headline.v1',

  DEFAULT: {
    font_family: 'Montserrat', font_weight: 800, italic: false, font_size: 64,
    uppercase: true, letter_spacing: 0, line_height: 1.15, text_align: 'left',
    text_color: '#FFFFFF', highlight_color: '#FFE600',
    outline_width: 0, outline_color: '#000000',
    box_enabled: true, box_color: '#0F172A', box_opacity: 0.92,
    box_padding_x: 40, box_padding_y: 30, box_radius: 28,
    border_width: 4, border_color: '#FF5A00',
    accent_style: 'none', accent_color: '#FF5A00', accent_width: 10,
    tag_size: 30, tag_text_color: '#FFFFFF', tag_bg_color: '#FF5A00', tag_radius: 12, tag_uppercase: true,
    shadow_distance: 0, shadow_blur: 24, shadow_color: '#000000', shadow_opacity: 0.5,
    width_mode: 'fit', max_width: 0.88,
    position_x: 0.5, position_y: 0.14,
    animation: 'slide_down', anim_duration: 0.4
  },

  LIMITS: {
    font_weight: [100, 900], font_size: [20, 260], letter_spacing: [-10, 40], line_height: [0.8, 2.2],
    outline_width: [0, 40], box_opacity: [0, 1], box_padding_x: [0, 160], box_padding_y: [0, 160], box_radius: [0, 999],
    border_width: [0, 24], accent_width: [2, 60], tag_size: [12, 90], tag_radius: [0, 999],
    shadow_distance: [0, 40], shadow_blur: [0, 80], shadow_opacity: [0, 1],
    max_width: [0.3, 1], position_x: [0, 1], position_y: [0, 1], anim_duration: [0.05, 2]
  },

  ENUMS: {
    text_align: ['left', 'center', 'right'],
    accent_style: ['none', 'bar', 'underline'],
    width_mode: ['fit', 'full'],
    animation: ['none', 'fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right']
  },

  ANIMATION_OPTIONS: [
    ['none', 'Sem animação'], ['fade', 'Aparecer (fade)'], ['slide_down', 'Descer do topo'],
    ['slide_up', 'Subir de baixo'], ['slide_left', 'Entrar pela direita'], ['slide_right', 'Entrar pela esquerda']
  ],

  WEIGHT_NAMES: { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' },

  hasTag: () => HeadlineStyle.tag.trim().length > 0,

  // Editor layout: one section per group, controls are built from this table
  SECTIONS: [
    {
      title: 'Texto',
      controls: [
        { key: 'font_size', type: 'range', label: 'Tamanho', min: 24, max: 200, step: 1, unit: 'px' },
        { key: 'text_align', type: 'segmented', options: [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']] },
        { key: 'uppercase', type: 'toggle', label: 'CAIXA ALTA' },
        { key: 'letter_spacing', type: 'range', label: 'Espaço entre letras', min: -5, max: 30, step: 0.5, unit: 'px' },
        { key: 'line_height', type: 'range', label: 'Espaço entre linhas', min: 0.9, max: 1.8, step: 0.05, unit: '×' }
      ]
    },
    {
      title: 'Cores do texto',
      hint: 'Dica: escreva *asteriscos* em volta de uma palavra para pintá-la com a cor de destaque.',
      controls: [
        { key: 'text_color', type: 'color', label: 'Cor do texto' },
        { key: 'highlight_color', type: 'color', label: 'Cor do destaque' },
        { key: 'outline_width', type: 'range', label: 'Contorno das letras', min: 0, max: 24, step: 0.5, unit: 'px' },
        { key: 'outline_color', type: 'color', label: 'Cor do contorno', showIf: s => s.outline_width > 0 }
      ]
    },
    {
      title: 'Cartão',
      controls: [
        { key: 'box_enabled', type: 'toggle', label: 'Mostrar cartão atrás do texto' },
        { key: 'box_color', type: 'color', label: 'Cor do cartão', showIf: s => s.box_enabled },
        { key: 'box_opacity', type: 'range', label: 'Opacidade', min: 0, max: 100, step: 1, unit: '%', scale: 100, showIf: s => s.box_enabled },
        { key: 'box_radius', type: 'range', label: 'Cantos arredondados', min: 0, max: 120, step: 1, unit: 'px', showIf: s => s.box_enabled },
        { key: 'border_width', type: 'range', label: 'Borda', min: 0, max: 16, step: 0.5, unit: 'px', showIf: s => s.box_enabled },
        { key: 'border_color', type: 'color', label: 'Cor da borda', showIf: s => s.box_enabled && s.border_width > 0 },
        { key: 'box_padding_x', type: 'range', label: 'Margem interna horizontal', min: 0, max: 120, step: 1, unit: 'px' },
        { key: 'box_padding_y', type: 'range', label: 'Margem interna vertical', min: 0, max: 120, step: 1, unit: 'px' },
        { key: 'width_mode', type: 'segmented', options: [['fit', 'Ajustar ao texto'], ['full', 'Largura total']] },
        { key: 'max_width', type: 'range', label: 'Largura máxima', min: 30, max: 100, step: 1, unit: '%', scale: 100 }
      ]
    },
    {
      title: 'Realce',
      controls: [
        { key: 'accent_style', type: 'segmented', options: [['none', 'Nenhum'], ['bar', 'Barra lateral'], ['underline', 'Sublinhado']] },
        { key: 'accent_color', type: 'color', label: 'Cor do realce', showIf: s => s.accent_style !== 'none' },
        { key: 'accent_width', type: 'range', label: 'Espessura', min: 2, max: 40, step: 1, unit: 'px', showIf: s => s.accent_style !== 'none' }
      ]
    },
    {
      title: 'Etiqueta (tag)',
      hint: 'Só aparece se o campo Tag estiver preenchido.',
      showIf: () => HeadlineStyle.hasTag(),
      controls: [
        { key: 'tag_size', type: 'range', label: 'Tamanho', min: 14, max: 60, step: 1, unit: 'px' },
        { key: 'tag_bg_color', type: 'color', label: 'Cor de fundo' },
        { key: 'tag_text_color', type: 'color', label: 'Cor do texto' },
        { key: 'tag_radius', type: 'range', label: 'Cantos arredondados', min: 0, max: 60, step: 1, unit: 'px' },
        { key: 'tag_uppercase', type: 'toggle', label: 'CAIXA ALTA' }
      ]
    },
    {
      title: 'Sombra',
      controls: [
        { key: 'shadow_distance', type: 'range', label: 'Distância', min: 0, max: 30, step: 0.5, unit: 'px' },
        { key: 'shadow_blur', type: 'range', label: 'Desfoque', min: 0, max: 60, step: 1, unit: 'px' },
        { key: 'shadow_color', type: 'color', label: 'Cor da sombra', showIf: s => s.shadow_distance > 0 || s.shadow_blur > 0 },
        { key: 'shadow_opacity', type: 'range', label: 'Opacidade da sombra', min: 0, max: 100, step: 1, unit: '%', scale: 100, showIf: s => s.shadow_distance > 0 || s.shadow_blur > 0 }
      ]
    },
    {
      title: 'Posição',
      hint: 'Dica: arraste o headline direto no vídeo, ou clique nele e use as setas (Shift = ajuste fino).',
      controls: [
        { key: 'position_x', type: 'range', label: 'Horizontal (0% = esquerda)', min: 0, max: 100, step: 0.5, unit: '%', scale: 100 },
        { key: 'position_y', type: 'range', label: 'Vertical (0% = topo)', min: 0, max: 100, step: 0.5, unit: '%', scale: 100 }
      ]
    },
    {
      title: 'Animação',
      controls: [
        { key: 'animation', type: 'select', label: 'Entrada e saída', options: null },
        { key: 'anim_duration', type: 'range', label: 'Duração da animação', min: 0.1, max: 1.5, step: 0.05, unit: 's', showIf: s => s.animation !== 'none' }
      ]
    }
  ],

  presets: [],
  presetId: null,
  style: null,
  text: '',
  tag: '',
  start: 0,
  duration: 4,
  outdated: false,
  ctl: {},
  geom: null,             // block rectangle (in preview canvas px) of the last paint
  _fontKey: '',
  _fontFilter: { q: '', cat: 'all' },
  _fontResults: [],
  _fontShown: 0,
  _persistTimer: 0,
  _sig: '',

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  init(presets) {
    // Presets without the new style schema come from a server that still runs the old code
    this.presets = (presets || []).filter(p => p.style && p.style.font_family);
    if (this.presets.length !== (presets || []).length) this.markOutdated();

    this.el = document.getElementById('live-headline');
    this.canvas = document.getElementById('hl-canvas');
    this.hit = document.getElementById('hl-hit');
    this.layer = document.getElementById('overlay-layer');
    this.editor = document.getElementById('hl-editor');
    this.hasLetterSpacing = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

    this.SECTIONS.find(sec => sec.controls.some(c => c.key === 'animation'))
      .controls.find(c => c.key === 'animation').options = this.ANIMATION_OPTIONS;

    this.loadState();
    this.bindFields();
    this.buildEditor();
    this.renderPresetCards();
    this.bindPreview();
    this.observeLayout();
    this.syncFields();
    this.syncControls();
    this.loadFont();
    document.addEventListener('fontcatalog', () => { this.updateFontButton(); this.syncControls(); this.filterFonts(); });
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(() => this.syncNow(), 0)));
    this.fitCanvas();
  },

  clone(obj) { return JSON.parse(JSON.stringify(obj)); },
  esc(text) { return SubtitleStyle.esc(text); },

  sanitize(raw) {
    const s = { ...this.DEFAULT };
    for (const [key, def] of Object.entries(this.DEFAULT)) {
      const v = raw ? raw[key] : undefined;
      if (v === undefined || v === null) continue;
      if (typeof def === 'boolean') s[key] = !!v;
      else if (/_color$/.test(key)) { if (/^#[0-9a-f]{6}$/i.test(String(v).trim())) s[key] = String(v).trim().toUpperCase(); }
      else if (this.ENUMS[key]) { if (this.ENUMS[key].includes(v)) s[key] = v; }
      else if (typeof def === 'string') s[key] = String(v).trim() || def;
      else if (Number.isFinite(Number(v))) s[key] = Number(v);
      const lim = this.LIMITS[key];
      if (lim && typeof s[key] === 'number') s[key] = Math.min(lim[1], Math.max(lim[0], s[key]));
    }
    s.font_weight = Math.round(s.font_weight / 100) * 100;
    return s;
  },

  loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
      if (saved && saved.style) {
        this.style = this.sanitize(saved.style);
        this.presetId = saved.presetId || null;
        this.text = typeof saved.text === 'string' ? saved.text : '';
        this.tag = typeof saved.tag === 'string' ? saved.tag : '';
        if (Number.isFinite(saved.start)) this.start = Math.max(0, saved.start);
        if (Number.isFinite(saved.duration)) this.duration = Math.min(60, Math.max(0.5, saved.duration));
      }
    } catch (e) { /* storage unavailable: start from the default preset */ }

    if (!this.style) {
      const p = this.presets.find(x => x.id === 'top_hook_banner') || this.presets[0];
      this.style = this.sanitize(p ? p.style : this.DEFAULT);
      this.presetId = p ? p.id : null;
      this.text = p ? p.default_text : 'SEU TÍTULO AQUI';
      this.tag = p ? p.default_tag : '';
    }
  },

  markOutdated() {
    if (this.outdated) return;
    this.outdated = true;
    const tab = document.getElementById('tab-headlines');
    if (!tab) return;
    const box = document.createElement('div');
    box.className = 'info-alert sub-notice warn';
    box.textContent = `⚠ ${SubtitleStyle.OUTDATED_MSG.replace('editor de legendas novo', 'editor de headlines novo')}`;
    tab.prepend(box);
  },

  persist() {
    if (this.outdated) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          style: this.style, presetId: this.presetId, text: this.text, tag: this.tag,
          start: this.start, duration: this.duration
        }));
      } catch (e) { /* ignore */ }
    }, 150);
  },

  enabled() { return !!document.getElementById('toggle-headline')?.checked; },
  timing() { return { start: this.start, duration: this.duration, enabled: this.enabled() }; },

  // First line of the text, for the timeline block
  blockLabel() {
    const first = String(this.text).replace(/\*/g, '').split('\n').find(l => l.trim());
    return (first || this.tag || 'Headline').trim();
  },

  // ---------------------------------------------------------------------------
  // Text / tag / timing fields (plain form inputs above the editor)
  // ---------------------------------------------------------------------------
  bindFields() {
    const $ = id => document.getElementById(id);
    $('headline-input-text')?.addEventListener('input', e => { this.text = e.target.value; this.contentChanged(); });
    $('headline-input-tag')?.addEventListener('input', e => { this.tag = e.target.value; this.contentChanged(); this.syncControls(); });
    $('headline-start')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { this.start = Math.max(0, v); this.timingChanged(); }
    });
    $('headline-duration')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { this.duration = Math.min(60, Math.max(0.5, v)); this.timingChanged(); }
    });
    $('toggle-headline')?.addEventListener('change', () => { this.timingChanged(); });
    $('btn-headline-play')?.addEventListener('click', () => this.playAnimation());
  },

  syncFields() {
    const $ = id => document.getElementById(id);
    if ($('headline-input-text') && $('headline-input-text') !== document.activeElement) $('headline-input-text').value = this.text;
    if ($('headline-input-tag') && $('headline-input-tag') !== document.activeElement) $('headline-input-tag').value = this.tag;
    if ($('headline-start') && $('headline-start') !== document.activeElement) $('headline-start').value = String(this.start);
    if ($('headline-duration') && $('headline-duration') !== document.activeElement) $('headline-duration').value = String(this.duration);
  },

  contentChanged() {
    this.persist();
    this.refresh();
    this.updateTimeline();
  },

  timingChanged() {
    this.persist();
    this._sig = '';
    this.updateTimeline();
    this.syncNow();
  },

  updateTimeline() {
    if (typeof Timeline !== 'undefined' && Timeline.renderHeadlines) Timeline.renderHeadlines();
  },

  // ---------------------------------------------------------------------------
  // Style changes
  // ---------------------------------------------------------------------------
  fontKey(s = this.style) { return `${s.font_family}|${s.font_weight}|${s.italic ? 1 : 0}`; },

  set(patch) {
    const before = this.style;
    this.style = this.sanitize({ ...before, ...patch });
    const fontChanged = this.fontKey() !== this.fontKey(before);
    this.persist();
    this.syncControls();
    if (fontChanged) this.loadFont();
    this.refresh();
  },

  refresh() {
    this.redraw();
    this._sig = '';
    this.syncNow();
  },

  applyPreset(id) {
    const p = this.presets.find(x => x.id === id);
    if (!p) return;
    const prev = this.presets.find(x => x.id === this.presetId);
    const before = this.style;
    // Keep what the user typed; only swap texts that are still the previous preset's sample
    if (!prev || this.text === prev.default_text || !this.text.trim()) this.text = p.default_text;
    if (!prev || this.tag === prev.default_tag || !this.tag.trim()) this.tag = p.default_tag;
    this.presetId = id;
    this.style = this.sanitize(p.style);
    this.persist();
    this.syncFields();
    this.syncControls();
    this.renderPresetCards();
    if (this.fontKey(before) !== this.fontKey()) this.loadFont();
    this.refresh();
    this.updateTimeline();
  },

  // Everything restored from a saved project (or a template) instead of picked by the user
  applyExternal(h) {
    const before = this.style;
    const toggle = document.getElementById('toggle-headline');
    if (toggle) toggle.checked = !!h.enabled;
    this.presetId = h.preset_id || null;
    this.style = this.sanitize(h.style || before);
    this.text = typeof h.text === 'string' ? h.text : this.text;
    this.tag = typeof h.tag === 'string' ? h.tag : this.tag;
    if (Number.isFinite(h.start)) this.start = Math.max(0, h.start);
    if (Number.isFinite(h.duration)) this.duration = Math.min(60, Math.max(0.5, h.duration));
    this.persist();
    this.syncFields();
    this.syncControls();
    this.renderPresetCards();
    if (this.fontKey(before) !== this.fontKey()) this.loadFont();
    this.refresh();
    this.updateTimeline();
  },

  isModified() {
    const p = this.presets.find(x => x.id === this.presetId);
    if (!p) return false;
    return JSON.stringify(this.sanitize(p.style)) !== JSON.stringify(this.style);
  },

  presetName() {
    const p = this.presets.find(x => x.id === this.presetId);
    return p ? p.name : 'Personalizado';
  },

  // ---------------------------------------------------------------------------
  // Font loading (the browser draws the text, so only the CDN stylesheet is needed)
  // ---------------------------------------------------------------------------
  async loadFont() {
    const s = this.style;
    const key = this.fontKey();
    this._fontKey = key;
    this.updateFontButton();
    this.setFontStatus('loading');

    await SubtitleStyle.injectCss(SubtitleStyle.fontCssUrl([{ family: s.font_family, weight: s.font_weight, italic: s.italic }]));
    let ok = true;
    try {
      const faces = await document.fonts.load(`${s.italic ? 'italic ' : ''}${s.font_weight} 64px "${s.font_family}"`, 'AaÁÍÇÃÕéÊ0123');
      ok = faces.length > 0;
    } catch (e) { ok = false; }
    if (this._fontKey !== key) return;
    this.setFontStatus(ok ? 'ready' : 'error');
    this.redraw();
  },

  setFontStatus(state) {
    const el = document.getElementById('hl-font-status');
    if (!el) return;
    el.className = `font-status ${state}`;
    el.textContent = {
      loading: 'Carregando fonte…',
      ready: '✓ Fonte pronta para o preview e para o render',
      error: '⚠ Não foi possível carregar essa fonte agora; o headline usa uma fonte padrão até ela carregar.'
    }[state];
  },

  // ---------------------------------------------------------------------------
  // Editor UI
  // ---------------------------------------------------------------------------
  buildEditor() {
    if (!this.editor) return;

    const controlHtml = c => {
      const id = `hlctl-${c.key}`;
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
      if (c.type === 'select') {
        return `<div class="sub-ctl" data-key="${c.key}">
          <label for="${id}">${c.label}</label>
          <select id="${id}" class="text-input">${c.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
      }
      return `<div class="sub-ctl" data-key="${c.key}"><div class="segmented" role="group">
        ${c.options.map(([v, l]) => `<button type="button" data-value="${v}">${l}</button>`).join('')}
        </div></div>`;
    };

    this.editor.innerHTML = `
      <section class="sub-section">
        <h4 class="sub-section-title">Fonte <span class="sub-count" id="hl-font-count"></span></h4>
        <button type="button" class="font-picker-btn" id="hl-font-btn" aria-haspopup="listbox" aria-expanded="false">
          <span class="font-btn-name" id="hl-font-btn-name"></span>
          <span class="font-btn-meta" id="hl-font-btn-meta"></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="font-panel hidden" id="hl-font-panel">
          <input type="search" id="hl-font-search" class="text-input" placeholder="Buscar fonte (ex.: Anton, Bebas, Pacifico)…" autocomplete="off" spellcheck="false">
          <div class="font-cats" id="hl-font-cats"></div>
          <div class="font-list" id="hl-font-list" role="listbox"></div>
          <div class="font-foot" id="hl-font-foot"></div>
        </div>
        <div class="sub-grid-2">
          <div class="form-group"><label for="hl-font-weight">Peso</label><select id="hl-font-weight" class="text-input"></select></div>
          <div class="sub-ctl-inline sub-italic"><label class="toggle-switch"><input type="checkbox" id="hl-font-italic"><span class="switch-slider"></span><span class="switch-label">Itálico</span></label></div>
        </div>
        <div class="font-status" id="hl-font-status"></div>
      </section>
      ${this.SECTIONS.map((sec, i) => `
        <section class="sub-section" data-sec="${i}">
          <h4 class="sub-section-title">${sec.title}</h4>
          ${sec.controls.map(controlHtml).join('')}
          ${sec.hint ? `<span class="field-hint">${sec.hint}</span>` : ''}
        </section>`).join('')}
      <div class="sub-actions">
        <button type="button" class="btn btn-ghost btn-xs" id="hl-btn-reset">↺ Restaurar estilo pronto</button>
      </div>`;

    this.secEls = [...this.editor.querySelectorAll('section[data-sec]')];
    for (const sec of this.SECTIONS) {
      for (const c of sec.controls) {
        const row = this.editor.querySelector(`.sub-ctl[data-key="${c.key}"]`);
        this.ctl[c.key] = { row, def: c };
        if (c.type === 'range') this.bindRange(row, c);
        else if (c.type === 'color') this.bindColor(row, c);
        else if (c.type === 'toggle') row.querySelector('input').addEventListener('change', e => this.set({ [c.key]: e.target.checked }));
        else if (c.type === 'select') row.querySelector('select').addEventListener('change', e => this.set({ [c.key]: e.target.value }));
        else row.querySelectorAll('button').forEach(b => b.addEventListener('click', () => this.set({ [c.key]: b.dataset.value })));
      }
    }

    document.getElementById('hl-btn-reset').addEventListener('click', () => this.applyPreset(this.presetId || (this.presets[0] && this.presets[0].id)));
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
      } else if (def.type === 'select') {
        row.querySelector('select').value = v;
      } else {
        row.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === v));
      }
    }

    (this.secEls || []).forEach(el => {
      const sec = this.SECTIONS[Number(el.dataset.sec)];
      el.hidden = sec.showIf ? !sec.showIf(s) : false;
    });

    this.syncWeightControls();
    this.updateFontButton();
    const reset = document.getElementById('hl-btn-reset');
    if (reset) reset.disabled = !this.isModified();
    document.getElementById('hl-preset-modified')?.classList.toggle('hidden', !this.isModified());
  },

  fontEntry(name = this.style.font_family) { return SubtitleStyle.fontsByName.get(name) || null; },

  syncWeightControls() {
    const sel = document.getElementById('hl-font-weight');
    const ital = document.getElementById('hl-font-italic');
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
    sel.onchange = () => {
      const weight = parseInt(sel.value, 10);
      const e = this.fontEntry();
      this.set({ font_weight: weight, italic: e ? this.style.italic && e.i.includes(weight) : this.style.italic });
    };
    ital.onchange = () => this.set({ italic: ital.checked });
  },

  updateFontButton() {
    const name = document.getElementById('hl-font-btn-name');
    if (!name) return;
    const s = this.style;
    name.textContent = s.font_family;
    name.style.fontFamily = `"${s.font_family}", sans-serif`;
    const entry = this.fontEntry();
    const cat = entry ? SubtitleStyle.CATEGORY_NAMES[entry.c] : '';
    document.getElementById('hl-font-btn-meta').textContent = `${s.font_weight}${s.italic ? ' itálico' : ''}${cat ? ' · ' + cat : ''}`;
    const count = document.getElementById('hl-font-count');
    if (count) count.textContent = SubtitleStyle.fontCatalog.length ? `${SubtitleStyle.fontCatalog.length.toLocaleString('pt-BR')} no Google Fonts` : '';
  },

  // --- Font picker (catalog, previews and recents are shared with the subtitle editor) ---
  bindFontPicker() {
    const btn = document.getElementById('hl-font-btn');
    const panel = document.getElementById('hl-font-panel');
    const search = document.getElementById('hl-font-search');
    const list = document.getElementById('hl-font-list');

    this._io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        SubtitleStyle.queuePreview(en.target.dataset.family);
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
    document.getElementById('hl-font-foot').addEventListener('click', e => {
      if (e.target.closest('.font-retry')) SubtitleStyle.loadFontCatalog();
    });
    document.getElementById('hl-font-cats').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      this._fontFilter.cat = chip.dataset.cat;
      this.filterFonts();
    });
  },

  renderCategoryChips() {
    const cats = [['all', 'Todas']];
    if (SubtitleStyle.recents.length) cats.push(['recent', 'Recentes']);
    cats.push(['sans-serif', 'Sans'], ['serif', 'Serif'], ['display', 'Display'], ['handwriting', 'Manuscrita'], ['monospace', 'Mono']);
    document.getElementById('hl-font-cats').innerHTML = cats.map(([id, label]) =>
      `<button type="button" class="chip${this._fontFilter.cat === id ? ' active' : ''}" data-cat="${id}">${label}</button>`).join('');
  },

  filterFonts() {
    const list = document.getElementById('hl-font-list');
    if (!list) return;
    const { q, cat } = this._fontFilter;
    const needle = q.trim().toLowerCase();

    let pool = SubtitleStyle.fontCatalog;
    if (cat === 'recent') pool = SubtitleStyle.recents.map(n => SubtitleStyle.fontsByName.get(n)).filter(Boolean);
    else if (cat !== 'all') pool = pool.filter(f => f.c === cat);
    if (needle) pool = pool.filter(f => f.f.toLowerCase().includes(needle));

    this._fontResults = pool;
    this._fontShown = 0;
    list.innerHTML = '';
    list.scrollTop = 0;
    this.renderCategoryChips();
    this.appendFontRows();

    const typed = q.trim();
    if (SubtitleStyle.catalogState === 'error' && typed) {
      const row = document.createElement('div');
      row.className = 'font-row';
      row.dataset.family = typed;
      row.innerHTML = `<span class="font-row-name">Usar “${this.esc(typed)}”</span><span class="font-row-cat">digitada</span>`;
      list.prepend(row);
    }

    const foot = document.getElementById('hl-font-foot');
    if (foot) {
      if (SubtitleStyle.catalogState === 'loading') {
        foot.textContent = 'Carregando o catálogo do Google Fonts…';
      } else if (SubtitleStyle.catalogState === 'error') {
        foot.innerHTML = `<span class="font-foot-error">⚠ Não foi possível carregar o catálogo (${this.esc(SubtitleStyle.catalogError)}).</span> <button type="button" class="btn btn-ghost btn-xs font-retry">Tentar de novo</button>`;
      } else {
        const warn = SubtitleStyle.catalogSource === 'fallback' ? ' · sem conexão: lista reduzida' : '';
        foot.textContent = pool.length ? `${pool.length.toLocaleString('pt-BR')} fonte(s)${warn}` : 'Nenhuma fonte encontrada';
      }
    }
  },

  appendFontRows() {
    const list = document.getElementById('hl-font-list');
    if (!list || this._fontShown >= this._fontResults.length) return;
    const chunk = this._fontResults.slice(this._fontShown, this._fontShown + 60);
    this._fontShown += chunk.length;

    const frag = document.createDocumentFragment();
    for (const f of chunk) {
      const face = SubtitleStyle.pickPreviewFace(f);
      const row = document.createElement('div');
      row.className = `font-row${f.f === this.style.font_family ? ' selected' : ''}`;
      row.dataset.family = f.f;
      row.setAttribute('role', 'option');
      row.innerHTML = `<span class="font-row-name" style="font-family:'${this.esc(f.f)}',sans-serif;font-weight:${face.weight};font-style:${face.italic ? 'italic' : 'normal'}">${this.esc(f.f)}</span>
        <span class="font-row-cat">${SubtitleStyle.CATEGORY_NAMES[f.c] || ''}</span>`;
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
    SubtitleStyle.recents = [name, ...SubtitleStyle.recents.filter(n => n !== name)].slice(0, 8);
    try { localStorage.setItem(SubtitleStyle.RECENT_KEY, JSON.stringify(SubtitleStyle.recents)); } catch (e) { /* ignore */ }

    document.getElementById('hl-font-panel').classList.add('hidden');
    document.getElementById('hl-font-btn').setAttribute('aria-expanded', 'false');
    document.getElementById('hl-font-search').value = '';
    this._fontFilter.q = '';
    this.set({ font_family: name, font_weight: weight, italic });
  },

  // ---------------------------------------------------------------------------
  // Preset cards (a tiny canvas per preset, drawn by the same paint())
  // ---------------------------------------------------------------------------
  renderPresetCards() {
    const container = document.getElementById('headline-template-list');
    if (!container) return;

    container.innerHTML = this.presets.map(p => `
      <div class="template-card preset-card hl-preset-card ${p.id === this.presetId ? 'active' : ''}" data-id="${p.id}" data-type="headline" title="${this.esc(p.description)}">
        <div class="template-card-header"><span class="template-card-title">${this.esc(p.name)}</span></div>
        <div class="hl-sample"><canvas width="360" height="176" data-preset="${p.id}"></canvas></div>
        <span class="badge badge-subtle">${this.esc(p.preview_badge || p.category)}</span>
      </div>`).join('');

    container.querySelectorAll('canvas[data-preset]').forEach(cv => {
      const p = this.presets.find(x => x.id === cv.dataset.preset);
      const st = this.sanitize(p.style);
      this.paintSample(cv, p, st);
      // Draw again once this preset's font has arrived
      SubtitleStyle.injectCss(SubtitleStyle.fontCssUrl([{ family: st.font_family, weight: st.font_weight, italic: st.italic }]))
        .then(() => document.fonts.load(`${st.italic ? 'italic ' : ''}${st.font_weight} 40px "${st.font_family}"`, 'Aa'))
        .then(() => { if (cv.isConnected) this.paintSample(cv, p, st); })
        .catch(() => { /* keeps the fallback font */ });
    });
  },

  paintSample(canvas, preset, st) {
    const ctx = canvas.getContext('2d');
    const style = { ...st, position_x: 0.5, position_y: 0.5, max_width: Math.min(0.92, Math.max(0.6, st.max_width)), width_mode: 'fit' };
    const text = 'Seu título\n*aqui*';
    const tag = preset.default_tag ? 'TAG' : '';
    // Largest scale at which the whole block fits the thumbnail
    for (let k = 0.5; k >= 0.12; k -= 0.03) {
      const g = this.layout(ctx, style, text, tag, canvas.width, canvas.height, k);
      if (g && g.blockW <= canvas.width * 0.96 && g.blockH <= canvas.height * 0.9) break;
    }
    const chosen = this._lastK;
    this.paint(ctx, canvas.width, canvas.height, { style, text, tag, k: chosen });
  },

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  },

  rrPath(x, y, w, h, r) {
    const p = new Path2D();
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
    return p;
  },

  setFont(ctx, face, spacing) {
    ctx.font = face;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';
    if (this.hasLetterSpacing) ctx.letterSpacing = `${spacing}px`;
  },

  // Geometry of the whole block for a canvas of W x H (k = canvas px per reference px)
  layout(ctx, s, text, tag, W, H, kOverride) {
    const k = kOverride || Math.min(W, H) / this.REF;
    this._lastK = k;
    const size = s.font_size * k;
    const face = `${s.italic ? 'italic ' : ''}${s.font_weight} ${size}px "${s.font_family}", sans-serif`;
    const ls = s.letter_spacing * k;
    this.setFont(ctx, face, ls);

    const fm = ctx.measureText('Hg');
    const asc = fm.fontBoundingBoxAscent ?? size * 0.95;
    const desc = fm.fontBoundingBoxDescent ?? size * 0.25;
    const adv = str => ctx.measureText(str).width;
    const measure = str => Math.max(0, adv(str) - (this.hasLetterSpacing ? ls : 0));
    const lh = size * s.line_height;

    const padX = s.box_padding_x * k;
    const padY = s.box_padding_y * k;
    const barW = s.accent_style === 'bar' ? s.accent_width * k : 0;
    const padL = padX + barW;
    const padR = padX;
    const maxBlockW = Math.min(W, s.max_width * W);
    const maxInner = Math.max(40 * k, maxBlockW - padL - padR);

    // --- Text lines: real line breaks, then greedy wrap; *word* marks highlighted text
    const lines = [];
    const raw = String(text || '').replace(/\r/g, '').replace(/^\n+|\n+$/g, '');
    const strOf = ws => ws.map(w => w.map(i => i.c).join('')).join(' ');
    const pushLine = ws => {
      const items = [];
      ws.forEach((w, wi) => {
        if (wi > 0) {
          const prev = ws[wi - 1][ws[wi - 1].length - 1];
          items.push({ c: ' ', hl: prev.hl && w[0].hl });
        }
        items.push(...w);
      });
      const segs = [];
      let pos = 0;
      for (const it of items) {
        const last = segs[segs.length - 1];
        if (last && last.hl === it.hl) last.t += it.c;
        else segs.push({ t: it.c, hl: it.hl, at: pos });
        pos += it.c.length;
      }
      const full = items.map(i => i.c).join('');
      lines.push({ segs, text: full, w: measure(full) });
    };

    for (const para of raw.trim() ? raw.split('\n') : []) {
      const chars = [];
      let hl = false;
      for (const ch of para) {
        if (ch === '*') { hl = !hl; continue; }
        chars.push({ c: s.uppercase ? ch.toUpperCase() : ch, hl });
      }
      const words = [];
      let cur = [];
      for (const it of chars) {
        if (it.c === ' ') { if (cur.length) { words.push(cur); cur = []; } } else cur.push(it);
      }
      if (cur.length) words.push(cur);
      if (!words.length) { lines.push({ segs: [], text: '', w: 0 }); continue; }

      let line = [];
      for (let word of words) {
        // a word wider than the line is broken by characters
        while (measure(strOf([word])) > maxInner && word.length > 1) {
          let n = word.length - 1;
          while (n > 1 && measure(strOf([word.slice(0, n)])) > maxInner) n--;
          if (line.length) { pushLine(line); line = []; }
          pushLine([word.slice(0, n)]);
          word = word.slice(n);
        }
        if (line.length && measure(strOf([...line, word])) > maxInner) { pushLine(line); line = [word]; }
        else line.push(word);
      }
      if (line.length) pushLine(line);
    }
    // x of each segment inside its line, measured on the prefix so kerning carries across segments
    for (const ln of lines) for (const sg of ln.segs) sg.x = sg.at === 0 ? 0 : adv(ln.text.slice(0, sg.at));

    // --- Tag pill (same face, own size)
    let tagInfo = null;
    let tagText = String(tag || '').trim();
    if (tagText) {
      if (s.tag_uppercase) tagText = tagText.toUpperCase();
      const tSize = s.tag_size * k;
      const tFace = `${s.italic ? 'italic ' : ''}${s.font_weight} ${tSize}px "${s.font_family}", sans-serif`;
      const tLs = 0.08 * tSize;
      this.setFont(ctx, tFace, tLs);
      const tm = ctx.measureText('Hg');
      const tAsc = tm.fontBoundingBoxAscent ?? tSize * 0.95;
      const tDesc = tm.fontBoundingBoxDescent ?? tSize * 0.25;
      const tMeasure = str => Math.max(0, ctx.measureText(str).width - (this.hasLetterSpacing ? tLs : 0));
      const tPadX = 0.6 * tSize;
      const tPadY = 0.28 * tSize;
      while (tagText.length > 1 && tMeasure(tagText) + 2 * tPadX > maxInner) tagText = tagText.slice(0, -2) + '…';
      tagInfo = {
        text: tagText, face: tFace, ls: tLs, asc: tAsc, padX: tPadX, padY: tPadY,
        w: tMeasure(tagText) + 2 * tPadX, h: tAsc + tDesc + 2 * tPadY
      };
      this.setFont(ctx, face, ls);
    }
    if (!lines.length && !tagInfo) return null;

    // --- Block size
    const textW = lines.reduce((m, l) => Math.max(m, l.w), 0);
    const contentW = Math.max(textW, tagInfo ? tagInfo.w : 0);
    const blockW = s.width_mode === 'full' ? maxBlockW : Math.min(maxBlockW, contentW + padL + padR);
    const inner = blockW - padL - padR;
    const alignX = w => (s.text_align === 'left' ? padL : s.text_align === 'right' ? padL + inner - w : padL + (inner - w) / 2);

    let y = padY;
    if (tagInfo) {
      tagInfo.x = alignX(tagInfo.w);
      tagInfo.y = y;
      y += tagInfo.h + (lines.length ? Math.max(10 * k, 0.4 * tagInfo.h) : 0);
    }
    lines.forEach((ln, i) => {
      ln.x = alignX(ln.w);
      ln.top = y + i * lh;
      ln.baseline = ln.top + (lh - (asc + desc)) / 2 + asc;
    });
    y += lines.length * lh;

    let underline = null;
    if (s.accent_style === 'underline' && lines.length) {
      const h = s.accent_width * k;
      y += 0.2 * size;
      underline = { x: alignX(textW), y, w: textW, h };
      y += h;
    }
    const blockH = y + padY;

    const bx = Math.min(Math.max(0, W - blockW), Math.max(0, s.position_x * W - blockW / 2));
    const by = Math.min(Math.max(0, H - blockH), Math.max(0, s.position_y * H - blockH / 2));

    return { k, size, face, ls, lh, asc, desc, lines, tag: tagInfo, underline, bx, by, blockW, blockH, padL, barW };
  },

  // Draws the headline on ctx (a canvas of W x H). Returns the block geometry, or null when empty.
  paint(ctx, W, H, opts = {}) {
    const s = opts.style || this.style;
    const text = opts.text !== undefined ? opts.text : this.text;
    const tag = opts.tag !== undefined ? opts.tag : this.tag;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = this.layout(ctx, s, text, tag, W, H, opts.k);
    if (!g) return null;
    const k = g.k;
    const { bx, by, blockW, blockH } = g;

    const shadowOn = s.shadow_opacity > 0 && (s.shadow_distance > 0 || s.shadow_blur > 0);
    const setShadow = on => {
      if (on) {
        ctx.shadowColor = this.rgba(s.shadow_color, s.shadow_opacity);
        ctx.shadowBlur = s.shadow_blur * k;
        ctx.shadowOffsetX = ctx.shadowOffsetY = s.shadow_distance * k;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
      }
    };
    setShadow(false);

    // Card: soft shadow outside only (like CSS box-shadow), then the fill, accent and border
    const card = s.box_enabled ? this.rrPath(bx, by, blockW, blockH, s.box_radius * k) : null;
    if (card) {
      if (shadowOn) {
        ctx.save();
        const outside = new Path2D();
        outside.rect(0, 0, W, H);
        outside.addPath(card);
        ctx.clip(outside, 'evenodd');
        setShadow(true);
        ctx.fillStyle = '#000';
        ctx.fill(card);
        ctx.restore();
        setShadow(false);
      }
      ctx.fillStyle = this.rgba(s.box_color, s.box_opacity);
      ctx.fill(card);
    }

    if (g.barW > 0) {
      ctx.save();
      if (card) ctx.clip(card);
      ctx.fillStyle = s.accent_color;
      ctx.fillRect(bx, by, g.barW, blockH);
      ctx.restore();
    }

    if (card && s.border_width > 0) {
      const bw = s.border_width * k;
      ctx.lineWidth = bw;
      ctx.strokeStyle = s.border_color;
      ctx.stroke(this.rrPath(bx + bw / 2, by + bw / 2, blockW - bw, blockH - bw, s.box_radius * k - bw / 2));
    }

    // Tag pill
    if (g.tag) {
      const t = g.tag;
      ctx.fillStyle = s.tag_bg_color;
      ctx.fill(this.rrPath(bx + t.x, by + t.y, t.w, t.h, s.tag_radius * k));
      this.setFont(ctx, t.face, t.ls);
      ctx.fillStyle = s.tag_text_color;
      ctx.fillText(t.text, bx + t.x + t.padX, by + t.y + t.padY + t.asc);
    }

    // Text: every outline first, then every fill, so neighbouring outlines never cover letters
    this.setFont(ctx, g.face, g.ls);
    const shadowOnText = !card && shadowOn;
    const pass = mode => {
      for (const ln of g.lines) {
        for (const sg of ln.segs) {
          const x = bx + ln.x + sg.x;
          const y = by + ln.baseline;
          if (mode === 'stroke') ctx.strokeText(sg.t, x, y);
          else { ctx.fillStyle = sg.hl ? s.highlight_color : s.text_color; ctx.fillText(sg.t, x, y); }
        }
      }
    };
    if (s.outline_width > 0) {
      ctx.strokeStyle = s.outline_color;
      ctx.lineWidth = s.outline_width * 2 * k;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      setShadow(shadowOnText);
      pass('stroke');
      setShadow(false);
      pass('fill');
    } else {
      setShadow(shadowOnText);
      pass('fill');
      setShadow(false);
    }

    if (g.underline) {
      const u = g.underline;
      ctx.fillStyle = s.accent_color;
      ctx.fill(this.rrPath(bx + u.x, by + u.y, u.w, u.h, u.h / 2));
    }
    return g;
  },

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------
  fitCanvas() {
    if (!this.canvas || !this.layer) return;
    const w = this.layer.clientWidth;
    const h = this.layer.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.redraw();
  },

  observeLayout() {
    if (this.layer && 'ResizeObserver' in window) new ResizeObserver(() => this.fitCanvas()).observe(this.layer);
  },

  redraw() {
    if (!this.canvas || !this.canvas.width) return;
    this.geom = this.paint(this.canvas.getContext('2d'), this.canvas.width, this.canvas.height);
    if (this.hit) {
      const g = this.geom;
      if (g) {
        const d = this.dpr || 1;
        Object.assign(this.hit.style, {
          left: `${g.bx / d}px`, top: `${g.by / d}px`, width: `${g.blockW / d}px`, height: `${g.blockH / d}px`
        });
      }
      this.hit.hidden = !g;
    }
  },

  // Same maths as backend/headlines.py: linear fade, cubic ease on the slide, mirrored exit
  animAt(t) {
    const kind = this.style.animation;
    if (kind === 'none') return { alpha: 1, x: 0, y: 0 };
    const A = Math.min(this.style.anim_duration, this.duration / 2);
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const pIn = clamp01((t - this.start) / A);
    const pOut = clamp01((t - (this.start + this.duration - A)) / A);
    const travel = this.SLIDE_REF * (1 - pIn) ** 3 + this.SLIDE_REF * pOut ** 3;
    const off = { slide_up: [0, 1], slide_down: [0, -1], slide_left: [1, 0], slide_right: [-1, 0] }[kind] || [0, 0];
    return { alpha: pIn * (1 - pOut), x: off[0] * travel, y: off[1] * travel };
  },

  // Called every frame by the player with the position on the OUTPUT timeline
  syncAt(time) {
    this._time = time;
    if (!this.el) return;
    if (!this.enabled()) return this.setVisible(false);

    // While the Headlines tab is open and the video is paused, show the finished headline (no
    // entrance frame at alpha 0) even outside its window, so edits are always visible.
    // Anywhere else the picture follows the render: only in the window, animated.
    const inWindow = time >= this.start && time <= this.start + this.duration;
    const editing = this.tabActive() && !!(Player.video && Player.video.paused && Player.video.currentSrc);
    let mode = 'hidden';
    if (editing) mode = inWindow ? 'still' : 'sample';
    else if (inWindow) mode = 'live';
    if (mode === 'hidden') return this.setVisible(false);

    const a = mode === 'live' ? this.animAt(time) : { alpha: 1, x: 0, y: 0 };
    const k = (this.cssW ? Math.min(this.cssW, this.cssH) : 0) / this.REF;
    const sig = `${mode}|${a.alpha.toFixed(3)}|${a.x.toFixed(2)}|${a.y.toFixed(2)}|${k.toFixed(4)}`;
    if (sig === this._sig) return;
    this._sig = sig;

    this.setVisible(true);
    this.el.classList.toggle('is-sample', mode === 'sample');
    this.canvas.style.opacity = String(a.alpha);
    this.el.style.transform = `translate(${(a.x * k).toFixed(2)}px, ${(a.y * k).toFixed(2)}px)`;
  },

  setVisible(on) {
    if (!this.el) return;
    this.el.classList.toggle('hidden', !on);
    if (!on) this._sig = '';
  },

  tabActive() { return !!document.getElementById('tab-headlines')?.classList.contains('active'); },

  // Plays the stretch around the headline so the entrance/exit animation can be judged
  playAnimation() {
    if (!Player.video || !Player.video.currentSrc || typeof Timeline === 'undefined') return;
    if (!this.enabled()) document.getElementById('toggle-headline')?.click();
    Player.seek(Timeline.sequenceToSource(Math.max(0, this.start - 0.5)));
    Player.video.play().catch(() => { /* needs a user gesture in some browsers; the click is one */ });
  },

  syncNow() {
    if (typeof Timeline !== 'undefined' && Player.video) {
      this.syncAt(Timeline.sourceToSequence ? Timeline.sourceToSequence(Player.currentTime || 0) : (Player.currentTime || 0));
    }
  },

  // ---------------------------------------------------------------------------
  // Direct manipulation: drag / arrow keys move the block
  // ---------------------------------------------------------------------------
  bindPreview() {
    const el = this.hit;
    if (!el) return;
    let dragging = false;
    let grab = { x: 0, y: 0 };

    const centre = () => {
      const g = this.geom;
      const d = this.dpr || 1;
      const r = this.layer.getBoundingClientRect();
      return { cx: r.left + (g.bx + g.blockW / 2) / d, cy: r.top + (g.by + g.blockH / 2) / d, r };
    };
    const round = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

    el.addEventListener('pointerdown', e => {
      if (!this.geom) return;
      dragging = true;
      const c = centre();
      grab = { x: e.clientX - c.cx, y: e.clientY - c.cy };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      const r = this.layer.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.set({ position_x: round((e.clientX - grab.x - r.left) / r.width), position_y: round((e.clientY - grab.y - r.top) / r.height) });
    });
    const end = () => { dragging = false; el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('keydown', e => {
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.001 : 0.005;
      this.set({ position_x: round(this.style.position_x + dir[0] * step), position_y: round(this.style.position_y + dir[1] * step) });
    });
  },

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // Size of the render's frames: render.py scales the long side to 1920, and js/canvasframe.js may
  // reframe it again after that (a different aspect ratio) before this image is even overlaid.
  exportSize() {
    if (typeof CanvasFrame !== 'undefined') return CanvasFrame.outputSize();
    const v = Player.video;
    const meta = (typeof App !== 'undefined' && App.currentProject && App.currentProject.meta) || {};
    const vw = (v && v.videoWidth) || meta.width || 1920;
    const vh = (v && v.videoHeight) || meta.height || 1080;
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    return vh > vw ? { w: even(1920 * vw / vh), h: 1920 } : { w: 1920, h: even(1920 * vh / vw) };
  },

  // Loads one face from the Google Fonts CDN without needing any editor UI (used by the queue page)
  ensureFace(s) {
    const fam = encodeURIComponent(s.font_family).replace(/%20/g, '+');
    const url = `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@${s.italic ? 1 : 0},${s.font_weight}&display=swap`;
    this._faceLinks = this._faceLinks || new Map();
    if (!this._faceLinks.has(url)) {
      this._faceLinks.set(url, new Promise(resolve => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = () => resolve(true);
        link.onerror = () => resolve(false);
        document.head.appendChild(link);
      }));
    }
    return this._faceLinks.get(url)
      .then(() => document.fonts.load(`${s.italic ? 'italic ' : ''}${s.font_weight} 64px "${s.font_family}"`, 'AaÁÍÇÃÕéÊ0123'))
      .catch(() => []);
  },

  // A finished headline as a transparent PNG (base64) for a w x h frame, straight from a style
  // and a text. This is what the queue attaches to each video: the same paint() as the editor.
  async renderPng({ style, text, tag, w, h }) {
    this.hasLetterSpacing = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
    const s = this.sanitize(style);
    await this.ensureFace(s);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = this.paint(c.getContext('2d'), w, h, { style: s, text, tag });
    return g ? c.toDataURL('image/png').split(',')[1] : null;
  },

  // The headline block of the render request (null when disabled or there is nothing to draw)
  async exportConfig() {
    if (!this.enabled()) return null;
    await this.loadFont();
    const { w, h } = this.exportSize();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = this.paint(c.getContext('2d'), w, h);
    if (!g) return null;
    return {
      enabled: true,
      image: c.toDataURL('image/png').split(',')[1],
      text: this.text,
      tag: this.tag,
      start: this.start,
      duration: this.duration,
      animation: this.style.animation,
      anim_duration: this.style.anim_duration
    };
  }
};
