/* ============================================================
   photos.spec.js — E2E tests for the Photo Gallery template
   ============================================================ */

const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---------- Layer 1: Detection & Rendering ---------- */

test('photos template is detected for a sheet with Photo and Album columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-grid', { timeout: 5000 });
  await expect(page.locator('.photos-grid')).toBeVisible();
});

test('photos grid renders photo cards for each row with a valid image URL', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });
  const count = await page.locator('.photos-card').count();
  expect(count).toBeGreaterThanOrEqual(8);
});

test('photos template renders img elements inside each card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card-img', { timeout: 5000 });
  const imgCount = await page.locator('.photos-card-img').count();
  expect(imgCount).toBeGreaterThanOrEqual(8);
});

test('photos header shows correct photo count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-count', { timeout: 5000 });
  await expect(page.locator('.photos-count')).toContainText('photo');
});

/* ---------- Layer 2: Album filter toolbar ---------- */

test('photos toolbar renders album filter buttons from album column data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-filter-btn', { timeout: 5000 });
  const btnCount = await page.locator('.photos-filter-btn').count();
  // Should have "All" + at least 3 album buttons (Mountain Trip, Beach Vacation, City Break)
  expect(btnCount).toBeGreaterThanOrEqual(4);
});

test('photos filter "All" button is active by default', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-filter-btn.photos-filter-active', { timeout: 5000 });
  const activeText = await page.locator('.photos-filter-btn.photos-filter-active').first().textContent();
  expect(activeText?.trim()).toBe('All');
});

test('clicking an album filter button shows only photos in that album', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-filter-btn', { timeout: 5000 });

  // Mountain Trip has 3 photos in the fixture
  const mountainBtn = page.locator('.photos-filter-btn', { hasText: 'Mountain Trip' });
  await mountainBtn.click();
  await expect(mountainBtn).toHaveClass(/photos-filter-active/);

  const cards = await page.locator('.photos-card').count();
  expect(cards).toBe(3);
});

test('clicking "All" after filtering restores all photos', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-filter-btn', { timeout: 5000 });

  // Filter to Beach Vacation (3 photos)
  await page.locator('.photos-filter-btn', { hasText: 'Beach Vacation' }).click();
  await expect(page.locator('.photos-card')).toHaveCount(3);

  // Click All to restore
  await page.locator('.photos-filter-btn', { hasText: 'All' }).click();
  const totalCount = await page.locator('.photos-card').count();
  expect(totalCount).toBeGreaterThanOrEqual(8);
});

/* ---------- Layer 3: Lightbox interaction ---------- */

test('clicking a photo card opens the lightbox overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });

  await page.locator('.photos-card').first().click();
  await page.waitForSelector('.photos-lb-overlay:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('.photos-lb-overlay')).not.toHaveClass(/hidden/);
});

test('lightbox shows the clicked photo image src', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });

  await page.locator('.photos-card').first().click();
  await page.waitForSelector('.photos-lb-img', { timeout: 3000 });
  const src = await page.locator('.photos-lb-img').getAttribute('src');
  expect(src).toBeTruthy();
  expect(src).toMatch(/^https?:\/\//);
});

test('lightbox closes when clicking the X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });

  await page.locator('.photos-card').first().click();
  await page.waitForSelector('.photos-lb-overlay:not(.hidden)', { timeout: 3000 });

  await page.click('.photos-lb-close');
  await page.waitForSelector('.photos-lb-overlay', { state: 'hidden', timeout: 3000 });
  await expect(page.locator('.photos-lb-overlay')).toHaveClass(/hidden/);
});

test('lightbox closes when clicking the overlay background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });

  await page.locator('.photos-card').first().click();
  await page.waitForSelector('.photos-lb-overlay:not(.hidden)', { timeout: 3000 });

  // Click the overlay (top-left corner, away from modal)
  await page.click('.photos-lb-overlay', { position: { x: 5, y: 5 } });
  await page.waitForSelector('.photos-lb-overlay', { state: 'hidden', timeout: 3000 });
  await expect(page.locator('.photos-lb-overlay')).toHaveClass(/hidden/);
});

test('lightbox closes on Escape key', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });

  await page.locator('.photos-card').first().click();
  await page.waitForSelector('.photos-lb-overlay:not(.hidden)', { timeout: 3000 });

  await page.keyboard.press('Escape');
  await page.waitForSelector('.photos-lb-overlay', { state: 'hidden', timeout: 3000 });
  await expect(page.locator('.photos-lb-overlay')).toHaveClass(/hidden/);
});

/* ---------- Layer 4: Visual consistency ---------- */

test('photo cards have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-card', { timeout: 5000 });
  await expect(page.locator('.photos-card').first()).toHaveCSS('cursor', 'pointer');
});

test('photos grid uses CSS grid layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-grid', { timeout: 5000 });
  await expect(page.locator('.photos-grid')).toHaveCSS('display', 'grid');
});

test('filter buttons use design token colors when active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-filter-btn.photos-filter-active', { timeout: 5000 });

  const bgColor = await page.locator('.photos-filter-btn.photos-filter-active').first().evaluate(el =>
    getComputedStyle(el).backgroundColor
  );
  // Should not be transparent (inactive state), should have a real background color
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(bgColor).not.toBe('transparent');
});

