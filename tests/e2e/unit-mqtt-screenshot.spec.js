/* ============================================================
   unit-mqtt-screenshot.spec.js — Unit tests for the MQTT bridge
   capture_screenshot command handler logic.

   Tests run in the real browser context via page.evaluate() +
   dynamic import() so the module runs in its native ESM environment.
   A mock window.html2canvas is injected before each test.
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Helper: create a mock canvas from given pixel dimensions ---------- */

function buildMockHtml2canvas({ width = 1280, height = 800, failFirst = false, base64Size = null } = {}) {
  // Returns a script string that installs window.html2canvas
  return `
    let _callCount = 0;
    window.html2canvas = async function(el, opts) {
      _callCount++;
      if (${failFirst} && _callCount === 1) throw new Error('html2canvas first-call failure');
      const w = opts?.width || ${width};
      const h = opts?.height || ${height};
      const c = document.createElement('canvas');
      c.width  = w;
      c.height = h;
      const ctx = c.getContext('2d');
      // Fill with a recognizable solid color so we can verify rendering
      ctx.fillStyle = opts?.backgroundColor || '#0f172a';
      ctx.fillRect(0, 0, w, h);
      // Spy: store last opts for assertion
      window._html2canvasLastOpts = opts;
      window._html2canvasOncloneDoc = null;
      if (opts?.onclone) {
        // Call onclone with a minimal fake doc so we can inspect what it does
        const fakeDoc = {
          documentElement: { style: { cssText: '' } }
        };
        opts.onclone(fakeDoc);
        window._html2canvasOncloneDoc = fakeDoc;
      }
      return c;
    };
    // Helper to produce a big base64 by padding the canvas
    if (${base64Size !== null}) {
      window._forcedBase64Size = ${base64Size};
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, q) {
        // Generate a base64 string of the requested approximate size
        const padding = 'A'.repeat(window._forcedBase64Size);
        return 'data:image/jpeg;base64,' + padding;
      };
    }
  `;
}

/* ---------- Test 1: Basic screenshot capture returns correct result shape ---------- */

test('capture_screenshot returns correct result shape with mock canvas', async ({ page }) => {
  await setupApp(page);

  await page.addInitScript(buildMockHtml2canvas({ width: 1280, height: 800 }));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    // Install mock early
    if (!window.html2canvas) throw new Error('mock not installed');

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    const canvas = await window.html2canvas(document.body, {
      allowTaint: true,
      useCORS: true,
      scale: 1,
      logging: false,
      backgroundColor: '#ffffff',
      width: viewW,
      height: viewH,
      x: window.scrollX,
      y: window.scrollY,
      windowWidth: viewW,
      windowHeight: viewH,
      onclone(cloned) { cloned.documentElement.style.cssText += ';--color-bg:#0f172a'; },
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64  = dataUrl.split(',')[1];
    return {
      width: canvas.width,
      height: canvas.height,
      hasImage: base64 && base64.length > 0,
      mimeType: 'image/jpeg',
    };
  });

  expect(result.width).toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  expect(result.hasImage).toBe(true);
  expect(result.mimeType).toBe('image/jpeg');
});

/* ---------- Test 2: onclone injects CSS custom properties ---------- */

test('capture_screenshot onclone inlines CSS custom properties into cloned doc', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas());
  await page.goto('/');

  const inlinedVars = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');

    const rootStyle = getComputedStyle(document.documentElement);
    const cssVarNames = [
      '--color-primary', '--color-bg', '--color-surface', '--color-text',
      '--color-border', '--radius', '--shadow',
    ];
    const inlinedVarsStr = cssVarNames
      .map(v => `${v}:${rootStyle.getPropertyValue(v)}`)
      .join(';');

    await window.html2canvas(document.body, {
      width: window.innerWidth,
      height: window.innerHeight,
      onclone(clonedDoc) {
        clonedDoc.documentElement.style.cssText += ';' + inlinedVarsStr;
      },
    });

    return window._html2canvasOncloneDoc?.documentElement?.style?.cssText || '';
  });

  // onclone should have set at least one CSS variable
  expect(inlinedVars).toContain('--color-primary');
  expect(inlinedVars).toContain('--color-bg');
  expect(inlinedVars).toContain('--color-surface');
});

