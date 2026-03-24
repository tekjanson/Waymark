// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ================================================================
   charts.spec.js — E2E tests for SVG chart rendering engine
   
   Tests chart rendering via the tracker template integration
   (sheet-010) and direct page.evaluate() calls for all three
   chart types (line, bar, pie/donut).
   ================================================================ */

/* ---------- Tracker chart integration ---------- */

test('tracker shows summary bar chart when multiple rows present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap', { timeout: 5_000 });

  await expect(page.locator('.tracker-chart-wrap')).toBeVisible();
  await expect(page.locator('.tracker-chart-wrap .chart-svg')).toBeVisible();
});

test('tracker chart contains correct number of bars (one per row)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.chart-bar-rect', { timeout: 5_000 });

  // sheet-010 has 8 data rows → 8 bars
  const bars = page.locator('.tracker-chart-wrap .chart-bar-rect');
  expect(await bars.count()).toBe(8);
});

test('tracker chart bars have fill colors based on progress', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.chart-bar-rect', { timeout: 5_000 });

  // At least one bar should have a fill attribute (color is applied inline)
  const firstBar = page.locator('.chart-bar-rect').first();
  const fill = await firstBar.getAttribute('fill');
  expect(fill).toBeTruthy();
  expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
});

test('tracker chart has x-axis labels', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap .chart-axis-x', { timeout: 5_000 });

  const labels = page.locator('.tracker-chart-wrap .chart-axis-x');
  expect(await labels.count()).toBe(8);
});

test('tracker chart SVG has correct role and aria-label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap svg', { timeout: 5_000 });

  const svg = page.locator('.tracker-chart-wrap svg');
  await expect(svg).toHaveAttribute('role', 'img');
  const label = await svg.getAttribute('aria-label');
  expect(label).toBeTruthy();
});

test('tracker chart appears above the progress rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap', { timeout: 5_000 });
  await page.waitForSelector('.template-tracker-row', { timeout: 5_000 });

  // Chart wrap should come before the first tracker row in DOM order
  const chartFirst = await page.evaluate(() => {
    const chart = document.querySelector('.tracker-chart-wrap');
    const row = document.querySelector('.template-tracker-row');
    if (!chart || !row) return false;
    return chart.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(chartFirst).toBeTruthy();
});

/* ---------- drawBarChart direct rendering ---------- */

test('drawBarChart renders SVG with correct bar count', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawBarChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawBarChart(div, {
      labels: ['A', 'B', 'C'],
      values: [10, 20, 30],
    });
    const bars = div.querySelectorAll('.chart-bar-rect');
    const svg = div.querySelector('svg');
    document.body.removeChild(div);
    return { barCount: bars.length, hasSvg: !!svg };
  });
  expect(result.hasSvg).toBe(true);
  expect(result.barCount).toBe(3);
});

test('drawBarChart shows empty message when no data', async ({ page }) => {
  await setupApp(page);
  const text = await page.evaluate(async () => {
    const { drawBarChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawBarChart(div, { labels: [], values: [] });
    const txt = div.querySelector('.chart-empty')?.textContent || '';
    document.body.removeChild(div);
    return txt;
  });
  expect(text).toBe('No data');
});

test('drawBarChart has hover tooltip div and shows text on mouseenter', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawBarChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawBarChart(div, { labels: ['Alpha', 'Beta'], values: [5, 10] });
    const hasTip = !!div.querySelector('.chart-tooltip');
    const bar = div.querySelector('.chart-bar-rect');
    // Simulate mouseenter
    bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
    const tipVisible = div.querySelector('.chart-tooltip')?.classList.contains('chart-tooltip-show');
    const tipText = div.querySelector('.chart-tooltip')?.textContent || '';
    document.body.removeChild(div);
    return { hasTip, tipVisible, tipText };
  });
  expect(result.hasTip).toBe(true);
  expect(result.tipVisible).toBe(true);
  expect(result.tipText).toContain('Alpha');
});

/* ---------- drawLineChart direct rendering ---------- */

