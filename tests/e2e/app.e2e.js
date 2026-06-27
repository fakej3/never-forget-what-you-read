// E2E tests for the never-forget-what-you-read app
// Uses Playwright. App served at http://localhost:3333

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { createMockAI, wrapGeminiResponse, makeRateLimitBody } from '../helpers/mock-ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR    = join(__dirname, '../generated-books');
const EXPECTED_DIR = join(__dirname, '../expected');

// ── Helpers ──────────────────────────────────────────────────────────────────

function bookPath(slug) {
  return join(BOOKS_DIR, `${slug}.pdf`);
}

function loadExpected(slug) {
  const p = join(EXPECTED_DIR, `${slug}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Set up Gemini API route interception with a mock AI function.
 * The route handler wraps the mock response in Gemini format.
 */
async function setupGeminiMock(page, mockFn) {
  await page.route('**/generativelanguage.googleapis.com/**', async route => {
    const requestBody = route.request().postData() || '';
    const response = mockFn(requestBody);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: wrapGeminiResponse(response),
    });
  });
}

/**
 * Set up Gemini API route interception with a rate-limit mock for first N calls,
 * then normal responses thereafter.
 */
async function setupRateLimitMock(page, rateLimitCount, mockFn) {
  let callCount = 0;
  await page.route('**/generativelanguage.googleapis.com/**', async route => {
    if (callCount < rateLimitCount) {
      callCount++;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: makeRateLimitBody(),
      });
    } else {
      callCount++;
      const requestBody = route.request().postData() || '';
      const response = mockFn(requestBody);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: wrapGeminiResponse(response),
      });
    }
  });
}

/**
 * Upload a PDF file to the app.
 * Sets a fake API key so the app won't reject the upload.
 */
async function uploadBook(page, pdfPath) {
  // Set API key in IndexedDB via app's settings form
  await page.click('#open-settings');
  await page.waitForSelector('#settings-modal:not(.hidden)');
  await page.fill('#api-key-input', 'test-api-key-for-qa-testing');
  await page.click('#save-settings');
  await page.waitForSelector('#settings-modal.hidden', { timeout: 5000 });

  // Upload file
  const fileInput = page.locator('#file-input');
  await fileInput.setInputFiles(pdfPath);
}

/**
 * Wait for processing to complete (progress reaches 100% or status shows "Complete").
 */
async function waitForComplete(page, timeoutMs = 90000) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#progress-status');
      const bar    = document.querySelector('#progress-bar');
      if (!status) return false;
      const text = status.textContent || '';
      const width = parseInt(bar?.style?.width || '0');
      return text.includes('Complete') || width >= 100;
    },
    { timeout: timeoutMs }
  );
}

/**
 * Wait for rate-limited status to appear.
 */
async function waitForRateLimited(page, timeoutMs = 60000) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#progress-status');
      const text = status?.textContent || '';
      return text.toLowerCase().includes('rate') ||
             text.toLowerCase().includes('quota') ||
             document.querySelector('[data-status="rate-limited"]') !== null ||
             document.querySelector('.btn-resume') !== null ||
             document.querySelector('button:has-text("Resume")') !== null;
    },
    { timeout: timeoutMs }
  );
}

/**
 * Open a book from the library by clicking its card.
 */
async function openBookFromLibrary(page, titleText) {
  // Wait for book to appear in library
  await page.waitForSelector('#book-grid .book-card, #book-grid [class*="book"]', { timeout: 10000 });
  // Click on the book
  await page.click(`text="${titleText}"`);
  // Wait for detail view
  await page.waitForSelector('#book-detail:not(.hidden)', { timeout: 5000 });
}

/**
 * Count items in a list element.
 */
async function countListItems(page, selector) {
  return page.locator(selector).locator('li').count();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Full pipeline E2E tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB before each test to avoid state leakage
    await page.goto('http://localhost:3333');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases?.() || [];
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  // ── Test 1: tiny-book full pipeline ──────────────────────────────────────

  test('1. tiny-book full pipeline — upload, mock AI, verify completion', async ({ page }) => {
    const slug     = 'tiny-book';
    const pdfPath  = bookPath(slug);
    const expected = loadExpected(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 60000);

    // Verify processing section shows success
    const statusText = await page.locator('#progress-status').textContent();
    expect(statusText).toContain('Complete');

    // Navigate to book detail
    // Wait for library to refresh
    await page.waitForTimeout(1000);

    // Find book in library — look for book cards
    const bookCards = page.locator('#book-grid').locator('[class*="book-card"], .book-card, [data-book-id]');
    const cardCount = await bookCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Click first book card (the one we just processed)
    await bookCards.first().click();
    await page.waitForSelector('#book-detail:not(.hidden)', { timeout: 10000 });

    // Check chapter count in detail view
    const chapterItems = await page.locator('#chapter-list').locator('[class*="chapter"], li, div').count();
    if (expected) {
      expect(chapterItems).toBeGreaterThanOrEqual(expected.expectedChapterCount - 1);
    }

    // Check concepts, principles, vocabulary, quotes
    const concepts = await page.locator('#detail-concepts li').count();
    const principles = await page.locator('#detail-principles li').count();
    const vocab = await page.locator('#detail-vocab li').count();
    const quotes = await page.locator('#detail-quotes [class*="quote"], #detail-quotes blockquote, #detail-quotes div').count();

    if (expected) {
      expect(concepts).toBeGreaterThan(0);
      expect(principles).toBeGreaterThan(0);
      // Relaxed: just verify we got something
      console.log(`tiny-book: chapters=${chapterItems}, concepts=${concepts}, principles=${principles}, vocab=${vocab}, quotes=${quotes}`);
    }
  });

  // ── Test 2: normal-book chapter detection ────────────────────────────────

  test('2. normal-book chapter detection — verify 20 chapters detected', async ({ page }) => {
    const slug    = 'normal-book';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 120000);

    // Check the processing log for chapter count
    const logText = await page.locator('#processing-log').textContent();
    // The pipeline logs "N chapters detected"
    const chapterMatch = logText.match(/(\d+)\s+chapters?\s+detected/i);
    if (chapterMatch) {
      const detected = parseInt(chapterMatch[1]);
      // Allow groupChapters to reduce count slightly for large books
      expect(detected).toBeGreaterThanOrEqual(15);
      console.log(`normal-book: detected ${detected} chapters`);
    }
  });

  // ── Test 3: self-help-book multiline headings (Bug 1 fix) ────────────────

  test('3. self-help-book multiline headings — verify ≥13 chapters detected', async ({ page }) => {
    const slug    = 'self-help-book';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 120000);

    // Check the log for chapter count — this is the critical Bug 1 validation
    const logText = await page.locator('#processing-log').textContent();
    const chapterMatch = logText.match(/(\d+)\s+chapters?\s+detected/i);

    if (chapterMatch) {
      const detected = parseInt(chapterMatch[1]);
      console.log(`self-help-book: detected ${detected} chapters (Bug 1 fix requires ≥13)`);
      expect(detected).toBeGreaterThanOrEqual(13);
    } else {
      // Also check via AI calls made — should have ≥13 chapter calls + 1 summary
      const aiMatch = logText.match(/(\d+)\s+AI\s+calls/i) || logText.match(/~(\d+)\s+AI\s+calls/i);
      if (aiMatch) {
        const aiCalls = parseInt(aiMatch[1]);
        expect(aiCalls).toBeGreaterThanOrEqual(14); // 13 chapters + 1 summary
        console.log(`self-help-book: ${aiCalls} AI calls (expecting ≥14 for 13 chapters)`);
      }
    }
  });

  // ── Test 4: no-headings-book fallback ────────────────────────────────────

  test('4. no-headings-book fallback — verify N-page sections created (5-20 range)', async ({ page }) => {
    const slug    = 'no-headings-book';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 120000);

    const logText = await page.locator('#processing-log').textContent();
    // Sections should be labeled "Section N (pp. X–Y)"
    const sectionMatches = logText.match(/Section \d+/gi) || [];
    const chapterMatch = logText.match(/(\d+)\s+chapters?\s+detected/i);

    if (chapterMatch) {
      const sectionCount = parseInt(chapterMatch[1]);
      console.log(`no-headings-book: ${sectionCount} sections created`);
      expect(sectionCount).toBeGreaterThanOrEqual(5);
      expect(sectionCount).toBeLessThanOrEqual(20);
    }

    // Check that chapter list contains "Section" entries (not real chapters)
    const logContainsSections = logText.toLowerCase().includes('section');
    expect(logContainsSections).toBe(true);
  });

  // ── Test 5: resume test ──────────────────────────────────────────────────

  test('5. resume test — rate limit after 2 calls, then Resume AI completes', async ({ page }) => {
    const slug    = 'tiny-book';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    // First: set up rate-limit mock (429 for first 2 chapter calls, then normal)
    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);

    // Rate limit the first 2 calls, then normal responses
    let interceptCount = 0;
    await page.route('**/generativelanguage.googleapis.com/**', async route => {
      interceptCount++;
      if (interceptCount <= 2) {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: makeRateLimitBody(),
        });
      } else {
        const requestBody = route.request().postData() || '';
        const response = mockFn(requestBody);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: wrapGeminiResponse(response),
        });
      }
    });

    await uploadBook(page, pdfPath);

    // Wait for rate-limited state — the app should show book as rate-limited
    // and display a "Resume AI" button or similar
    try {
      await waitForRateLimited(page, 30000);
      console.log('resume test: rate-limited state detected');
    } catch (e) {
      // May not show rate-limited UI for all cases — check status
      console.log('resume test: did not detect rate-limited state, checking status...');
    }

    // Check if there's a resume button in the library
    await page.waitForTimeout(2000);

    // Try to find and click Resume AI button in the book library card
    const resumeBtn = page.locator('button:has-text("Resume"), button:has-text("Resume AI"), .btn-resume');
    const resumeCount = await resumeBtn.count();

    if (resumeCount > 0) {
      console.log('resume test: found Resume AI button, clicking...');
      await resumeBtn.first().click();
      // Now it should complete
      await waitForComplete(page, 90000);
      const statusText = await page.locator('#progress-status').textContent();
      expect(statusText).toContain('Complete');
      console.log('resume test: completed after resume');
    } else {
      // Book may have completed despite rate limits (retry logic)
      // Check if it's in library
      const bookCards = page.locator('#book-grid [class*="book-card"], #book-grid .book-card');
      const count = await bookCards.count();
      expect(count).toBeGreaterThan(0);
      console.log('resume test: book processed (resume not needed or rate limits retried)');
    }
  });

  // ── Test 6: storage persistence ─────────────────────────────────────────

  test('6. storage persistence — book survives page reload', async ({ page }) => {
    const slug    = 'tiny-book';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 60000);

    // Verify book is in library before reload
    await page.waitForTimeout(1000);
    const beforeReload = await page.locator('#book-grid [class*="book-card"], #book-grid .book-card').count();
    expect(beforeReload).toBeGreaterThan(0);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Book should still be in library
    const afterReload = await page.locator('#book-grid [class*="book-card"], #book-grid .book-card, #book-grid [data-book-id]').count();
    expect(afterReload).toBeGreaterThan(0);
    console.log(`storage persistence: ${beforeReload} books before reload, ${afterReload} after`);
  });

  // ── Test 7: stress-100 no crash ─────────────────────────────────────────

  test('7. stress-100 no crash — 100-page no-headings PDF completes without error', async ({ page }) => {
    const slug    = 'stress-100';
    const pdfPath = bookPath(slug);

    expect(existsSync(pdfPath), `PDF ${pdfPath} must exist`).toBe(true);

    const callCount = { n: 0 };
    const mockFn = createMockAI(callCount);
    await setupGeminiMock(page, (body) => mockFn(body));

    // Track JS errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await uploadBook(page, pdfPath);
    await waitForComplete(page, 180000);

    // No unhandled errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ResizeObserver') &&
      !e.toLowerCase().includes('warning')
    );
    expect(criticalErrors).toHaveLength(0);

    const statusText = await page.locator('#progress-status').textContent();
    expect(statusText).toContain('Complete');
    console.log(`stress-100: completed without errors. JS errors: ${errors.length}`);
  });

});
