// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, setupPublicApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ============================================================
   linker.spec.js — Community Linker & Knowledge Graph E2E tests
   Fixtures:
     - sheet-058 → linker-community.json (14 entries)
     - sheet-080 → linker-knowledge-graph.json (Knowledge Graph)
     - sheet-081 → linker-federated-subgraph.json (Federated Sub-Graph)
   ============================================================ */

/* ---------- Detection ---------- */

test('linker detected from Name/Link/Type headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-grid', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Linker');
});

test('linker detected and rendered for Knowledge Graph sheet-080', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-graph-svg', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Linker');
  await expect(page.locator('.linker-graph-node')).toHaveCount(6);
});

/* ---------- Card Rendering ---------- */

test('linker renders all 14 entries as cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const cards = page.locator('.linker-card');
  expect(await cards.count()).toBe(14);
});

test('linker card shows name and description', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const firstCard = page.locator('.linker-card').first();
  await expect(firstCard.locator('.linker-card-name')).toContainText('Cooking & Recipes');
  await expect(firstCard.locator('.linker-card-desc')).toContainText('community hub for home cooks');
});

test('linker card shows icon', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const firstIcon = page.locator('.linker-card-icon').first();
  await expect(firstIcon).toContainText('🍳');
});

/* ---------- Type Badges ---------- */

test('linker shows Directory badge for linker-type entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const firstBadge = page.locator('.linker-card').first().locator('.linker-card-type');
  await expect(firstBadge).toContainText('Directory');
  await expect(firstBadge).toHaveClass(/linker-type-directory/);
});

test('linker shows Waymark badge for waymark-type entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const mimi = page.locator('.linker-card').nth(2);
  await expect(mimi.locator('.linker-card-type')).toContainText('Waymark');
  await expect(mimi.locator('.linker-card-type')).toHaveClass(/linker-type-waymark/);
});

/* ---------- Tags ---------- */

test('linker renders tag chips', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const firstTags = page.locator('.linker-card').first().locator('.linker-tag');
  expect(await firstTags.count()).toBe(3);
  const tagTexts = await firstTags.allTextContents();
  expect(tagTexts).toContain('cooking');
  expect(tagTexts).toContain('food');
  expect(tagTexts).toContain('recipes');
});

/* ---------- Search / Filter ---------- */

test('linker search filters cards by name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('Mimi');
  const visibleCards = page.locator('.linker-card:not(.hidden)');
  expect(await visibleCards.count()).toBe(1);
  await expect(visibleCards.first().locator('.linker-card-name')).toContainText("Mimi's Kitchen");
});

test('linker search filters by tags', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('fitness');
  const visibleCards = page.locator('.linker-card:not(.hidden)');
  expect(await visibleCards.count()).toBe(1);
  await expect(visibleCards.first().locator('.linker-card-name')).toContainText('Fitness Tracker');
});

test('linker search shows empty message when no matches', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('zzzznonexistent');
  const emptyMsg = page.locator('.linker-empty-filter');
  await expect(emptyMsg).toBeVisible();
  await expect(emptyMsg).toContainText('No entries matching');
});

test('linker search clears filter when input emptied', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });

  const search = page.locator('.linker-search');
  await search.fill('Mimi');
  expect(await page.locator('.linker-card:not(.hidden)').count()).toBe(1);
  await search.fill('');
  expect(await page.locator('.linker-card:not(.hidden)').count()).toBe(14);
});

/* ---------- Card Click Navigation ---------- */

test('linker card click navigates to #/sheet/{id} in auth mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  await page.locator('.linker-card').first().locator('.linker-card-header').click();
  await expect(page).toHaveURL(/#\/sheet\/sheet-059/);
});

test('linker card click navigates to #/public/{id} in public mode', async ({ page }) => {
  await setupPublicApp(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  await page.locator('.linker-card').first().click();
  await expect(page).toHaveURL(/#\/public\/sheet-059/);
});

/* ---------- Directory View ---------- */

test('linker directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-linker/Waymark%20Community%20Hub'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('linker directoryView renders folder cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-linker/Waymark%20Community%20Hub'; });
  await page.waitForSelector('.linker-directory', { timeout: 8_000 });
  await expect(page.locator('.linker-dir-title')).toContainText('Community Linkers');
});

