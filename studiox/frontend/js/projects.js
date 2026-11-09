// Projects screen: every saved video, its state, and quick actions.

const Projects = {
  items: [],
  filter: 'all',
  query: '',
  showDemos: false,
  _sig: '',
  _timer: 0,

  async init() {
    document.getElementById('search').addEventListener('input', e => { this.query = e.target.value; this.render(); });
    document.getElementById('show-demos').addEventListener('change', e => { this.showDemos = e.target.checked; this.render(); });
    document.getElementById('filters').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      this.filter = chip.dataset.filter;
      document.querySelectorAll('#filters .chip').forEach(c => c.classList.toggle('active', c === chip));
      this.render();
    });
    document.getElementById('grid').addEventListener('click', e => this.onAction(e));

    const box = document.getElementById('lightbox');
    const close = () => { box.hidden = true; const v = document.getElementById('lightbox-video'); v.pause(); v.removeAttribute('src'); v.load(); };
    document.getElementById('lightbox-close').addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });

    await this.load();
    this._timer = setInterval(() => { if (!document.hidden) this.load(); }, 3000);
    UI.refreshNavBadge();
    setInterval(() => { if (!document.hidden) UI.refreshNavBadge(); }, 4000);
  },

  async load() {
    try {
      const data = await UI.api('/studiox/api/projects');
      const sig = JSON.stringify(data.projects);
      this.items = data.projects;
      if (sig !== this._sig) {
        this._sig = sig;
        this.render();
      }
    } catch (err) {
      document.getElementById('page-sub').textContent = err.outdated
        ? 'O servidor está com uma versão antiga. Feche a janela do StudioX (start.bat / run.py), abra de novo e recarregue com Ctrl+F5.'
        : `Não foi possível carregar os projetos: ${err.message}`;
      const first = document.querySelector('#grid .loader-block');
      if (first) first.remove();
    }
  },

  matches(p) {
    if (p.is_demo && !this.showDemos) return false;
    const st = p.status;
    if (this.filter === 'draft' && st !== 'draft') return false;
    if (this.filter === 'queue' && !['queued', 'processing', 'uploading'].includes(st)) return false;
    if (this.filter === 'rendered' && st !== 'rendered') return false;
    if (this.filter === 'error' && st !== 'error') return false;
    const q = this.query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.source_name || '').toLowerCase().includes(q);
  },

  render() {
    const visible = this.items.filter(p => this.matches(p));
    const total = this.items.filter(p => this.showDemos || !p.is_demo).length;
    const active = this.items.filter(p => p.status === 'queued' || p.status === 'processing').length;
    const running = this.items.filter(p => p.status === 'processing').length;

    document.getElementById('page-sub').textContent =
      `${total} projeto(s) salvo(s). O que você edita no editor é guardado automaticamente e pode ser reaberto a qualquer momento.`;

    const banner = document.getElementById('queue-banner');
    banner.hidden = !active;
    if (active) {
      document.getElementById('queue-banner-text').textContent =
        `Fila de edição: ${running ? '1 vídeo sendo processado' : 'nenhum processando agora'} e ${active - running} aguardando.`;
    }

    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    grid.innerHTML = visible.map(p => this.cardHtml(p)).join('');
    empty.hidden = visible.length > 0;
    if (!visible.length) {
      const none = this.items.length === 0 || total === 0;
      empty.innerHTML = none
        ? `<h3>Nenhum projeto ainda</h3><p>Envie vídeos pela fila de edição: eles são cortados, legendados e renderizados sozinhos com o template que você escolher.</p><a href="/studiox/queue.html" class="btn btn-accent">Adicionar vídeos à fila</a>`
        : `<h3>Nada encontrado</h3><p>Nenhum projeto combina com esse filtro ou busca.</p>`;
    }
  },

  cardHtml(p) {
    const e = UI.esc;
    const st = p.status;
    const q = p.queue || {};
    const dims = p.width && p.height ? `${p.width}×${p.height}` : '';
    const meta = [dims, UI.fmtDuration(p.duration), UI.fmtSize(p.size_mb)].filter(Boolean).join(' · ');
    const thumb = p.thumb_url
      ? `<img src="${e(p.thumb_url)}" alt="" loading="lazy">`
      : `<div class="ph">sem miniatura</div>`;
    let label = UI.STATUS[st] || st;
    if (st === 'processing' && q.step) label = `Processando · ${({ analyze: 'análise', cuts: 'cortes', transcribe: 'transcrição', render: 'render' })[q.step] || q.step}`;
    const progress = st === 'processing' || st === 'queued'
      ? `<div class="mini-progress" title="${e(q.message || '')}"><div style="width:${Math.max(3, q.progress || 0)}%"></div></div>` : '';
    const note = st === 'error' ? `<div class="project-meta err">${e((q.error || q.message || 'Falhou').slice(0, 140))}</div>` : '';
    const stamp = st === 'rendered' && p.final_at ? `Renderizado ${UI.timeAgo(p.final_at)}` : `Editado ${UI.timeAgo(p.updated_at)}`;
    const kind = p.kind || 'video';
    const source = kind === 'source';
    const hl = p.highlights || {};
    const kindBadge = source ? '<span class="thumb-badge tr">vídeo longo</span>' : kind === 'clip' ? '<span class="thumb-badge tr">corte</span>' : '';
    const origin = kind === 'clip' && p.clip_of ? `<div class="project-meta">Corte ${e(String(p.clip_of.number || ''))} de ${e(p.clip_of.parent_name || 'um vídeo longo')}${Number.isFinite(p.clip_of.score) ? ` · nota ${p.clip_of.score}` : ''}</div>` : '';
    const sourceLine = source ? `<div class="project-meta">${hl.candidates ? `${hl.candidates} corte(s) encontrados` : 'Ainda não analisado'}${hl.clips ? ` · ${hl.clips} projeto(s) criado(s)` : ''}</div>` : '';
    const openBtn = source
      ? `<a class="btn btn-accent btn-xs btn-open" href="/studiox/clips.html?video=${e(p.id)}">Cortes com IA</a>`
      : `<a class="btn btn-primary btn-xs btn-open" href="/studiox/editor.html?project=${e(p.id)}">Abrir no editor</a>`;
    const play = p.has_final ? `
        <button class="btn btn-secondary btn-xs" data-act="play" data-id="${e(p.id)}" title="Assistir o vídeo renderizado">▶ Ver</button>
        <a class="btn btn-secondary btn-xs" href="/studiox/api/projects/${e(p.id)}/download/final" title="Baixar o vídeo renderizado" aria-label="Baixar o vídeo renderizado">${Icons.download}</a>` : '';
    return `
      <article class="project-card" data-id="${e(p.id)}">
        <a class="project-thumb" href="/studiox/editor.html?project=${e(p.id)}" title="Abrir no editor">
          ${thumb}
          <span class="thumb-badge tl st-${e(st)}">${e(label)}</span>
          ${p.is_demo ? '<span class="thumb-badge tr">demo</span>' : kindBadge}
          <span class="thumb-badge br">${e(UI.fmtDuration(p.duration))}</span>
        </a>
        <div class="project-body">
          <div class="project-name">${e(p.name)}</div>
          <div class="project-meta">${e(meta)}${source ? '' : `${meta ? ' · ' : ''}${p.cuts} corte(s)`}</div>
          ${origin}${sourceLine}
          <div class="project-meta">${e(stamp)}${q.template_name ? ` · template ${e(q.template_name)}` : ''}</div>
          ${progress}${note}
          <div class="project-actions">
            ${openBtn}
            ${play}
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-xs" data-act="rename" data-id="${e(p.id)}" title="Renomear o projeto">Renomear</button>
            <button class="btn btn-ghost btn-xs icon-danger" data-act="delete" data-id="${e(p.id)}" title="Apagar o projeto e seus arquivos">Apagar</button>
          </div>
        </div>
      </article>`;
  },

  async onAction(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const p = this.items.find(x => x.id === id);
    if (!p) return;

    if (btn.dataset.act === 'play') {
      const v = document.getElementById('lightbox-video');
      v.src = `/studiox/api/projects/${id}/video/final.mp4?t=${Date.now()}`;
      document.getElementById('lightbox').hidden = false;
      v.play().catch(() => { /* the controls are there */ });
    } else if (btn.dataset.act === 'rename') {
      const name = prompt('Novo nome do projeto:', p.name);
      if (name === null) return;
      try {
        await UI.api(`/studiox/api/projects/${id}/state`, { method: 'PUT', json: { name } });
        await this.load();
      } catch (err) { UI.toast(`Não foi possível renomear: ${err.message}`, 'error'); }
    } else if (btn.dataset.act === 'delete') {
      if (!confirm(`Apagar o projeto “${p.name}”?\n\nO vídeo original, os cortes e o vídeo renderizado serão removidos do disco. Isso não pode ser desfeito.`)) return;
      try {
        await UI.api(`/studiox/api/projects/${id}`, { method: 'DELETE' });
        UI.toast('Projeto apagado.', 'success');
        await this.load();
      } catch (err) { UI.toast(err.message, 'error'); }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => Projects.init());