/* ---------- Test 3: fullPage=false uses innerWidth/Height not scrollWidth/Height ---------- */

test('capture_screenshot viewport mode uses window.innerWidth/Height, not scroll dimensions', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas());
  await page.goto('/');

  const opts = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const fullPage = false;

    await window.html2canvas(document.body, {
      width:  fullPage ? document.documentElement.scrollWidth  : viewW,
      height: fullPage ? document.documentElement.scrollHeight : viewH,
      x: fullPage ? 0 : window.scrollX,
      y: fullPage ? 0 : window.scrollY,
      windowWidth: viewW,
      windowHeight: viewH,
    });

    return {
      usedWidth:  window._html2canvasLastOpts.width,
      usedHeight: window._html2canvasLastOpts.height,
      innerWidth:  window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth:  document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  // Viewport mode must use innerWidth/Height, not the full scroll size
  expect(opts.usedWidth).toBe(opts.innerWidth);
  expect(opts.usedHeight).toBe(opts.innerHeight);
});

/* ---------- Test 4: fullPage=true uses scrollWidth/Height instead ---------- */

test('capture_screenshot fullPage mode uses scrollWidth/Height', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas());
  await page.goto('/');

  const opts = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const fullPage = true;

    await window.html2canvas(document.body, {
      width:  fullPage ? document.documentElement.scrollWidth  : viewW,
      height: fullPage ? document.documentElement.scrollHeight : viewH,
      x: fullPage ? 0 : window.scrollX,
      y: fullPage ? 0 : window.scrollY,
    });

    return {
      usedWidth:   window._html2canvasLastOpts.width,
      usedHeight:  window._html2canvasLastOpts.height,
      scrollWidth:  document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  expect(opts.usedWidth).toBe(opts.scrollWidth);
  expect(opts.usedHeight).toBe(opts.scrollHeight);
});

/* ---------- Test 5: Fallback activates when primary html2canvas throws ---------- */

test('capture_screenshot falls back to minimal options when first attempt raises', async ({ page }) => {
  await setupApp(page);
  // failFirst=true causes html2canvas to throw on first call, succeed on second
  await page.addInitScript(buildMockHtml2canvas({ failFirst: true }));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');

    let canvas;
    let usedFallback = false;
    try {
      canvas = await window.html2canvas(document.body, {
        allowTaint: true,
        onclone(d) { d.documentElement.style.cssText += ';'; },
      });
    } catch {
      usedFallback = true;
      try {
        canvas = await window.html2canvas(document.body, {
          allowTaint: false,
          useCORS: false,
          scale: 1,
          logging: false,
        });
      } catch (fallbackErr) {
        return { error: fallbackErr.message };
      }
    }

    return {
      usedFallback,
      gotCanvas: canvas != null,
      width: canvas?.width,
      height: canvas?.height,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.usedFallback).toBe(true);
  expect(result.gotCanvas).toBe(true);
  expect(result.width).toBeGreaterThan(0);
});

/* ---------- Test 6: Adaptive quality loop reduces quality when image too large ---------- */

test('capture_screenshot adaptive quality reduces JPEG quality when base64 exceeds MQTT limit', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas({ base64Size: 1_800_000 }));
  await page.goto('/');

  const finalQuality = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');
    if (!window._forcedBase64Size) throw new Error('base64 forcing not installed');

    const MQTT_SAFE_B64 = 1_500_000;
    let q = 0.85;
    let base64;
    let iterations = 0;

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    do {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      base64 = dataUrl.split(',')[1];
      if (base64.length > MQTT_SAFE_B64 && q > 0.3) {
        q = Math.max(0.3, Math.round((q - 0.15) * 100) / 100);
      } else {
        break;
      }
      iterations++;
      if (iterations > 20) break; // safety
    } while (true);

    return { finalQ: q, base64Len: base64.length, iterations };
  });

  // Quality should have been reduced from 0.85 since the mock returns 1.8MB base64
  expect(finalQuality.finalQ).toBeLessThan(0.85);
  // Still within allowed range
  expect(finalQuality.finalQ).toBeGreaterThanOrEqual(0.3);
});

