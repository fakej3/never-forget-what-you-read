#!/usr/bin/env node
// Generates all test PDFs and ground-truth JSON files.
// PDFs → tests/generated-books/
// Ground truth → tests/expected/

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { BOOKS, STRESS_BOOKS, makeChapterTitles, toWordNumber } from './books/index.js';
import { wrapText, makeParagraph } from './helpers/pdf-builder.js';
import { computeExpectedCounts } from './helpers/mock-ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR    = join(__dirname, 'generated-books');
const EXPECTED_DIR = join(__dirname, 'expected');

mkdirSync(BOOKS_DIR,    { recursive: true });
mkdirSync(EXPECTED_DIR, { recursive: true });

const PAGE_WIDTH  = 612;
const PAGE_HEIGHT = 792;
const MARGIN      = 72;
const BODY_WIDTH  = PAGE_WIDTH - MARGIN * 2;

// ── PDF drawing helpers ──────────────────────────────────────────────────────

function drawLine(page, text, font, size, x, y, color = rgb(0,0,0)) {
  if (text && y > 40) {
    page.drawText(text, { x, y, font, size, color });
  }
  return y - size * 1.4;
}

function drawWrapped(page, text, font, size, x, startY) {
  const lines = wrapText(text, font, size, BODY_WIDTH);
  let y = startY;
  for (const line of lines) {
    if (y < 50) break;
    page.drawText(line, { x, y, font, size, color: rgb(0,0,0) });
    y -= size * 1.4;
  }
  return y;
}

