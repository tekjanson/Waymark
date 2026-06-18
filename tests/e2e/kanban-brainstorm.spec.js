const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils.js');

test('brainstorm toggle button appears in kanban toolbar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await expect(brainstormBtn).toBeVisible();
  expect(await brainstormBtn.textContent()).toContain('💭 Brainstorm');
});

test('clicking brainstorm button enters brainstorm mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Should show brainstorm view instead of board
  const brainstormView = page.locator('.kanban-brainstorm-view');
  await expect(brainstormView).toBeVisible();
  
  // Should show title
  const title = page.locator('.kanban-brainstorm-title');
  await expect(title).toContainText('💭 Brainstorm Mode');
});

test('brainstorm mode shows empty state when no ideas exist', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  const emptyState = page.locator('.kanban-brainstorm-empty');
  await expect(emptyState).toContainText('No ideas yet');
});

test('new idea button allows creating an idea', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  page.once('dialog', dialog => {
    dialog.accept('New Feature Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Should show idea card in grid
  const ideaCard = page.locator('.kanban-idea-card');
  await expect(ideaCard).toBeVisible();
  await expect(ideaCard).toContainText('New Feature Idea');
});

test('idea card shows discussion count badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create an idea
  page.once('dialog', dialog => {
    dialog.accept('Test Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Check for discussion badge showing 0 messages
  const badge = page.locator('.kanban-idea-discuss-badge');
  await expect(badge).toContainText('💬 0 message');
});

test('expanding idea opens discussion panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Expandable Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Click expand button
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Should show discussion panel
  const panel = page.locator('.kanban-idea-discussion-panel');
  await expect(panel).toBeVisible();
  
  // Should show panel title with idea name
  const panelTitle = page.locator('.kanban-idea-panel-title');
  await expect(panelTitle).toContainText('Expandable Idea');
});

test('discussion panel allows adding discussion entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Test Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand to discussion
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Add discussion entry
  const discussInput = page.locator('.kanban-idea-discuss-input');
  await discussInput.fill('This is a great idea!');
  
  const addBtn = page.locator('.kanban-idea-discuss-btn');
  await addBtn.click();
  
  // Check discussion entry appears
  const entry = page.locator('.kanban-idea-discussion-entry');
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('This is a great idea!');
});

test('idea description can be edited in discussion panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Test Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand to discussion
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Edit description
  const descArea = page.locator('.kanban-idea-desc-textarea');
  await descArea.fill('This is a detailed description of our idea.');
  await descArea.blur();
  
  // Verify description field has content
  await expect(descArea).toHaveValue('This is a detailed description of our idea.');
});

test('mark refined button changes idea status', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Refined Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand to discussion
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Check initial status
  const statusIndicator = page.locator('.kanban-idea-status-indicator');
  await expect(statusIndicator).toContainText('🔄 Brainstorm');
  
  // Click mark refined
  const refineBtn = page.locator('.kanban-idea-refine-btn');
  await refineBtn.click();
  
  // Status should update
  await expect(statusIndicator).toContainText('✓ Refined');
  await expect(statusIndicator).toHaveClass(/refined/);
});

test('refined idea shows convert to task button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Task Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Convert button should not be visible yet
  let convertBtn = page.locator('.kanban-idea-convert-btn');
  await expect(convertBtn).not.toBeVisible();
  
  // Mark as refined
  const refineBtn = page.locator('.kanban-idea-refine-btn');
  await refineBtn.click();
  
  // Now convert button should appear
  convertBtn = page.locator('.kanban-idea-convert-btn');
  await expect(convertBtn).toBeVisible();
});

test('delete button removes an idea', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Deletable Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Click delete and confirm
  page.once('dialog', dialog => {
    dialog.accept();
  });
  
  const deleteBtn = page.locator('.kanban-idea-delete-btn');
  await deleteBtn.click();
  
  // Should be back at empty grid view
  const emptyState = page.locator('.kanban-brainstorm-empty');
  await expect(emptyState).toBeVisible();
});

test('back button returns to ideas grid from discussion panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Grid Return Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  // Expand
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Verify we're in discussion panel
  const panel = page.locator('.kanban-idea-discussion-panel');
  await expect(panel).toBeVisible();
  
  // Click back button
  const backBtn = page.locator('.kanban-idea-back-btn');
  await backBtn.click();
  
  // Should be back at grid
  const grid = page.locator('.kanban-ideas-grid');
  await expect(grid).toBeVisible();
  
  // Panel should be hidden
  await expect(panel).not.toBeVisible();
});

test('brainstorm button toggle returns to board view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  
  // Enter brainstorm mode
  await brainstormBtn.click();
  const brainstormView = page.locator('.kanban-brainstorm-view');
  await expect(brainstormView).toBeVisible();
  
  // Exit brainstorm mode
  await brainstormBtn.click();
  
  // Should be back to board
  const board = page.locator('.kanban-board');
  await expect(board).toBeVisible();
  
  // Brainstorm view should be hidden
  await expect(brainstormView).not.toBeVisible();
});

test('discussion entry shows author and timestamp', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create and expand idea
  page.once('dialog', dialog => {
    dialog.accept('Timestamp Test Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Add discussion
  const discussInput = page.locator('.kanban-idea-discuss-input');
  await discussInput.fill('Discussion with metadata');
  
  const addBtn = page.locator('.kanban-idea-discuss-btn');
  await addBtn.click();
  
  // Check for entry header with author and time
  const entryHeader = page.locator('.kanban-idea-entry-header');
  await expect(entryHeader).toBeVisible();
  
  const entryContent = page.locator('.kanban-idea-entry-content');
  await expect(entryContent).toContainText('Discussion with metadata');
});

test('multiple discussion entries display in thread', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  await brainstormBtn.click();
  
  // Create idea
  page.once('dialog', dialog => {
    dialog.accept('Multi-discussion Idea');
  });
  
  const newIdeaBtn = page.locator('.kanban-new-idea-btn');
  await newIdeaBtn.click();
  
  const expandBtn = page.locator('.kanban-idea-expand-btn');
  await expandBtn.click();
  
  // Add multiple discussions
  const discussInput = page.locator('.kanban-idea-discuss-input');
  const addBtn = page.locator('.kanban-idea-discuss-btn');
  
  await discussInput.fill('First discussion point');
  await addBtn.click();
  
  await discussInput.fill('Second discussion point');
  await addBtn.click();
  
  // Check both entries are visible
  const entries = page.locator('.kanban-idea-discussion-entry');
  expect(await entries.count()).toBe(2);
});

test('brainstorm button has active class when in brainstorm mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  
  const brainstormBtn = page.locator('.kanban-brainstorm-toggle');
  
  // Initially not active
  await expect(brainstormBtn).not.toHaveClass(/active/);
  
  // Enter brainstorm mode
  await brainstormBtn.click();
  
  // Should be active
  await expect(brainstormBtn).toHaveClass(/active/);
  
  // Exit brainstorm mode
  await brainstormBtn.click();
  
  // Should not be active
  await expect(brainstormBtn).not.toHaveClass(/active/);
});
