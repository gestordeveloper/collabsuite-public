// Fixing the text of a caption (a word the transcription got wrong). The text lives in the project's transcript, so the
// fix is saved there: the preview, the timeline and the rendered video all show the corrected words.

const CaptionEdit = {
  _box: null,
  _range: null,   // { first, last } indexes in Player.transcriptionCues

  // The caption on screen at the playhead (double click on it, or the button next to the transcript)
  openAtPlayhead() {
    const found = SubtitleStyle.findCue(Player.currentTime || 0);
    if (!found) { App.showToast('Não há legenda neste instante. Posicione o vídeo sobre uma legenda.', 'warning'); return; }
    const all = Player.transcriptionCues || [];
    const idx = found.cue.words.map(w => all.indexOf(w.src)).filter(i => i >= 0);
    if (!idx.length) return;
    this.open(Math.min(...idx), Math.max(...idx));
  },

  open(first, last) {
    const all = Player.transcriptionCues || [];
    if (!all.length || first < 0 || last >= all.length) return;
    if (Player.video && !Player.video.paused) Player.togglePlay?.();
    this._range = { first, last };
    const text = all.slice(first, last + 1).filter(w => (w.type === undefined || w.type === 'word')).map(w => String(w.text).trim()).join(' ');

    this.close();
    const box = document.createElement('div');
    box.className = 'caption-edit';
    box.innerHTML = `
      <div class="caption-edit-title">Editar legenda <span class="caption-edit-time"></span></div>
      <input type="text" class="text-input caption-edit-input" spellcheck="true" maxlength="300" aria-label="Texto da legenda">
      <div class="caption-edit-hint">O tempo de cada palavra é mantido. Se você mudar a quantidade de palavras, elas dividem o mesmo trecho.</div>
      <div class="caption-edit-actions">
        <button type="button" class="btn btn-ghost btn-xs" data-act="cancel">Cancelar</button>
        <button type="button" class="btn btn-primary btn-xs" data-act="save">Salvar</button>
      </div>`;
    document.body.appendChild(box);
    this._box = box;

    const start = Number(all[first].start) || 0;
    box.querySelector('.caption-edit-time').textContent = `[${start.toFixed(1)}s]`;
    const input = box.querySelector('input');
    input.value = text;
    input.focus();
    input.select();
    input.addEventListener('keydown', e => {
      e.stopPropagation();   // typing must not trigger the editor's shortcuts
      if (e.key === 'Enter') this.save();
      else if (e.key === 'Escape') this.close();
    });
    box.addEventListener('keydown', e => e.stopPropagation());
    box.querySelector('[data-act=cancel]').addEventListener('click', () => this.close());
    box.querySelector('[data-act=save]').addEventListener('click', () => this.save());
    Player.seek?.(start);
  },

  close() {
    if (this._box) this._box.remove();
    this._box = null;
  },

  async save() {
    if (!this._box || !this._range) return;
    const text = this._box.querySelector('input').value.trim();
    if (!text) { App.showToast('A legenda não pode ficar vazia.', 'warning'); return; }
    const project = App.currentProject;
    if (!project) return;
    const btn = this._box.querySelector('[data-act=save]');
    btn.disabled = true;
    try {
      const res = await fetch(`/studiox/api/projects/${project.id}/transcript/words`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this._range, text })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Não foi possível salvar a legenda');
      const data = await res.json();
      if (App.currentProject?.id !== project.id) return;
      Player.setTranscription(data.words);
      Timeline.renderSubtitles();
      App.renderTranscriptList(data.words);
      SubtitleStyle.refresh();
      this.close();
      App.showToast('Legenda corrigida.', 'success');
    } catch (err) {
      btn.disabled = false;
      App.showToast(err.message.includes('Failed to fetch') ? 'Servidor desatualizado: reinicie o StudioX e tente de novo.' : err.message, 'error');
    }
  },

  init() {
    document.getElementById('live-subtitles')?.addEventListener('dblclick', e => { e.preventDefault(); this.openAtPlayhead(); });
    document.getElementById('btn-edit-caption')?.addEventListener('click', () => this.openAtPlayhead());
  }
};

document.addEventListener('DOMContentLoaded', () => CaptionEdit.init());
