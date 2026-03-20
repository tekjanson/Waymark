/* ============================================================
   templates/guide/index.js — Instruction guide slide deck
   ============================================================ */

import {
  el,
  editableCell,
  textareaCell,
  emitEdit,
  registerTemplate,
  delegateEvent,
} from '../shared.js';
import {
  STATUS_STATES,
  buildGuideDecks,
  clampSlideIndex,
  guideStatusKey,
  guideStatusLabel,
  slideExcerpt,
  summariseGuideDeck,
} from './helpers.js';

const _activeSlides = new Map();

const definition = {
  name: 'Instruction Guide',
  icon: '🪴',
  color: '#15803d',
  priority: 22,
  itemNoun: 'Slide',
  defaultHeaders: ['Guide', 'Slide', 'Objective', 'Instruction', 'Visual', 'Duration', 'Status'],

  detect(lower) {
    const hasGuide = lower.some(h => /^(guide|deck|playbook|workflow|lesson|module|process|task)/.test(h));
    const hasSlide = lower.some(h => /^(slide|step|screen|page|title|instruction)/.test(h));
    const hasInstruction = lower.some(h => /^(instruction|content|details|script|body|copy|talk.?track|notes?)/.test(h));
    const hasObjective = lower.some(h => /^(objective|goal|outcome|purpose|why)/.test(h));
    const hasVisual = lower.some(h => /^(visual|asset|demo|cue|illustration|media|callout)/.test(h));
    return (hasGuide && hasSlide && (hasInstruction || hasObjective))
      || (hasSlide && hasInstruction && hasVisual);
  },

  columns(lower) {
    const cols = {
      guide: -1,
      slide: -1,
      objective: -1,
      instruction: -1,
      visual: -1,
      duration: -1,
      status: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.guide = lower.findIndex(h => /^(guide|deck|playbook|workflow|lesson|module|process|task)/.test(h));
    cols.slide = lower.findIndex((h, i) => !used().includes(i) && /^(slide|step|screen|page|title|instruction)/.test(h));
    cols.objective = lower.findIndex((h, i) => !used().includes(i) && /^(objective|goal|outcome|purpose|why)/.test(h));
    cols.instruction = lower.findIndex((h, i) => !used().includes(i) && /^(instruction|content|details|script|body|copy|talk.?track|notes?)/.test(h));
    cols.visual = lower.findIndex((h, i) => !used().includes(i) && /^(visual|asset|demo|cue|illustration|media|callout)/.test(h));
    cols.duration = lower.findIndex((h, i) => !used().includes(i) && /^(duration|time|minutes|estimate|timing)/.test(h));
    cols.status = lower.findIndex((h, i) => !used().includes(i) && /^(status|state|progress|stage)/.test(h));

    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'guide', label: 'Guide', colIndex: cols.guide, type: 'text', placeholder: 'Guide or task name' },
      { role: 'slide', label: 'Slide', colIndex: cols.slide, type: 'text', placeholder: 'Slide headline', required: true },
      { role: 'objective', label: 'Objective', colIndex: cols.objective, type: 'text', placeholder: 'What should the viewer do?' },
      { role: 'instruction', label: 'Instruction', colIndex: cols.instruction, type: 'textarea', placeholder: 'Speaker notes or step details' },
      { role: 'visual', label: 'Visual', colIndex: cols.visual, type: 'text', placeholder: 'Visual cue or prop' },
      { role: 'duration', label: 'Duration', colIndex: cols.duration, type: 'text', placeholder: '2 min' },
      { role: 'status', label: 'Status', colIndex: cols.status, type: 'select', options: ['Draft', 'In Progress', 'Ready', 'Done'], defaultValue: 'Draft' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';
    const decks = buildGuideDecks(rows, cols);

    if (!decks.length) {
      container.append(el('div', { className: 'guide-empty' }, ['Add slides to build an instruction deck.']));
      return;
    }

    for (const deck of decks) {
      const card = el('section', { className: 'guide-card' });
      const summary = summariseGuideDeck(deck.slides);
      const header = el('div', { className: 'guide-card-header' }, [
        el('div', { className: 'guide-card-title-wrap' }, [
          el('span', { className: 'guide-card-kicker' }, ['Instruction deck']),
          el('h3', { className: 'guide-card-title' }, [deck.title]),
          el('p', { className: 'guide-card-subtitle' }, [summary.summaryText]),
        ]),
        el('div', { className: 'guide-progress' }, [
          el('div', { className: 'guide-progress-bar' }, [
            el('div', { className: 'guide-progress-fill', style: { width: `${summary.percent}%` } }),
          ]),
          el('span', { className: 'guide-progress-text' }, [`${summary.percent}% complete`]),
        ]),
      ]);

      const body = el('div', { className: 'guide-card-body' });
      const rail = el('div', { className: 'guide-rail' });
      const stage = el('div', { className: 'guide-stage' });
      body.append(rail, stage);
      card.append(header, body);

      const renderDeck = () => {
        const activeIndex = clampSlideIndex(_activeSlides.get(deck.id) ?? 0, deck.slides.length);
        _activeSlides.set(deck.id, activeIndex);
        const activeSlide = deck.slides[activeIndex];
        const liveSummary = summariseGuideDeck(deck.slides);

        header.querySelector('.guide-card-subtitle').textContent = liveSummary.summaryText;
        header.querySelector('.guide-progress-fill').style.width = `${liveSummary.percent}%`;
        header.querySelector('.guide-progress-text').textContent = `${liveSummary.percent}% complete`;

        rail.innerHTML = '';
        for (let i = 0; i < deck.slides.length; i++) {
          const slide = deck.slides[i];
          rail.append(el('button', {
            type: 'button',
            className: `guide-thumb ${i === activeIndex ? 'active' : ''}`,
            dataset: { slideIndex: String(i) },
          }, [
            el('span', { className: 'guide-thumb-index' }, [`${i + 1}`]),
            el('span', { className: 'guide-thumb-copy' }, [
              el('span', { className: 'guide-thumb-title' }, [slide.title]),
              el('span', { className: 'guide-thumb-excerpt' }, [slideExcerpt(slide.instruction)]),
            ]),
            el('span', { className: `guide-thumb-status guide-status-${guideStatusKey(slide.statusKey)}` }, [guideStatusLabel(slide.statusKey)]),
          ]));
        }

        stage.innerHTML = '';
        const stageFrame = el('div', { className: `guide-stage-frame guide-stage-${guideStatusKey(activeSlide.statusKey)}` });
        stageFrame.append(
          el('div', { className: 'guide-stage-top' }, [
            el('span', { className: 'guide-stage-kicker' }, [`Slide ${activeIndex + 1} of ${deck.slides.length}`]),
            cols.status >= 0
              ? el('button', {
                type: 'button',
                className: `guide-status guide-status-${guideStatusKey(activeSlide.statusKey)}`,
              }, [guideStatusLabel(activeSlide.statusKey)])
              : el('span', { className: `guide-status guide-status-${guideStatusKey(activeSlide.statusKey)}` }, [guideStatusLabel(activeSlide.statusKey)]),
          ]),
          cols.slide >= 0
            ? editableCell('h4', { className: 'guide-slide-title' }, activeSlide.title, activeSlide.rowIndex, cols.slide)
            : el('h4', { className: 'guide-slide-title' }, [activeSlide.title]),
        );

        const meta = el('div', { className: 'guide-slide-meta' });
        if (cols.objective >= 0) {
          meta.append(editableCell('span', { className: 'guide-meta-chip guide-objective' }, activeSlide.objective || 'Clarify the desired outcome', activeSlide.rowIndex, cols.objective));
        }
        if (cols.visual >= 0) {
          meta.append(editableCell('span', { className: 'guide-meta-chip guide-visual-cue' }, activeSlide.visual || 'Add a visual cue', activeSlide.rowIndex, cols.visual));
        }
        if (cols.duration >= 0) {
          meta.append(editableCell('span', { className: 'guide-meta-chip guide-duration' }, activeSlide.durationLabel, activeSlide.rowIndex, cols.duration, {
            onCommit(value, node) {
              activeSlide.duration = value;
              node.textContent = value || 'Flexible';
            },
          }));
        }
        stageFrame.append(meta);

        stageFrame.append(
          cols.instruction >= 0
            ? textareaCell('div', { className: 'guide-instruction' }, activeSlide.instruction || 'Add speaker notes, directions, or detail for this slide.', activeSlide.rowIndex, cols.instruction)
            : el('div', { className: 'guide-instruction' }, [activeSlide.instruction || 'Add speaker notes, directions, or detail for this slide.']),
        );

        const nav = el('div', { className: 'guide-nav' }, [
          el('button', Object.assign({
            type: 'button',
            className: 'guide-nav-btn guide-nav-prev',
          }, activeIndex === 0 ? { disabled: true } : {}), ['Previous']),
          el('span', { className: 'guide-counter' }, [`${activeIndex + 1} / ${deck.slides.length}`]),
          el('button', Object.assign({
            type: 'button',
            className: 'guide-nav-btn guide-nav-next',
          }, activeIndex === deck.slides.length - 1 ? { disabled: true } : {}), ['Next']),
        ]);
        stageFrame.append(nav);
        stage.append(stageFrame);

        const statusButton = stageFrame.querySelector('.guide-status');
        if (cols.status >= 0 && statusButton?.tagName === 'BUTTON') {
          statusButton.addEventListener('click', () => {
            const current = guideStatusKey(activeSlide.statusKey);
            const next = STATUS_STATES[(STATUS_STATES.indexOf(current) + 1) % STATUS_STATES.length];
            activeSlide.statusKey = next;
            activeSlide.statusRaw = guideStatusLabel(next);
            emitEdit(activeSlide.rowIndex, cols.status, guideStatusLabel(next));
            renderDeck();
          });
        }

        stageFrame.querySelector('.guide-nav-prev')?.addEventListener('click', () => {
          _activeSlides.set(deck.id, Math.max(activeIndex - 1, 0));
          renderDeck();
        });
        stageFrame.querySelector('.guide-nav-next')?.addEventListener('click', () => {
          _activeSlides.set(deck.id, Math.min(activeIndex + 1, deck.slides.length - 1));
          renderDeck();
        });
      };

      delegateEvent(rail, 'click', '.guide-thumb', (_event, thumb) => {
        _activeSlides.set(deck.id, Number(thumb.dataset.slideIndex || 0));
        renderDeck();
      });

      renderDeck();
      container.append(card);
    }
  },
};

registerTemplate('guide', definition);
export default definition;