test('drawLineChart renders SVG with path and dots', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawLineChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawLineChart(div, {
      labels: ['Jan', 'Feb', 'Mar'],
      series: [{ name: 'Sales', values: [10, 20, 15] }],
    });
    const paths = div.querySelectorAll('.chart-line-path');
    const dots = div.querySelectorAll('.chart-dot');
    const hasSvg = !!div.querySelector('svg');
    document.body.removeChild(div);
    return { pathCount: paths.length, dotCount: dots.length, hasSvg };
  });
  expect(result.hasSvg).toBe(true);
  expect(result.pathCount).toBe(1);
  expect(result.dotCount).toBe(3);
});

test('drawLineChart renders one path per series', async ({ page }) => {
  await setupApp(page);
  const pathCount = await page.evaluate(async () => {
    const { drawLineChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawLineChart(div, {
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: 'Revenue', values: [100, 120, 90, 150] },
        { name: 'Cost', values: [60, 70, 65, 80] },
      ],
    });
    const count = div.querySelectorAll('.chart-line-path').length;
    document.body.removeChild(div);
    return count;
  });
  expect(pathCount).toBe(2);
});

test('drawLineChart renders legend when multiple series present', async ({ page }) => {
  await setupApp(page);
  const legendCount = await page.evaluate(async () => {
    const { drawLineChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawLineChart(div, {
      labels: ['Jan', 'Feb'],
      series: [
        { name: 'Alpha', values: [1, 2] },
        { name: 'Beta', values: [3, 4] },
      ],
    });
    const count = div.querySelectorAll('.chart-legend-label').length;
    document.body.removeChild(div);
    return count;
  });
  expect(legendCount).toBe(2);
});

/* ---------- drawPieChart direct rendering ---------- */

test('drawPieChart renders SVG with correct slice count', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, {
      segments: [
        { label: 'A', value: 30 },
        { label: 'B', value: 50 },
        { label: 'C', value: 20 },
      ],
    });
    const slices = div.querySelectorAll('.chart-pie-slice');
    const hasSvg = !!div.querySelector('svg');
    document.body.removeChild(div);
    return { sliceCount: slices.length, hasSvg };
  });
  expect(result.hasSvg).toBe(true);
  expect(result.sliceCount).toBe(3);
});

test('drawPieChart shows legend with percentages', async ({ page }) => {
  await setupApp(page);
  const labels = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, {
      segments: [
        { label: 'Alpha', value: 50 },
        { label: 'Beta', value: 50 },
      ],
    });
    const texts = [...div.querySelectorAll('.chart-legend-label')].map(t => t.textContent);
    document.body.removeChild(div);
    return texts;
  });
  expect(labels).toHaveLength(2);
  expect(labels[0]).toContain('Alpha');
  expect(labels[0]).toContain('50%');
});

test('drawPieChart donut variant renders donut hole element', async ({ page }) => {
  await setupApp(page);
  const hasHole = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, {
      segments: [
        { label: 'X', value: 60 },
        { label: 'Y', value: 40 },
      ],
    }, { donut: true });
    const hole = !!div.querySelector('.chart-donut-hole') ||
      !!div.querySelector('.chart-donut.chart-svg');
    document.body.removeChild(div);
    return hole;
  });
  expect(hasHole).toBe(true);
});

test('drawPieChart shows empty message when all values are zero', async ({ page }) => {
  await setupApp(page);
  const text = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, { segments: [{ label: 'X', value: 0 }] });
    const msg = div.querySelector('.chart-empty')?.textContent || '';
    document.body.removeChild(div);
    return msg;
  });
  expect(text).toBe('No data');
});

test('drawPieChart legend renders as HTML elements (not SVG text)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, {
      segments: [
        { label: 'Food', value: 40 },
        { label: 'Transport', value: 30 },
        { label: 'Housing', value: 30 },
      ],
      showLegend: true,
    });
    const htmlLegend = !!div.querySelector('.chart-html-legend');
    const legendItems = div.querySelectorAll('.chart-legend-item').length;
    const legendLabels = [...div.querySelectorAll('.chart-legend-label')].map(el => el.textContent);
    // Legend should be HTML divs/spans, not SVG text elements
    const svgTexts = div.querySelectorAll('svg text.chart-legend-label').length;
    document.body.removeChild(div);
    return { htmlLegend, legendItems, legendLabels, svgTexts };
  });
  expect(result.htmlLegend).toBe(true);
  expect(result.legendItems).toBe(3);
  expect(result.legendLabels[0]).toContain('Food');
  expect(result.legendLabels[0]).toContain('%');
  expect(result.svgTexts).toBe(0);
});

