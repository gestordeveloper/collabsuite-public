// Fine colour adjustments on top of a grade preset. Shared by the editor (live preview of the video) and by
// the template screen (swatches). The maths mirrors backend/templates.py (grade_adjust_filter): the render
// uses ffmpeg's eq + colorchannelmixer, the preview an SVG colour matrix that does the same operations.

const Grade = {
  DEFAULT: { brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0 },
  CONTROLS: [
    { key: 'brightness', label: 'Brilho', min: -0.3, max: 0.3, step: 0.01, hint: 'mais escuro ← → mais claro' },
    { key: 'contrast', label: 'Contraste', min: 0.6, max: 1.6, step: 0.01, hint: 'suave ← → forte' },
    { key: 'saturation', label: 'Saturação', min: 0, max: 2, step: 0.01, hint: 'preto e branco ← → vibrante' },
    { key: 'temperature', label: 'Temperatura', min: -1, max: 1, step: 0.01, hint: 'frio (azul) ← → quente (laranja)' },
    { key: 'tint', label: 'Matiz', min: -1, max: 1, step: 0.01, hint: 'verde ← → magenta' }
  ],
  BRIGHT_GAIN: 1.16,   // ffmpeg's eq works on limited-range luma: its brightness is ~1.16x stronger in RGB
  _seq: 0,

  clean(raw) {
    const out = {};
    for (const c of this.CONTROLS) {
      const v = Number(raw && raw[c.key]);
      out[c.key] = Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : this.DEFAULT[c.key];
    }
    return out;
  },

  isNeutral(adj) {
    const a = this.clean(adj);
    return this.CONTROLS.every(c => Math.abs(a[c.key] - this.DEFAULT[c.key]) < 1e-3);
  },

  // 4x5 matrix (row-major) for feColorMatrix: saturation, then luma contrast/brightness, then channel gains
  matrix(adj) {
    const a = this.clean(adj);
    const w = [0.2126, 0.7152, 0.0722];
    const s = a.saturation, c = a.contrast;
    const rows = [];
    const off = -(c - 1) * 0.5 + this.BRIGHT_GAIN * a.brightness;
    const t = a.temperature, tint = a.tint;
    const gain = [1 + 0.15 * t + 0.05 * tint, 1 - 0.10 * tint, 1 - 0.15 * t + 0.05 * tint];
    for (let i = 0; i < 3; i++) {
      const row = [0, 0, 0];
      for (let j = 0; j < 3; j++) row[j] = (i === j ? s : 0) + (1 - s) * w[j] + (c - 1) * w[j];
      rows.push([...row.map(v => v * gain[i]), 0, off * gain[i]]);
    }
    rows.push([0, 0, 0, 1, 0]);
    return rows.flat();
  },

  // A hidden <svg> holds one colour-matrix filter per user of this module; returns the filter's id
  filterId(owner) {
    const id = `grade-adjust-${owner}`;
    if (!document.getElementById(id)) {
      let host = document.getElementById('grade-svg-defs');
      if (!host) {
        host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.id = 'grade-svg-defs';
        host.setAttribute('width', '0');
        host.setAttribute('height', '0');
        host.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
        host.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
        document.body.appendChild(host);
      }
      const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      f.id = id;
      f.setAttribute('color-interpolation-filters', 'sRGB');
      f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
      const m = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      f.appendChild(m);
      host.querySelector('defs').appendChild(f);
    }
    return id;
  },

  // CSS `filter` value: the preset's own filter, then the adjustments
  css(presetCss, adj, owner) {
    const base = presetCss && presetCss !== 'none' ? presetCss : '';
    if (this.isNeutral(adj)) return base || 'none';
    const id = this.filterId(owner);
    document.getElementById(id).firstChild.setAttribute('values', this.matrix(adj).map(v => v.toFixed(4)).join(' '));
    return `${base} url(#${id})`.trim();
  },

  // Sliders inside `container`. `state.adj` is edited in place; onChange(adj) fires on every move.
  mountControls(container, state, onChange) {
    const uid = ++this._seq;
    container.innerHTML = this.CONTROLS.map(c => `
      <div class="grade-row">
        <div class="grade-row-head"><label for="grade-${uid}-${c.key}">${c.label}</label><span class="grade-val" data-val="${c.key}"></span></div>
        <input type="range" id="grade-${uid}-${c.key}" data-key="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">
        <div class="grade-hint">${c.hint}</div>
      </div>`).join('') + '<button type="button" class="btn btn-ghost btn-xs" data-grade-reset>Restaurar ajustes</button>';
    const paint = () => {
      state.adj = this.clean(state.adj);
      for (const c of this.CONTROLS) {
        const input = container.querySelector(`input[data-key="${c.key}"]`);
        if (document.activeElement !== input) input.value = state.adj[c.key];
        const v = state.adj[c.key];
        container.querySelector(`[data-val="${c.key}"]`).textContent =
          c.key === 'contrast' || c.key === 'saturation' ? `${Math.round(v * 100)}%` : (v > 0 ? '+' : '') + (Math.round(v * 100) / 100);
      }
    };
    container.addEventListener('input', e => {
      const input = e.target.closest('input[data-key]');
      if (!input) return;
      state.adj[input.dataset.key] = parseFloat(input.value);
      paint();
      onChange(state.adj);
    });
    container.querySelector('[data-grade-reset]').addEventListener('click', () => {
      state.adj = { ...this.DEFAULT };
      paint();
      onChange(state.adj);
    });
    paint();
    return { refresh: paint };
  }
};
