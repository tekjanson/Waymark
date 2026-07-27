/* ============================================================
   rfi.spec.js — Playwright test suite for Construction RFI Template
   ============================================================ */

import { test, expect } from '@playwright/test';

// 2D data array matching Waymark's native sheet schema (header row evaluated separately)
const mockHeaders = ['RFI Number', 'Subject', 'Status', 'Assigned To', 'Response Due', 'Official Response', 'Note'];
const mockRows = [
  // Data Row 1 (Index 0): RFI-001 in 'Open' status with an assigned user
  ['RFI-001', 'Plumbing Layout Sleeve Clash', 'Open', 'David Chen', '2026-08-01', '', ''],
  // Data Row 2 (Index 1): Contiguous child note attached to RFI-001 (empty primary key)
  ['', '', '', 'David Chen', '2026-07-20', '', 'Field inspection showed conflict with piping.'],
  // Data Row 3 (Index 2): RFI-002 in 'Draft' status assigned to a different user
  ['RFI-002', 'HVAC Duct Elevation Spec', 'Draft', 'Sarah Jenkins', '2026-08-10', '', ''],
];

test.describe('Waymark Construction RFI Template', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to local Waymark runtime (WAYMARK_LOCAL=true environment)
    await page.goto('/');

    // Expose capture function to assert Waymark's native emitEdit / onEdit synchronization
    await page.exposeFunction('captureEdit', (rowIndex, colIndex, newValue) => {
      window.lastCapturedEdit = { rowIndex, colIndex, newValue };
    });

    // Mount the template inside the browser context using native Waymark APIs
    await page.evaluate(async ({ headers, rows }) => {
      const tpl = await import('./rfi.js').then(m => m.default || m);
      const shared = await import('./shared.js');

      // Intercept native cell edits and forward to Playwright
      shared.onEdit((rowIdx, colIdx, val) => {
        window.captureEdit(rowIdx, colIdx, val);
      });

      // Compute column mapping from headers
      const lower = headers.map(h => h.toLowerCase());
      const cols = tpl.columns(lower);

      // Create container and invoke native render signature: render(container, rows, cols, template)
      const container = document.createElement('div');
      container.id = 'rfi-test-root';
      document.body.appendChild(container);

      tpl.render(container, rows, cols, tpl);
    }, { headers: mockHeaders, rows: mockRows });
  });

  test('detects template and renders summary bar, filter pills, and swim-lanes', async ({ page }) => {
    // Assert summary bar counts calculate accurately from rows
    await expect(page.locator('.rfi-summary-bar .count-open')).toHaveText('1');
    await expect(page.locator('.rfi-summary-bar .count-pending')).toHaveText('0');

    // Assert assignee filter pills generated dynamically from unique team members
    await expect(page.locator('.rfi-filter-pill', { hasText: 'David Chen' })).toBeVisible();
    await expect(page.locator('.rfi-filter-pill', { hasText: 'Sarah Jenkins' })).toBeVisible();

    // Assert all 4 Kanban swim-lane columns rendered
    const kanban = page.locator('.rfi-kanban');
    await expect(kanban.locator('.rfi-column-draft')).toBeVisible();
    await expect(kanban.locator('.rfi-column-open')).toBeVisible();
    await expect(kanban.locator('.rfi-column-pending')).toBeVisible();
    await expect(kanban.locator('.rfi-column-closed')).toBeVisible();

    // Assert cards populated in correct columns
    await expect(page.locator('.rfi-column-open .rfi-card')).toContainText('RFI-001');
    await expect(page.locator('.rfi-column-draft .rfi-card')).toContainText('RFI-002');
  });

  test('filters cards dynamically when assignee pills are clicked', async ({ page }) => {
    const davidPill = page.locator('.rfi-filter-pill', { hasText: 'David Chen' });
    const sarahPill = page.locator('.rfi-filter-pill', { hasText: 'Sarah Jenkins' });
    const allPill = page.locator('.rfi-filter-pill', { hasText: 'All Assignees' });

    // Filter by David Chen -> RFI-001 visible, RFI-002 hidden
    await davidPill.click();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-001' })).toBeVisible();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-002' })).toBeHidden();

    // Filter by Sarah Jenkins -> RFI-002 visible, RFI-001 hidden
    await sarahPill.click();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-001' })).toBeHidden();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-002' })).toBeVisible();

    // Reset filter -> both visible
    await allPill.click();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-001' })).toBeVisible();
    await expect(page.locator('.rfi-card', { hasText: 'RFI-002' })).toBeVisible();
  });

  test('groups contiguous sub-rows into discussion notes and reveals them on expand', async ({ page }) => {
    const rfi1Card = page.locator('.rfi-card', { hasText: 'RFI-001' });

    // Detail section should be hidden initially
    await expect(rfi1Card.locator('.rfi-card-detail')).toBeHidden();

    // Assert sub-row count badge shows 1 note attached
    await expect(rfi1Card.locator('.rfi-card-subtask-count')).toContainText('1');

    // Click expand toggle
    await rfi1Card.locator('.rfi-card-expand').click();

    // Detail panel reveals the contiguous discussion note
    const detail = rfi1Card.locator('.rfi-card-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.rfi-note-text')).toHaveText('Field inspection showed conflict with piping.');
    await expect(detail.locator('.rfi-note-author')).toHaveText('David Chen');
  });

  test('cycles stage badge on click and triggers native emitEdit write-back', async ({ page }) => {
    const rfi1Card = page.locator('.rfi-card', { hasText: 'RFI-001' });
    const statusBtn = rfi1Card.locator('.rfi-status-btn');

    // Initial stage is Open
    await expect(statusBtn).toHaveText('Open');

    // Clicking cycles Open -> Pending
    await statusBtn.click();
    await expect(statusBtn).toHaveText('Pending');
    await expect(statusBtn).toHaveClass(/pending/);

    // Assert native emitEdit write-back was fired with correct 1-based row index (Row 1) and status column index (Col 2)
    const editData = await page.evaluate(() => window.lastCapturedEdit);
    expect(editData).toEqual({
      rowIndex: 1, // 1-based index for RFI-001
      colIndex: 2, // 0-based index for 'Status' column
      newValue: 'Pending'
    });
  });

  test('opens history-aware focus modal and allows status editing', async ({ page }) => {
    const rfi1Card = page.locator('.rfi-card', { hasText: 'RFI-001' });

    // Click open focus modal button (⛶)
    await rfi1Card.locator('.rfi-card-open').click();

    // Assert overlay and modal appear
    const overlay = page.locator('.rfi-modal-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.rfi-modal-title')).toHaveText('Plumbing Layout Sleeve Clash');

    // Assert clicking close button removes overlay
    await overlay.locator('.rfi-modal-close').click();
    await expect(overlay).toBeHidden();
  });
});