/* ---------- Security ---------- */

test('linker rejects external URLs and shows warning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const blogCard = page.locator('.linker-card', { hasText: 'External Blog' });
  await expect(blogCard.locator('.linker-card-warning')).toContainText('Not a valid Waymark link');
  await expect(blogCard).toHaveClass(/linker-card-invalid/);
});

test('linker rejects javascript: URI and shows warning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const malCard = page.locator('.linker-card', { hasText: 'Sneaky Script' });
  await expect(malCard.locator('.linker-card-warning')).toContainText('Not a valid Waymark link');
  await expect(malCard).toHaveClass(/linker-card-invalid/);
});

test('linker accepts full Waymark URL and extracts sheet ID', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const socialCard = page.locator('.linker-card', { hasText: 'Social Hub' });
  await expect(socialCard.locator('.linker-card-warning')).toHaveCount(0);
  await expect(socialCard).not.toHaveClass(/linker-card-invalid/);
});

test('linker invalid card click does not navigate', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const currentUrl = page.url();
  await page.locator('.linker-card', { hasText: 'External Blog' }).click();
  expect(page.url()).toBe(currentUrl);
});

/* ---------- Folder Links ---------- */

test('linker accepts folder hash route and shows no warning', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  const folderCard = page.locator('.linker-card', { hasText: 'Knowledge Folder' });
  await expect(folderCard.locator('.linker-card-warning')).toHaveCount(0);
  await expect(folderCard).not.toHaveClass(/linker-card-invalid/);
});

test('linker folder card click navigates to #/folder/{id}', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  await page.locator('.linker-card', { hasText: 'Knowledge Folder' }).locator('.linker-card-header').click();
  await expect(page).toHaveURL(/#\/folder\/1SUmmTO4n2Hyuat_oHbt7nrv_6U-FoniC/);
});

test('linker folder card click uses #/public/ in public mode', async ({ page }) => {
  await setupPublicApp(page, 'sheet-058');
  await page.waitForSelector('.linker-card', { timeout: 5_000 });
  await page.locator('.linker-card', { hasText: 'Knowledge Folder' }).click();
  await expect(page).toHaveURL(/#\/public\/1SUmmTO4n2Hyuat_oHbt7nrv_6U-FoniC/);
});

/* ---------- Knowledge Graph, Tree Explorer, Federation & Synthetic Understanding ---------- */

test('knowledge graph renders SVG nodes, directed edges, and synthetic understanding callouts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-graph-svg', { timeout: 5_000 });

  await expect(page.locator('.linker-stat-nodes .linker-stat-value')).toHaveText('6');
  const edgeCount = await page.locator('.linker-graph-edge').count();
  expect(edgeCount).toBeGreaterThanOrEqual(7);

  // Cards render synthesis callout and relation pills
  const firstCard = page.locator('.linker-card').first();
  await expect(firstCard.locator('.linker-card-synthesis')).toContainText('Central knowledge hub');
  await expect(firstCard.locator('.linker-relation-pill').first()).toContainText('federates → Waymark Dev Board');
});

test('selecting a node in the Knowledge Graph updates the Synthetic Understanding Inspector', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-graph-node', { timeout: 5_000 });

  // Click the "Mimi's Kitchen" graph node
  const mimiNode = page.locator('.linker-graph-node[data-node-key="mimi\'s kitchen"]');
  await mimiNode.click();

  await expect(page.locator('.linker-inspector-title')).toContainText("Mimi's Kitchen");
  await expect(page.locator('.linker-inspector-synthesis')).toContainText('Curated allergen-free recipe collection');
  await expect(page.locator('.linker-inspector-rel-item').first()).toContainText('Weekly Meal Plan');
});

test('clicking a connected relationship in the Inspector hops focus to the target node', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-inspector-rel-item', { timeout: 5_000 });

  // First node is "AI Engineering Graph", which connects to "Waymark Dev Board"
  const relItem = page.locator('.linker-inspector-rel-item[data-target-key="waymark dev board"]');
  await relItem.click();

  await expect(page.locator('.linker-inspector-title')).toContainText('Waymark Dev Board');
  await expect(page.locator('.linker-inspector-synthesis')).toContainText('Core engineering workboard');
});

