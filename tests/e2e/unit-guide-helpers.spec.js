const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test('guideStatusKey classifies known status labels', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { guideStatusKey } = await import('/js/templates/guide/helpers.js');
    return {
      done: guideStatusKey('Done'),
      ready: guideStatusKey('approved'),
      progress: guideStatusKey('In Progress'),
      draft: guideStatusKey('notes only'),
    };
  });
  expect(result).toEqual({
    done: 'done',
    ready: 'ready',
    progress: 'progress',
    draft: 'draft',
  });
});

test('guideStatusLabel normalises state labels', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { guideStatusLabel } = await import('/js/templates/guide/helpers.js');
    return [
      guideStatusLabel('draft'),
      guideStatusLabel('progress'),
      guideStatusLabel('ready'),
      guideStatusLabel('done'),
    ];
  });
  expect(result).toEqual(['Draft', 'In Progress', 'Ready', 'Done']);
});

test('parseDurationMinutes handles minute and hour formats', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { parseDurationMinutes } = await import('/js/templates/guide/helpers.js');
    return {
      short: parseDurationMinutes('5 min'),
      long: parseDurationMinutes('1 hr 30 min'),
      numeric: parseDurationMinutes('12'),
      invalid: parseDurationMinutes('soon'),
    };
  });
  expect(result.short).toBe(5);
  expect(result.long).toBe(90);
  expect(result.numeric).toBe(12);
  expect(result.invalid).toBeNull();
});

test('formatDuration renders friendly labels', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { formatDuration } = await import('/js/templates/guide/helpers.js');
    return {
      short: formatDuration('8 min'),
      long: formatDuration('75'),
      empty: formatDuration(''),
    };
  });
  expect(result.short).toBe('8 min');
  expect(result.long).toBe('1 hr 15 min');
  expect(result.empty).toBe('Flexible');
});

test('slideExcerpt trims long content safely', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { slideExcerpt } = await import('/js/templates/guide/helpers.js');
    return {
      blank: slideExcerpt(''),
      short: slideExcerpt('Short copy', 20),
      long: slideExcerpt('This is a longer slide body that needs to collapse into a short preview.', 24),
    };
  });
  expect(result.blank).toBe('Add guidance for this slide.');
  expect(result.short).toBe('Short copy');
  expect(result.long.endsWith('…')).toBe(true);
});

test('clampSlideIndex keeps indexes in range', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { clampSlideIndex } = await import('/js/templates/guide/helpers.js');
    return {
      negative: clampSlideIndex(-4, 3),
      middle: clampSlideIndex(1, 3),
      high: clampSlideIndex(8, 3),
      empty: clampSlideIndex(5, 0),
    };
  });
  expect(result).toEqual({ negative: 0, middle: 1, high: 2, empty: 0 });
});

test('buildGuideDecks groups rows into ordered decks', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildGuideDecks } = await import('/js/templates/guide/helpers.js');
    const rows = [
      ['Deck A', 'Slide 1', 'Goal', 'Body', 'Cue', '2 min', 'Done'],
      ['Deck A', 'Slide 2', 'Goal', 'Body', 'Cue', '2 min', 'Ready'],
      ['Deck B', 'Slide 1', 'Goal', 'Body', 'Cue', '4 min', 'Draft'],
    ];
    const cols = { guide: 0, slide: 1, objective: 2, instruction: 3, visual: 4, duration: 5, status: 6 };
    return buildGuideDecks(rows, cols).map(deck => ({
      title: deck.title,
      slideCount: deck.slides.length,
      firstSlide: deck.slides[0].title,
    }));
  });
  expect(result).toEqual([
    { title: 'Deck A', slideCount: 2, firstSlide: 'Slide 1' },
    { title: 'Deck B', slideCount: 1, firstSlide: 'Slide 1' },
  ]);
});

test('summariseGuideDeck counts statuses and completion', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { summariseGuideDeck } = await import('/js/templates/guide/helpers.js');
    return summariseGuideDeck([
      { statusKey: 'done' },
      { statusKey: 'ready' },
      { statusKey: 'progress' },
      { statusKey: 'draft' },
    ]);
  });
  expect(result.total).toBe(4);
  expect(result.percent).toBe(25);
  expect(result.counts).toEqual({ draft: 1, progress: 1, ready: 1, done: 1 });
});