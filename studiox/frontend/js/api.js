// API Client for StudioX

const API = {
  async getTemplates() {
    const res = await fetch('/studiox/api/templates');
    return await res.json();
  },

  // A bare FastAPI "Not Found" means the route itself doesn't exist, i.e. the server is
  // still running the code from before an update (err.outdated). Real errors carry a message.
  async failure(res, fallback) {
    let detail = fallback;
    try { detail = (await res.json()).detail || fallback; } catch (e) { /* not JSON */ }
    const err = new Error(detail);
    err.outdated = res.status === 404 && detail === 'Not Found';
    return err;
  },

  async getFonts() {
    const res = await fetch('/studiox/api/fonts');
    if (!res.ok) throw await this.failure(res, 'Não foi possível carregar o catálogo de fontes');
    return await res.json();
  },

  // Makes the server download the TTF the render will use, and returns its libass metrics
  async resolveFont(family, weight, italic) {
    const q = new URLSearchParams({ family, weight, italic });
    const res = await fetch(`/studiox/api/fonts/resolve?${q}`);
    if (!res.ok) throw await this.failure(res, 'Fonte indisponível');
    return await res.json();
  },

  async uploadVideo(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (err) {
            reject(new Error('Resposta inválida do servidor'));
          }
        } else {
          let detail = '';
          try { const d = JSON.parse(xhr.responseText).detail; if (typeof d === 'string') detail = d; } catch (e) { /* not JSON */ }
          if (!detail) detail = (xhr.responseText || '').trim().slice(0, 200);
          const hint = {
            401: 'Sessão expirada. Recarregue o CollabSuite.',
            413: 'O arquivo é maior que o limite aceito pelo servidor (proxy/Nginx).',
            502: 'O editor não respondeu. Tente de novo em alguns segundos.',
            503: 'O editor de vídeo não está disponível no servidor.',
            504: 'O servidor demorou demais para processar o vídeo.'
          }[xhr.status];
          reject(new Error(`Erro ${xhr.status}: ${detail || hint || xhr.statusText || 'falha no upload'}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Falha de rede no upload (a conexão caiu antes do servidor responder — comum quando o arquivo passa do limite de tamanho do proxy)')));
      xhr.addEventListener('timeout', () => reject(new Error('Tempo esgotado no upload')));
      xhr.open('POST', '/studiox/api/upload');
      xhr.send(formData);
    });
  },

  async getProject(projectId) {
    const res = await fetch(`/studiox/api/projects/${projectId}`);
    return await res.json();
  },

  async transcribe(projectId, engine = 'auto', language = 'pt') {
    const formData = new FormData();
    formData.append('engine', engine);
    formData.append('language', language);

    const res = await fetch(`/studiox/api/projects/${projectId}/transcribe`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Falha na transcrição');
    return await res.json();
  },

  async detectSilences(projectId) {
    const res = await fetch(`/studiox/api/projects/${projectId}/detect-silence`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Falha na detecção de silêncios');
    return await res.json();
  },

  async analyzeWithAI(projectId, options = {}) {
    const res = await fetch(`/studiox/api/projects/${projectId}/ai-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) throw await this.failure(res, 'Falha na análise de IA');
    return await res.json();
  },

  async getAiSettings() {
    const res = await fetch('/studiox/api/settings/ai');
    if (!res.ok) throw await this.failure(res, 'Não foi possível ler as configurações de IA');
    return await res.json();
  },

  async getReviewSettings() {
    const res = await fetch('/studiox/api/settings/review');
    if (!res.ok) throw await this.failure(res, 'Não foi possível ler as instruções da revisão');
    return await res.json();
  },

  async saveReviewSettings(instructions) {
    const res = await fetch('/studiox/api/settings/review', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions })
    });
    if (!res.ok) throw await this.failure(res, 'Não foi possível salvar as instruções');
    return await res.json();
  },

  async aiApply(projectId, body) {
    const res = await fetch(`/studiox/api/projects/${projectId}/ai-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await this.failure(res, 'Falha ao aplicar os cortes da IA');
    return await res.json();
  },

  async render(renderData) {
    const res = await fetch('/studiox/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(renderData)
    });
    if (!res.ok) throw new Error('Falha ao iniciar renderização');
    return await res.json();
  },

  async getRenderStatus(jobId) {
    const res = await fetch(`/studiox/api/render/${jobId}/status`);
    if (!res.ok) throw new Error('Job não encontrado');
    return await res.json();
  }
};