test('inline editing Synthetic Understanding in Inspector emits cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-inspector-synthesis-edit', { timeout: 5_000 });

  await page.click('.linker-inspector-synthesis-edit');
  const editor = await page.waitForSelector('.linker-inspector-synthesis-edit input, .linker-inspector-synthesis-edit textarea', { timeout: 5_000 });
  await editor.fill('Updated synthetic understanding across federated engineering boards.');
  await editor.evaluate(el => el.blur());

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value.includes('Updated synthetic understanding'))).toBe(true);
});

test('linker tree renders hierarchical branches and supports collapse/expand', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-tree-row', { timeout: 5_000 });

  const initialRows = await page.locator('.linker-tree-row:visible').count();
  expect(initialRows).toBeGreaterThanOrEqual(4);

  // Collapse the root branch
  const firstToggle = page.locator('.linker-tree-toggle').first();
  await firstToggle.click();
  const collapsedRows = await page.locator('.linker-tree-row:visible').count();
  expect(collapsedRows).toBeLessThan(initialRows);

  // Expand it back
  await firstToggle.click();
  expect(await page.locator('.linker-tree-row:visible').count()).toBe(initialRows);
});

test('view mode switcher toggles between Explore All, Knowledge Graph, Linker Tree, and Cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-view-switcher', { timeout: 5_000 });

  await page.click('.linker-view-btn[data-view="graph"]');
  await expect(page.locator('.linker-graph-panel')).toBeVisible();
  await expect(page.locator('.linker-tree-panel')).toBeHidden();
  await expect(page.locator('.linker-grid')).toBeHidden();

  await page.click('.linker-view-btn[data-view="tree"]');
  await expect(page.locator('.linker-tree-panel')).toBeVisible();
  await expect(page.locator('.linker-graph-panel')).toBeHidden();

  await page.click('.linker-view-btn[data-view="cards"]');
  await expect(page.locator('.linker-grid')).toBeVisible();
  await expect(page.locator('.linker-explorer')).toBeHidden();

  await page.click('.linker-view-btn[data-view="split"]');
  await expect(page.locator('.linker-graph-panel')).toBeVisible();
  await expect(page.locator('.linker-tree-panel')).toBeVisible();
  await expect(page.locator('.linker-grid')).toBeVisible();
});

test('cross-sheet federation merges remote sub-graph sheet-081 into Knowledge Graph and Tree', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-federate-btn', { timeout: 5_000 });

  expect(await page.locator('.linker-graph-node').count()).toBe(6);

  // Click Federate on "AI Engineering Graph" (which links to sheet-081)
  await page.locator('.linker-federate-btn[data-sheet-id="sheet-081"]').click();
  await page.waitForSelector('.linker-federated-tray:not(.hidden)', { timeout: 5_000 });

  // 3 nodes from sheet-081 (Agent Registry Hub, IoT Sensor Fleet, WebRTC Signaling Mesh) should now be federated
  expect(await page.locator('.linker-graph-node').count()).toBe(9);
  expect(await page.locator('.linker-federated-card').count()).toBe(3);
  await expect(page.locator('.linker-federation-status')).toContainText('Federated: 1 sheet (+3 nodes)');

  // Selecting a federated node in the tray loads its synthetic understanding in the Inspector
  await page.locator('.linker-federated-card', { hasText: 'WebRTC Signaling Mesh' }).click();
  await expect(page.locator('.linker-inspector-title')).toContainText('WebRTC Signaling Mesh');
  await expect(page.locator('.linker-inspector-provenance')).toContainText('Federated from Platform Architecture Sub-Graph');
  await expect(page.locator('.linker-inspector-synthesis')).toContainText('Serverless peer-to-peer data channels');
});

test('source data click-through from Inspector navigates to target Waymark sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-080');
  await page.waitForSelector('.linker-source-link', { timeout: 5_000 });

  // Select "Waymark Dev Board" (sheet-028) and click Open Source Data in Inspector
  await page.locator('.linker-graph-node[data-node-key="waymark dev board"]').click();
  await page.locator('.linker-source-link').click();
  await expect(page).toHaveURL(/#\/sheet\/sheet-028/);
});