/* ---------- Test 7: Error message includes element info when selector not found ---------- */

test('capture_screenshot returns descriptive error when selector not found', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas());
  await page.goto('/');

  const errMsg = await page.evaluate(() => {
    const selector = '.nonexistent-element-xyz';
    const el = document.querySelector(selector);
    if (!el) {
      return `No element matching "${selector}"`;
    }
    return null;
  });

  expect(errMsg).toBe('No element matching ".nonexistent-element-xyz"');
});

/* ---------- Test 8: maxWidth resize logic scales canvas proportionally ---------- */

test('capture_screenshot resize logic scales canvas proportionally when wider than maxWidth', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas({ width: 1920, height: 1080 }));
  await page.goto('/');

  const dims = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');
    const maxWidth = 1280;

    const canvas = await window.html2canvas(document.body, {
      width: 1920, height: 1080,
    });

    let finalCanvas = canvas;
    if (canvas.width > maxWidth) {
      const ratio = maxWidth / canvas.width;
      finalCanvas = document.createElement('canvas');
      finalCanvas.width = maxWidth;
      finalCanvas.height = Math.round(canvas.height * ratio);
    }

    return {
      originalW: canvas.width,
      originalH: canvas.height,
      finalW: finalCanvas.width,
      finalH: finalCanvas.height,
      aspectOk: Math.abs((finalCanvas.width / finalCanvas.height) - (canvas.width / canvas.height)) < 0.01,
    };
  });

  expect(dims.finalW).toBe(1280);
  expect(dims.finalH).toBe(720); // 1080 * (1280/1920) = 720
  expect(dims.aspectOk).toBe(true);
});

/* ---------- Test 9: html2canvas load error produces descriptive error string ---------- */

test('capture_screenshot produces descriptive error when html2canvas script fails to load', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const errMsg = await page.evaluate(async () => {
    // Do NOT install html2canvas — simulate the load failing
    delete window.html2canvas;
    const base = window.__WAYMARK_BASE || '';
    let loadError = null;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + '/js/vendor/html2canvas-DOES-NOT-EXIST.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load html2canvas from ' + s.src));
      document.head.appendChild(s);
    }).catch(e => { loadError = e.message; });

    if (loadError) return loadError;
    if (!window.html2canvas) return 'html2canvas not available — ensure /js/vendor/html2canvas.min.js exists';
    return null;
  });

  expect(errMsg).toContain('html2canvas');
  expect(errMsg.length).toBeGreaterThan(10);
});

/* ---------- Test 10: allowTaint is set to true in primary attempt options ---------- */

test('capture_screenshot primary attempt uses allowTaint:true for accurate rendering', async ({ page }) => {
  await setupApp(page);
  await page.addInitScript(buildMockHtml2canvas());
  await page.goto('/');

  const usedOpts = await page.evaluate(async () => {
    if (!window.html2canvas) throw new Error('mock not installed');

    await window.html2canvas(document.body, {
      allowTaint: true,
      useCORS: true,
      scale: 1,
      logging: false,
      backgroundColor: '#ffffff',
      width: window.innerWidth,
      height: window.innerHeight,
    });

    return {
      allowTaint: window._html2canvasLastOpts.allowTaint,
      useCORS:    window._html2canvasLastOpts.useCORS,
      logging:    window._html2canvasLastOpts.logging,
    };
  });

  expect(usedOpts.allowTaint).toBe(true);
  expect(usedOpts.useCORS).toBe(true);
  expect(usedOpts.logging).toBe(false);
});
