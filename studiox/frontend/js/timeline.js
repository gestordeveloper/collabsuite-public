// Multi-Track Sequence & Ripple Timeline Engine for StudioX
//
// Virtualized renderer: only the slice of the timeline near the viewport is ever
// materialised (DOM nodes for clips/subtitles, a windowed canvas for ruler and
// waveform). Cost per frame is therefore independent of the video length, and
// canvases never get near the browser's ~32k px size limit.

const TL = {
  LABEL_W: 80,         // width of the sticky track-label column (px)
  END_PAD: 48,         // empty space after the last frame (px)
  MAX_PPS: 600,        // max zoom (pixels per second)
  DEFAULT_PPS: 60,     // preferred zoom for short videos
  MAX_CONTENT_W: 30e6, // stay under the browser layout width limit
  TRACK_VIDEO_H: 52
};

// [major tick step in seconds, minor subdivisions]
const RULER_STEPS = [
  [0.05, 5], [0.1, 5], [0.2, 4], [0.5, 5], [1, 5], [2, 4], [5, 5], [10, 5], [15, 3], [30, 3],
  [60, 6], [120, 4], [300, 5], [600, 5], [900, 3], [1800, 3], [3600, 6], [7200, 4]
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const Timeline = {
  clips: [],
  revision: 0, // bumped whenever the cut list changes (SubtitleStyle rebuilds its cues)
  selectedClipId: null,
  rawDuration: 0,
  pixelsPerSecond: TL.DEFAULT_PPS,
  minPps: 1,
  maxPps: TL.MAX_PPS,
  fitPps: TL.DEFAULT_PPS,
  waveformSamples: [],
  thumbnails: [],
  thumbTimes: [],
  thumbBase: null,
  tileW: 92,
  viewport: null,
  content: null,
  rulerCanvas: null,
  waveformCanvas: null,
  playhead: null,
  isDraggingPlayhead: false,
  activeTrim: null,
  mode: 'sequence', // 'sequence' (continuous edit without gaps) | 'source' (raw media with gaps)
  MODE_ICON: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M3 15h18M8 4v16M16 4v16"></path></svg>',
  snapping: true,

  // Internal render state
  _clipEls: new Map(),
  _subEls: new Map(),
  _phrases: [],
  _cuesRef: null,
  _cuesLen: -1,
  _subBlocks: [],
  _dirty: { subsData: true, canvas: true },
  _win: { origin: -1, width: 0, dpr: 0 },
  _raf: 0,
  _trackW: 0,
  _phX: null,
  _lastUserScroll: 0,
  _dragRaf: 0,
  _lastClientX: 0,
  _lastSeekSent: null,
  _pendingSeek: null,

  init() {
    this.viewport = document.getElementById('timeline-viewport');
    this.content = document.getElementById('timeline-content');
    this.rulerCanvas = document.getElementById('ruler-canvas');
    this.waveformCanvas = document.getElementById('waveform-canvas');
    this.playhead = document.getElementById('playhead');
    this.trackVideo = document.getElementById('track-video-content');
    this.trackSubs = document.getElementById('track-subtitles-content');

    this.bindEvents();
    this.updateDimensions();
    this.syncZoomSlider();
  },

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  setData(data) {
    this.rawDuration = data.meta.duration || 1;
    this.waveformSamples = data.waveform || [];
    this.thumbnails = (data.thumbnails || []).slice().sort((a, b) => a.time - b.time);
    this.thumbTimes = this.thumbnails.map(t => t.time);
    this.thumbBase = (data.id || App.currentProject?.id) ? `/studiox/api/projects/${data.id || App.currentProject.id}/thumbs/` : null;

    const ar = data.meta.width && data.meta.height ? data.meta.width / data.meta.height : 16 / 9;
    this.tileW = clamp(Math.round(TL.TRACK_VIDEO_H * ar), 28, 110);

    // Initialize clips
    if (data.initial_cuts && data.initial_cuts.length > 0) {
      this.clips = data.initial_cuts.map((c, i) => ({
        id: `clip_${i + 1}`,
        start: Number(c.start),
        end: Number(c.end),
        beat: c.beat || `CORTE ${i + 1}`,
        source: c.source
      }));
    } else {
      this.clips = [{
        id: 'clip_1',
        start: 0,
        end: this.rawDuration,
        beat: 'CORTE 1',
        source: data.source_name
      }];
    }

    if (this.clips.length > 0) {
      this.selectedClipId = this.clips[0].id;
    }

    this.resetDom();
    this.computeSequenceTimings();

    // Short videos open at the classic zoom, long ones open fitted to the screen.
    this.updateZoomBounds();
    this.pixelsPerSecond = clamp(Math.min(TL.DEFAULT_PPS, this.fitPps), this.minPps, this.maxPps);
    if (this.viewport) this.viewport.scrollLeft = 0;

    this.render();
  },

  resetDom() {
    this._clipEls.forEach(el => el.remove());
    this._clipEls.clear();
    this._subEls.forEach(el => el.remove());
    this._subEls.clear();
    this._win.origin = -1;
  },

  computeSequenceTimings() {
    this.revision++;
    let offset = 0;
    this.clips.forEach((clip) => {
      const dur = Math.max(0.1, clip.end - clip.start);
      clip.duration = dur;
      clip.seqStart = offset;
      clip.seqEnd = offset + dur;
      offset += dur;
    });
  },

  getTotalSequenceDuration() {
    if (!this.clips || this.clips.length === 0) return this.rawDuration;
    const last = this.clips[this.clips.length - 1];
    if (last.seqEnd !== undefined) return last.seqEnd;
    return this.clips.reduce((sum, c) => sum + (c.end - c.start), 0);
  },

  getActiveDuration() {
    return this.mode === 'sequence' ? this.getTotalSequenceDuration() : this.rawDuration;
  },

  // Index of the last clip whose source start is <= t (or -1). Clips are kept ordered.
  clipIndexAtSource(t) {
    const clips = this.clips;
    let lo = 0, hi = clips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (clips[mid].start <= t) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
  },

  sourceToSequence(srcTime) {
    if (this.mode !== 'sequence') return srcTime;
    const clips = this.clips;
    const i = this.clipIndexAtSource(srcTime);
    if (i >= 0 && srcTime <= clips[i].end) {
      return clips[i].seqStart + (srcTime - clips[i].start);
    }
    // Between clips: snap to the start of the next one
    if (clips[i + 1]) return clips[i + 1].seqStart;
    return this.getTotalSequenceDuration();
  },

  sequenceToSource(seqTime) {
    if (this.mode !== 'sequence') return seqTime;
    const clips = this.clips;
    let lo = 0, hi = clips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (clips[mid].seqEnd < seqTime) lo = mid + 1; else hi = mid;
    }
    const c = clips[lo];
    if (c && seqTime >= c.seqStart) return c.start + (seqTime - c.seqStart);
    if (clips.length > 0) return clips[clips.length - 1].end;
    return 0;
  },

  // ---------------------------------------------------------------------------
  // Geometry & zoom
  // ---------------------------------------------------------------------------
  viewportWidth() {
    return (this.viewport && this.viewport.clientWidth) || 1200;
  },

  updateZoomBounds() {
    const dur = Math.max(this.getActiveDuration(), 0.1);
    const fit = (this.viewportWidth() - TL.LABEL_W - TL.END_PAD) / dur;
    this.fitPps = Math.max(0.005, fit);
    this.maxPps = Math.max(1, Math.min(TL.MAX_PPS, TL.MAX_CONTENT_W / dur));
    this.minPps = Math.min(this.fitPps, 20, this.maxPps);
    this.pixelsPerSecond = clamp(this.pixelsPerSecond, this.minPps, this.maxPps);
  },

  updateDimensions() {
    this.updateZoomBounds();
    const cw = this.viewportWidth();
    const dur = this.getActiveDuration();
    this._trackW = Math.max(cw - TL.LABEL_W, Math.ceil(dur * this.pixelsPerSecond) + TL.END_PAD);
    if (this.content) this.content.style.width = `${TL.LABEL_W + this._trackW}px`;
    this.syncZoomSlider();
  },

  ppsToSlider(pps) {
    if (this.maxPps <= this.minPps) return 0;
    return 100 * Math.log(pps / this.minPps) / Math.log(this.maxPps / this.minPps);
  },

  sliderToPps(v) {
    return this.minPps * Math.pow(this.maxPps / this.minPps, v / 100);
  },

  syncZoomSlider() {
    const input = document.getElementById('timeline-zoom');
    if (input) input.value = String(this.ppsToSlider(this.pixelsPerSecond));
  },

  // Zoom keeping the time under `anchorClientX` (default: playhead, else viewport centre) fixed.
  setZoom(pps, anchorClientX) {
    if (!this.viewport) return;
    const newPps = clamp(pps, this.minPps, this.maxPps);
    if (Math.abs(newPps - this.pixelsPerSecond) < 1e-9) return;

    const rect = this.viewport.getBoundingClientRect();
    let anchorX;
    if (anchorClientX !== undefined) {
      anchorX = clamp(anchorClientX - rect.left, TL.LABEL_W, this.viewport.clientWidth);
    } else {
      const phX = (this._phX || 0) - this.viewport.scrollLeft; // playhead x inside viewport
      anchorX = phX >= TL.LABEL_W && phX <= this.viewport.clientWidth ? phX : (TL.LABEL_W + this.viewport.clientWidth) / 2;
    }

    const anchorTime = (this.viewport.scrollLeft + anchorX - TL.LABEL_W) / this.pixelsPerSecond;
    this.pixelsPerSecond = newPps;
    this.updateDimensions();
    this.viewport.scrollLeft = Math.max(0, anchorTime * newPps + TL.LABEL_W - anchorX);

    this._dirty.subsData = true;
    this._dirty.canvas = true;
    this.renderHeadlines();
    this.refreshPlayhead();
    this.requestRender();
  },

  zoomToFit() {
    this.updateZoomBounds();
    this.setZoom(this.fitPps);
    if (this.viewport) this.viewport.scrollLeft = 0;
    this.requestRender();
  },

  // ---------------------------------------------------------------------------
  // Render scheduling
  // ---------------------------------------------------------------------------
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => this.flush());
  },

  // Full re-render (data changed). Runs synchronously so callers see the result.
  render() {
    this.computeSequenceTimings();
    this.updateDimensions();
    this._dirty.subsData = true;
    this._dirty.canvas = true;
    this.renderHeadlines();
    this.updateStats();
    this.flush();
    this.refreshPlayhead();
  },

  renderSubtitles() {
    this._dirty.subsData = true;
    this.flush();
  },

  flush() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (!this.viewport) return;

    if (this._dirty.subsData) this.buildSubtitleBlocks();

    const s = this.viewport.scrollLeft;
    const w = Math.max(0, this.viewport.clientWidth - TL.LABEL_W);
    const margin = Math.max(200, w * 0.5);
    const vis = { s, w, l: s - margin, r: s + w + margin };

    this.renderClips(vis);
    this.renderSubtitleBlocks(vis);
    this.renderCanvases(vis);
    if (typeof Music !== 'undefined') Music.renderLanes(vis);
    if (typeof Motion !== 'undefined') Motion.renderLanes(vis);
    if (typeof SplitScreen !== 'undefined') SplitScreen.renderLanes(vis);

    this._dirty.subsData = false;
    this._dirty.canvas = false;
  },

  // Range [i0, i1) of clips overlapping the track-space window [l, r]
  clipRange(l, r) {
    const clips = this.clips;
    const n = clips.length;
    if (!n) return [0, 0];
    const isSeq = this.mode === 'sequence';
    const pps = this.pixelsPerSecond;

    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const c = clips[mid];
      if (((isSeq ? c.seqStart : c.start) + c.duration) * pps < l) lo = mid + 1; else hi = mid;
    }
    const i0 = lo;
    hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const c = clips[mid];
      if ((isSeq ? c.seqStart : c.start) * pps <= r) lo = mid + 1; else hi = mid;
    }
    return [i0, lo];
  },

  // ---------------------------------------------------------------------------
  // Video track (clips + filmstrip)
  // ---------------------------------------------------------------------------
  renderClips(vis) {
    if (!this.trackVideo) return;
    const clips = this.clips;
    const pps = this.pixelsPerSecond;
    const isSeq = this.mode === 'sequence';
    const [i0, i1] = this.clipRange(vis.l, vis.r);
    const seen = new Set();

    for (let i = i0; i < i1; i++) {
      const clip = clips[i];
      const left = (isSeq ? clip.seqStart : clip.start) * pps;
      const width = Math.max(2, clip.duration * pps);
      // Level of detail: thousands of tiny cuts stay cheap when zoomed out
      const lod = width < 8 ? 0 : width < 48 ? 1 : 2;

      let el = this._clipEls.get(clip.id);
      if (el && el._lod !== lod) {
        el.remove();
        this._clipEls.delete(clip.id);
        el = null;
      }
      if (!el) {
        el = this.createClipEl(clip, lod);
        this.trackVideo.appendChild(el);
        this._clipEls.set(clip.id, el);
      }
      seen.add(clip.id);

      if (el._left !== left) { el.style.left = `${left}px`; el._left = left; }
      if (el._width !== width) { el.style.width = `${width}px`; el._width = width; }

      const sel = clip.id === this.selectedClipId;
      if (el._sel !== sel) { el._sel = sel; el.classList.toggle('selected', sel); }

      if (lod >= 1) this.updateFilmstrip(el, clip, left, width, vis);
      if (lod === 2) {
        const label = `${clip.beat} (${clip.duration.toFixed(1)}s)`;
        if (el._labelText !== label) { el._labelText = label; el._label.textContent = label; }
        const showBadge = isSeq && i < clips.length - 1;
        if (el._badgeOn !== showBadge) { el._badgeOn = showBadge; el._badge.style.display = showBadge ? '' : 'none'; }
        if (showBadge && typeof Transitions !== 'undefined') {
          const b = Transitions.badgeFor(clips[i + 1]);
          if (el._badgeKey !== b.key) {
            el._badgeKey = b.key;
            el._badge.textContent = b.icon;
            el._badge.title = b.title;
            el._badge.classList.toggle('custom', !!b.cls);
          }
        }
      }
    }

    for (const [id, el] of this._clipEls) {
      if (!seen.has(id)) {
        el.remove();
        this._clipEls.delete(id);
      }
    }
  },

  createClipEl(clip, lod) {
    const el = document.createElement('div');
    el.className = `clip-block${lod === 0 ? ' tiny' : lod === 1 ? ' narrow' : ''}`;
    el.dataset.id = clip.id;
    el._lod = lod;

    if (lod === 0) return el;

    const handle = (side, title) => {
      const h = document.createElement('div');
      h.className = `clip-handle ${side}`;
      h.dataset.handle = side;
      h.dataset.id = clip.id;
      h.title = title;
      return h;
    };

    el._strip = document.createElement('div');
    el._strip.className = 'clip-filmstrip';
    el.append(el._strip);
    if (lod === 2) {
      el._label = document.createElement('div');
      el._label.className = 'clip-label';
      el._badge = document.createElement('div');
      el._badge.className = 'clip-transition-badge';
      el._badge.title = 'Transição deste corte';
      el._badge.textContent = '⚡';
      // the dot opens the choice of transition / sound for this one cut (js/transitions.js)
      el._badge.addEventListener('mousedown', e => e.stopPropagation());
      el._badge.addEventListener('click', e => { e.stopPropagation(); if (typeof Transitions !== 'undefined') Transitions.openCutPopover(clip.id, el._badge); });
      el.append(el._label);
    }
    el.append(handle('left', 'Ajustar Início do Corte'), handle('right', 'Ajustar Fim do Corte'));
    if (lod === 2) el.append(el._badge);
    return el;
  },

  // Nearest thumbnail filename for a source time (binary search)
  thumbNameAt(t) {
    const times = this.thumbTimes;
    let lo = 0, hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) lo--;
    return this.thumbnails[lo].filename;
  },

  // Only the tiles inside the visible slice of the clip exist in the DOM
  updateFilmstrip(el, clip, left, width, vis) {
    if (!this.thumbnails.length || !this.thumbBase) return;
    const tileW = this.tileW;
    const pps = this.pixelsPerSecond;
    const a = Math.max(0, vis.l - left);
    const b = Math.min(width, vis.r - left);
    const k0 = Math.floor(a / tileW);
    const k1 = Math.max(k0, Math.ceil(b / tileW));
    const tiles = el._tiles || (el._tiles = new Map());

    for (const [k, img] of tiles) {
      if (k < k0 || k >= k1) {
        img.remove();
        tiles.delete(k);
      }
    }
    for (let k = k0; k < k1; k++) {
      let img = tiles.get(k);
      if (!img) {
        img = document.createElement('img');
        img.draggable = false;
        img.decoding = 'async';
        img.style.left = `${k * tileW}px`;
        img.style.width = `${tileW}px`;
        el._strip.appendChild(img);
        tiles.set(k, img);
      }
      const visW = Math.min(tileW, width - k * tileW); // last tile may be cut by the clip edge
      const t = clip.start + Math.min(clip.duration, (k * tileW + visW / 2) / pps);
      const name = this.thumbNameAt(t);
      if (img._name !== name) {
        img._name = name;
        img.src = this.thumbBase + name;
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Headline track
  // ---------------------------------------------------------------------------
  renderHeadlines() {
    const block = document.getElementById('timeline-headline-block');
    if (!block) return;

    const { enabled, start, duration } = HeadlineStyle.timing();
    if (!enabled) {
      block.style.display = 'none';
      return;
    }

    block.style.display = 'flex';
    block.style.left = `${start * this.pixelsPerSecond}px`;
    block.style.width = `${Math.max(60, duration * this.pixelsPerSecond)}px`;
    const label = document.getElementById('headline-block-text');
    if (label) label.textContent = HeadlineStyle.blockLabel();
  },

  // ---------------------------------------------------------------------------
  // Subtitle track
  // ---------------------------------------------------------------------------
  // First clip whose source end is after t
  firstClipEndingAfter(t) {
    const clips = this.clips;
    let lo = 0, hi = clips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (clips[mid].end <= t) lo = mid + 1; else hi = mid;
    }
    return clips[lo];
  },

  // The kept clip a word actually falls in, or null if it sits in a cut-away gap
  clipForWord(w) {
    const c = this.firstClipEndingAfter(w.start);
    return c && w.end > c.start && w.start < c.end ? c : null;
  },

  groupPhrases(words) {
    // Group words into readable phrase cues (4 words or punctuation). A phrase
    // never spans a cut: it breaks whenever the kept clip changes, and words
    // that fall entirely inside a removed gap are dropped, so the caption
    // text shown here always matches what the final video will contain.
    const phrases = [];
    let cur = [];
    let curClip = null;
    const push = () => {
      if (cur.length > 0) {
        phrases.push({
          start: cur[0].start,
          end: cur[cur.length - 1].end,
          text: cur.map(x => x.text).join(' '),
          clip: curClip
        });
      }
      cur = [];
    };
    for (const w of words) {
      const c = this.clipForWord(w);
      if (!c) continue; // cut away: not part of the kept video
      if (c !== curClip) push();
      curClip = c;
      cur.push(w);
      if (cur.length >= 4 || /[.,!?;:]/.test(w.text || '')) push();
    }
    push();
    return phrases;
  },

  // Positions every phrase in track pixels and merges the ones too small to read
  buildSubtitleBlocks() {
    const cues = Player.transcriptionCues || [];
    // Phrase grouping depends on the current cut list too (clipForWord), so it
    // must be rebuilt whenever clips change, not only when the transcript does.
    if (this._cuesRef !== cues || this._cuesLen !== cues.length || this._phrasesRevision !== this.revision) {
      this._phrases = this.groupPhrases(cues);
      this._cuesRef = cues;
      this._cuesLen = cues.length;
      this._phrasesRevision = this.revision;
    }

    const pps = this.pixelsPerSecond;
    const isSeq = this.mode === 'sequence';
    const blocks = [];
    let cur = null;

    for (const p of this._phrases) {
      const c = p.clip;
      if (!c) continue;

      let s, e;
      if (isSeq) {
        const a = Math.max(c.start, p.start);
        const b = Math.min(c.end, p.end);
        s = c.seqStart + (a - c.start);
        e = c.seqStart + (b - c.start);
      } else {
        s = p.start;
        e = p.end;
      }

      const left = s * pps;
      const width = Math.max(4, (e - s) * pps);

      if (cur && cur.width < 40 && left - (cur.left + cur.width) < 3) {
        cur.width = Math.max(cur.width, left + width - cur.left);
        cur.text += ` ${p.text}`;
        cur.tEnd = p.end;
      } else {
        cur = { left, width, text: p.text, tStart: p.start, tEnd: p.end };
        blocks.push(cur);
      }
    }
    this._subBlocks = blocks;
  },

  renderSubtitleBlocks(vis) {
    if (!this.trackSubs) return;
    const blocks = this._subBlocks;
    const seen = new Set();

    let lo = 0, hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].left + blocks[mid].width < vis.l) lo = mid + 1; else hi = mid;
    }

    for (let i = lo; i < blocks.length && blocks[i].left <= vis.r; i++) {
      const b = blocks[i];
      seen.add(i);
      let el = this._subEls.get(i);
      if (!el) {
        el = document.createElement('div');
        this.trackSubs.appendChild(el);
        this._subEls.set(i, el);
      }
      if (el._b !== b) {
        el._b = b;
        const tiny = b.width < 14;
        el.className = `subtitle-block${tiny ? ' tiny' : ''}`;
        el.style.left = `${b.left}px`;
        el.style.width = `${b.width}px`;
        if (tiny) {
          el.textContent = '';
          el.removeAttribute('title');
        } else {
          const span = document.createElement('span');
          span.className = 'sub-phrase-text';
          span.textContent = b.text;
          el.replaceChildren(span);
          el.title = `[${b.tStart.toFixed(1)}s - ${b.tEnd.toFixed(1)}s] ${b.text.slice(0, 200)}`;
        }
      }
    }

    for (const [i, el] of this._subEls) {
      if (!seen.has(i)) {
        el.remove();
        this._subEls.delete(i);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Ruler + waveform (windowed canvases)
  // ---------------------------------------------------------------------------
  renderCanvases(vis) {
    if (!this.rulerCanvas || !this.waveformCanvas) return;

    const cw = this.viewportWidth();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const winW = Math.min(Math.ceil(cw * 3), Math.floor(16384 / dpr));
    const win = this._win;

    const visL = vis.s;
    const visR = vis.s + vis.w;
    const slackL = win.origin <= 0 ? -Infinity : cw * 0.25;
    const slackR = win.origin + win.width >= this._trackW ? -Infinity : cw * 0.25;
    const valid = win.origin >= 0 && win.dpr === dpr && win.width === winW &&
      visL >= win.origin + slackL && visR <= win.origin + win.width - slackR;

    if (valid && !this._dirty.canvas) return;

    if (!valid) {
      win.origin = Math.max(0, Math.floor(visL - cw));
      win.width = winW;
      win.dpr = dpr;
    }

    this.sizeCanvas(this.rulerCanvas, win);
    this.sizeCanvas(this.waveformCanvas, win);
    this.drawRuler(win);
    this.drawWaveform(win);
  },

  sizeCanvas(canvas, win) {
    const h = canvas.parentElement.clientHeight || 26;
    const pw = Math.round(win.width * win.dpr);
    const ph = Math.round(h * win.dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    canvas.style.width = `${win.width}px`;
    canvas.style.height = `${h}px`;
    canvas.style.transform = `translateX(${win.origin}px)`;
    canvas._h = h;
  },

  formatRulerTime(t, step) {
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const scale = Math.pow(10, decimals);
    const total = Math.round(t * scale);
    const sec = Math.floor(total / scale);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    let out = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    if (decimals) out += `.${String(total % scale).padStart(decimals, '0')}`;
    return out;
  },

  drawRuler(win) {
    const canvas = this.rulerCanvas;
    const ctx = canvas.getContext('2d');
    const W = win.width;
    const H = canvas._h;
    ctx.setTransform(win.dpr, 0, 0, win.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const dur = this.getActiveDuration();
    const pps = this.pixelsPerSecond;
    if (dur <= 0) return;

    // Pick the smallest step that keeps labels readable
    let pick = RULER_STEPS[RULER_STEPS.length - 1];
    for (const st of RULER_STEPS) {
      if (st[0] * pps >= 90) { pick = st; break; }
    }
    const [major, div] = pick;
    const minor = major / div;
    const showMinor = minor * pps >= 6;

    const t0 = win.origin / pps;
    const t1 = Math.min((win.origin + W) / pps, dur);
    const nStart = Math.max(0, Math.floor(t0 / minor));
    const nEnd = Math.floor(t1 / minor + 1e-9);

    const pathMajor = new Path2D();
    const pathMinor = new Path2D();
    const labels = [];

    for (let n = nStart; n <= nEnd; n++) {
      const t = n * minor;
      const x = Math.round(t * pps - win.origin) + 0.5;
      if (n % div === 0) {
        pathMajor.moveTo(x, H);
        pathMajor.lineTo(x, H - 12);
        labels.push([this.formatRulerTime(t, major), x + 4]);
      } else if (showMinor) {
        pathMinor.moveTo(x, H);
        pathMinor.lineTo(x, H - 6);
      }
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.stroke(pathMinor);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.stroke(pathMajor);

    ctx.fillStyle = '#8A8A94';
    ctx.font = '10px "Geist Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    for (const [text, x] of labels) ctx.fillText(text, x, 3);
  },

  drawWaveform(win) {
    const canvas = this.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const W = win.width;
    const H = canvas._h;
    ctx.setTransform(win.dpr, 0, 0, win.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const samples = this.waveformSamples;
    const n = samples.length;
    if (!n || this.rawDuration <= 0) return;

    const pps = this.pixelsPerSecond;
    const dt = this.rawDuration / n; // seconds covered by one sample
    const centerY = H / 2;
    const maxBar = H * 0.88;
    const COL = 2; // px per column (1.5px bar + gap)

    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#FF7DBE');
    gradient.addColorStop(0.5, '#EC1889');
    gradient.addColorStop(1, '#C80E71');
    ctx.fillStyle = gradient;

    // Peak amplitude over the source interval [t0, t1] (interpolated when zoomed far in)
    const peak = (t0, t1) => {
      const i0 = t0 / dt;
      const i1 = t1 / dt;
      if (i1 - i0 <= 1) {
        const f = (i0 + i1) / 2 - 0.5;
        const a = Math.floor(f);
        const w = f - a;
        const va = samples[clamp(a, 0, n - 1)] || 0;
        const vb = samples[clamp(a + 1, 0, n - 1)] || 0;
        return va + (vb - va) * w;
      }
      let m = 0;
      const end = Math.min(n, Math.ceil(i1));
      for (let i = Math.max(0, Math.floor(i0)); i < end; i++) {
        if (samples[i] > m) m = samples[i];
      }
      return m;
    };

    const drawSegment = (x0, x1, srcStart) => {
      const a = Math.max(x0, win.origin);
      const b = Math.min(x1, win.origin + W);
      for (let x = Math.floor(a / COL) * COL; x < b; x += COL) {
        const xs = Math.max(x, x0);
        const xe = Math.min(x + COL, x1);
        if (xe <= xs) continue;
        const v = peak(srcStart + (xs - x0) / pps, srcStart + (xe - x0) / pps);
        const bh = Math.max(2, v * maxBar);
        ctx.fillRect(x - win.origin, centerY - bh / 2, COL - 0.5, bh);
      }
    };

    if (this.mode === 'sequence') {
      const [i0, i1] = this.clipRange(win.origin, win.origin + W);
      for (let i = i0; i < i1; i++) {
        const c = this.clips[i];
        drawSegment(c.seqStart * pps, c.seqEnd * pps, c.start);
      }
    } else {
      drawSegment(0, this.rawDuration * pps, 0);
    }
  },

  // ---------------------------------------------------------------------------
  // Stats & playhead
  // ---------------------------------------------------------------------------
  updateStats() {
    const stats = document.getElementById('timeline-stats');
    if (!stats) return;

    const totalSeqTime = this.getTotalSequenceDuration();
    const modeLabel = this.mode === 'sequence' ? 'Sequência' : 'Bruto';
    stats.innerText = `${this.clips.length} cortes | ${Player.formatTime(totalSeqTime)} final [${modeLabel}]`;

    // Summary modal
    const countEl = document.getElementById('summary-cuts-count');
    const durEl = document.getElementById('summary-duration');
    if (countEl) countEl.innerText = this.clips.length;
    if (durEl) durEl.innerText = Player.formatTime(totalSeqTime);
  },

  // `time` is in the current display domain (sequence or source seconds)
  updatePlayhead(time) {
    if (!this.playhead) return;
    const x = TL.LABEL_W + time * this.pixelsPerSecond;
    if (this._phX !== x) {
      this._phX = x;
      this.playhead.style.transform = `translate3d(${x}px, 0, 0)`;
    }
    this.followPlayhead(time);
  },

  refreshPlayhead() {
    this._phX = null;
    // video.currentTime already reflects a seek that hasn't fired timeupdate yet
    const src = Player.video ? Player.video.currentTime : Player.currentTime;
    this.updatePlayhead(this.mode === 'sequence' ? this.sourceToSequence(src) : src);
  },

  // While playing, keep the playhead on screen (page-flip like a DAW)
  followPlayhead(time) {
    if (!this.viewport || !Player.isPlaying || this.isDraggingPlayhead || this.activeTrim) return;
    if (performance.now() - this._lastUserScroll < 1500) return;

    const x = time * this.pixelsPerSecond;
    const s = this.viewport.scrollLeft;
    const w = this.viewport.clientWidth - TL.LABEL_W;
    if (x < s || x > s + w - 40) {
      this.viewport.scrollLeft = Math.max(0, x - w * 0.1);
    }
  },

  scrollToTime(displayTime) {
    if (!this.viewport) return;
    const x = displayTime * this.pixelsPerSecond;
    this.viewport.scrollLeft = Math.max(0, x - (this.viewport.clientWidth - TL.LABEL_W) / 2);
  },

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------
  clientXToTrackX(clientX) {
    const rect = this.viewport.getBoundingClientRect();
    return clientX - rect.left + this.viewport.scrollLeft - TL.LABEL_W;
  },

  // Playhead follows the cursor immediately; video seeks are coalesced per frame
  scrubTo(clientX) {
    const t = clamp(this.clientXToTrackX(clientX) / this.pixelsPerSecond, 0, this.getActiveDuration());
    this.updatePlayhead(t);
    this._pendingSeek = this.mode === 'sequence' ? this.sequenceToSource(t) : t;
  },

  flushSeek(precise) {
    if (this._pendingSeek === null) return;
    if (precise || this._pendingSeek !== this._lastSeekSent) {
      Player.seek(this._pendingSeek, !precise);
      this._lastSeekSent = this._pendingSeek;
    }
  },

  selectClip(id) {
    if (this.selectedClipId === id) return;
    this.selectedClipId = id;
    for (const [cid, el] of this._clipEls) {
      const sel = cid === id;
      if (el._sel !== sel) {
        el._sel = sel;
        el.classList.toggle('selected', sel);
      }
    }
  },

  beginTrim(handle, clientX) {
    const clip = this.clips.find(c => c.id === handle.dataset.id);
    if (!clip) return;
    this.selectClip(clip.id);
    const type = handle.dataset.handle;
    // Source mode drags the edge to the cursor; remember where on the handle it was grabbed
    const grab = this.mode === 'source'
      ? this.clientXToTrackX(clientX) / this.pixelsPerSecond - (type === 'left' ? clip.start : clip.end)
      : 0;
    this.activeTrim = {
      clip,
      type,
      grab,
      startX: clientX,
      origStart: clip.start,
      origEnd: clip.end
    };
    this._lastClientX = clientX;
    this.startDragLoop();
  },

  // Computed from the drag origin (not incrementally) so it is exact and idempotent
  applyTrim(clientX) {
    const t = this.activeTrim;
    if (!t) return;
    const { clip, type } = t;
    const pps = this.pixelsPerSecond;

    let delta;
    if (this.mode === 'sequence') {
      // Ripple trim: edge stays put, in/out point moves by the dragged distance
      delta = (clientX - t.startX) / pps;
    } else {
      const absTime = this.clientXToTrackX(clientX) / pps;
      delta = absTime - t.grab - (type === 'left' ? t.origStart : t.origEnd);
    }

    let seekTo;
    if (type === 'left') {
      clip.start = Math.round(clamp(t.origStart + delta, 0, clip.end - 0.2) * 100) / 100;
      seekTo = clip.start;
    } else {
      clip.end = Math.round(clamp(t.origEnd + delta, clip.start + 0.2, this.rawDuration) * 100) / 100;
      seekTo = clip.end;
    }

    this.computeSequenceTimings();
    this.updateDimensions();
    this._dirty.subsData = true;
    this._dirty.canvas = true;
    this.flush();
    this.updateStats();

    this._pendingSeek = seekTo;
    this.updatePlayhead(this.mode === 'sequence' ? this.sourceToSequence(seekTo) : seekTo);
    this.flushSeek(false);
  },

  // One rAF loop drives scrubbing / trimming (and edge auto-scroll) while the mouse is down
  startDragLoop() {
    if (this._dragRaf) return;
    const tick = () => {
      if (!this.isDraggingPlayhead && !this.activeTrim) {
        this._dragRaf = 0;
        return;
      }

      const rect = this.viewport.getBoundingClientRect();
      const x = this._lastClientX - rect.left;
      const cw = this.viewport.clientWidth;
      const edge = 56;
      let v = 0;
      if (x > cw - edge) v = Math.min(1.5, (x - (cw - edge)) / edge) * 26;
      else if (x < TL.LABEL_W + edge) v = -Math.min(1.5, (TL.LABEL_W + edge - x) / edge) * 26;
      if (v) this.viewport.scrollLeft += v;

      if (this.isDraggingPlayhead) {
        this.scrubTo(this._lastClientX);
        this.flushSeek(false);
      } else if (this.activeTrim) {
        this.applyTrim(this._lastClientX);
      }
      this._dragRaf = requestAnimationFrame(tick);
    };
    this._dragRaf = requestAnimationFrame(tick);
  },

  endDrag() {
    const wasScrubbing = this.isDraggingPlayhead;
    const wasTrimming = !!this.activeTrim;
    this.isDraggingPlayhead = false;
    this.activeTrim = null;
    if (wasScrubbing) this.flushSeek(true); // land on the exact frame
    if (wasTrimming) this.render();
    this._lastSeekSent = null;
  },

  bindEvents() {
    // Mode toggle button
    const btnToggleMode = document.getElementById('btn-toggle-timeline-mode');
    if (btnToggleMode) {
      btnToggleMode.addEventListener('click', () => {
        const src = Player.currentTime;
        this.mode = this.mode === 'sequence' ? 'source' : 'sequence';
        btnToggleMode.innerHTML = `${this.MODE_ICON}${this.mode === 'sequence' ? 'Sequência Contínua' : 'Mídia Bruta'}`;
        btnToggleMode.classList.toggle('active', this.mode === 'sequence');
        this.render();
        this.scrollToTime(this.mode === 'sequence' ? this.sourceToSequence(src) : src);
        this.requestRender();
        App.showToast(`Modo da Timeline alterado para: ${this.mode === 'sequence' ? 'Sequência Contínua (Sem Gaps)' : 'Mídia Bruta (Com Gaps)'}`, 'info');
      });
    }

    // Zoom slider (logarithmic) + fit button
    const zoomInput = document.getElementById('timeline-zoom');
    if (zoomInput) {
      zoomInput.min = '0';
      zoomInput.max = '100';
      zoomInput.step = '0.5';
      zoomInput.addEventListener('input', (e) => {
        this.setZoom(this.sliderToPps(parseFloat(e.target.value)));
      });
    }
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.zoomToFit());

    if (this.viewport) {
      // Scrolling only re-renders the visible window
      this.viewport.addEventListener('scroll', () => this.requestRender(), { passive: true });

      // Wheel: scroll horizontally; Ctrl/Cmd (or trackpad pinch) + wheel: zoom at the cursor
      this.viewport.addEventListener('wheel', (e) => {
        this._lastUserScroll = performance.now();
        if (this.rawDuration <= 0) return;
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setZoom(this.pixelsPerSecond * Math.exp(-dy * 0.0015), e.clientX);
        } else if (Math.abs(dy) > Math.abs(e.deltaX)) {
          e.preventDefault();
          this.viewport.scrollLeft += dy;
        }
      }, { passive: false });

      // Click / drag to seek, clip selection, trim handles
      this.viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this._lastUserScroll = performance.now();

        // Ignore the scrollbars
        const rect = this.viewport.getBoundingClientRect();
        if (e.clientY > rect.top + this.viewport.clientHeight || e.clientX > rect.left + this.viewport.clientWidth) return;
        if (this.clientXToTrackX(e.clientX) < 0) return; // label column

        const handle = e.target.closest('.clip-handle');
        if (handle) {
          if (typeof Music !== 'undefined') Music.clearSelection();
          if (typeof Motion !== 'undefined') Motion.clearSelection();
          if (typeof SplitScreen !== 'undefined') SplitScreen.clearSelection();
          this.beginTrim(handle, e.clientX);
          e.preventDefault();
          return;
        }

        const clipEl = e.target.closest('.clip-block');
        if (clipEl) {
          if (typeof Music !== 'undefined') Music.clearSelection();   // S / Del act on what was clicked last
          if (typeof Motion !== 'undefined') Motion.clearSelection();
          if (typeof SplitScreen !== 'undefined') SplitScreen.clearSelection();
          this.selectClip(clipEl.dataset.id);
        }

        this.isDraggingPlayhead = true;
        this._lastClientX = e.clientX;
        this.scrubTo(e.clientX);
        this.flushSeek(true);
        this.startDragLoop();
      });
    }

    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingPlayhead || this.activeTrim) this._lastClientX = e.clientX;
    });
    window.addEventListener('mouseup', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());

    // Re-fit on resize / layout changes
    const onResize = () => {
      this.updateDimensions();
      this._dirty.subsData = true;
      this._dirty.canvas = true;
      this.refreshPlayhead();
      this.requestRender();
    };
    if (window.ResizeObserver && this.viewport) {
      new ResizeObserver(onResize).observe(this.viewport);
    } else {
      window.addEventListener('resize', onResize);
    }

    // Split Cut Tool
    document.getElementById('btn-split-cut')?.addEventListener('click', () => this.splitCurrentClip());
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea'].includes(e.target.tagName.toLowerCase())) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyS') {
        this.splitCurrentClip();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        this.deleteSelectedClip();
      }
    });

    // Delete Clip Tool
    document.getElementById('btn-delete-clip')?.addEventListener('click', () => this.deleteSelectedClip());

    // Reset edits
    document.getElementById('btn-reset-edits')?.addEventListener('click', () => {
      this.clips = [{
        id: 'clip_1',
        start: 0,
        end: this.rawDuration,
        beat: 'CLIP ORIGINAL',
        source: App.currentProject?.source_name || 'video.mp4'
      }];
      this.selectedClipId = 'clip_1';
      this.render();
      App.showToast('Edição restaurada para o clipe original.', 'success');
    });

    // Snapping toggle
    const btnSnap = document.getElementById('btn-snap-toggle');
    if (btnSnap) {
      btnSnap.addEventListener('click', () => {
        this.snapping = !this.snapping;
        btnSnap.classList.toggle('active', this.snapping);
        App.showToast(`Snapping ${this.snapping ? 'ativado' : 'desativado'}`, 'info');
      });
    }

    // Sync playhead with player updates (per frame while playing)
    Player.onTimeUpdateCallbacks.push((srcTime) => {
      if (this.isDraggingPlayhead) return; // the cursor owns the playhead while scrubbing
      this.updatePlayhead(this.mode === 'sequence' ? this.sourceToSequence(srcTime) : srcTime);
    });
  },

  splitCurrentClip() {
    // a music clip was the last thing clicked: S / the Split button cut it instead of the video
    if (typeof Music !== 'undefined' && Music.selectionActive()) { Music.splitAtPlayhead(); return; }
    const t = Player.currentTime;
    const clipIdx = this.clips.findIndex(c => t > c.start + 0.15 && t < c.end - 0.15);

    if (clipIdx === -1) {
      App.showToast('Posicione a agulha dentro de um clipe para dividir.', 'warning');
      return;
    }

    const orig = this.clips[clipIdx];
    const cut = Math.round(t * 100) / 100;
    const leftClip = {
      id: `clip_${Date.now()}_a`,
      start: orig.start,
      end: cut,
      beat: `${orig.beat} A`,
      source: orig.source
    };
    const rightClip = {
      id: `clip_${Date.now()}_b`,
      start: cut,
      end: orig.end,
      beat: `${orig.beat} B`,
      source: orig.source
    };

    this.clips.splice(clipIdx, 1, leftClip, rightClip);
    this.selectedClipId = rightClip.id;
    this.render();
    App.showToast('Clipe dividido com sucesso!', 'success');
  },

  deleteSelectedClip() {
    if (typeof Music !== 'undefined' && Music.selectionActive()) { Music.deleteSelected(); return; }
    if (typeof Motion !== 'undefined' && Motion.selectionActive()) { Motion.deleteSelected(); return; }
    if (typeof SplitScreen !== 'undefined' && SplitScreen.selectionActive()) { SplitScreen.deleteSelected(); return; }
    if (!this.selectedClipId || this.clips.length <= 1) {
      App.showToast('É necessário manter pelo menos um clipe na timeline.', 'warning');
      return;
    }

    const idx = this.clips.findIndex(c => c.id === this.selectedClipId);
    this.clips = this.clips.filter(c => c.id !== this.selectedClipId);
    // Select the neighbour so repeated deletes keep working where the user is
    this.selectedClipId = this.clips[Math.min(Math.max(idx, 0), this.clips.length - 1)]?.id || null;
    this.render();
    App.showToast('Clipe excluído e timeline reajustada!', 'success');
  }
};
