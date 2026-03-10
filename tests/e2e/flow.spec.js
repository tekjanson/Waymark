// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('login flow detected as Flow Diagram template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-group', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Flow');

  // Check the group header shows the flow name
  await expect(page.locator('.flow-group-title')).toContainText('User Login Flow');

  // Check step count badge
  await expect(page.locator('.flow-group-count')).toContainText('9 steps');
});

test('flow diagram renders SVG with nodes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // SVG should have node groups
  const nodes = page.locator('.flow-node');
  expect(await nodes.count()).toBe(9);

  // Check arrowhead markers exist
  const markers = page.locator('.flow-svg defs marker');
  expect(await markers.count()).toBeGreaterThan(0);
});

test('flow diagram renders edges between nodes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Should have edge groups connecting nodes
  const edges = page.locator('.flow-edge');
  expect(await edges.count()).toBeGreaterThan(0);
});

test('flow step table shows all steps with type badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Expand the collapsible step table
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  // Header row + 9 data rows
  const rows = page.locator('.flow-step-row');
  expect(await rows.count()).toBe(10);

  // Type badges should be present
  const badges = page.locator('.flow-type-badge');
  // 9 in the table + potentially some in the inspector — just check at least 9
  expect(await badges.count()).toBeGreaterThanOrEqual(9);

  // Check specific type badges exist and are visible
  await expect(page.locator('.flow-step-table .flow-type-start').first()).toBeVisible();
  await expect(page.locator('.flow-step-table .flow-type-decision').first()).toBeVisible();
  await expect(page.locator('.flow-step-table .flow-type-end').first()).toBeVisible();
});

test('flow step inline edit commits on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Expand the collapsible step table
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  // Click the first editable step cell (second row, step column)
  const stepCell = page.locator('.flow-step-cell-step.editable-cell').first();
  await stepCell.click();

  // Wait for the input to appear
  const input = await page.waitForSelector('.flow-step-cell-step input.editable-cell-input', { timeout: 3_000 });
  await input.fill('Open Application');
  await input.press('Enter');

  // Verify the edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Open Application')).toBe(true);
});

test('flow step inline edit cancels on Escape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Expand the collapsible step table
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  const stepCell = page.locator('.flow-step-cell-step.editable-cell').first();
  const originalText = await stepCell.textContent();

  await stepCell.click();
  const input = await page.waitForSelector('.flow-step-cell-step input.editable-cell-input', { timeout: 3_000 });
  await input.fill('Something Else');
  await input.press('Escape');

  // Text should revert
  await expect(stepCell).toContainText(originalText || '');
});

test('flow decision nodes have diamond shape in SVG', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Decision nodes should use polygon (diamond shape)
  const decisionNodes = page.locator('.flow-node-decision polygon');
  expect(await decisionNodes.count()).toBeGreaterThan(0);
});

test('flow edge labels render for conditional branches', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Should have edge labels for Yes/No and Valid/Invalid branches
  const edgeLabels = page.locator('.flow-edge-label');
  expect(await edgeLabels.count()).toBeGreaterThan(0);
});

/* ---------- Drag-and-drop reorder (table) ---------- */

test('flow step rows are draggable with drag handles', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Expand table
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  // Each data row (not header) should be draggable
  const draggableRows = page.locator('.flow-step-row[draggable="true"]');
  expect(await draggableRows.count()).toBe(9);

  // Each draggable row should have a drag handle
  const handles = page.locator('.flow-drag-handle');
  expect(await handles.count()).toBe(9);
});

test('flow step row gains dragging class on dragstart', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Expand table
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  const row = page.locator('.flow-step-row[draggable="true"]').first();

  // Dispatch synthetic dragstart
  await row.evaluate(el => {
    const evt = new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() });
    el.dispatchEvent(evt);
  });
  await expect(row).toHaveClass(/flow-step-dragging/);
});

/* ---------- Interactive canvas features ---------- */

test('flow SVG nodes have connection ports', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Each node should have an output port
  const ports = page.locator('.flow-port-out');
  expect(await ports.count()).toBe(9);
});

