// E2E tests for delete, reprocess, and developer tools
// Run: cd tests && npx playwright test e2e/deletion.e2e.js

import { test, expect } from '@playwright/test';
import { existsSync }    from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { createMockAI, wrapGeminiResponse, makeRateLimitBody } from '../helpers/mock-ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = join(__dirname, '../generated-books');

function bookPath(slug) { return join(BOOKS_DIR, `${slug}.pdf`); }

// ── Shared helpers ────────────────────────────────────────────────────────────

async function setupGeminiMock(page, mockFn) {
  await page.route('**/generativelanguage.googleapis.com/**', async route => {
    const body = route.request().postData() || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: wrapGeminiResponse(mockFn(body)),
    });
  });
}

async function configureApiKey(page) {
  await page.click('#open-settings');
  await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });
  await page.fill('#api-key-input', 'test-key-deletion-tests');
  await page.click('#save-settings');
  await page.waitForFunction(() => document.getElementById('settings-modal')?.classList.contains('hidden'), { timeout: 5000 });
}

async function uploadBook(page, slug) {
  const pdf = bookPath(slug);
  expect(existsSync(pdf), `PDF must exist: ${pdf}`).toBe(true);
  await page.locator('#file-input').setInputFiles(pdf);
}

async function waitForProcessingVisible(page) {
  await page.waitForFunction(
    () => !document.getElementById('processing-section')?.classList.contains('hidden'),
    { timeout: 15000 }
  );
}

async function waitForProcessingHidden(page, timeoutMs = 15000) {
  await page.waitForFunction(
    () => document.getElementById('processing-section')?.classList.contains('hidden'),
    { timeout: timeoutMs }
  );
}

async function waitForProcessingComplete(page, timeoutMs = 90000) {
  await page.waitForFunction(
    () => document.querySelector('#progress-status')?.textContent?.includes('Complete'),
    { timeout: timeoutMs }
  );
}

async function waitForModalHidden(page, modalId, timeoutMs = 5000) {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.classList.contains('hidden'),
    modalId,
    { timeout: timeoutMs }
  );
}

async function waitForModalVisible(page, modalId, timeoutMs = 5000) {
  await page.waitForFunction(
    (id) => !document.getElementById(id)?.classList.contains('hidden'),
    modalId,
    { timeout: timeoutMs }
  );
}

async function countBooksInArchive(page) {
  return page.locator('#book-grid .book-card').count();
}