function addPage(doc) {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

/**
 * Add a chapter opening page.
 * headingLines: array of strings drawn top-down at Y=680, 656, 632...
 * Each line is a separate drawText call at a different Y (> 5pt apart → newlines in PDF.js extraction).
 * bodyText: sparse body so ALL-CAPS detection can fire (< 200 words).
 */
function addChapterOpeningPage(doc, boldFont, bodyFont, headingLines, bodyParagraph) {
  const page = addPage(doc);
  let y = 680;
  for (const line of headingLines) {
    if (y < 200) break;
    page.drawText(line, { x: MARGIN, y, font: boldFont, size: 16, color: rgb(0,0,0) });
    y -= 24; // Always > 5pt gap → PDF.js inserts newline
  }

  // Sparse body: ~100-160 words to stay under SPARSE_WORDS=200
  if (bodyParagraph) {
    y -= 20;
    drawWrapped(page, bodyParagraph, bodyFont, 11, MARGIN, Math.min(y, 560));
  }
  return page;
}

/**
 * Add a regular content page with 3 paragraphs.
 */
function addContentPage(doc, bodyFont, seed) {
  const page = addPage(doc);
  let y = 720;
  const lineSize = 11;

  for (let p = 0; p < 3; p++) {
    const text = makeParagraph(seed * 3 + p, 90);
    const lines = wrapText(text, bodyFont, lineSize, BODY_WIDTH);
    for (const line of lines) {
      if (y < 60) break;
      page.drawText(line, { x: MARGIN, y, font: bodyFont, size: lineSize, color: rgb(0,0,0) });
      y -= lineSize * 1.4;
    }
    y -= lineSize * 1.4; // paragraph gap
  }
  return page;
}

/**
 * Add a plain content page (no structure, just prose).
 */
function addPlainPage(doc, bodyFont, seed) {
  const page = addPage(doc);
  let y = 720;
  const lineSize = 11;
  // One big block of ~280 words (fills the page)
  const text = makeParagraph(seed, 280);
  const lines = wrapText(text, bodyFont, lineSize, BODY_WIDTH);
  for (const line of lines) {
    if (y < 60) break;
    page.drawText(line, { x: MARGIN, y, font: bodyFont, size: lineSize, color: rgb(0,0,0) });
    y -= lineSize * 1.4;
  }
  return page;
}

/**
 * Add a page with numbered list items (to test that they're not detected as headings).
 * List items like "1. First item" must not match the bare-digit heading pattern
 * since that pattern requires the item after "N. " to start with a capital letter.
 * We use lowercase content to avoid matching /^\d{1,2}\.\s+[A-ZÀ-ɏ]/.
 */
function addBulletListPage(doc, bodyFont, boldFont, seed) {
  const page = addPage(doc);
  let y = 700;
  const lineSize = 11;

  // Section label — deliberately NOT "Chapter N:" to avoid false chapter detection
  page.drawText(`Exercise ${seed + 1}: Lists and Structures`, {
    x: MARGIN, y, font: boldFont, size: 16, color: rgb(0,0,0),
  });
  y -= 30;

  // Numbered list items with lowercase text (won't match heading pattern)
  const items = [
    'item: first point about structure',
    'item: second point about methodology',
    'item: third point about application',
    'item: fourth point about outcomes',
    'item: fifth point about review',
    'item: sixth point about implementation',
    'item: seventh point about analysis',
    'item: eighth point about conclusions',
  ];

  for (let i = 0; i < items.length; i++) {
    if (y < 60) break;
    page.drawText(`${i + 1}. ${items[(seed + i) % items.length]}`, {
      x: MARGIN, y, font: bodyFont, size: lineSize, color: rgb(0,0,0),
    });
    y -= lineSize * 1.6;
  }
  return page;
}

/**
 * Add a page with quoted passages.
 */
function addQuotePage(doc, bodyFont, boldFont, seed) {
  const page = addPage(doc);
  let y = 680;
  const lineSize = 11;

  // Section label — deliberately NOT "Chapter N:" to avoid false chapter detection
  page.drawText(`Quotation ${seed + 1}: Wisdom and Quotations`, {
    x: MARGIN, y, font: boldFont, size: 16, color: rgb(0,0,0),
  });
  y -= 30;

  const quotes = [
    `"The only way to do great work is to love what you do." — Steve Jobs`,
    `"In the middle of difficulty lies opportunity." — Albert Einstein`,
    `"Success is not final, failure is not fatal." — Winston Churchill`,
    `"The future belongs to those who believe in the beauty of their dreams." — Eleanor Roosevelt`,
  ];

  for (let i = 0; i < 3; i++) {
    const q = quotes[(seed + i) % quotes.length];
    const lines = wrapText(q, bodyFont, lineSize, BODY_WIDTH - 30);
    for (const line of lines) {
      if (y < 60) break;
      page.drawText(line, { x: MARGIN + 20, y, font: bodyFont, size: lineSize, color: rgb(0.2, 0.2, 0.5) });
      y -= lineSize * 1.4;
    }
    y -= 20;
    // Add some body text
    const bodyText = makeParagraph(seed * 10 + i, 50);
    y = drawWrapped(page, bodyText, bodyFont, lineSize, MARGIN, y) - 10;
  }
  return page;
}

// ── Heading line builders ────────────────────────────────────────────────────

function headingLinesForFormat(format, index, titles) {
  const title = titles[index];

  switch (format) {
    case 'self-help': {
      // CHAPTER on line 1, word-number on line 2, chapter title on line 3
      const num = toWordNumber(index + 1).toUpperCase();
      const topicTitles = ['THOUGHTS ARE THINGS','DESIRE','FAITH','AUTO-SUGGESTION',
        'SPECIALIZED KNOWLEDGE','IMAGINATION','ORGANIZED PLANNING','DECISION',
        'PERSISTENCE','POWER OF THE MASTERMIND','THE MYSTERY OF SEX TRANSMUTATION',
        'THE SUBCONSCIOUS MIND','THE BRAIN'];
      const topic = topicTitles[index % topicTitles.length];
      return ['CHAPTER', num, topic];
    }
    case 'mixed': {
      // Each chapter uses a different format
      const formats = [
        // 0: ALL-CAPS multi-line
        () => ['CHAPTER ONE'],
        // 1: standard
        () => [`Chapter 2: Second Movement`],
        // 2: Roman
        () => [`III. The Third Way`],
        // 3: Part
        () => [`Part Four: Transformation`],
        // 4: ALL-CAPS single
        () => [`LESSON FIVE`],
        // 5: standard
        () => [`Chapter 6: Finale`],
      ];
      return (formats[index % formats.length] || (() => [title]))();
    }
    default:
      // For all other formats, just use the title as a single heading line
      return [title];
  }
}

// ── Book generators ──────────────────────────────────────────────────────────

async function generateStandardBook(bookDef) {
  const doc      = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  const titles      = makeChapterTitles(bookDef);
  const chapterCount = bookDef.chapterCount;
  const contentPages = (bookDef.pagesPerChapter || 1) - 1; // pages after chapter heading page

  // Optionally add a title/cover page (for tiny-book: 5 chapters × 1 page = 5 pages + title + blank = 7)
  if (bookDef.slug === 'tiny-book') {
    const coverPage = addPage(doc);
    coverPage.drawText(bookDef.title, {
      x: MARGIN, y: 450, font: boldFont, size: 24, color: rgb(0,0,0),
    });
    const blankPage = addPage(doc); // ensures 7 pages for 5 chapters + 2 extra
    void blankPage;
  }

  for (let i = 0; i < chapterCount; i++) {
    const headingLines = headingLinesForFormat(bookDef.headingFormat, i, titles);
    const bodyParagraph = makeParagraph(i * 17 + 3, 130); // ~130 words, sparse enough
    addChapterOpeningPage(doc, boldFont, bodyFont, headingLines, bodyParagraph);

    for (let p = 0; p < contentPages; p++) {
      if (bookDef.slug === 'bullet-list-book') {
        addBulletListPage(doc, bodyFont, boldFont, i * contentPages + p);
      } else if (bookDef.slug === 'quote-heavy-book') {
        addQuotePage(doc, bodyFont, boldFont, i * contentPages + p);
      } else {
        addContentPage(doc, bodyFont, i * contentPages + p);
      }
    }
  }

  return doc.save();
}

async function generateNoHeadingsBook(bookDef) {
  const doc      = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < bookDef.totalPages; i++) {
    addPlainPage(doc, bodyFont, i);
  }

  return doc.save();
}

