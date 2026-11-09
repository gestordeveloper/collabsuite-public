// Template Management & Live Styling for StudioX

const TemplatesManager = {
  catalog: null,
  selectedSubtitle: null, // kept in sync by SubtitleStyle (headline presets: HeadlineStyle)
  selectedTransition: 'micro_fade_30ms',
  selectedGrade: 'warm_cinematic',
  gradeState: { adj: { ...Grade.DEFAULT } },   // fine adjustments on top of the preset (see js/grade.js)
  _gradeUi: null,

  async init() {
    try {
      this.catalog = await API.getTemplates();
      SubtitleStyle.init(this.catalog.subtitles);
      HeadlineStyle.init(this.catalog.headlines);
      this.renderTransitionCards();
      this.renderGradingCards();
      const controls = document.getElementById('grade-controls');
      if (controls) this._gradeUi = Grade.mountControls(controls, this.gradeState, () => this.applyLiveColorGrade());
      this.bindEvents();
      this.applyLiveColorGrade();
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  },

  renderTransitionCards() {
    const container = document.getElementById('transition-template-list');
    if (!container || !this.catalog) return;

    container.innerHTML = this.catalog.transitions.map(tpl => `
      <div class="template-card ${tpl.id === this.selectedTransition ? 'active' : ''}" data-id="${tpl.id}" data-type="transition" role="button" tabindex="0">
        <div class="template-card-header">
          <span class="template-card-title">${tpl.icon} ${tpl.name}</span>
          ${tpl.recommended ? '<span class="badge badge-accent">Padrão</span>' : ''}${tpl.kind === 'custom' ? '<span class="badge badge-accent">Minha</span>' : ''}
        </div>
        <p class="template-card-desc">${tpl.description}</p>
        ${typeof Transitions !== 'undefined' ? Transitions.cardActions(tpl) : ''}
      </div>
    `).join('');
  },

  renderGradingCards() {
    const container = document.getElementById('grading-template-list');
    if (!container || !this.catalog) return;

    container.innerHTML = this.catalog.color_grades.map(tpl => `
      <div class="template-card ${tpl.id === this.selectedGrade ? 'active' : ''}" data-id="${tpl.id}" data-type="grade">
        <div class="template-card-header">
          <span class="template-card-title">${tpl.name}</span>
        </div>
        <p class="template-card-desc">${tpl.description}</p>
      </div>
    `).join('');
  },

  bindEvents() {
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.template-card');
      if (!card) return;

      const type = card.dataset.type;
      const id = card.dataset.id;

      if (type === 'subtitle') {
        SubtitleStyle.applyPreset(id);
      } else if (type === 'headline') {
        HeadlineStyle.applyPreset(id);
      } else if (type === 'transition') {
        this.selectedTransition = id;
        this.renderTransitionCards();
        if (typeof Looks !== 'undefined' && Looks.state) Looks.changed();   // preview + demo follow the choice
      } else if (type === 'grade') {
        this.selectedGrade = id;
        this.renderGradingCards();
        this.applyLiveColorGrade();
      }
    });
  },

  applyLiveColorGrade() {
    const video = document.getElementById('main-video');
    if (!video || !this.catalog) return;

    const grade = this.catalog.color_grades.find(g => g.id === this.selectedGrade);
    video.style.filter = Grade.css(grade ? grade.css_filter : 'none', this.gradeState.adj, 'editor');
  },

  setGradeAdjust(adj) {
    this.gradeState.adj = Grade.clean(adj);
    if (this._gradeUi) this._gradeUi.refresh();
    this.applyLiveColorGrade();
  }
};
