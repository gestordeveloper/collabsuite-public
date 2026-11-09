// The look controls of the editor that the render and the preview (js/fx.js) share: LUT, zoom on the cuts and the
// duration of the transitions. The cards of the transitions themselves are drawn by TemplatesManager.
//
// Saved with the project (edit.lut, edit.zoom, edit.transition_scale) and with the templates, like the grade.

const Looks = {
  DEFAULTS: {
    lut: { id: '', intensity: 1 },
    zoom: { enabled: false, style: 'alternate', amount: 1.15, focus: 0.4 },
    scale: 1
  },
  STYLES: {
    alternate: ['Alternar', 'Um corte fechado, o próximo aberto, e assim por diante: esconde os cortes secos.'],
    punch: ['Impacto', 'Cada corte começa ampliado e assenta devagar: dá ênfase a cada frase.'],
    push: ['Aproximar', 'Cada trecho se aproxima aos poucos e volta ao normal no corte seguinte.']
  },
  state: null,
  luts: [],
  _demo: null,
  _demoTid: null,

  clean(src) {
    const s = src && typeof src === 'object' ? src : {};
    const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const lut = s.lut || {}, zoom = s.zoom || {};
    const D = this.DEFAULTS;
    return {
      lut: { id: /^[a-z0-9_]{1,60}$/.test(lut.id || '') ? lut.id : '', intensity: num(lut.intensity, 0, 1, D.lut.intensity) },
      zoom: {
        enabled: !!zoom.enabled,
        style: this.STYLES[zoom.style] ? zoom.style : D.zoom.style,
        amount: num(zoom.amount, 1.03, 1.5, D.zoom.amount),
        focus: num(zoom.focus, 0, 1, D.zoom.focus)
      },
      transitionScale: num(s.transition_scale, 0.5, 2, D.scale)
    };
  },

  exportConfig() {
    return { lut: { ...this.state.lut }, zoom: { ...this.state.zoom }, transition_scale: this.state.transitionScale };
  },

  // From a saved edit or a template (both carry lut / zoom / transition_scale); nothing saved = everything off
  applyExternal(src) {
    this.state = this.clean(src);
    if (this.state.lut.id) Fx.loadLut(this.state.lut.id).then(() => Fx.refresh());
    this.paintBadges();
    this.paint();
    Fx.refresh();
  },

  // ---------------------------------------------------------------------------
  async init() {
    this.state = this.clean(null);
    Fx.setConstants(TemplatesManager.catalog && TemplatesManager.catalog.looks);
    Fx.mount();
    this.bind();
    this.paint();
    await this.loadLuts();
  },

  $(id) { return document.getElementById(id); },

  bind() {
    const on = (id, ev, fn) => this.$(id) && this.$(id).addEventListener(ev, fn);

    // LUT
    this.$('lut-list')?.addEventListener('click', e => {
      const del = e.target.closest('[data-lut-del]');
      if (del) { e.stopPropagation(); this.deleteLut(del.dataset.lutDel); return; }
      const card = e.target.closest('.lut-card');
      if (card) this.pickLut(card.dataset.id);
    });
    on('lut-intensity', 'input', e => { this.state.lut.intensity = parseInt(e.target.value, 10) / 100; this.changed(); });
    on('lut-upload-btn', 'click', () => this.$('lut-file').click());
    on('lut-file', 'change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.uploadLut(f); });

    // Zoom on the cuts
    on('zoom-enabled', 'change', e => { this.state.zoom.enabled = e.target.checked; this.changed(); });
    this.$('zoom-style')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-style]');
      if (b) { this.state.zoom.style = b.dataset.style; this.changed(); }
    });
    on('zoom-amount', 'input', e => { this.state.zoom.amount = 1 + parseInt(e.target.value, 10) / 100; this.changed(); });
    on('zoom-focus', 'input', e => { this.state.zoom.focus = parseInt(e.target.value, 10) / 100; this.changed(); });

    // Transitions
    on('tx-scale', 'input', e => { this.state.transitionScale = parseInt(e.target.value, 10) / 100; this.changed(); });
    on('btn-tx-preview', 'click', () => Fx.previewCut());
    const list = this.$('transition-template-list');
    if (list) {
      list.addEventListener('mouseover', e => { const c = e.target.closest('.template-card'); if (c) this.demoShow(c.dataset.id); });
      list.addEventListener('mouseleave', () => this.demoShow(TemplatesManager.selectedTransition));
      list.addEventListener('focusin', e => { const c = e.target.closest('.template-card'); if (c) this.demoShow(c.dataset.id); });
    }
    // the cards are div[role=button]: Enter / Space choose them, like a click
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.lut-card, .template-card[data-type="transition"]')) {
        e.preventDefault();
        e.target.click();
      }
    });
    // the demo only runs while its tab is open (App switches the tab in its own click handler: look after it)
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(() => {
      if (b.dataset.tab === 'tab-transitions') this.demoShow(TemplatesManager.selectedTransition);
      else this.demoStop();
    }, 0)));
  },

  // Icon and tooltip of the chosen transition (the small badge on every clip of the timeline)
  badge() {
    const t = ((TemplatesManager.catalog && TemplatesManager.catalog.transitions) || []).find(x => x.id === TemplatesManager.selectedTransition);
    return t ? { icon: t.icon, title: `Transição: ${t.name}` } : { icon: '⚡', title: 'Transição: corte seco' };
  },

  paintBadges() {
    if (typeof Transitions !== 'undefined') Transitions.paintBadges();   // every cut has its own (js/transitions.js)
  },

  // A setting changed: repaint the panel, the preview, and let the autosave see it
  changed() {
    this.paintBadges();
    this.paint();
    Fx.refresh();
    this.demoRestart();
  },

  paint() {
    if (!this.state) return;
    const $ = id => this.$(id);
    const { lut, zoom, transitionScale } = this.state;

    // LUT
    const list = $('lut-list');
    if (list) {
      const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const card = (id, name, swatches, del, hint) => `
        <div class="lut-card${lut.id === id ? ' active' : ''}" data-id="${esc(id)}" role="button" tabindex="0" title="${esc(hint || name)}">
          <span class="lut-sw">${swatches.length ? swatches.map(c => `<i style="background:${esc(c)}"></i>`).join('') : '<i class="lut-none">sem LUT</i>'}</span>
          <span class="lut-name">${esc(name)}</span>
          ${del ? `<button type="button" class="lut-del" data-lut-del="${esc(id)}" title="Excluir este LUT">✕</button>` : ''}
        </div>`;
      const mine = this.luts.filter(l => l.kind === 'user');
      list.innerHTML = card('', 'Nenhum', [], false, 'Não aplicar LUT') +
        this.luts.filter(l => l.kind !== 'user').map(l => card(l.id, l.name, l.swatches, false, l.description)).join('') +
        mine.map(l => card(l.id, l.name, l.swatches, true, `${l.name} (.cube ${l.size}³)`)).join('');
    }
    const box = $('lut-strength-box');
    if (box) box.classList.toggle('hidden', !lut.id);
    if ($('lut-intensity') && document.activeElement !== $('lut-intensity')) $('lut-intensity').value = Math.round(lut.intensity * 100);
    if ($('lut-intensity-val')) $('lut-intensity-val').textContent = `${Math.round(lut.intensity * 100)}%`;
    const picked = this.luts.find(l => l.id === lut.id);
    if ($('lut-desc')) $('lut-desc').textContent = picked ? picked.description : '';

    // Zoom
    if ($('zoom-enabled')) $('zoom-enabled').checked = zoom.enabled;
    $('zoom-config')?.classList.toggle('hidden', !zoom.enabled);
    document.querySelectorAll('#zoom-style button').forEach(b => b.classList.toggle('active', b.dataset.style === zoom.style));
    if ($('zoom-style-hint')) $('zoom-style-hint').textContent = this.STYLES[zoom.style][1];
    const pct = Math.round((zoom.amount - 1) * 100);
    if ($('zoom-amount') && document.activeElement !== $('zoom-amount')) $('zoom-amount').value = pct;
    if ($('zoom-amount-val')) $('zoom-amount-val').textContent = `+${pct}%`;
    if ($('zoom-focus') && document.activeElement !== $('zoom-focus')) $('zoom-focus').value = Math.round(zoom.focus * 100);
    if ($('zoom-focus-val')) $('zoom-focus-val').textContent = zoom.focus < 0.34 ? 'mais no topo' : (zoom.focus > 0.66 ? 'mais embaixo' : 'centro');

    // Transition duration
    if ($('tx-scale') && document.activeElement !== $('tx-scale')) $('tx-scale').value = Math.round(transitionScale * 100);
    if ($('tx-scale-val')) $('tx-scale-val').textContent = `${transitionScale.toFixed(2).replace(/\.?0+$/, '')}×`;
  },

  // ---------------------------------------------------------------------------
  // LUT library
  // ---------------------------------------------------------------------------
  async loadLuts() {
    try {
      const res = await fetch('/studiox/api/luts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.luts = (await res.json()).luts || [];
    } catch (err) {
      console.warn('LUT list failed:', err);
      this.luts = [];
    }
    if (this.state.lut.id && !this.luts.some(l => l.id === this.state.lut.id)) {
      // saved with a LUT that was deleted since: the render skips it, so the panel says "none"
      this.state.lut.id = '';
    }
    this.paint();
  },

  pickLut(id) {
    this.state.lut.id = id;
    if (id) {
      const status = this.$('lut-status');
      if (status) status.textContent = 'Carregando o LUT…';
      Fx.loadLut(id).then(ok => {
        if (status) status.textContent = ok ? '' : 'A prévia do LUT não está disponível neste navegador; o vídeo renderizado terá o LUT normalmente.';
        Fx.refresh();
      });
    }
    this.changed();
  },

  async uploadLut(file) {
    const status = this.$('lut-status');
    if (status) status.textContent = 'Enviando…';
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/studiox/api/luts', { method: 'POST', body });
      if (!res.ok) {
        let detail = `erro ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
        throw new Error(detail);
      }
      const item = await res.json();
      await this.loadLuts();
      this.pickLut(item.id);
      App.showToast(`LUT “${item.name}” adicionado.`, 'success');
    } catch (err) {
      if (status) status.textContent = '';
      App.showToast(`Não foi possível usar este LUT: ${err.message}`, 'error');
    }
  },

  async deleteLut(id) {
    const item = this.luts.find(l => l.id === id);
    if (!confirm(`Excluir o LUT “${item ? item.name : id}”? Templates e projetos que o usam passam a renderizar sem ele.`)) return;
    try {
      const res = await fetch(`/studiox/api/luts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`erro ${res.status}`);
      Fx.luts.delete(id);
      if (this.state.lut.id === id) this.state.lut.id = '';
      await this.loadLuts();
      this.changed();
    } catch (err) {
      App.showToast(`Não foi possível excluir: ${err.message}`, 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // The demo of a transition
  // ---------------------------------------------------------------------------
  demoShow(tid) {
    const cv = this.$('tx-demo');
    if (!cv || !tid || !document.getElementById('tab-transitions')?.classList.contains('active')) return;
    const portrait = !!(App.currentProject && App.currentProject.meta && App.currentProject.meta.is_portrait);
    const w = portrait ? 180 : 320, h = portrait ? 320 : 180;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.classList.toggle('portrait', portrait);
    if (!this._demo) this._demo = Fx.demo(cv, this.$('tx-demo-veil'));
    this._demoTid = tid;
    const t = ((TemplatesManager.catalog && TemplatesManager.catalog.transitions) || []).find(x => x.id === tid);
    const label = this.$('tx-demo-label');
    if (label) label.textContent = t ? `${t.icon} ${t.name}` : '';
    this._demo.show(tid, this.state.transitionScale);
  },

  demoRestart() {
    if (this._demoTid && document.getElementById('tab-transitions')?.classList.contains('active')) this.demoShow(this._demoTid);
  },

  demoStop() {
    if (this._demo) this._demo.stop();
  }
};
