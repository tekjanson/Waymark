import { chromium } from '@playwright/test';

const FILE_PATH = '/home/tekjanson/Documents/Code/Waymark/even-app/out.ehpk';

async function uploadEvenApp() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[Upload] Starting upload to Even Hub...');
    
    // Navigate to Even Hub
    await page.goto('https://hub.evenrealities.com/hub/com.evenreality.g2eyes');
    console.log('[Upload] Navigated to Even Hub');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    console.log('[Upload] Page loaded');

    // Find and click the "Upload a build" button
    const uploadButton = page.locator('button:has-text("Upload a build")');
    await uploadButton.click();
    console.log('[Upload] Clicked upload button');

    // Wait for the file input dialog or file input element
    await page.waitForTimeout(2000);

    // Try to find the file input element
    const fileInput = page.locator('input[type="file"]');
    const fileInputCount = await fileInput.count();
    
    if (fileInputCount > 0) {
      console.log('[Upload] Found file input element');
      await fileInput.first().setInputFiles(FILE_PATH);
      console.log('[Upload] File path set successfully!');
    } else {
      console.log('[Upload] No file input element found, trying alternative method...');
      // Try using the keyboard shortcut
      await page.keyboard.type(FILE_PATH);
      await page.keyboard.press('Enter');
    }

    // Wait a bit to see the upload progress
    await page.waitForTimeout(5000);
    console.log('[Upload] Upload process complete!');

  } catch (error) {
    console.error('[Upload] Error during upload:', error);
  } finally {
    await browser.close();
  }
}

uploadEvenApp();