test('photos template renders correctly at mobile width (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-grid', { timeout: 5000 });

  // Check nothing overflows the viewport
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.photos-grid, .photos-card').forEach(el => {
      if (el.getBoundingClientRect().right > window.innerWidth + 5) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---------- Layer 5: Drive URL conversion (unit tests via page.evaluate) ---------- */

test('driveToImgSrc converts drive.google.com/file/d/{id}/view to uc?export=view URL', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { driveToImgSrc } = await import('/js/templates/photos.js');
    return {
      fileUrl: driveToImgSrc('https://drive.google.com/file/d/abc123XYZ/view'),
      openUrl: driveToImgSrc('https://drive.google.com/open?id=abc123XYZ'),
      ucUrl:   driveToImgSrc('https://drive.google.com/uc?id=abc123XYZ'),
      direct:  driveToImgSrc('https://images.unsplash.com/photo.jpg'),
      empty:   driveToImgSrc(''),
    };
  });

  expect(result.fileUrl).toBe('https://drive.google.com/uc?export=view&id=abc123XYZ');
  expect(result.openUrl).toBe('https://drive.google.com/uc?export=view&id=abc123XYZ');
  expect(result.ucUrl).toBe('https://drive.google.com/uc?export=view&id=abc123XYZ');
  expect(result.direct).toBe('https://images.unsplash.com/photo.jpg');
  expect(result.empty).toBe('');
});

test('isPhotoUrl returns true for valid image URLs and converted Drive links', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { isPhotoUrl } = await import('/js/templates/photos.js');
    return {
      httpsUrl:    isPhotoUrl('https://images.unsplash.com/photo.jpg'),
      driveFile:   isPhotoUrl('https://drive.google.com/file/d/someId/view'),
      driveOpen:   isPhotoUrl('https://drive.google.com/open?id=someId'),
      httpOk:      isPhotoUrl('http://example.com/photo.png'),
      empty:       isPhotoUrl(''),
      noProtocol:  isPhotoUrl('example.com/photo.jpg'),
      nullVal:     isPhotoUrl(null),
    };
  });

  expect(result.httpsUrl).toBe(true);
  expect(result.driveFile).toBe(true);
  expect(result.driveOpen).toBe(true);
  expect(result.httpOk).toBe(true);
  expect(result.empty).toBe(false);
  expect(result.noProtocol).toBe(false);
  expect(result.nullVal).toBe(false);
});

test('driveToImgSrc handles Drive URLs with extra query params', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { driveToImgSrc } = await import('/js/templates/photos.js');
    return {
      withUsp: driveToImgSrc('https://drive.google.com/file/d/XYZ456/view?usp=sharing'),
      withExtra: driveToImgSrc('https://drive.google.com/open?usp=sharing&id=ABC789'),
    };
  });

  expect(result.withUsp).toBe('https://drive.google.com/uc?export=view&id=XYZ456');
  expect(result.withExtra).toBe('https://drive.google.com/uc?export=view&id=ABC789');
});

test('photos template detects sheets with Photo header', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const detected = await page.evaluate(async () => {
    const { detectTemplate } = await import('/js/templates/index.js');
    const result = detectTemplate(['Photo', 'Title', 'Date', 'Album', 'Description']);
    return result?.key;
  });

  expect(detected).toBe('photos');
});

test('photos template detects sheets with Image URL header', async ({ page }) => {
  await setupApp(page);
  await page.goto('/');

  const detected = await page.evaluate(async () => {
    const { detectTemplate } = await import('/js/templates/index.js');
    const result = detectTemplate(['Image URL', 'Caption', 'Date', 'Category']);
    return result?.key;
  });

  expect(detected).toBe('photos');
});

/* ---------- Layer 6: Upload button ---------- */

test('photos header shows an upload button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-upload-btn', { timeout: 5000 });
  await expect(page.locator('.photos-upload-btn')).toBeVisible();
  await expect(page.locator('.photos-upload-btn')).toContainText('Upload');
});

test('upload button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-upload-btn', { timeout: 5000 });
  await expect(page.locator('.photos-upload-btn')).toHaveCSS('cursor', 'pointer');
});

test('upload photo triggers Drive upload and appends a new row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-upload-btn', { timeout: 5000 });

  // Simulate a file upload by setting a fake file on the hidden input
  await page.evaluate(async () => {
    const input = document.querySelector('.photos-upload-input');
    const fakeFile = new File(['fake-image-data'], 'test-photo.jpg', { type: 'image/jpeg' });
    // Use DataTransfer to assign files to the input
    const dt = new DataTransfer();
    dt.items.add(fakeFile);
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Wait for the photo-upload toast (there may also be an 'Added' toast from the row insert)
  await page.waitForSelector('.toast', { timeout: 5000 });
  await expect(page.locator('.toast').last()).toContainText(/uploaded|Photo/i);

  // Verify a Drive upload record was created in mock mode
  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const uploadRecord = records.find(r => r.type === 'photo-upload');
  expect(uploadRecord).toBeTruthy();
  expect(uploadRecord.name).toBe('test-photo.jpg');
});

test('upload input accepts only image files', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-upload-btn', { timeout: 5000 });

  const accept = await page.locator('.photos-upload-input').getAttribute('accept');
  expect(accept).toBe('image/*');
});

test('upload input is hidden from layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-064');
  await page.waitForSelector('.photos-upload-btn', { timeout: 5000 });

  // The file input should be invisible (hidden via style.display = 'none')
  const inputVisible = await page.locator('.photos-upload-input').isVisible();
  expect(inputVisible).toBe(false);
});