test('drawPieChart slice hover shows tooltip with label and percentage', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawPieChart } = await import('/js/templates/charts.js');
    const div = document.createElement('div');
    document.body.appendChild(div);
    drawPieChart(div, {
      segments: [
        { label: 'Groceries', value: 60 },
        { label: 'Utilities', value: 40 },
      ],
    });
    const hasTip = !!div.querySelector('.chart-tooltip');
    const slice = div.querySelector('.chart-pie-slice');
    slice.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
    const tipVisible = div.querySelector('.chart-tooltip')?.classList.contains('chart-tooltip-show');
    const tipText = div.querySelector('.chart-tooltip')?.textContent || '';
    document.body.removeChild(div);
    return { hasTip, tipVisible, tipText };
  });
  expect(result.hasTip).toBe(true);
  expect(result.tipVisible).toBe(true);
  expect(result.tipText).toContain('Groceries');
  expect(result.tipText).toContain('%');
});

test('drawBarChart preserves title div in container (does not wipe on re-render)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { drawBarChart } = await import('/js/templates/charts.js');
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    // Add a title div first — simulates how tracker.js uses drawBarChart
    const titleDiv = document.createElement('div');
    titleDiv.className = 'chart-container-title';
    titleDiv.textContent = 'Progress Overview';
    wrap.appendChild(titleDiv);
    drawBarChart(wrap, { labels: ['A', 'B'], values: [10, 20] });
    const titleStillThere = !!wrap.querySelector('.chart-container-title');
    const titleText = wrap.querySelector('.chart-container-title')?.textContent || '';
    document.body.removeChild(wrap);
    return { titleStillThere, titleText };
  });
  expect(result.titleStillThere).toBe(true);
  expect(result.titleText).toBe('Progress Overview');
});

test('chart SVG has max-width constraint applied via CSS class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap .chart-svg', { timeout: 5_000 });

  // The chart SVG should not exceed 520px max-width
  const svgWidth = await page.evaluate(() => {
    const svg = document.querySelector('.tracker-chart-wrap .chart-svg');
    return svg ? svg.getBoundingClientRect().width : 0;
  });
  expect(svgWidth).toBeLessThanOrEqual(525); // 520px + 5px tolerance
});

/* ---------- Visual consistency ---------- */

test('chart SVG uses class-based styling (chart-grid-line, chart-axis)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap svg', { timeout: 5_000 });

  const hasGridLine = await page.evaluate(() =>
    !!document.querySelector('.tracker-chart-wrap .chart-grid-line')
  );
  const hasAxis = await page.evaluate(() =>
    !!document.querySelector('.tracker-chart-wrap .chart-axis')
  );
  expect(hasGridLine).toBe(true);
  expect(hasAxis).toBe(true);
});

test('chart container has correct border-radius styling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap', { timeout: 5_000 });

  await expect(page.locator('.tracker-chart-wrap')).toHaveCSS('border-radius', /\d+px/);
});

test('chart renders correctly at mobile width (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-010');
  await page.waitForSelector('.tracker-chart-wrap', { timeout: 5_000 });

  // Chart should still be present and not overflow
  await expect(page.locator('.tracker-chart-wrap')).toBeVisible();
  const overflows = await page.evaluate(() => {
    const wrap = document.querySelector('.tracker-chart-wrap');
    if (!wrap) return ['missing'];
    return [...wrap.querySelectorAll('*')]
      .filter(el => el.getBoundingClientRect().right > window.innerWidth + 4)
      .map(el => el.className || el.tagName);
  });
  expect(overflows).toHaveLength(0);
});
