// Helpers shared by the Projects and Queue screens

const UI = {
  esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4200);
  },

  // JSON in / JSON out. Errors carry the server's message (FastAPI's `detail`).
  async api(path, { method = 'GET', json } = {}) {
    const res = await fetch(path, {
      method,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined
    });
    if (!res.ok) {
      let detail = `Erro ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body.detail === 'string') detail = body.detail;
        else if (Array.isArray(body.detail)) detail = body.detail.map(d => d.msg).join('; ');
      } catch (e) { /* not JSON */ }
      const err = new Error(detail);
      err.status = res.status;
      // A bare "Not Found" on an /api route: the server predates this screen and needs a restart
      err.outdated = res.status === 404 && detail === 'Not Found';
      throw err;
    }
    return res.json();
  },

  fmtDuration(sec) {
    if (!Number.isFinite(sec)) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  },

  fmtSize(mb) {
    if (!Number.isFinite(mb)) return '';
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  },

  timeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'agora há pouco';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} d`;
    return new Date(iso).toLocaleDateString('pt-BR');
  },

  STATUS: {
    draft: 'Rascunho', queued: 'Na fila', uploading: 'Enviando', processing: 'Processando',
    rendered: 'Renderizado', error: 'Erro', cancelled: 'Cancelado'
  },

  // Queue counter in the header of every screen
  async refreshNavBadge() {
    const el = document.getElementById('nav-queue-count');
    if (!el) return;
    try {
      const q = await UI.api('/studiox/api/queue');
      const n = q.items.filter(i => i.status === 'queued' || i.status === 'running').length;
      el.textContent = n ? String(n) : '';
    } catch (e) { /* server restarting */ }
  }
};
