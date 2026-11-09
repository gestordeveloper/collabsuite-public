// Settings screen: the API keys of the AI providers and of ElevenLabs (transcription). Keys are write-only: the server never sends them back.

const Settings = {
  data: null,

  async init() {
    try {
      await this.load();
    } catch (err) {
      const box = document.getElementById('notice');
      box.hidden = false;
      box.textContent = err.outdated
        ? '⚠ O servidor do StudioX está rodando uma versão antiga e não tem esta tela. Feche a janela do servidor (start.bat / run.py), abra de novo e recarregue com Ctrl+F5.'
        : `⚠ Não foi possível carregar as configurações: ${err.message}`;
      return;
    }
    UI.refreshNavBadge();
  },

  async load() {
    this.data = await UI.api('/studiox/api/settings/ai');
    this.render();
    await this.loadReview();
  },

  // Standing instructions for the review (the same for the queue and the editor) + the read-only base prompt
  async loadReview() {
    const box = document.getElementById('review-instructions');
    if (!box) return;
    try {
      const r = await UI.api('/studiox/api/settings/review');
      box.value = r.instructions || '';
      document.getElementById('review-badge').textContent = r.instructions ? '✓ instruções salvas' : 'sem instruções extras';
      document.getElementById('review-prompt').textContent = (r.prompt && r.prompt.review) || '';
      this.updateReviewCount();
    } catch (err) {
      document.getElementById('review-card').hidden = true;  // older server without this endpoint
    }
  },

  updateReviewCount() {
    const box = document.getElementById('review-instructions');
    document.getElementById('review-count').textContent = `${box.value.length}/${box.maxLength}`;
  },

  async saveReview() {
    const btn = document.getElementById('btn-save-review');
    btn.disabled = true;
    try {
      const r = await UI.api('/studiox/api/settings/review', { method: 'PUT', json: { instructions: document.getElementById('review-instructions').value } });
      document.getElementById('review-instructions').value = r.instructions;
      this.updateReviewCount();
      document.getElementById('review-badge').textContent = r.instructions ? '✓ salvas' : 'sem instruções extras';
      UI.toast(r.instructions ? 'Instruções salvas. Valem para a fila e para o editor.' : 'Instruções removidas.', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  render() {
    const d = this.data;
    const e = UI.esc;
    document.getElementById('enc-badge').textContent = d.encrypted_at_rest ? 'criptografadas' : 'arquivo local';
    const notice = document.getElementById('notice');
    notice.hidden = d.local;
    if (!d.local) notice.textContent = '⚠ Você está acessando de outro aparelho. Por segurança, as chaves só podem ser alteradas no computador onde o StudioX está rodando.';

    document.getElementById('providers').innerHTML = d.providers.map(p => {
      const cli = p.kind === 'cli';
      const badge = p.configured
        ? `<span class="badge ok">${cli ? '✓ instalado' : p.source === 'env' ? 'via variável de ambiente' : '✓ configurada'}</span>`
        : `<span class="badge badge-dim">${cli ? 'não encontrado' : 'não configurada'}</span>`;
      const isDefault = d.default_provider === p.id;
      const dis = d.local ? '' : 'disabled';
      return `
      <section class="pcard provider" data-id="${e(p.id)}">
        <div class="pcard-title">
          <span>${e(p.name)}</span>${badge}
        </div>
        <p class="field-hint" style="margin:-6px 0 10px">${e(p.note)} <a class="link" href="${e(p.keys_url)}" target="_blank" rel="noopener">${cli ? 'Instalar ↗' : 'Obter chave ↗'}</a></p>
        ${cli ? `<p class="field-hint" style="margin:0 0 10px">${p.path ? `Encontrado em <code>${e(p.path)}</code>. Para usar outro, defina a variável ${e(p.env)}.` : 'Instale o programa e faça login nele; depois recarregue esta tela.'}</p>` : `
        <div class="form-group">
          <label for="key-${e(p.id)}">Chave de API ${p.configured && p.masked ? `<span class="muted">(salva: ${e(p.masked)})</span>` : ''}</label>
          <div class="key-row">
            <input type="password" class="text-input" id="key-${e(p.id)}" autocomplete="off" spellcheck="false" ${dis}
              placeholder="${p.configured ? 'Deixe vazio para manter a chave salva' : e(p.key_hint)}">
            <button type="button" class="btn btn-ghost btn-xs" data-act="reveal" title="Mostrar / ocultar o que você digitou">Mostrar</button>
          </div>
        </div>`}

        <div class="form-group">
          <label for="model-${e(p.id)}">Modelo</label>
          <div class="key-row">
            <input type="text" class="text-input" id="model-${e(p.id)}" list="models-${e(p.id)}" value="${e(p.model)}" ${dis}
              placeholder="${e(p.default_model || (cli ? 'o da sua conta' : ''))}" spellcheck="false">
            <datalist id="models-${e(p.id)}">${p.models.map(m => `<option value="${e(m)}">`).join('')}</datalist>
            <button type="button" class="btn btn-ghost btn-xs" data-act="models" ${p.configured ? '' : 'disabled'} title="Busca na sua conta os modelos disponíveis">Carregar lista</button>
          </div>
        </div>

        <div class="prov-actions">
          <button type="button" class="btn btn-accent btn-sm" data-act="save" ${dis}>Salvar</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="test" ${dis}>Testar conexão</button>
          ${!cli && p.configured && p.source === 'saved' ? `<button type="button" class="btn btn-ghost btn-sm icon-danger" data-act="remove" ${dis}>Remover chave</button>` : ''}
          <label class="check-inline" style="margin-left:auto" title="A fila e o editor usam este provedor quando o template não escolhe um">
            <input type="radio" name="default-provider" value="${e(p.id)}" ${isDefault ? 'checked' : ''} ${p.configured && d.local ? '' : 'disabled'}> padrão
          </label>
        </div>
        <div class="prov-status" data-status></div>
      </section>`;
    }).join('');

    document.getElementById('providers').insertAdjacentHTML('beforeend', (d.services || []).map(sv => this.serviceCard(sv, d.local)).join(''));

    document.getElementById('transcription').innerHTML = `
      <span class="chip-info ${d.transcription.elevenlabs ? 'on' : 'off'}">ElevenLabs Scribe: ${d.transcription.elevenlabs ? 'chave encontrada' : 'sem chave'}</span>
      <span class="chip-info ${d.transcription.groq ? 'on' : 'off'}">Groq Whisper: ${d.transcription.groq ? 'chave encontrada (a do Groq acima)' : 'sem chave do Groq'}</span>
      <span class="chip-info ${d.transcription.whisper ? 'on' : 'off'}">Whisper local: ${d.transcription.whisper ? 'instalado' : 'não instalado'}</span>`;
  },

  // ElevenLabs (and any other service that only has a key): no model, no "default" choice
  serviceCard(sv, local) {
    const e = UI.esc;
    const dis = local ? '' : 'disabled';
    const badge = !sv.configured ? '<span class="badge badge-dim">não configurada</span>'
      : sv.source === 'saved' ? '<span class="badge ok">✓ configurada</span>'
      : sv.source === 'dotenv' ? '<span class="badge ok">via arquivo .env</span>'
      : '<span class="badge ok">via variável de ambiente</span>';
    const dotenvNote = sv.source === 'dotenv' ? `
        <div class="info-alert" style="margin-bottom:12px">
          Esta chave está hoje escrita em texto puro no arquivo <code>.env</code>. Guarde-a aqui para ficar criptografada junto com as outras
          (o arquivo <code>.env</code> não é apagado).
          <div style="margin-top:8px"><button type="button" class="btn btn-secondary btn-xs" data-act="import" ${dis}>Guardar aqui</button></div>
        </div>` : '';
    return `
      <section class="pcard service" data-id="${e(sv.id)}">
        <div class="pcard-title"><span>${e(sv.name)}</span>${badge}</div>
        <p class="field-hint" style="margin:-6px 0 10px">${e(sv.note)} <a class="link" href="${e(sv.keys_url)}" target="_blank" rel="noopener">Obter chave ↗</a></p>
        ${dotenvNote}
        <div class="form-group">
          <label for="key-${e(sv.id)}">Chave de API ${sv.configured && sv.masked ? `<span class="muted">(em uso: ${e(sv.masked)})</span>` : ''}</label>
          <div class="key-row">
            <input type="password" class="text-input" id="key-${e(sv.id)}" autocomplete="off" spellcheck="false" ${dis}
              placeholder="${sv.source === 'saved' ? 'Deixe vazio para manter a chave salva' : e(sv.key_hint)}">
            <button type="button" class="btn btn-ghost btn-xs" data-act="reveal" title="Mostrar / ocultar o que você digitou">Mostrar</button>
          </div>
        </div>
        <div class="prov-actions">
          <button type="button" class="btn btn-accent btn-sm" data-act="save" ${dis}>Salvar</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="test" ${dis}>Testar conexão</button>
          ${sv.source === 'saved' ? `<button type="button" class="btn btn-ghost btn-sm icon-danger" data-act="remove" ${dis}>Remover chave</button>` : ''}
        </div>
        <div class="prov-status" data-status></div>
      </section>`;
  },

  card(el) { return el.closest('.provider, .service'); },
  setStatus(card, text, kind = '') {
    const s = card.querySelector('[data-status]');
    s.textContent = text;
    s.className = `prov-status ${kind}`;
  },

  async onClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const card = this.card(btn);
    const id = card.dataset.id;
    const keyInput = card.querySelector(`#key-${id}`);
    const modelInput = card.querySelector(`#model-${id}`);
    const act = btn.dataset.act;

    if (act === 'reveal') {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      btn.textContent = keyInput.type === 'password' ? 'Mostrar' : 'Ocultar';
      return;
    }
    if (card.classList.contains('service')) return this.onServiceClick(btn, card, keyInput, act);

    btn.disabled = true;
    try {
      if (act === 'save') {
        const res = await UI.api(`/studiox/api/settings/ai/${id}`, {
          method: 'PUT', json: { api_key: keyInput ? keyInput.value.trim() || null : null, model: modelInput.value.trim() }
        });
        await this.load();
        const fresh = document.querySelector(`.provider[data-id="${id}"]`);
        this.setStatus(fresh, res.warning ? `Salvo. Atenção: ${res.warning}` : 'Salvo.', res.warning ? 'warn' : 'ok');
        UI.toast(`${res.status.name}: configurações salvas.`, 'success');
      } else if (act === 'test') {
        this.setStatus(card, 'Testando…');
        const res = await UI.api(`/studiox/api/settings/ai/${id}/test`, { method: 'POST', json: { api_key: keyInput ? keyInput.value.trim() || null : null } });
        this.setStatus(card, res.message, res.ok ? 'ok' : 'err');
      } else if (act === 'models') {
        this.setStatus(card, 'Buscando modelos…');
        const res = await UI.api(`/studiox/api/settings/ai/${id}/models`);
        card.querySelector(`#models-${id}`).innerHTML = res.models.map(m => `<option value="${UI.esc(m)}">`).join('');
        this.setStatus(card, `${res.models.length} modelo(s) disponíveis. Clique no campo Modelo para escolher.`, 'ok');
      } else if (act === 'remove') {
        if (!confirm(`Remover a chave salva de ${this.data.providers.find(p => p.id === id).name}?`)) { btn.disabled = false; return; }
        await UI.api(`/studiox/api/settings/ai/${id}/key`, { method: 'DELETE' });
        await this.load();
        UI.toast('Chave removida.', 'info');
        return;
      }
    } catch (err) {
      this.setStatus(card, err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  },

  async onServiceClick(btn, card, keyInput, act) {
    const id = card.dataset.id;
    const sv = this.data.services.find(x => x.id === id);
    const base = `/studiox/api/settings/services/${id}`;
    const fresh = () => document.querySelector(`.service[data-id="${id}"]`);
    btn.disabled = true;
    try {
      if (act === 'save') {
        if (!keyInput.value.trim()) { this.setStatus(card, 'Cole a chave para salvar.', 'err'); return; }
        const res = await UI.api(base, { method: 'PUT', json: { api_key: keyInput.value.trim() } });
        await this.load();
        this.setStatus(fresh(), res.warning ? `Salva. Atenção: ${res.warning}` : 'Salva.', res.warning ? 'warn' : 'ok');
        UI.toast(`${sv.name}: chave salva.`, 'success');
      } else if (act === 'import') {
        await UI.api(`${base}/import-env`, { method: 'POST', json: {} });
        await this.load();
        this.setStatus(fresh(), 'Chave guardada e criptografada.', 'ok');
        UI.toast(`${sv.name}: chave guardada.`, 'success');
      } else if (act === 'test') {
        this.setStatus(card, 'Testando…');
        const res = await UI.api(`${base}/test`, { method: 'POST', json: { api_key: keyInput.value.trim() || null } });
        this.setStatus(card, res.message, res.ok ? 'ok' : 'err');
      } else if (act === 'remove') {
        if (!confirm(`Remover a chave salva de ${sv.name}? Sem ela, a transcrição usa o Whisper deste computador (se estiver instalado).`)) return;
        await UI.api(`${base}/key`, { method: 'DELETE' });
        await this.load();
        UI.toast('Chave removida.', 'info');
      }
    } catch (err) {
      this.setStatus(card, err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  },

  async onChange(ev) {
    if (!ev.target.matches('input[name="default-provider"]')) return;
    try {
      await UI.api('/studiox/api/settings/ai-default', { method: 'POST', json: { provider: ev.target.value } });
      UI.toast('Provedor padrão atualizado.', 'success');
      await this.load();
    } catch (err) { UI.toast(err.message, 'error'); await this.load(); }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('providers');
  root.addEventListener('click', e => Settings.onClick(e));
  root.addEventListener('change', e => Settings.onChange(e));
  document.getElementById('btn-save-review')?.addEventListener('click', () => Settings.saveReview());
  document.getElementById('review-instructions')?.addEventListener('input', () => Settings.updateReviewCount());
  Settings.init();
});
