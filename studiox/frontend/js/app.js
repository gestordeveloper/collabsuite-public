// Main Application Orchestrator for StudioX

const App = {
  currentProject: null,
  activeRenderJob: null,
  pollInterval: null,

  async init() {
    // Initialize components
    Player.init();
    Timeline.init();
    SplitScreen.init();
    Music.init();
    Motion.init();
    await TemplatesManager.init();
    await Looks.init();
    await Transitions.init();
    FaceTrack.init();
    CanvasFrame.init();
    ProjectState.init();

    this.bindEvents();
    this.setupDragAndDrop();

    // /editor.html?project=<id> opens a saved project
    const wanted = new URLSearchParams(location.search).get('project');
    if (wanted) await this.openProject(wanted);
  },

  async openProject(projectId) {
    try {
      const res = await fetch(`/studiox/api/projects/${encodeURIComponent(projectId)}`);
      if (res.status === 404) throw new Error('projeto não encontrado (foi apagado?)');
      if (!res.ok) throw new Error(`erro ${res.status}`);
      const data = await res.json();
      this.setProject(data);
      const q = data.state && data.state.queue_status;
      if (q === 'queued' || q === 'running') {
        this.showToast('Este vídeo ainda está na fila de edição. Alterações feitas aqui podem ser sobrescritas pela fila.', 'warning');
      }
    } catch (err) {
      this.showToast(`Não foi possível abrir o projeto: ${err.message}`, 'error');
    }
  },

  bindEvents() {
    // Upload triggers
    const btnUpload = document.getElementById('btn-upload-trigger');
    const fileInput = document.getElementById('file-input');

    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.handleFileUpload(file);
          fileInput.value = '';
        }
      });
    }

    const emptyMediaState = document.getElementById('empty-media-state');
    if (emptyMediaState && fileInput) {
      emptyMediaState.style.cursor = 'pointer';
      emptyMediaState.addEventListener('click', () => fileInput.click());
    }

    const btnCloseUploadModal = document.getElementById('btn-close-upload-modal');
    if (btnCloseUploadModal) {
      btnCloseUploadModal.addEventListener('click', () => {
        document.getElementById('upload-modal')?.classList.add('hidden');
      });
    }

    // Demo video loader
    document.getElementById('btn-load-demo')?.addEventListener('click', () => this.loadDemoVideo());

    // Auto-cut silences button
    document.getElementById('btn-auto-cut')?.addEventListener('click', () => this.runAutoCutSilences());

    // Transcribe button
    document.getElementById('btn-transcribe')?.addEventListener('click', () => this.runTranscription());
    try {
      const engineSel = document.getElementById('transcribe-engine');
      const saved = localStorage.getItem('videoUse.transcribeEngine');
      if (engineSel && saved && [...engineSel.options].some(o => o.value === saved)) engineSel.value = saved;
    } catch (e) { /* storage blocked */ }

    // Render modal buttons
    const btnRenderModal = document.getElementById('btn-render-modal');
    const modal = document.getElementById('render-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');

    if (btnRenderModal && modal) {
      btnRenderModal.addEventListener('click', () => {
        this.updateRenderModalSummary();
        modal.classList.remove('hidden');
        document.getElementById('render-config-view')?.classList.remove('hidden');
        document.getElementById('render-progress-view')?.classList.add('hidden');
        document.getElementById('render-finished-actions')?.classList.add('hidden');
      });
    }

    if (btnCloseModal && modal) {
      btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
    }

    // AI Assistant modal buttons
    const btnAiModal = document.getElementById('btn-ai-analyze-trigger');
    const aiModal = document.getElementById('ai-modal');
    const btnCloseAiModal = document.getElementById('btn-close-ai-modal');

    if (btnAiModal && aiModal) {
      btnAiModal.addEventListener('click', () => {
        if (!this.currentProject) {
          this.showToast('Carregue ou importe um vídeo primeiro.', 'warning');
          return;
        }
        aiModal.classList.remove('hidden');
        this.loadAiProviders();
        this.loadSavedCopy();
      });
    }

    if (btnCloseAiModal && aiModal) {
      btnCloseAiModal.addEventListener('click', () => aiModal.classList.add('hidden'));
    }

    // Run AI analysis button
    document.getElementById('btn-run-ai-analysis')?.addEventListener('click', () => this.runAIAnalysis());

    // Apply AI cuts button
    document.getElementById('btn-apply-ai-cuts')?.addEventListener('click', () => this.applyAICuts());

    // Start render button
    document.getElementById('btn-start-render')?.addEventListener('click', () => this.startRender());

    // Inspector Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const tabId = btn.dataset.tab;
        const targetContent = document.getElementById(tabId);
        if (targetContent) targetContent.classList.add('active');
      });
    });

    // Render mode radio cards
    document.querySelectorAll('.radio-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });
  },

  setupDragAndDrop() {
    const dropZone = document.body;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.opacity = '0.92';
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.style.opacity = '1';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.opacity = '1';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });
  },

  showUploadModal(title = 'Importando & Analisando Vídeo') {
    const modal = document.getElementById('upload-modal');
    const titleEl = document.getElementById('upload-modal-title');
    const bar = document.getElementById('upload-progress-bar');
    const pct = document.getElementById('upload-progress-pct');
    const status = document.getElementById('upload-status-text');
    const consoleBox = document.getElementById('upload-console-logs');
    const btnClose = document.getElementById('btn-close-upload-modal');

    if (titleEl) titleEl.innerText = title;
    if (bar) bar.style.width = '0%';
    if (pct) pct.innerText = '0%';
    if (status) status.innerText = 'Iniciando upload...';
    if (btnClose) btnClose.classList.add('hidden');
    if (consoleBox) {
      consoleBox.innerHTML = '<div class="console-line">> [Upload] Inicializando transferência para o StudioX...</div>';
    }
    if (modal) modal.classList.remove('hidden');
  },

  updateUploadProgress(percent, statusMessage, logMessage = null) {
    const bar = document.getElementById('upload-progress-bar');
    const pct = document.getElementById('upload-progress-pct');
    const status = document.getElementById('upload-status-text');
    const consoleBox = document.getElementById('upload-console-logs');

    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    if (bar) bar.style.width = `${clamped}%`;
    if (pct) pct.innerText = `${clamped}%`;
    if (status && statusMessage) status.innerText = statusMessage;
    if (consoleBox && logMessage) {
      const line = document.createElement('div');
      line.className = 'console-line';
      line.innerText = `> ${logMessage}`;
      consoleBox.appendChild(line);
      consoleBox.scrollTop = consoleBox.scrollHeight;
    }
  },

  appendUploadLog(logMessage) {
    const consoleBox = document.getElementById('upload-console-logs');
    if (consoleBox && logMessage) {
      const line = document.createElement('div');
      line.className = 'console-line';
      line.innerText = `> ${logMessage}`;
      consoleBox.appendChild(line);
      consoleBox.scrollTop = consoleBox.scrollHeight;
    }
  },

  hideUploadModal(delay = 800) {
    setTimeout(() => {
      const modal = document.getElementById('upload-modal');
      if (modal) modal.classList.add('hidden');
    }, delay);
  },

  async handleFileUpload(file) {
    const fileSizeMb = (file.size / (1024 * 1024)).toFixed(2);
    this.showUploadModal(`Importando: ${file.name}`);
    this.appendUploadLog(`[Arquivo] Nome: ${file.name} | Tamanho: ${fileSizeMb} MB`);

    let loggedMilestones = new Set();
    let serverTimer = null;

    try {
      this.updateUploadProgress(5, `Enviando "${file.name}"... (0%)`, `[Rede] Abrindo stream HTTP para o servidor...`);

      const uploadPromise = API.uploadVideo(file, (networkPct) => {
        // Map 0..100% network upload to 0..65% overall progress
        const mappedPct = Math.round(networkPct * 0.65);
        this.updateUploadProgress(mappedPct, `Enviando "${file.name}"... (${networkPct}%)`);

        if (networkPct >= 25 && !loggedMilestones.has(25)) {
          loggedMilestones.add(25);
          this.appendUploadLog(`[Upload] 25% transferido...`);
        }
        if (networkPct >= 50 && !loggedMilestones.has(50)) {
          loggedMilestones.add(50);
          this.appendUploadLog(`[Upload] 50% transferido...`);
        }
        if (networkPct >= 75 && !loggedMilestones.has(75)) {
          loggedMilestones.add(75);
          this.appendUploadLog(`[Upload] 75% transferido...`);
        }
        if (networkPct >= 100 && !loggedMilestones.has(100)) {
          loggedMilestones.add(100);
          this.appendUploadLog(`[Upload] 100% dos bytes enviados. Processando vídeo no servidor...`);
          this.updateUploadProgress(70, `Analisando vídeo com FFmpeg...`, `[FFmpeg] Iniciando inspeção de metadados com FFprobe...`);
        }
      });

      // Simulate backend progress steps while server is processing
      serverTimer = setInterval(() => {
        const bar = document.getElementById('upload-progress-bar');
        const currentW = parseInt(bar?.style?.width || '0', 10);
        if (currentW >= 70 && currentW < 95) {
          const nextW = currentW + 5;
          if (nextW === 75) {
            this.updateUploadProgress(nextW, `Extraindo forma de onda (waveform)...`, `[Áudio] Amostrando 600 pontos de amplitude RMS...`);
          } else if (nextW === 85) {
            this.updateUploadProgress(nextW, `Gerando miniaturas da timeline...`, `[Filmstrip] Capturando 24 miniaturas de alta precisão...`);
          } else if (nextW === 95) {
            this.updateUploadProgress(nextW, `Detectando pausas e silêncios...`, `[Silencedetect] Mapeando silêncios para cortes inteligentes...`);
          } else {
            this.updateUploadProgress(nextW, `Processando vídeo no servidor...`);
          }
        }
      }, 450);

      let projectData = await uploadPromise;
      if (projectData.analyzed === false) {
        // The server answers as soon as the file is saved and analyses it (waveform, thumbnails, silences) in the background
        this.updateUploadProgress(75, 'Analisando o vídeo no servidor...', '[Servidor] Arquivo recebido. Analisando em segundo plano...');
        for (;;) {
          await new Promise(r => setTimeout(r, 2000));
          let st = null;
          try { st = await (await fetch(`/studiox/api/projects/${projectData.id}/analysis`)).json(); } catch (e) { /* tries again */ }
          if (!st || !st.done) continue;
          if (st.error) throw new Error(st.error);
          break;
        }
        projectData = await API.getProject(projectData.id);
      }
      if (serverTimer) clearInterval(serverTimer);

      this.updateUploadProgress(100, `Vídeo importado e pronto para edição!`, `[Sucesso] Metadados: ${projectData.meta.width}x${projectData.meta.height} @ ${projectData.meta.fps}fps (${projectData.meta.duration.toFixed(2)}s)`);
      this.appendUploadLog(`[Timeline] Waveform gerado (${projectData.waveform?.length || 0} amostras), ${projectData.thumbnails?.length || 0} miniaturas carregadas.`);

      this.setProject(projectData);
      this.showToast('Vídeo importado e analisado com sucesso!', 'success');
      this.hideUploadModal(850);
    } catch (err) {
      if (serverTimer) clearInterval(serverTimer);
      console.error(err);
      this.updateUploadProgress(100, `Erro ao importar arquivo`, `[ERRO] ${err.message}`);
      document.getElementById('btn-close-upload-modal')?.classList.remove('hidden');
      this.showToast(`Erro ao importar vídeo: ${err.message}`, 'error');
    }
  },

  async loadDemoVideo() {
    this.showUploadModal('Carregando Vídeo de Demonstração');
    this.updateUploadProgress(10, 'Sintetizando vídeo de demonstração...', '[Demo] Conectando ao gerador de vídeo sintetizado...');

    const t1 = setTimeout(() => {
      this.updateUploadProgress(35, 'Gerando stream de vídeo 1280x720 30fps...', '[FFmpeg] Gerando lavfi testsrc com timecode e padrões de cores...');
    }, 200);

    const t2 = setTimeout(() => {
      this.updateUploadProgress(65, 'Sintetizando áudio senoidal com pausas...', '[FFmpeg] Injetando canal de áudio 48kHz com silêncios simulados...');
    }, 550);

    const t3 = setTimeout(() => {
      this.updateUploadProgress(85, 'Gerando miniaturas e forma de onda...', '[Waveform] Gerando 600 pontos de amplitude RMS e 24 thumbnails...');
    }, 850);

    try {
      const res = await fetch('/studiox/api/demo-clip', { method: 'POST' });
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      if (!res.ok) throw new Error('Não foi possível gerar vídeo demo');
      const data = await res.json();

      this.updateUploadProgress(100, 'Vídeo de demonstração pronto!', `[Sucesso] Mídia carregada: ${data.meta.width}x${data.meta.height} (${data.meta.duration}s, ${data.initial_cuts.length} takes).`);
      this.appendUploadLog(`[Legendas] Transcrição com palavras sincronizadas pronta.`);

      this.setProject(data);
      this.showToast('Vídeo de demonstração carregado!', 'success');
      this.hideUploadModal(800);
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      this.updateUploadProgress(100, 'Erro ao carregar demonstração', `[ERRO] ${err.message}`);
      document.getElementById('btn-close-upload-modal')?.classList.remove('hidden');
      this.showToast(`Erro: ${err.message}`, 'error');
    }
  },

  setProject(data) {
    ProjectState.detach();
    this.currentProject = data;

    // Enable buttons
    document.getElementById('btn-render-modal')?.removeAttribute('disabled');
    document.querySelector('.project-dot')?.classList.add('active');
    document.getElementById('project-title').innerText = data.display_name || data.source_name;
    document.title = `${data.display_name || data.source_name} | StudioX`;
    try { history.replaceState(null, '', `?project=${encodeURIComponent(data.id)}`); } catch (e) { /* file:// */ }

    // Hide empty state & show media details
    document.getElementById('empty-media-state')?.classList.add('hidden');
    document.getElementById('media-details')?.classList.remove('hidden');

    // Populate metadata
    document.getElementById('source-name').innerText = data.meta.filename;
    document.getElementById('source-aspect').innerText = data.meta.aspect;
    document.getElementById('meta-duration').innerText = Player.formatTime(data.meta.duration);
    document.getElementById('meta-res').innerText = `${data.meta.width}x${data.meta.height}`;
    document.getElementById('meta-fps').innerText = `${data.meta.fps} fps`;
    document.getElementById('meta-size').innerText = `${data.meta.size_mb} MB`;
    document.getElementById('take-count').innerText = `1 take (${data.initial_cuts.length} cortes)`;

    // Words from a previously loaded video must not leak into this one
    Player.setTranscription([]);
    this.renderTranscriptList([]);

    // Load video player & timeline. A saved project reopens with the cuts it was left with.
    const saved = data.state && data.state.edit;
    const hasSavedCuts = !!(saved && saved.clips && saved.clips.length);
    Player.loadVideo(data.video_url);
    Timeline.setData(hasSavedCuts ? { ...data, initial_cuts: saved.clips } : data);
    document.getElementById('take-count').innerText =
      `1 take (${hasSavedCuts ? saved.clips.length : data.initial_cuts.length} cortes)`;

    ProjectState.apply(saved);
    if (saved) Looks.applyExternal(saved);
    Transitions.applyExternal(saved);   // default sound + the cuts with their own transition (null = back to none)
    CanvasFrame.applyExternal(saved ? saved.canvas : null);
    SplitScreen.applyExternal(saved ? saved.split : null);
    SplitScreen.attach(data.id);
    Music.applyExternal(saved ? saved.music : null);
    Music.attach(data.id);
    Motion.applyExternal(saved ? saved.motion : null);
    Motion.attach(data.id);
    FaceTrack.applyExternal(saved ? saved.track : null);
    FaceTrack.attach(data.id);
    ProjectState.attach(data);
    ProjectState.renderTemplateList();
    this.loadSavedTranscript(data.id);
    if (data.timeline_notice) {
      const s = Number(data.timeline_notice.lead_in_s || 0).toFixed(2).replace('.', ',');
      this.showToast(`Este vídeo tem o áudio começando ${s} s depois da imagem. Os cortes por IA feitos antes desta correção ficaram ${s} s adiantados: clique em “Analisar Erros com IA” de novo (ou reenfileire) para refazê-los.`, 'warning');
    }
  },

  // A transcript made earlier (by the queue, or in a previous session) comes back with the project
  async loadSavedTranscript(projectId) {
    try {
      const res = await fetch(`/studiox/api/projects/${projectId}/transcript`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.words || !data.words.length || !this.currentProject || this.currentProject.id !== projectId) return;
      Player.setTranscription(data.words);
      Timeline.renderSubtitles();
      this.renderTranscriptList(data.words);
      const badge = document.getElementById('transcription-status');
      if (badge) {
        badge.innerText = 'Concluído';
        badge.style.color = 'var(--success)';
      }
    } catch (e) { /* no transcript yet */ }
  },

  renderTranscriptList(words) {
    const listContainer = document.getElementById('transcript-list');
    if (!listContainer) return;
    if (!words || !words.length) {
      listContainer.innerHTML = '<div class="transcript-placeholder">Clique em transcrever para gerar legendas e cortes de frases.</div>';
      const badge = document.getElementById('transcription-status');
      if (badge) { badge.innerText = 'Aguardando'; badge.style.color = ''; }
      return;
    }
    // Group words into short phrases
    const phrases = [];
    let cur = [];
    let from = 0;
    const flush = (to) => {
      if (!cur.length) return;
      phrases.push({ start: cur[0].start, end: cur[cur.length - 1].end, first: from, last: to, text: cur.map(x => x.text).join(' ') });
      cur = [];
      from = to + 1;
    };
    words.forEach((w, i) => {
      cur.push(w);
      if (cur.length >= 5 || /[.!?]/.test(w.text)) flush(i);
    });
    flush(words.length - 1);
    listContainer.innerHTML = phrases.map(p => `
      <div class="phrase-item" onclick="Player.seek(${p.start})">
        <span class="phrase-time">[${p.start.toFixed(1)}s]</span>
        <span class="phrase-text">${p.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>
        <button type="button" class="phrase-edit" title="Corrigir o texto desta legenda" aria-label="Editar texto" onclick="event.stopPropagation(); CaptionEdit.open(${p.first}, ${p.last})">✎</button>
      </div>
    `).join('');
  },

  async runAutoCutSilences() {
    if (!this.currentProject) return;

    this.showToast('Detectando silêncios e pausas mortas com FFmpeg...', 'info');
    try {
      const res = await API.detectSilences(this.currentProject.id);
      if (res.cuts && res.cuts.length > 0) {
        Timeline.clips = res.cuts.map((c, i) => ({
          id: `clip_${i + 1}`,
          start: c.start,
          end: c.end,
          beat: c.beat || `BEAT ${i + 1}`,
          source: c.source
        }));
        Timeline.selectedClipId = Timeline.clips[0].id;
        Timeline.render();
        this.showToast(`${res.silences.length} silêncio(s) removidos com cortes de 30-80ms de padding!`, 'success');
      } else {
        this.showToast('Nenhum silêncio longo detectado na gravação.', 'warning');
      }
    } catch (err) {
      this.showToast(`Erro na análise: ${err.message}`, 'error');
    }
  },

  async runTranscription() {
    if (!this.currentProject) return;

    const statusBadge = document.getElementById('transcription-status');
    if (statusBadge) {
      statusBadge.innerText = 'Transcrevendo...';
      statusBadge.style.color = 'var(--accent-text)';
    }

    this.showToast('Transcrevendo áudio com precisão de palavras...', 'info');

    const engine = document.getElementById('transcribe-engine')?.value || 'auto';
    try { localStorage.setItem('videoUse.transcribeEngine', engine); } catch (e) { /* storage blocked */ }

    try {
      const res = await API.transcribe(this.currentProject.id, engine);
      for (const note of res.notes || []) this.showToast(note, 'warning');
      Player.setTranscription(res.words);
      Timeline.renderSubtitles();

      if (statusBadge) {
        statusBadge.innerText = 'Concluído';
        statusBadge.style.color = 'var(--success)';
      }

      this.renderTranscriptList(res.words);

      this.showToast(`Transcrição gerada (${res.words.length} palavras mapeadas)!`, 'success');
    } catch (err) {
      console.error(err);
      if (statusBadge) {
        statusBadge.innerText = 'Falhou';
        statusBadge.style.color = 'var(--danger)';
      }
      this.showToast(`Erro na transcrição: ${err.message}`, 'error');
    }
  },

  updateRenderModalSummary() {
    const gradeTpl = TemplatesManager.catalog?.color_grades.find(g => g.id === TemplatesManager.selectedGrade);
    const transTpl = TemplatesManager.catalog?.transitions.find(t => t.id === TemplatesManager.selectedTransition);

    const st = SubtitleStyle.style;
    document.getElementById('summary-sub-template').innerText =
      `${SubtitleStyle.presetName()} · ${st.font_family} ${st.font_weight}${st.italic ? ' itálico' : ''}`;
    const hl = HeadlineStyle.timing();
    document.getElementById('summary-headline').innerText = hl.enabled
      ? `${HeadlineStyle.presetName()} · ${HeadlineStyle.style.font_family} · ${hl.start}s + ${hl.duration}s`
      : 'Desligado';
    if (gradeTpl) document.getElementById('summary-grade').innerText = gradeTpl.name;
    if (transTpl) {
      const sc = Looks.state.transitionScale;
      document.getElementById('summary-transition').innerText =
        transTpl.name + (transTpl.fx && transTpl.fx.length && Math.abs(sc - 1) > 0.01 ? ` (${sc.toFixed(2).replace(/\.?0+$/, '')}×)` : '')
        + (Object.keys(Transitions.state.cuts).length ? ` · ${Object.keys(Transitions.state.cuts).length} corte(s) personalizado(s)` : '')
        + (Transitions.state.sound.id && Transitions.state.sound.id !== 'none' ? ' · com som' : '');
    }
    const lut = Looks.luts.find(l => l.id === Looks.state.lut.id);
    document.getElementById('summary-lut').innerText = lut ? `${lut.name} · ${Math.round(Looks.state.lut.intensity * 100)}%` : 'Nenhum';
    const zm = Looks.state.zoom;
    document.getElementById('summary-zoom').innerText = zm.enabled
      ? `${Looks.STYLES[zm.style][0]} · +${Math.round((zm.amount - 1) * 100)}%` : 'Desligado';
    const music = document.getElementById('summary-music');
    if (music) music.innerText = Music.summary();
  },

  async startRender() {
    if (!this.currentProject) return;

    const isPreview = document.querySelector('input[name="render-mode"]:checked')?.value === 'preview';
    const enableSubs = document.getElementById('toggle-subtitles')?.checked;

    // Drawn by the same code as the live preview, at the video's own resolution
    let headlineConfig = null;
    try {
      headlineConfig = await HeadlineStyle.exportConfig();
    } catch (err) {
      this.showToast(`Não foi possível preparar o headline: ${err.message}`, 'error');
      return;
    }

    const renderData = {
      project_id: this.currentProject.id,
      ranges: Timeline.clips.map(c => ({
        source: c.source || this.currentProject.source_name,
        start: c.start,
        end: c.end,
        beat: c.beat
      })),
      grade: TemplatesManager.selectedGrade,
      grade_adjust: Grade.clean(TemplatesManager.gradeState.adj),
      split: SplitScreen.exportConfig(),
      music: Music.exportConfig(),
      motion: Motion.exportConfig(),
      subtitle_template_id: SubtitleStyle.presetId,
      subtitle_style: SubtitleStyle.exportStyle(),
      enable_subtitles: enableSubs,
      headline: headlineConfig,
      transition_id: TemplatesManager.selectedTransition,
      transition_scale: Looks.state.transitionScale,
      ...Transitions.exportConfig(),   // transition_sound, cut_transitions
      lut: { ...Looks.state.lut },
      zoom: { ...Looks.state.zoom },
      canvas: CanvasFrame.exportConfig(),
      track: FaceTrack.exportConfig(),
      is_preview: isPreview
    };

    // Show progress view
    document.getElementById('render-config-view')?.classList.add('hidden');
    document.getElementById('render-progress-view')?.classList.remove('hidden');

    try {
      const res = await API.render(renderData);
      this.activeRenderJob = res.job_id;
      this.startPollingRenderProgress(res.job_id);
    } catch (err) {
      this.showToast(`Erro ao iniciar renderização: ${err.message}`, 'error');
    }
  },

  startPollingRenderProgress(jobId) {
    if (this.pollInterval) clearInterval(this.pollInterval);

    const progressBar = document.getElementById('render-progress-bar');
    const progressPct = document.getElementById('render-progress-pct');
    const statusText = document.getElementById('render-status-text');
    const consoleBox = document.getElementById('console-logs');

    this.pollInterval = setInterval(async () => {
      try {
        const job = await API.getRenderStatus(jobId);

        if (progressBar) progressBar.style.width = `${job.progress}%`;
        if (progressPct) progressPct.innerText = `${job.progress}%`;
        if (statusText) {
          statusText.innerText = job.status === 'completed' ? 'Renderização finalizada!' : 'Executando pipeline StudioX...';
        }

        if (consoleBox && job.logs) {
          consoleBox.innerHTML = job.logs.map(l => `<div class="console-line">> ${l}</div>`).join('');
          consoleBox.scrollTop = consoleBox.scrollHeight;
        }

        if (job.status === 'completed') {
          clearInterval(this.pollInterval);
          this.showRenderFinished(job);
        } else if (job.status === 'error') {
          clearInterval(this.pollInterval);
          this.showToast('Erro durante a renderização.', 'error');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 900);
  },

  showRenderFinished(job) {
    const finishedActions = document.getElementById('render-finished-actions');
    const previewPlayer = document.getElementById('rendered-video-preview');
    const btnDownloadVideo = document.getElementById('btn-download-video');
    const btnDownloadEdl = document.getElementById('btn-download-edl');

    if (finishedActions) finishedActions.classList.remove('hidden');
    if (previewPlayer && job.output_url) {
      previewPlayer.src = job.output_url;
      previewPlayer.load();
    }

    if (btnDownloadVideo) {
      btnDownloadVideo.href = `/studiox/api/projects/${this.currentProject.id}/download/final`;
    }
    if (btnDownloadEdl) {
      btnDownloadEdl.href = `/studiox/api/projects/${this.currentProject.id}/download/edl`;
    }

    this.showToast('Renderização 100% concluída!', 'success');
  },

  aiAnalysisResults: null,

  async runAIAnalysis() {
    if (!this.currentProject) return;

    const provider = document.getElementById('ai-provider-select')?.value || 'local';
    const model = document.getElementById('ai-model')?.value.trim() || '';
    const instructions = document.getElementById('ai-instructions')?.value || '';
    const copyText = document.getElementById('ai-copy')?.value || '';
    const strictCopy = document.getElementById('ai-strict')?.checked !== false;

    const btnRun = document.getElementById('btn-run-ai-analysis');
    if (btnRun) {
      btnRun.disabled = true;
      btnRun.innerHTML = '<img src="images/loader.gif" alt="" class="loader loader-inline"><span>Analisando transcrição com IA...</span>';
    }

    this.showToast('Executando raciocínio editorial da IA...', 'info');

    try {
      const res = await API.analyzeWithAI(this.currentProject.id, {
        provider,
        model: model || null,
        instructions,
        copy_text: copyText,
        strict_copy: strictCopy
      });

      this.aiAnalysisResults = res;
      if (this.currentProject.state) { this.currentProject.state.copy = copyText; this.currentProject.state.strict_copy = strictCopy; }
      this.renderScriptSummary(res.summary && res.summary.script, !!copyText.trim());

      // Populate Stats
      document.getElementById('ai-stat-errors').innerText = res.summary.errors_found;
      document.getElementById('ai-stat-retakes').innerText = res.summary.retakes;
      document.getElementById('ai-stat-stutters').innerText = res.summary.stutters;
      document.getElementById('ai-stat-saved').innerText = `${res.summary.time_saved_s}s`;

      // Render Diff Word Flow with interactive click-to-toggle
      this.renderWordDiffFlow(res.word_diff);

      // Render Decisions List (cuts, then the word corrections the AI proposes)
      const decisionsList = document.getElementById('ai-decisions-list');
      if (decisionsList) {
        const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const items = (res.decisions || []).map(d => `
            <div class="decision-item ${esc(d.type)}">
              <span class="decision-tag">${esc(d.type)}</span>
              <span>${esc(d.description)}</span>
            </div>`);
        (res.fixes || []).forEach(f => items.push(`
            <div class="decision-item">
              <span class="decision-tag">correção</span>
              <span>“${esc(f.from)}” → “${esc(f.to)}”</span>
            </div>`));
        if (res.summary && res.summary.llm_notes) {
          items.push(`<div class="decision-item"><span class="decision-tag">IA</span><span>${esc(res.summary.llm_notes)}</span></div>`);
        }
        decisionsList.innerHTML = items.length
          ? items.join('')
          : `<div class="decision-item"><span>Nenhum erro grave detectado. Fala fluida com bom ritmo.</span></div>`;
      }
      (res.warnings || []).forEach(w => this.showToast(w, 'warning'));

      document.getElementById('ai-results-section')?.classList.remove('hidden');
      const via = res.summary.engine && res.summary.engine.startsWith('llm_')
        ? `pela IA (${res.summary.model || res.summary.engine.slice(4)})${res.summary.script && res.summary.script.used ? ' seguindo a copy' : ''}`
        : (res.summary.engine === 'copy_align' ? 'seguindo a copy (sem IA)' : 'pelas regras locais');
      this.showToast(`Análise concluída ${via}: ${res.summary.errors_found} trecho(s) a cortar, ${(res.fixes || []).length} correção(ões).`, 'success');
    } catch (err) {
      console.error(err);
      this.showToast(`Erro na análise de IA: ${err.message}`, 'error');
    } finally {
      if (btnRun) {
        btnRun.disabled = false;
        btnRun.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg><span>Executar Análise Inteligente de Erros</span>';
      }
    }
  },

  // The copy saved with the project fills the box the first time the modal opens for it
  loadSavedCopy() {
    const box = document.getElementById('ai-copy');
    const strict = document.getElementById('ai-strict');
    const pid = this.currentProject && this.currentProject.id;
    if (!box || !pid || this._aiCopyFor === pid) return;
    this._aiCopyFor = pid;
    const st = this.currentProject.state || {};
    box.value = st.copy || '';
    if (strict) strict.checked = st.strict_copy !== false;
  },

  // How much of the copy was found in the recording (or why the copy was not used)
  renderScriptSummary(sc, hadCopy) {
    const el = document.getElementById('ai-script-summary');
    if (!el) return;
    const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (!hadCopy || !sc) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    let html;
    if (!sc.used) {
      html = `<strong>Copy não usada.</strong> ${sc.lines_total ? `Só ${Math.round((sc.confidence || 0) * 100)}% dela combina com o que foi gravado: confira se é a copy deste vídeo.` : 'Não encontrei linhas no texto colado.'} A análise seguiu só a transcrição.`;
    } else {
      const bad = [];
      if ((sc.lines_missing || []).length) bad.push(`sem gravação: linha(s) ${sc.lines_missing.join(', ')}`);
      if ((sc.lines_partial || []).length) bad.push(`incompleta(s): ${sc.lines_partial.join(', ')}`);
      if ((sc.lines_free || []).length) bad.push(`dita(s) com outras palavras, mantida(s): ${sc.lines_free.join(', ')}`);
      if ((sc.out_of_order || []).length) bad.push(`gravada(s) fora de ordem: ${sc.out_of_order.join(', ')}`);
      html = `<strong>Copy:</strong> ${sc.lines_ok} de ${sc.lines_total} linhas encontradas na gravação${bad.length ? ' — ' + esc(bad.join('; ')) : ''}. Cada linha ficou com a melhor tentativa; ${sc.cut_words} palavra(s) fora dela.`;
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
  },

  renderWordDiffFlow(wordDiff) {
    const wordFlow = document.getElementById('ai-diff-word-flow');
    if (!wordFlow || !wordDiff) return;

    wordFlow.innerHTML = wordDiff.map(w => `
      <span class="word-pill ${w.status}" 
            data-index="${w.index}" 
            title="${w.reason || (w.status === 'cut' ? 'Cortado pela IA (Clique para manter)' : 'Mantido (Clique para cortar)')}">
        ${w.text}
      </span>
    `).join(' ');

    // Add click event to toggle word status
    wordFlow.querySelectorAll('.word-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const idx = parseInt(pill.getAttribute('data-index'), 10);
        const word = this.aiAnalysisResults?.word_diff?.find(x => x.index === idx);
        if (!word) return;

        word.status = word.status === 'cut' ? 'kept' : 'cut';
        word.reason = word.status === 'cut' ? 'Cortado manualmente pelo editor' : 'Mantido manualmente pelo editor';
        
        this.recalculateCutsFromWordDiff();
        this.renderWordDiffFlow(this.aiAnalysisResults.word_diff);
      });
    });
  },

  recalculateCutsFromWordDiff() {
    if (!this.aiAnalysisResults || !this.aiAnalysisResults.word_diff) return;
    const words = this.aiAnalysisResults.word_diff;
    const kept = words.filter(w => w.status === 'kept');
    const cuts = [];

    if (kept.length > 0) {
      let segStart = Math.max(0, kept[0].start - 0.05);
      let segWords = [kept[0]];

      for (let i = 1; i < kept.length; i++) {
        const prev = kept[i - 1];
        const curr = kept[i];
        const gap = curr.start - prev.end;
        const hadCutInBetween = (curr.index - prev.index > 1);

        if (hadCutInBetween || gap >= 0.8) {
          const segEnd = prev.end + 0.08;
          cuts.push({
            start: Math.round(segStart * 1000) / 1000,
            end: Math.round(segEnd * 1000) / 1000,
            beat: `CORTE ${cuts.length + 1}`,
            source: this.currentProject?.source_name || '',
            quote: segWords.map(w => w.text).join(' '),
            reason: 'Fala fluida limpa'
          });
          segStart = Math.max(0, curr.start - 0.05);
          segWords = [curr];
        } else {
          segWords.push(curr);
        }
      }

      if (segWords.length > 0) {
        const segEnd = segWords[segWords.length - 1].end + 0.08;
        cuts.push({
          start: Math.round(segStart * 1000) / 1000,
          end: Math.round(segEnd * 1000) / 1000,
          beat: `CORTE ${cuts.length + 1}`,
          source: this.currentProject?.source_name || '',
          quote: segWords.map(w => w.text).join(' '),
          reason: 'Fala fluida limpa'
        });
      }
    }

    this.aiAnalysisResults.recommended_cuts = cuts;

    // Update stats counters. Time saved = duration of the words actually marked "cut", not
    // total-span-minus-kept-clip-time: that also count the natural pauses between kept phrases
    // (always closed up above via the 0.8s gap split), which showed a "time saved" even with 0 cuts.
    const cutWords = words.filter(w => w.status === 'cut');
    const timeSaved = Math.round(cutWords.reduce((acc, w) => acc + (w.end - w.start), 0) * 10) / 10;

    const statErrors = document.getElementById('ai-stat-errors');
    const statSaved = document.getElementById('ai-stat-saved');
    if (statErrors) statErrors.innerText = cutWords.length;
    if (statSaved) statSaved.innerText = `${timeSaved}s`;
  },

  // Providers with a saved key (Configurações) + the local rules
  async loadAiProviders() {
    const select = document.getElementById('ai-provider-select');
    const hint = document.getElementById('ai-provider-hint');
    if (!select) return;
    try {
      const data = await API.getAiSettings();
      const keep = select.value;
      const ready = data.providers.filter(p => p.configured);
      select.innerHTML = '<option value="local">Regras locais (grátis, sem chave)</option>' +
        ready.map(p => `<option value="${p.id}">${p.name} · ${p.model}${p.id === data.default_provider ? ' (padrão)' : ''}</option>`).join('');
      select.value = [...select.options].some(o => o.value === keep) && keep !== 'local' ? keep : (data.default_provider || 'local');
      if (hint) {
        hint.innerHTML = ready.length
          ? 'A IA lê a transcrição, marca erros de gravação e retakes e sugere correções. As chaves ficam em <a href="/studiox/settings.html" class="link">Configurações</a>.'
          : 'Nenhuma IA configurada ainda. Salve uma chave em <a href="/studiox/settings.html" class="link">Configurações</a> para revisar com Claude, GPT, Llama e outros.';
      }
    } catch (e) { /* older server: keep the local option only */ }
  },

  async applyAICuts() {
    if (!this.aiAnalysisResults || !this.aiAnalysisResults.recommended_cuts) {
      this.showToast('Execute a análise de IA primeiro.', 'warning');
      return;
    }

    let cuts = this.aiAnalysisResults.recommended_cuts;
    // The server rebuilds the cuts from the words that ended up cut (also after manual toggles),
    // puts each edge on the real audio, and saves the accepted word corrections in the transcript.
    try {
      const diff = this.aiAnalysisResults.word_diff || [];
      const applied = await API.aiApply(this.currentProject.id, {
        cut_indices: diff.filter(w => w.status === 'cut').map(w => w.index),
        fixes: this.aiAnalysisResults.fixes || []
      });
      if (applied.cuts && applied.cuts.length) cuts = applied.cuts;
      if (applied.fixes_applied) this.showToast(`${applied.fixes_applied} palavra(s) corrigida(s) na transcrição.`, 'info');
    } catch (err) {
      console.warn('ai-apply failed, using the analysis cuts:', err);
    }

    if (cuts.length === 0) {
      this.showToast('Nenhum corte para aplicar.', 'warning');
      return;
    }

    Timeline.clips = cuts.map((c, i) => ({
      id: `ai_clip_${i + 1}`,
      start: c.start,
      end: c.end,
      duration: c.end - c.start,
      beat: c.beat || `BEAT ${i + 1}`,
      source: c.source || this.currentProject.source_name
    }));

    Timeline.selectedClipId = Timeline.clips[0].id;
    
    Timeline.render();
    this.loadSavedTranscript(this.currentProject.id); // words with the corrections applied

    // Position player at the start of the first clip
    Player.seek(Timeline.clips[0].start);

    document.getElementById('ai-modal')?.classList.add('hidden');
    this.showToast(`${cuts.length} corte(s) da IA aplicados com sucesso!`, 'success');
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
