/* ============================================================
   templates/guide/helpers.js — Pure helpers for guide decks
   ============================================================ */

export const STATUS_STATES = ['draft', 'progress', 'ready', 'done'];

const STATUS_LABELS = {
  draft: 'Draft',
  progress: 'In Progress',
  ready: 'Ready',
  done: 'Done',
};

function safeCell(row, idx) {
  return idx >= 0 && idx < row.length ? (row[idx] || '').trim() : '';
}

export function guideStatusKey(raw) {
  const value = (raw || '').toLowerCase().trim();
  if (STATUS_STATES.includes(value)) return value;
  if (/^(done|complete|complete[d]?|delivered|live|published)$/.test(value)) return 'done';
  if (/^(ready|approved|final|finalized|prepped)$/.test(value)) return 'ready';
  if (/^(in.?progress|active|working|rehearsing|building|blocked)$/.test(value)) return 'progress';
  return 'draft';
}

export function guideStatusLabel(raw) {
  const key = STATUS_STATES.includes(raw) ? raw : guideStatusKey(raw);
  return STATUS_LABELS[key] || STATUS_LABELS.draft;
}

export function parseDurationMinutes(raw) {
  const value = (raw || '').toLowerCase().trim();
  if (!value) return null;

  const hours = value.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/);
  const minutes = value.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/);
  if (hours || minutes) {
    const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
    return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
  }

  const plain = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain) : null;
}

export function formatDuration(raw) {
  const minutes = parseDurationMinutes(raw);
  if (!minutes) return (raw || '').trim() || 'Flexible';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function slideExcerpt(raw, maxLength = 84) {
  const value = (raw || '').trim().replace(/\s+/g, ' ');
  if (!value) return 'Add guidance for this slide.';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function clampSlideIndex(index, total) {
  if (!Number.isFinite(index) || total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

export function buildGuideDecks(rows, cols) {
  const decks = [];
  const deckMap = new Map();
  let lastGuideTitle = 'Instruction Guide';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const explicitGuide = safeCell(row, cols.guide);
    const guideTitle = explicitGuide || (cols.guide >= 0 ? lastGuideTitle : 'Instruction Guide');
    lastGuideTitle = guideTitle || lastGuideTitle;
    const key = guideTitle || 'Instruction Guide';
    if (!deckMap.has(key)) {
      const deck = { id: `guide-${decks.length + 1}`, title: key, slides: [] };
      deckMap.set(key, deck);
      decks.push(deck);
    }

    const deck = deckMap.get(key);
    const statusRaw = safeCell(row, cols.status);
    deck.slides.push({
      row,
      originalIndex: i,
      rowIndex: i + 1,
      guide: key,
      title: safeCell(row, cols.slide) || `Slide ${deck.slides.length + 1}`,
      objective: safeCell(row, cols.objective),
      instruction: safeCell(row, cols.instruction),
      visual: safeCell(row, cols.visual),
      duration: safeCell(row, cols.duration),
      durationLabel: formatDuration(safeCell(row, cols.duration)),
      statusRaw,
      statusKey: guideStatusKey(statusRaw),
    });
  }

  return decks;
}

export function summariseGuideDeck(slides) {
  const counts = { draft: 0, progress: 0, ready: 0, done: 0 };
  for (const slide of slides) counts[guideStatusKey(slide.statusKey || slide.statusRaw)]++;
  const total = slides.length;
  const percent = total ? Math.round((counts.done / total) * 100) : 0;
  const summaryText = total
    ? `${counts.done} done · ${counts.ready} ready · ${counts.progress} active`
    : 'No slides yet';
  return { total, percent, counts, summaryText };
}