async function generateLargeParagraphBook(bookDef) {
  const doc      = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titles   = makeChapterTitles(bookDef);
  const contentPages = (bookDef.pagesPerChapter || 1) - 1;

  for (let i = 0; i < bookDef.chapterCount; i++) {
    const headingLines = [titles[i]];
    const bodyParagraph = makeParagraph(i * 7, 130);
    addChapterOpeningPage(doc, boldFont, bodyFont, headingLines, bodyParagraph);

    for (let p = 0; p < contentPages; p++) {
      // Large single paragraph per page (no double-newlines)
      const page = addPage(doc);
      const text = makeParagraph(i * contentPages * 3 + p, 300);
      const lines = wrapText(text, bodyFont, 11, BODY_WIDTH);
      let y = 720;
      for (const line of lines) {
        if (y < 60) break;
        page.drawText(line, { x: MARGIN, y, font: bodyFont, size: 11, color: rgb(0,0,0) });
        y -= 11 * 1.4;
      }
    }
  }
  return doc.save();
}

async function generateManySmallChapters(bookDef) {
  const doc      = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const titles   = makeChapterTitles(bookDef);

  for (let i = 0; i < bookDef.chapterCount; i++) {
    // Each chapter is exactly 1 page: heading + short body
    const page = addPage(doc);
    page.drawText(titles[i], { x: MARGIN, y: 680, font: boldFont, size: 16, color: rgb(0,0,0) });
    const body = makeParagraph(i * 13, 120);
    drawWrapped(page, body, bodyFont, 11, MARGIN, 640);
  }
  return doc.save();
}