test('flow clicking SVG node shows inspector panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Inspector should be hidden initially
  await expect(page.locator('.flow-inspector')).toHaveClass(/hidden/);

  // Click on the first node
  await page.locator('.flow-node').first().click();

  // Inspector should appear
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });
  await expect(page.locator('.flow-inspector-title')).toBeVisible();

  // Inspector should have input fields
  const inputs = page.locator('.flow-inspector-input');
  expect(await inputs.count()).toBeGreaterThan(0);
});

test('flow inspector edit commits on blur', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Click on the first node to open inspector
  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  // Edit the step name field
  const nameInput = page.locator('.flow-inspector-input').first();
  await nameInput.fill('Modified Step Name');
  await nameInput.blur();

  // Verify edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Modified Step Name')).toBe(true);
});

test('flow canvas hint is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-canvas-hint', { timeout: 5_000 });

  await expect(page.locator('.flow-canvas-hint')).toBeVisible();
  await expect(page.locator('.flow-canvas-hint')).toContainText('Drag nodes');
});

test('flow table toggle button works', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-table-toggle', { timeout: 5_000 });

  // Table should be hidden by default
  await expect(page.locator('.flow-step-table')).toHaveClass(/hidden/);

  // Click toggle to show
  await page.click('.flow-table-toggle');
  await page.waitForSelector('.flow-step-table:not(.hidden)', { timeout: 3_000 });

  // Click toggle again to hide
  await page.click('.flow-table-toggle');
  await expect(page.locator('.flow-step-table')).toHaveClass(/hidden/);
});

test('flow grid background renders in SVG', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Grid background pattern
  const patterns = page.locator('.flow-svg defs pattern');
  expect(await patterns.count()).toBeGreaterThan(0);
});

/* ---------- Inspector combo dropdown (Next field) ---------- */

test('flow inspector Next field shows combo dropdown with step suggestions', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Click on the first node to open inspector
  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  // The Next field should have a combo wrap with arrow and dropdown
  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  await expect(comboWrap).toBeVisible();

  const arrow = comboWrap.locator('.flow-inspector-combo-arrow');
  await expect(arrow).toBeVisible();

  // Focus the input to open the dropdown
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');
  await comboInput.focus();

  const dropdown = comboWrap.locator('.flow-inspector-combo-dropdown:not(.hidden)');
  await expect(dropdown).toBeVisible();

  // Should list other step names as options
  const options = dropdown.locator('.flow-inspector-combo-option');
  expect(await options.count()).toBeGreaterThan(0);
});

test('flow inspector Next combo selects option from dropdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Click the last node (Done) which has no Next value
  const nodes = page.locator('.flow-node');
  const lastNode = nodes.last();
  await lastNode.click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');

  // Clear and focus to see all options
  await comboInput.fill('');
  const dropdown = comboWrap.locator('.flow-inspector-combo-dropdown:not(.hidden)');
  await expect(dropdown).toBeVisible();

  // Click on the first option
  const firstOption = dropdown.locator('.flow-inspector-combo-option').first();
  const optionText = await firstOption.textContent();
  await firstOption.click();

  // Verify edit record
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === optionText)).toBe(true);
});

test('flow inspector Next combo arrow toggles dropdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');
  const arrow = comboWrap.locator('.flow-inspector-combo-arrow');
  const dropdown = comboWrap.locator('.flow-inspector-combo-dropdown');

  // Focus opens dropdown
  await comboInput.focus();
  await expect(dropdown).not.toHaveClass(/hidden/);

  // Click arrow to close
  await arrow.click();
  await expect(dropdown).toHaveClass(/hidden/);

  // Click arrow again to re-open
  await arrow.click();
  await expect(dropdown).not.toHaveClass(/hidden/);
});

