import { test, expect } from '@playwright/test';

// Mock schema based on Waymark's data abstraction
const mockSheetData = {
  headers: ["RFI Number", "Subject", "Status", "Assigned To", "Response Due", "Official Response"],
  rows: [
    { rowIndex: 2, "RFI Number": "RFI-001", "Subject": "Plumbing Layout", "Status": "Open", "Assigned To": "John Doe", "Response Due": "2026-08-01", "Official Response": "" }
  ]
};

test.describe('Waymark Construction RFI Template', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to local Waymark instance (WAYMARK_LOCAL=true environment)
    await page.goto('/');

    // Expose a capture function to test Waymark's writeBack callback
    await page.exposeFunction('captureWriteBack', (rowIndex, colName, newValue) => {
      window.lastCapturedWriteBack = { rowIndex, colName, newValue };
    });

    // Mount the template with our mock data
    await page.evaluate(async (data) => {
      // Import the template (Assuming the test server serves the raw ES Modules)
      const module = await import('./rfi.js');
      
      // In Waymark, registerTemplate populates a global array or object. 
      // We assume window.__WAYMARK_TEMPLATES__ holds the registered modules.
      const tpl = window.__WAYMARK_TEMPLATES__.find(t => t.name === 'Construction RFI');
      
      // Create a mock writeBack that forwards to our exposed Playwright function
      const mockWriteBack = (row, col, val) => window.captureWriteBack(row, col, val);
      
      const el = tpl.render(data, mockWriteBack);
      document.body.appendChild(el);
    }, mockSheetData);
  });

  test('detects template and renders summary bar and kanban lanes', async ({ page }) => {
    await expect(page.locator('.rfi-summary-bar')).toBeVisible();
    await expect(page.locator('.rfi-kanban')).toBeVisible();
    
    // Verify specific columns rendered
    await expect(page.locator('.rfi-column').filter({ hasText: 'Open' })).toBeVisible();
    await expect(page.locator('.rfi-column').filter({ hasText: 'Pending' })).toBeVisible();
    
    // Verify standard text searchability works on DOM nodes
    await expect(page.locator('.rfi-card')).toContainText('RFI-001');
    await expect(page.locator('.rfi-card')).toContainText('Plumbing Layout');
  });

  test('cycles status through swim-lanes and calls writeBack on click', async ({ page }) => {
    const statusBtn = page.locator('.rfi-card .rfi-status-btn');
    
    // Initial state is "Open"
    await expect(statusBtn).toHaveText('Open');
    
    // Click to cycle status (Open -> Pending)
    await statusBtn.click();
    
    // Assert DOM updated visually
    await expect(statusBtn).toHaveText('Pending');
    await expect(statusBtn).toHaveClass(/pending/);
    
    // Assert the card physically moved to the Pending column
    const pendingColumn = page.locator('.rfi-column').filter({ hasText: 'Pending' });
    await expect(pendingColumn.locator('.rfi-card')).toContainText('RFI-001');

    // Assert writeBack was fired with the correct parameters
    const writeBackData = await page.evaluate(() => window.lastCapturedWriteBack);
    expect(writeBackData).toEqual({
      rowIndex: 2,
      colName: 'Status',
      newValue: 'Pending'
    });
  });

  test('calls writeBack when Official Response textarea loses focus', async ({ page }) => {
    const textarea = page.locator('.rfi-card textarea');
    
    // Simulate user editing
    await textarea.fill('Approved pending structural review.');
    await textarea.blur(); // Trigger the blur event

    // Assert writeBack was fired
    const writeBackData = await page.evaluate(() => window.lastCapturedWriteBack);
    expect(writeBackData).toEqual({
      rowIndex: 2,
      colName: 'Official Response',
      newValue: 'Approved pending structural review.'
    });
  });
});
      
