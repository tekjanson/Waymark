// @ts-check
/**
 * wayboard.spec.js — Unified Wayboard home, 12 curated layout architectures,
 * Profile layout selector, and the Wayside social pane.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test.use({
  permissions: ['microphone', 'camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

async function openSettings(page) {
  await page.click('#user-name');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
}

test('home renders the Wayboard with greeting, markers, widgets, and wayside', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });

  await expect(page.locator('#wayboard-root .greeting-banner')).toBeVisible();
  await expect(page.locator('#wayboard-root .markers-section')).toBeVisible();
  await expect(page.locator('#wayboard-root .wayboard-section')).toBeVisible();
  // User-configured Wayboard marks render.
  expect(await page.locator('#wayboard-grid .widget').count()).toBeGreaterThan(0);
  // The Wayside social pane exists.
  await expect(page.locator('#home-wayside .wayside-head')).toContainText('The Wayside');
  // Status badges show.
  await expect(page.locator('#home-status-badges .badge')).not.toHaveCount(0);
});

test('Wayboard widgets render the selected Waymark with its detected template', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [
      { id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() },
      { id: 'sheet-001', name: 'Grocery Waymark', templateKey: 'checklist', pinnedAt: new Date().toISOString() },
    ],
  });

  const addSheetWidget = async (sheetId) => {
    await page.locator('select[name="type"]').selectOption('sheet');
    await page.locator('select[name="sheet"]').selectOption(sheetId);
    await page.locator('.wayboard-widget-form button[type="submit"]').click();
  };

  await page.click('#wayboard-add-widget');
  await addSheetWidget('sheet-077');
  await expect(page.locator('.wayboard-template-wrap .contacts-layout')).toBeVisible();
  await addSheetWidget('sheet-001');
  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
  await expect(page.locator('.wayboard-template-wrap[aria-readonly="true"]')).toHaveCount(2);
  await page.locator('.wayboard-widget-dialog-header .btn-icon').click();

  const bread = page.locator('.wayboard-template-wrap .checklist-row', { hasText: 'Bread' });
  const breadState = await bread.getAttribute('class');
  await bread.locator('.checklist-checkbox').click();
  await expect(bread).toHaveAttribute('class', breadState);
});

test('Quick actions can be selected and reordered inside their own widget', async ({ page }) => {
  await setupApp(page);
  const quickmarks = page.locator('.wayboard-widget-quickmarks');
  await expect(quickmarks.locator('.home-action-card')).toHaveCount(4);
  await quickmarks.getByRole('button', { name: 'Edit Quick actions' }).click();

  const options = page.locator('.wayboard-widget-quickmark-options');
  await expect(options.locator('input[type="checkbox"]')).toHaveCount(4);
  await options.locator('input[value="import"]').uncheck();
  await options.locator('input[value="browse"]').uncheck();
  const moveGuidesEarlier = options.getByRole('button', { name: 'Move Example Waymarks earlier' });
  await moveGuidesEarlier.click();
  await moveGuidesEarlier.click();
  await moveGuidesEarlier.click();
  await page.locator('.wayboard-widget-form button[type="submit"]').click();

  await expect(quickmarks.locator('.home-action-label')).toHaveText(['Example Waymarks', 'New Waymark']);
  await page.locator('.wayboard-widget-dialog-header .btn-icon').click();
  await page.locator('#home-action-create').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();
});

test('pinned Waymarks widget shows every pinned item with no show-more button', async ({ page }) => {
  const pinnedSheets = Array.from({ length: 8 }, (_, i) => ({
    id: `sheet-00${(i % 9) + 1}`,
    name: `Pinned Waymark ${i + 1}`,
    templateKey: 'checklist',
    pinnedAt: new Date().toISOString(),
  }));
  await setupApp(page, { pinnedSheets });
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });

  const pinnedWidget = page.locator('.wayboard-widget-pinned');
  await expect(pinnedWidget).toBeVisible();
  // Full list (grows to fit) — not the paged list.
  await expect(pinnedWidget.locator('.wayboard-full-list')).toBeVisible();
  await expect(pinnedWidget.locator('.wayboard-show-more')).toHaveCount(0);
  await expect(pinnedWidget.locator('.wayboard-data-row')).toHaveCount(8);
});

test('expanded Wayboard gives widgets the full home canvas and can be restored', async ({ page }) => {
  await setupApp(page);
  await page.click('#wayboard-expand-toggle');
  await expect(page.locator('#wayboard-root')).toHaveClass(/wayboard-expanded/);
  await expect(page.locator('#home-wayside')).toBeHidden();
  await page.getByRole('button', { name: 'Restore layout' }).click();
  await expect(page.locator('#wayboard-root')).not.toHaveClass(/wayboard-expanded/);
  await expect(page.locator('#home-wayside')).toBeVisible();
});

test('Wayboard can add a spreadsheet directly from Drive without pinning it first', async ({ page }) => {
  await setupApp(page);
  await page.click('#wayboard-add-widget');
  await page.locator('select[name="type"]').selectOption('sheet');

  const source = page.locator('select[name="sheet"]');
  await expect(source).toBeEnabled();
  await expect(source).toHaveValue('');
  await page.getByRole('button', { name: 'Browse Drive' }).click();
  await expect(source).toHaveValue('sheet-001');
  await page.locator('.wayboard-widget-form button[type="submit"]').click();

  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
  await expect(page.locator('.wayboard-template-wrap[aria-readonly="true"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.wayboard-template-wrap .checklist-row')).toHaveCount(10);
});

test('default home layout is mode-1', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root.mode-1', { timeout: 5_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-1\b/);
});

test('the 12 curated layouts each render a distinct architecture', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  const layouts = await page.evaluate(() => {
    const noTransitions = document.createElement('style');
    noTransitions.textContent = '#wayboard-root, #wayboard-root * { transition: none !important; }';
    document.head.append(noTransitions);
    const root = document.getElementById('wayboard-root');
    const read = mode => {
      root.className = `wayboard-root mode-${mode}`;
      const grid = getComputedStyle(root.querySelector('.wayboard-grid'));
      const canvas = getComputedStyle(root.querySelector('main.canvas'));
      const section = getComputedStyle(root.querySelector('.wayboard-section'));
      const greeting = getComputedStyle(root.querySelector('.greeting-banner'));
      const wayside = getComputedStyle(root.querySelector('aside.wayside'));
      const quickmarks = root.querySelector('.wayboard-widget-quickmarks');
      const quickStyle = getComputedStyle(quickmarks);
      const markRow = getComputedStyle(quickmarks.querySelector('.markers-row'));
      const widget = getComputedStyle(root.querySelector('.wayboard-widget'));
      return {
        gridDisplay: grid.display,
        gridColumns: grid.gridTemplateColumns,
        gridColumnCount: grid.columnCount,
        canvasDirection: canvas.flexDirection,
        canvasBg: canvas.backgroundImage,
        sectionMaxWidth: section.maxWidth,
        greetingBorder: greeting.borderBottomStyle,
        waysideOrder: wayside.order,
        fontFamily: quickStyle.fontFamily.toLowerCase(),
        widgetMinHeight: widget.minHeight,
        quickDisplay: quickStyle.display,
        markRowDisplay: markRow.display,
      };
    };
    return {
      command: read(1), bento: read(2), focus: read(3), social: read(4),
      rail: read(5), stream: read(6), pinboard: read(7), hud: read(8),
      gallery: read(9), canvas: read(10), editorial: read(11), matrix: read(12),
      all: Array.from({ length: 12 }, (_, i) => read(i + 1)),
    };
  });

  // Each archetype expresses its defining structural trait.
  expect(layouts.command.gridDisplay).toBe('grid');
  expect(layouts.bento.greetingBorder).toBe('solid');
  expect(layouts.bento.gridColumns.split(' ')).toHaveLength(4);
  expect(layouts.focus.sectionMaxWidth).not.toBe('none');
  expect(layouts.social.waysideOrder).toBe('-1');
  expect(layouts.rail.canvasDirection).toBe('row');
  expect(layouts.stream.gridDisplay).toBe('flex');
  expect(layouts.pinboard.gridColumnCount).toBe('3');
  expect(layouts.hud.fontFamily).toContain('mono');
  expect(layouts.gallery.widgetMinHeight).toBe('240px');
  expect(layouts.canvas.canvasBg).toContain('gradient');
  expect(layouts.editorial.gridColumnCount).toBe('2');
  expect(layouts.matrix.gridColumns.split(' ')).toHaveLength(5);
  expect(layouts.matrix.fontFamily).toContain('mono');

  // Quick marks stay visible in every layout (regression guard).
  expect(layouts.all.every(l => l.quickDisplay !== 'none' && l.markRowDisplay !== 'none')).toBe(true);
  // The layouts are genuinely distinct, not colour swaps.
  const signatures = new Set(layouts.all.map(l =>
    `${l.gridDisplay}:${l.gridColumns}:${l.canvasDirection}:${l.waysideOrder}:${l.widgetMinHeight}:${l.canvasBg}:${l.fontFamily}`));
  expect(signatures.size).toBeGreaterThanOrEqual(10);
});

test('all 12 layouts keep quick marks and greetings aligned at desktop and phone widths', async ({ page }) => {
  await setupApp(page);
  await page.addStyleTag({ content: '#wayboard-root, #wayboard-root * { transition: none !important; }' });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const alignmentIssues = await page.evaluate(() => {
      const root = document.getElementById('wayboard-root');
      const issues = [];
      for (let mode = 1; mode <= 12; mode++) {
        root.className = `wayboard-root mode-${mode}`;
        const workspace = root.querySelector('.workspace').getBoundingClientRect();
        const quickmarks = root.querySelector('.wayboard-widget-quickmarks');
        const marksStyle = getComputedStyle(quickmarks);
        if (marksStyle.display === 'none') {
          issues.push(`mode ${mode}: quick marks are hidden`);
          continue;
        }
        const marksBox = quickmarks.getBoundingClientRect();
        if (marksBox.left < workspace.left - 2 || marksBox.right > workspace.right + 2) {
          issues.push(`mode ${mode}: quick-mark panel escapes the Wayboard`);
        }
        for (const action of quickmarks.querySelectorAll('.home-action-card')) {
          if (action.getBoundingClientRect().width < 80) {
            issues.push(`mode ${mode}: quick-mark action is narrower than 80px`);
            break;
          }
        }
        const canvasScrollsHorizontally = ['auto', 'scroll'].includes(getComputedStyle(root.querySelector('main.canvas')).overflowX);
        if (!canvasScrollsHorizontally) {
          for (const widget of root.querySelectorAll('.wayboard-grid > .wayboard-widget')) {
            const widgetBox = widget.getBoundingClientRect();
            if (widgetBox.left < workspace.left - 2 || widgetBox.right > workspace.right + 2) {
              issues.push(`mode ${mode}: widget escapes the Wayboard bounds`);
              break;
            }
          }
        }
        const greeting = root.querySelector('.greeting-banner');
        if (getComputedStyle(greeting).display !== 'none') {
          const greetingBox = greeting.getBoundingClientRect();
          if (greetingBox.left < workspace.left - 2 || greetingBox.right > workspace.right + 2
              || greetingBox.top < workspace.top - 2) {
            issues.push(`mode ${mode}: greeting escapes the Wayboard bounds (${Math.round(greetingBox.left)}, ${Math.round(greetingBox.top)}, ${Math.round(greetingBox.right)}, ${Math.round(greetingBox.bottom)}; workspace ${Math.round(workspace.left)}, ${Math.round(workspace.top)}, ${Math.round(workspace.right)}, ${Math.round(workspace.bottom)})`);
          }
        }
      }
      return issues;
    });
    expect(alignmentIssues, `Wayboard alignment at ${viewport.width} × ${viewport.height}`).toEqual([]);
  }
});

test('Profile settings lists all 12 home layout templates', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  const options = page.locator('#settings-home-template option');
  await expect(options).toHaveCount(12);
  // Grouped into three optgroups.
  await expect(page.locator('#settings-home-template optgroup')).toHaveCount(3);
});

test('changing the home layout applies the mode class and persists to localStorage', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await openSettings(page);

  await page.selectOption('#settings-home-template', '7');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-7\b/);

  const stored = await page.evaluate(() => localStorage.getItem('waymark_home_template_mode'));
  expect(stored).toBe('7');
});

test('prev/next cycle buttons change the layout', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await openSettings(page);

  await page.click('#settings-home-template-next');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-2\b/);
  await page.click('#settings-home-template-prev');
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-1\b/);
});

test('saved home layout survives reload (zero-flash from localStorage)', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await page.evaluate(() => localStorage.setItem('waymark_home_template_mode', '9'));

  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-9\b/);
});

test('The Wayside header explains itself and uses consistent section labels', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .wayside-head', { timeout: 5_000 });
  await expect(page.locator('#home-wayside .wayside-head')).toContainText('The Wayside');
  // A tagline clarifies what the Wayside is.
  await expect(page.locator('#home-wayside .wayside-head-tagline')).toContainText('Chat, call & share Waymarks');
  // Section labels are the unified vocabulary (no overlapping puns).
  const labels = await page.locator('#home-wayside .wayside-label').allInnerTexts();
  expect(labels).toContain('CREWS');
  expect(labels).toContain('WAYMARKERS');
});

test('Wayside shows Waymarker Crews from a Contacts Waymark', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });
  await expect(page.locator('#home-wayside .crew-row', { hasText: 'Family Crew' })).toBeVisible();
  await expect(page.locator('#home-wayside .chat-input')).toBeVisible();
  await expect(page.locator('#wayside-call-btn')).toContainText('Call');
});

test('Wayside call button starts WebRTC signaling on the shared ledger and toggles to End Call', async ({ page }) => {
  await setupApp(page, {
    pinnedSheets: [{ id: 'sheet-077', name: 'Waymarker Crews', templateKey: 'contacts', pinnedAt: new Date().toISOString() }],
  });
  await page.waitForSelector('#home-wayside .crew-row', { timeout: 5_000 });

  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call');
  await expect(page.locator('#wayside-sheet-line')).toContainText('In call');

  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toHaveText('📹 Call');
});

test('past share collaborators appear in The Wayside and can be called even without a Contacts Waymark', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#home-wayside', { timeout: 5_000 });

  // Share a document with pastfriend@example.com without any Contacts Waymark sheet
  await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const wayboard = await import('/js/wayboard.js');
    await collab.shareDocumentWithContact({
      contactEmail: 'pastfriend@example.com',
      docId: 'sheet-001',
      docTitle: 'Groceries',
      waymarkType: 'checklist',
      permission: 'writer',
    });
    wayboard.renderWayboard();
  });

  // The past collaborator should appear as an avatar in ONLINE WAYMARKERS
  const avatar = page.locator('#home-wayside .avatar[title*="pastfriend@example.com"]');
  await expect(avatar).toBeVisible({ timeout: 5_000 });

  await avatar.click();
  await expect(page.locator('#wayside-crew-title')).toContainText('Pastfriend');

  // Start a WebRTC call with the past collaborator
  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call');
  await expect(page.locator('#wayside-sheet-line')).toContainText('In call');

  await page.click('#wayside-call-btn');
  await expect(page.locator('#wayside-call-btn')).toHaveText('📹 Call');
});

test('clicking Call on a collaborator notification in the bell starts a Wayside WebRTC call with that collaborator', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('.notif-bell', { timeout: 5_000 });

  await page.evaluate(async () => {
    const collab = await import('/js/collab.js');
    const { api } = await import('/js/api-client.js');
    const { sheetId } = await collab.ensureShareLedger({ contactEmail: 'callbuddy@example.com' });
    await api.sheets.appendRows(sheetId, 'Shared_Docs', [[
      'sheet-001', 'Groceries', 'checklist', 'testuser@gmail.com', '', 'writer', new Date().toISOString(), 'Shared',
    ]]);
    await collab.pollShareLedgers();
  });

  await page.click('.notif-bell');
  await page.waitForSelector('.notif-panel:not(.hidden)', { timeout: 3_000 });
  await page.locator('.notif-call-btn').first().click();

  await expect(page.locator('#wayside-crew-title')).toContainText('callbuddy', { ignoreCase: true });
  await expect(page.locator('#wayside-call-btn')).toContainText('End Call');
  await expect(page.locator('#wayside-sheet-line')).toContainText('In call');

  await page.click('#wayside-call-btn');
});


test('a legacy saved layout mode (13–50) maps to a curated layout', async ({ page }) => {
  // Mode 48 was the retired "Detective Corkboard"; it now resolves to Pinboard (7).
  await page.addInitScript(() => localStorage.setItem('waymark_home_template_mode', '48'));
  await setupApp(page);
  await page.waitForSelector('#wayboard-root', { timeout: 5_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-7\b/);
});