async function idbCount(page, storeName) {
  return page.evaluate(async (store) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('never-forget-v1');
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
    return new Promise((res) => {
      const req = db.transaction(store).objectStore(store).count();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => res(-1);
    });
  }, storeName);
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Delete, Reprocess, and Developer Tools', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3333');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases?.() ?? [];
      for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  // ── 1. Delete completed book ──────────────────────────────────────────────

  test('1. Delete completed book — removed from archive with no orphaned records', async ({ page }) => {
    const mockFn = createMockAI();
    await setupGeminiMock(page, body => mockFn(body));

    await configureApiKey(page);
    await uploadBook(page, 'tiny-book');
    await waitForProcessingComplete(page, 60000);
    await waitForProcessingHidden(page, 10000);

    expect(await countBooksInArchive(page)).toBe(1);
    expect(await idbCount(page, 'books')).toBe(1);

    // Click Delete on the book card
    await page.locator('#book-grid .book-card .btn-danger-ghost').first().click();
    await waitForModalVisible(page, 'delete-modal');

    // Confirm dialog should name the action clearly
    await expect(page.locator('#delete-modal')).toContainText('cannot be undone');
    await page.click('#confirm-delete');
    await waitForModalHidden(page, 'delete-modal');

    // Archive must be empty
    await page.waitForFunction(
      () => document.querySelectorAll('#book-grid .book-card').length === 0,
      { timeout: 5000 }
    );
    expect(await countBooksInArchive(page)).toBe(0);
    await expect(page.locator('#empty-library')).toBeVisible();

    // No orphaned IndexedDB records
    expect(await idbCount(page, 'books')).toBe(0);
    expect(await idbCount(page, 'chapters')).toBe(0);
    expect(await idbCount(page, 'knowledge')).toBe(0);
  });

  // ── 2. Delete paused (rate-limited) book ─────────────────────────────────

  test('2. Delete paused book — rate-limited book removed cleanly', async ({ page }) => {
    // Rate-limit all AI calls so the book lands in paused state
    await page.route('**/generativelanguage.googleapis.com/**', async route => {
      await route.fulfill({ status: 429, contentType: 'application/json', body: makeRateLimitBody() });
    });

    await configureApiKey(page);
    await uploadBook(page, 'tiny-book');

    // Wait for "Paused" / "Rate Limited" to appear in the book card
    await page.waitForFunction(
      () => [...document.querySelectorAll('#book-grid .book-card')]
             .some(c => c.textContent.includes('Paused') || c.textContent.includes('Rate')),
      { timeout: 60000 }
    );
    await waitForProcessingHidden(page, 10000);

    expect(await countBooksInArchive(page)).toBe(1);

    await page.locator('#book-grid .book-card .btn-danger-ghost').first().click();
    await waitForModalVisible(page, 'delete-modal');
    await page.click('#confirm-delete');
    await waitForModalHidden(page, 'delete-modal');

    await page.waitForFunction(
      () => document.querySelectorAll('#book-grid .book-card').length === 0,
      { timeout: 5000 }
    );
    expect(await countBooksInArchive(page)).toBe(0);
    expect(await idbCount(page, 'books')).toBe(0);
    expect(await idbCount(page, 'chapters')).toBe(0);
  });

  // ── 3. Delete processing book — cancels pipeline cleanly ─────────────────

  test('3. Delete processing book — pipeline cancelled, book removed', async ({ page }) => {
    // Slow mock: 2 s delay per AI call so the pipeline is still running when we delete
    await page.route('**/generativelanguage.googleapis.com/**', async route => {
      await new Promise(r => setTimeout(r, 2000));
      const mockFn = createMockAI();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: wrapGeminiResponse(mockFn(route.request().postData() || '')),
      });
    });

    await configureApiKey(page);
    await uploadBook(page, 'tiny-book');

    // Wait for the book card to appear (extraction done, AI in progress)
    await page.waitForSelector('#book-grid .book-card', { timeout: 30000 });

    // Delete while pipeline is running
    await page.locator('#book-grid .book-card .btn-danger-ghost').first().click();
    await waitForModalVisible(page, 'delete-modal');
    await page.click('#confirm-delete');
    await waitForModalHidden(page, 'delete-modal');

    // Processing panel should dismiss and archive become empty
    await waitForProcessingHidden(page, 10000);
    await page.waitForFunction(
      () => document.querySelectorAll('#book-grid .book-card').length === 0,
      { timeout: 8000 }
    );
    expect(await countBooksInArchive(page)).toBe(0);
    expect(await idbCount(page, 'books')).toBe(0);
  });

  // ── 4. Reprocess completed book ──────────────────────────────────────────

  test('4. Reprocess completed book — knowledge wiped and re-extracted', async ({ page }) => {
    const callCount = { n: 0 };
    const mockFn    = createMockAI(callCount);
    await setupGeminiMock(page, body => mockFn(body));

    await configureApiKey(page);
    await uploadBook(page, 'tiny-book');
    await waitForProcessingComplete(page, 60000);
    await waitForProcessingHidden(page, 10000);

    const firstCallCount = callCount.n;
    expect(firstCallCount).toBeGreaterThan(0);

    // Open the book detail view
    const card = page.locator('#book-grid .book-card').first();
    // Click the card but not the delete button
    await card.click({ position: { x: 10, y: 10 } });
    await page.waitForFunction(
      () => !document.getElementById('book-detail')?.classList.contains('hidden'),
      { timeout: 5000 }
    );

    // Confirm summary is populated
    const summaryBefore = await page.locator('#detail-book-summary').textContent();
    expect(summaryBefore.trim().length).toBeGreaterThan(10);

    // Click Reprocess
    await page.click('#reprocess-book');
    await waitForModalVisible(page, 'reprocess-modal');
    await expect(page.locator('#reprocess-modal')).toContainText('does not need to be re-uploaded');
    await page.click('#confirm-reprocess');
    await waitForModalHidden(page, 'reprocess-modal');

    // Detail view should close and processing should restart
    await waitForProcessingVisible(page);
    await waitForProcessingComplete(page, 60000);
    await waitForProcessingHidden(page, 10000);

    // AI must have been called again
    expect(callCount.n).toBeGreaterThan(firstCallCount);

    // Book still in archive and complete
    expect(await countBooksInArchive(page)).toBe(1);
    await expect(page.locator('#book-grid .book-card .status-complete')).toBeVisible();
  });

  // ── 5. Clear all books — developer tool ──────────────────────────────────

  test('5. Clear all books — dev tool empties archive', async ({ page }) => {
    const mockFn = createMockAI();
    await setupGeminiMock(page, body => mockFn(body));
    await configureApiKey(page);

    // Upload and complete two books
    await uploadBook(page, 'tiny-book');
    await waitForProcessingComplete(page, 60000);
    await waitForProcessingHidden(page, 10000);

    await uploadBook(page, 'normal-book');
    await waitForProcessingComplete(page, 90000);
    await waitForProcessingHidden(page, 10000);

    expect(await countBooksInArchive(page)).toBe(2);

    // Open Settings → expand Dev Tools → Clear All Books
    await page.click('#open-settings');
    await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5000 });
    await page.click('#dev-tools-section summary');
    await page.waitForSelector('#dev-clear-books:not(:disabled)', { state: 'visible', timeout: 3000 });
    await page.click('#dev-clear-books');

    // Confirm dialog
    await waitForModalVisible(page, 'dev-confirm-modal');
    await expect(page.locator('#dev-confirm-modal')).toContainText('cannot be undone');
    await page.click('#confirm-dev-action');
    await waitForModalHidden(page, 'dev-confirm-modal');

    // Settings modal should auto-close
    await page.waitForFunction(
      () => document.getElementById('settings-modal')?.classList.contains('hidden'),
      { timeout: 5000 }
    );

    // Archive must be empty
    await page.waitForFunction(
      () => document.querySelectorAll('#book-grid .book-card').length === 0,
      { timeout: 5000 }
    );
    expect(await countBooksInArchive(page)).toBe(0);
    await expect(page.locator('#empty-library')).toBeVisible();

    // No orphaned records in any store
    expect(await idbCount(page, 'books')).toBe(0);
    expect(await idbCount(page, 'chapters')).toBe(0);
    expect(await idbCount(page, 'knowledge')).toBe(0);
  });

});