test('flow inspector Next combo filters options when typing', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');
  const dropdown = comboWrap.locator('.flow-inspector-combo-dropdown');

  // Clear to see all options first
  await comboInput.fill('');
  const allCount = await dropdown.locator('.flow-inspector-combo-option').count();
  expect(allCount).toBeGreaterThan(1);

  // Type a non-matching value
  await comboInput.fill('zzz_nonexistent_step');
  const emptyHint = dropdown.locator('.flow-inspector-combo-empty');
  await expect(emptyHint).toBeVisible();
  await expect(emptyHint).toContainText('(new)');
  expect(await dropdown.locator('.flow-inspector-combo-option').count()).toBe(0);

  // Clear to restore all
  await comboInput.fill('');
  expect(await dropdown.locator('.flow-inspector-combo-option').count()).toBe(allCount);
});

test('flow inspector Next combo commits on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Click the last node (Done) which has empty Next
  const nodes = page.locator('.flow-node');
  await nodes.last().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');
  await comboInput.fill('User Opens App');
  await comboInput.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'User Opens App')).toBe(true);
});

test('flow inspector Next combo cancels on Escape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const comboWrap = page.locator('.flow-inspector-combo-wrap');
  const comboInput = comboWrap.locator('.flow-inspector-combo-input');
  const originalValue = await comboInput.inputValue();

  await comboInput.fill('Should Not Save');
  await comboInput.press('Escape');

  // Value should revert
  await expect(comboInput).toHaveValue(originalValue);

  // No edit record for the reverted value
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Should Not Save')).toBe(false);
});

/* ---------- Ghost edge preview ---------- */

test('flow port drag shows ghost label on canvas', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Ghost label should be hidden initially
  const ghostLabel = page.locator('.flow-ghost-label');
  await expect(ghostLabel).toHaveAttribute('visibility', 'hidden');

  // Simulate port mousedown on the first node's output port
  const port = page.locator('.flow-port-out').first();
  const portBox = await port.boundingBox();
  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
  await page.mouse.down();

  // Ghost label should now be visible
  await expect(ghostLabel).toHaveAttribute('visibility', 'visible');
  const labelText = await ghostLabel.evaluate(el => el.textContent);
  expect(labelText).toContain('target');

  // SVG should have connecting class
  await expect(page.locator('.flow-svg')).toHaveClass(/flow-svg-connecting/);

  await page.mouse.up();
  await expect(ghostLabel).toHaveAttribute('visibility', 'hidden');
});

/* ---------- Snap-to-grid ---------- */

test('flow dragged node position snaps to grid', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  const node = page.locator('.flow-node').first();
  const box = await node.boundingBox();

  // Drag the node by an arbitrary amount (13px horizontal)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 13, box.y + box.height / 2 + 7, { steps: 5 });
  await page.mouse.up();

  // Read the transform — should be snapped to grid multiples of 20
  const transform = await node.getAttribute('transform');
  const match = transform.match(/translate\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/);
  expect(match).not.toBeNull();
  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  expect(x % 20).toBe(0);
  expect(y % 20).toBe(0);
});

/* ---------- Keyboard shortcuts ---------- */

test('flow Delete key removes selected node connections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Click first node to select it
  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  // Count edges before
  const edgesBefore = await page.locator('.flow-edge').count();

  // Focus the canvas wrapper and press Delete
  await page.locator('.flow-canvas').first().focus();
  await page.keyboard.press('Delete');

  // Wait for RAF to flush edge re-render
  await page.waitForTimeout(100);

  // Should have fewer edges (at least one removed)
  const edgesAfter = await page.locator('.flow-edge').count();
  expect(edgesAfter).toBeLessThan(edgesBefore);

  // emitEdit should have been called to clear the Next field
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === '')).toBe(true);
});

test('flow Ctrl+Z undoes Delete and restores connections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Select first node
  await page.locator('.flow-node').first().click();
  await page.waitForSelector('.flow-inspector:not(.hidden)', { timeout: 3_000 });

  const edgesBefore = await page.locator('.flow-edge').count();

  // Delete connections
  await page.locator('.flow-canvas').first().focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100); // wait for RAF edge re-render
  const edgesAfterDelete = await page.locator('.flow-edge').count();
  expect(edgesAfterDelete).toBeLessThan(edgesBefore);

  // Undo with Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100); // wait for RAF edge re-render

  // Edges should be restored
  const edgesAfterUndo = await page.locator('.flow-edge').count();
  expect(edgesAfterUndo).toBe(edgesBefore);
});

