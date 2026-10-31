// @ts-check
/**
 * wayboard.spec.js — Unified Wayboard home, 50 layout architectures,
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

test('Quick marks can be selected and reordered inside their own widget', async ({ page }) => {
  await setupApp(page);
  const quickmarks = page.locator('.wayboard-widget-quickmarks');
  await expect(quickmarks.locator('.home-action-card')).toHaveCount(4);
  await quickmarks.getByRole('button', { name: 'Edit Quick marks' }).click();

  const options = page.locator('.wayboard-widget-quickmark-options');
  await expect(options.locator('input[type="checkbox"]')).toHaveCount(4);
  await options.locator('input[value="import"]').uncheck();
  await options.locator('input[value="browse"]').uncheck();
  const moveGuidesEarlier = options.getByRole('button', { name: 'Move Waymark guides earlier' });
  await moveGuidesEarlier.click();
  await moveGuidesEarlier.click();
  await moveGuidesEarlier.click();
  await page.locator('.wayboard-widget-form button[type="submit"]').click();

  await expect(quickmarks.locator('.home-action-label')).toHaveText(['Waymark guides', 'New Waymark']);
  await page.locator('.wayboard-widget-dialog-header .btn-icon').click();
  await page.locator('#home-action-create').click();
  await expect(page.locator('#create-sheet-modal')).toBeVisible();
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

test('home templates retain their defining layouts with user widgets enabled', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  const layouts = await page.evaluate(() => {
    const noTransitions = document.createElement('style');
    noTransitions.textContent = '#wayboard-root, #wayboard-root * { transition: none !important; }';
    document.head.append(noTransitions);
    const root = document.getElementById('wayboard-root');
    const read = mode => {
      root.className = `wayboard-root mode-${mode}`;
      const grid = getComputedStyle(root.querySelector('.wayboard-grid'));
      const section = getComputedStyle(root.querySelector('.wayboard-section'));
      const widget = getComputedStyle(root.querySelector('.wayboard-widget'));
      const greeting = getComputedStyle(root.querySelector('.greeting-banner'));
      const quickmarks = root.querySelector('.wayboard-widget-quickmarks');
      const quickmarkStyle = getComputedStyle(quickmarks);
      const markRow = getComputedStyle(quickmarks.querySelector('.markers-row'));
      const markAction = getComputedStyle(quickmarks.querySelector('.marker-card'));
      return {
        gridDisplay: grid.display,
        gridWrap: grid.flexWrap,
        sectionPosition: section.position,
        widgetPosition: widget.position,
        greetingPosition: greeting.position,
        greetingBorder: greeting.borderBottomStyle,
        quickmarkDisplay: quickmarkStyle.display,
        quickmarkRowDisplay: markRow.display,
        quickmarkRadius: markAction.borderRadius,
        quickmarkIconHeight: getComputedStyle(quickmarks.querySelector('.marker-thumb')).height,
        quickmarkBackground: quickmarkStyle.backgroundColor,
        quickmarkTopBorder: quickmarkStyle.borderTopWidth,
        quickmarkBottomBorder: quickmarkStyle.borderBottomWidth,
        quickmarkAfter: getComputedStyle(quickmarks, '::after').content,
        quickmarkLeftBorder: quickmarkStyle.borderLeftWidth,
      };
    };
    return {
      bento: read(2),
      prompt: read(13),
      stage: read(14),
      orbit: read(15),
      windows: read(19),
      accordion: read(35),
      compass: read(38),
      telemetry: read(49),
      tavern: read(16),
      gallery: read(12),
      corkboard: read(48),
      notebook: read(41),
      pipeline: read(31),
      allModes: Array.from({ length: 50 }, (_, index) => read(index + 1)),
    };
  });

  expect(layouts.bento.greetingBorder).toBe('solid');
  expect(layouts.prompt.gridDisplay).toBe('flex');
  expect(layouts.stage.widgetPosition).toBe('relative');
  expect(layouts.orbit.gridWrap).toBe('wrap');
  expect(layouts.windows.sectionPosition).toBe('absolute');
  expect(layouts.accordion.gridWrap).toBe('wrap');
  expect(layouts.compass.greetingPosition).toBe('relative');
  expect(layouts.telemetry.gridDisplay).toBe('grid');
  expect(layouts.tavern.quickmarkAfter).toContain('WAYMARK PARTY');
  expect(layouts.gallery.quickmarkIconHeight).toBe('85px');
  expect(layouts.corkboard.quickmarkBackground).toBe('rgb(250, 248, 245)');
  expect(layouts.corkboard.quickmarkBottomBorder).toBe('24px');
  expect(layouts.notebook.quickmarkLeftBorder).toBe('5px');
  expect(layouts.pipeline.quickmarkTopBorder).toBe('18px');
  expect(layouts.allModes).toHaveLength(50);
  expect(layouts.allModes.every(layout => layout.quickmarkDisplay !== 'none' && layout.quickmarkRowDisplay !== 'none')).toBe(true);
  expect(new Set(layouts.allModes.map(layout => `${layout.gridDisplay}:${layout.quickmarkRowDisplay}:${layout.quickmarkRadius}:${layout.quickmarkBackground}:${layout.quickmarkBottomBorder}`)).size).toBeGreaterThan(10);
});

test('all 50 layouts keep quick marks and greetings aligned at desktop and phone widths', async ({ page }) => {
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
      for (let mode = 1; mode <= 50; mode++) {
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

test('Profile settings lists all 50 home layout templates', async ({ page }) => {
  await setupApp(page);
  await openSettings(page);

  const options = page.locator('#settings-home-template option');
  await expect(options).toHaveCount(50);
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
  await page.evaluate(() => localStorage.setItem('waymark_home_template_mode', '23'));

  await page.reload();
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#wayboard-root')).toHaveClass(/\bmode-23\b/);
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

