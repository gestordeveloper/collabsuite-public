// Video Player Controller & Synchronizer for StudioX

const Player = {
  video: null,
  isPlaying: false,
  duration: 0,
  currentTime: 0,
  transcriptionCues: [],
  onTimeUpdateCallbacks: [],
  _raf: 0,

  init() {
    this.video = document.getElementById('main-video');
    if (!this.video) return;

    this.bindEvents();
  },

  bindEvents() {
    this.video.addEventListener('error', () => this._retryLoad());
    this.video.addEventListener('loadedmetadata', () => {
      this._retries = 900;
      this._preparingNote(null);
      this.duration = this.video.duration;
      const totalDur = Timeline ? Timeline.getActiveDuration() : this.duration;
      document.getElementById('time-total').innerText = this.formatTime(totalDur);
    });

    // timeupdate only fires ~4x/s: it covers seeks and paused states,
    // while the per-frame loop below drives playback.
    this.video.addEventListener('timeupdate', () => this.syncToVideo());
    this.video.addEventListener('seeked', () => this.syncToVideo());

    this.video.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayBtnState();
      document.getElementById('play-overlay')?.classList.add('hidden');
      this.startLoop();
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.stopLoop();
      this.updatePlayBtnState();
      document.getElementById('play-overlay')?.classList.remove('hidden');
      this.syncToVideo();
    });

    // Control buttons
    document.getElementById('btn-play-pause')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-big-play')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('play-overlay')?.addEventListener('click', () => this.togglePlay());

    document.getElementById('btn-prev-frame')?.addEventListener('click', () => {
      this.seek(Math.max(0, this.video.currentTime - 1.0));
    });

    document.getElementById('btn-next-frame')?.addEventListener('click', () => {
      this.seek(Math.min(this.duration, this.video.currentTime + 1.0));
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea', 'select'].includes(e.target.tagName.toLowerCase())) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'KeyJ') {
        this.seek(Math.max(0, this.video.currentTime - 1.0));
      } else if (e.code === 'KeyL') {
        this.seek(Math.min(this.duration, this.video.currentTime + 1.0));
      } else if (e.code === 'KeyK') {
        this.togglePlay();
      }
    });
  },

  // Re-syncs every dependent view (timecode, live subtitles, headline, timeline playhead)
  // with the video's real position, and enforces the cuts while playing.
  syncToVideo() {
    this.currentTime = this.video.currentTime;
    const displayCurTime = Timeline ? Timeline.sourceToSequence(this.currentTime) : this.currentTime;
    const displayTotalTime = Timeline ? Timeline.getActiveDuration() : this.duration;

    this.setText('time-current', this.formatTime(displayCurTime));
    this.setText('time-total', this.formatTime(displayTotalTime));

    this.syncSubtitles(this.currentTime);
    this.syncHeadlines(displayCurTime);
    if (typeof SplitScreen !== 'undefined') SplitScreen.syncAt(displayCurTime);
    if (typeof CanvasFrame !== 'undefined') CanvasFrame.syncAt(displayCurTime);
    if (typeof Music !== 'undefined') Music.syncAt();
    if (typeof Fx !== 'undefined') Fx.sync();
    if (typeof MotionPlayer !== 'undefined') MotionPlayer.syncAt(displayCurTime);
    this.handleClipJumps(this.currentTime);

    this.onTimeUpdateCallbacks.forEach(cb => cb(this.currentTime, this.duration));
  },

  // Only touches the DOM when the text actually changed
  setText(id, text) {
    const el = document.getElementById(id);
    if (el && el._text !== text) {
      el._text = text;
      el.innerText = text;
    }
  },

  startLoop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this.syncToVideo();
    };
    this._raf = requestAnimationFrame(tick);
  },

  stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  },

  loadVideo(src) {
    if (!this.video) return;
    this._srcBase = src;
    this._retries = 0;
    clearTimeout(this._retryTimer);
    this._preparingNote(null);
    this.video.src = src;
    this.video.load();
  },

  // The server answers 503 while it makes the H.264 copy that the browser can play (phone HEVC video).
  // The copy of a long HEVC video can take minutes on a small server, so keep asking (~30 min) and say what is happening
  // instead of leaving a black player.
  _preparingNote(text) {
    const box = document.getElementById('video-container');
    if (!box) return;
    let note = document.getElementById('video-preparing');
    if (!text) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('div');
      note.id = 'video-preparing';
      note.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;max-width:80%;padding:10px 16px;' +
        'border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font-size:13px;text-align:center;pointer-events:none;';
      box.appendChild(note);
    }
    note.textContent = text;
  },

  _retryLoad() {
    if (!this._srcBase) return;
    if (this._retries >= 900) {
      this._preparingNote('Não foi possível preparar a prévia deste vídeo. Recarregue a página ou envie o arquivo em H.264 (MP4).');
      return;
    }
    this._preparingNote('Preparando a prévia do vídeo… (arquivos HEVC/celular são convertidos; pode levar alguns minutos)');
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retries += 1;
      this.video.src = `${this._srcBase}${this._srcBase.includes('?') ? '&' : '?'}r=${this._retries}`;
      this.video.load();
    }, 2000);
  },

  togglePlay() {
    if (!this.video || !this.video.src) return;
    if (this.video.paused) {
      this.video.play().catch(console.error);
    } else {
      this.video.pause();
    }
  },

  // `fast` = imprecise keyframe seek (where supported), for scrubbing
  seek(time, fast = false) {
    if (!this.video || isNaN(time)) return;
    const t = Math.max(0, Math.min(this.duration, time));
    if (fast && typeof this.video.fastSeek === 'function') {
      this.video.fastSeek(t);
    } else {
      this.video.currentTime = t;
    }
  },

  updatePlayBtnState() {
    const playIcon = document.getElementById('play-icon');
    if (!playIcon) return;

    if (this.isPlaying) {
      playIcon.innerHTML = `
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      `;
    } else {
      playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
    }
  },

  setTranscription(words) {
    this.transcriptionCues = words || [];
  },

  // The caption itself (cue lookup, highlight, styling) lives in SubtitleStyle
  syncSubtitles(time) {
    SubtitleStyle.renderAt(time);
  },

  // The headline itself (drawing, animation, window) lives in HeadlineStyle;
  // `time` is the position on the OUTPUT timeline, like the render's start_in_output
  syncHeadlines(time) {
    HeadlineStyle.syncAt(time);
  },

  handleClipJumps(time) {
    if (!Timeline || !Timeline.clips || Timeline.clips.length === 0) return;

    // Check if current time falls within active clip (with tight boundary)
    const idx = Timeline.clipIndexAtSource(time);
    const currentClip = idx >= 0 && time < Timeline.clips[idx].end - 0.04;
    if (!currentClip && this.isPlaying) {
      // Jump seamlessly to next clip
      const nextClip = Timeline.clips[idx + 1];
      if (nextClip) {
        if (typeof Fx !== 'undefined') Fx.beforeJump(idx);   // keeps the last frame for the transition
        this.seek(nextClip.start);
      } else {
        this.video.pause();
        this.seek(Timeline.clips[0].start);
      }
    }
  },

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00:00.00';
    const totalMs = Math.floor(seconds * 1000);
    const ms = Math.floor((totalMs % 1000) / 10);
    const s = Math.floor((totalMs / 1000) % 60);
    const m = Math.floor((totalMs / (1000 * 60)) % 60);
    const h = Math.floor(totalMs / (1000 * 60 * 60));

    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms)}`;
  }
};