/* ---------- Minimap ---------- */

test('flow minimap appears for large diagrams (>= 15 nodes)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-031');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Minimap should be present
  const minimap = page.locator('.flow-minimap');
  await expect(minimap).toBeVisible();

  // Minimap should contain an SVG
  const mmSvg = page.locator('.flow-minimap-svg');
  await expect(mmSvg).toBeVisible();

  // Should have a viewport indicator
  const viewport = page.locator('.flow-minimap-viewport');
  expect(await viewport.count()).toBe(1);
});

test('flow minimap does not appear for small diagrams', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // sheet-029 has 9 nodes — minimap should NOT appear
  const minimap = page.locator('.flow-minimap');
  expect(await minimap.count()).toBe(0);
});

test('flow minimap contains node rectangles matching diagram nodes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-031');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Count diagram nodes
  const nodeCount = await page.locator('.flow-node').count();

  // Minimap should have one rect per node
  const mmRects = page.locator('.flow-minimap-svg rect:not(.flow-minimap-viewport)');
  expect(await mmRects.count()).toBe(nodeCount);
});

test('flow diagram-wrap has tabindex for keyboard shortcuts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-canvas', { timeout: 5_000 });

  const wrap = page.locator('.flow-canvas').first();
  await expect(wrap).toHaveAttribute('tabindex', '0');
});

test('flow auto-align button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-group', { timeout: 5_000 });

  const btn = page.locator('.flow-realign-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Auto-Align');
});

test('flow auto-align button re-renders diagram', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });

  // Nodes should exist before and after re-align
  expect(await page.locator('.flow-node').count()).toBe(9);
  await page.locator('.flow-realign-btn').click();

  // After re-align, nodes should still render
  await page.waitForSelector('.flow-svg', { timeout: 5_000 });
  expect(await page.locator('.flow-node').count()).toBe(9);
});

test('flow tooltip appears on node hover', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-node', { timeout: 5_000 });

  const firstNode = page.locator('.flow-node').first();
  await firstNode.hover();

  const tooltip = page.locator('.flow-tooltip:not(.hidden)');
  await expect(tooltip).toBeVisible({ timeout: 3000 });
});

test('flow detail modal opens on double-click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-node', { timeout: 5_000 });

  const firstNode = page.locator('.flow-node').first();
  await firstNode.dblclick();

  const modal = page.locator('.flow-detail-modal:not(.hidden)');
  await expect(modal).toBeVisible({ timeout: 3000 });
  await expect(modal.locator('.flow-detail-title')).not.toBeEmpty();
});

test('flow detail modal close button works', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-node', { timeout: 5_000 });

  await page.locator('.flow-node').first().dblclick();
  await page.waitForSelector('.flow-detail-modal:not(.hidden)', { timeout: 3000 });

  await page.locator('.flow-detail-close').click();
  await expect(page.locator('.flow-detail-modal.hidden')).toHaveCount(1);
});

test('flow layered layout positions decision branches horizontally', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-node', { timeout: 5_000 });

  // The layout should produce nodes at varying X positions (not all stacked at centerX)
  const transforms = await page.locator('.flow-node').evaluateAll(els =>
    els.map(el => el.getAttribute('transform'))
  );
  const xs = transforms.map(t => parseFloat(t.match(/translate\(([\d.]+)/)?.[1] || '0'));
  const uniqueXs = new Set(xs);
  // With hierarchical layout, decision branches should produce multiple X positions
  expect(uniqueXs.size).toBeGreaterThanOrEqual(2);
});

test('flow positions persist across re-renders via localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-029');
  await page.waitForSelector('.flow-node', { timeout: 5_000 });

  // Check localStorage for saved positions or drag a node to trigger save
  const firstNode = page.locator('.flow-node').first();
  const box = await firstNode.boundingBox();
  if (box) {
    // Drag node to new position
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();

    // Give localStorage time to save
    await page.waitForTimeout(500);

    // Check that localStorage has flow positions
    const stored = await page.evaluate(() => localStorage.getItem('waymark:flow-positions'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored);
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  }
});