async function generateStressBook(bookDef) {
  const doc      = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < bookDef.totalPages; i++) {
    if (bookDef.chapterEvery && i % bookDef.chapterEvery === 0) {
      const chapterNum = Math.floor(i / bookDef.chapterEvery) + 1;
      const title = `Chapter ${chapterNum}: Stress Section ${chapterNum}`;
      addChapterOpeningPage(doc, boldFont, bodyFont, [title], makeParagraph(i, 130));
    } else {
      addPlainPage(doc, bodyFont, i);
    }
  }
  return doc.save();
}

// ── Ground truth generator ───────────────────────────────────────────────────

function makeGroundTruth(bookDef) {
  // For stress books with chapterEvery, count = totalPages / chapterEvery
  const chapterCount = bookDef.chapterCount
    || bookDef.expectedSectionCount
    || (bookDef.chapterEvery ? Math.floor(bookDef.totalPages / bookDef.chapterEvery) : 5);
  const counts = computeExpectedCounts(chapterCount);
  const titles = bookDef.chapterTitles || makeChapterTitles(bookDef);

  const groundTruth = {
    bookSlug:              bookDef.slug,
    bookTitle:             bookDef.title,
    expectedChapterCount:  chapterCount,
    expectedChapterTitles: titles,
    detectionStrategy:     bookDef.detectionStrategy,
    headingFormat:         bookDef.headingFormat,
    expectedPages:         bookDef.totalPages || (bookDef.chapterCount * (bookDef.pagesPerChapter || 1)),
    ...counts,
  };

  // For no-headings books, adjust section count expectations
  if (bookDef.headingFormat === 'none') {
    const pages = bookDef.totalPages;
    const targetSections = Math.min(20, Math.max(5, Math.floor(pages / 20)));
    const sectionSize    = Math.ceil(pages / targetSections);
    const actualSections = Math.ceil(pages / sectionSize);
    groundTruth.expectedChapterCount  = actualSections;
    groundTruth.expectedSectionCount  = actualSections;
    const sectCounts = computeExpectedCounts(actualSections);
    Object.assign(groundTruth, sectCounts);
  }

  return groundTruth;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function generateAll() {
  console.log('Generating test PDFs...\n');

  const allBooks = [...BOOKS, ...STRESS_BOOKS];
  let generated = 0;

  for (const bookDef of allBooks) {
    const outPath = join(BOOKS_DIR, `${bookDef.slug}.pdf`);
    const expectPath = join(EXPECTED_DIR, `${bookDef.slug}.json`);

    try {
      let bytes;
      switch (bookDef.headingFormat) {
        case 'none':
          bytes = await generateNoHeadingsBook(bookDef);
          break;
        case 'self-help':
        case 'standard':
        case 'roman':
        case 'part':
        case 'section':
        case 'mixed':
          if (bookDef.slug === 'many-small-chapters') {
            bytes = await generateManySmallChapters(bookDef);
          } else if (bookDef.slug === 'large-paragraph-book') {
            bytes = await generateLargeParagraphBook(bookDef);
          } else if (bookDef.chapterEvery) {
            bytes = await generateStressBook(bookDef);
          } else {
            bytes = await generateStandardBook(bookDef);
          }
          break;
        default:
          bytes = await generateStandardBook(bookDef);
      }

      writeFileSync(outPath, bytes);
      const gt = makeGroundTruth(bookDef);
      writeFileSync(expectPath, JSON.stringify(gt, null, 2));
      console.log(`  [OK] ${bookDef.slug}.pdf — ${bookDef.totalPages || (bookDef.chapterCount * (bookDef.pagesPerChapter || 1))} pages`);
      generated++;
    } catch (err) {
      console.error(`  [ERR] ${bookDef.slug}: ${err.message}`);
      console.error(err.stack);
    }
  }

  console.log(`\nGenerated ${generated}/${allBooks.length} books.`);
  if (generated < allBooks.length) process.exit(1);
}

generateAll().catch(err => { console.error(err); process.exit(1); });
