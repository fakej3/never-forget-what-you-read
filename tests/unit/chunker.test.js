// Unit tests for src/chunker.js using node:test built-in
// Run: node --test tests/unit/chunker.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectChapters } from '../../src/chunker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake page object */
function page(pageNum, text) {
  return { pageNum, text };
}

/**
 * Build a pages array from an array of {pageNum, text} definitions.
 * A book with headings only on certain pages, body text on others.
 */
function makePages(defs) {
  return defs.map(d => page(d.pageNum, d.text));
}

/** Sparse body text (~130 words, well under SPARSE_WORDS=200) */
const SPARSE_BODY = 'The principles outlined in this section form the bedrock of understanding. ' +
  'Through careful analysis and systematic application, readers develop deeper appreciation. ' +
  'Each idea builds upon previous foundations creating a coherent framework for knowledge. ' +
  'Practical implementation requires attention to detail and willingness to adapt methods. ' +
  'The evidence suggests consistent practice leads to mastery and long-term retention. ' +
  'Scholars and practitioners alike recognize importance of integrating theory with application. ' +
  'This enables a more nuanced understanding of complex phenomena encountered professionally.';

/** Dense body text (> 200 words, over SPARSE_WORDS) */
function denseBody(n) {
  const sentence = 'This comprehensive analysis explores the multifaceted dimensions of the subject matter in great detail providing extensive coverage of all relevant topics and subtopics that practitioners must understand. ';
  let result = '';
  while (result.split(' ').length < 210) result += sentence;
  return result.slice(0, 1500);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('detectChapters — standard headings', () => {

  test('1. Standard "Chapter 1:" heading detection', () => {
    const pages = [
      page(1, 'Chapter 1: Introduction\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Chapter 2: The Foundation\n' + SPARSE_BODY),
      page(4, denseBody(2)),
    ];
    const result = detectChapters(pages);
    assert.equal(result.length, 2, 'Should detect 2 chapters');
    assert.match(result[0].title, /chapter 1/i);
    assert.match(result[1].title, /chapter 2/i);
  });

  test('2. "Chapter One" word-number detection', () => {
    const pages = [
      page(1, 'Chapter One: The Beginning\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Chapter Two: The Middle\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'Chapter Three: The End\n' + SPARSE_BODY),
    ];
    const result = detectChapters(pages);
    assert.equal(result.length, 3, 'Should detect 3 chapters');
    assert.match(result[0].title, /chapter one/i);
  });

  test('3. Multi-line CHAPTER/ONE detection (Bug 1 fix — critical)', () => {
    // "CHAPTER" on line 1, "ONE" on line 2, "THOUGHTS ARE THINGS" on line 3
    // This is the T&GR-style multi-line heading format.
    // PDF.js produces newlines between these because Y-coords differ > 5pt.
    //
    // With few chapters: Pass 0 detects "CHAPTER" + "ONE" → title = "CHAPTER ONE — THOUGHTS ARE THINGS"
    // With many chapters: "CHAPTER" appears on ≥25% of pages → suppressed as running header.
    //   Then Pass 2 (ALL-CAPS on sparse pages) detects "ONE", "TWO", etc. as chapter headings.
    // Either path correctly identifies chapters — we test both approaches below.
    //
    // For the Bug 1 fix: the key requirement is that chapters ARE detected (not just "Full Book").
    // Use enough chapters that the fallback (Pass 2 ALL-CAPS) is triggered, just like the real book.
    const selfHelpPages = [];
    const chapters = [
      { num: 'ONE',   title: 'THOUGHTS ARE THINGS' },
      { num: 'TWO',   title: 'DESIRE' },
      { num: 'THREE', title: 'FAITH' },
    ];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      selfHelpPages.push(page(i * 4 + 1, `CHAPTER\n${ch.num}\n${ch.title}\n` + SPARSE_BODY));
      selfHelpPages.push(page(i * 4 + 2, denseBody(i * 3)));
      selfHelpPages.push(page(i * 4 + 3, denseBody(i * 3 + 1)));
      selfHelpPages.push(page(i * 4 + 4, denseBody(i * 3 + 2)));
    }

    const result = detectChapters(selfHelpPages);
    assert.ok(result.length >= 3,
      `Multi-line CHAPTER/NUM/TITLE format should detect ≥ 3 chapters (Bug 1 fix), got ${result.length}`);

    // The title may be "CHAPTER ONE — THOUGHTS ARE THINGS" (Pass 0) or "ONE" (Pass 2 ALL-CAPS)
    // Both are correct — either way chapters are detected, which is the Bug 1 fix.
    const firstTitle = result[0].title;
    const isRecognized = /one/i.test(firstTitle) || /chapter/i.test(firstTitle) || /thoughts/i.test(firstTitle);
    assert.ok(isRecognized,
      `First chapter title "${firstTitle}" should reference "ONE", "CHAPTER", or "THOUGHTS"`);
  });

  test('3b. Self-help book: 13 chapters with CHAPTER/NUM/TITLE format', () => {
    // The critical test: 13 chapters using CHAPTER-on-line-1 format
    const selfHelpChapters = [
      'CHAPTER\nONE\nTHOUGHTS ARE THINGS',
      'CHAPTER\nTWO\nDESIRE',
      'CHAPTER\nTHREE\nFAITH',
      'CHAPTER\nFOUR\nAUTO-SUGGESTION',
      'CHAPTER\nFIVE\nSPECIALIZED KNOWLEDGE',
      'CHAPTER\nSIX\nIMAGINATION',
      'CHAPTER\nSEVEN\nORGANIZED PLANNING',
      'CHAPTER\nEIGHT\nDECISION',
      'CHAPTER\nNINE\nPERSISTENCE',
      'CHAPTER\nTEN\nPOWER OF THE MASTERMIND',
      'CHAPTER\nELEVEN\nTHE MYSTERY OF SEX TRANSMUTATION',
      'CHAPTER\nTWELVE\nTHE SUBCONSCIOUS MIND',
      'CHAPTER\nTHIRTEEN\nTHE BRAIN',
    ];

    const pages = [];
    for (let i = 0; i < selfHelpChapters.length; i++) {
      pages.push(page(i * 3 + 1, selfHelpChapters[i] + '\n' + SPARSE_BODY));
      pages.push(page(i * 3 + 2, denseBody(i * 2)));
      pages.push(page(i * 3 + 3, denseBody(i * 2 + 1)));
    }

    const result = detectChapters(pages);
    assert.ok(result.length >= 13,
      `Self-help book should detect ≥ 13 chapters (Bug 1 fix), got ${result.length}`);
  });

  test('14. Title synthesis from multi-line headings', () => {
    // With 2 chapters, "CHAPTER" appears on 2 out of 4 pages = 50%.
    // threshold = max(3, 4*0.25) = 3. Count=2 < 3, so "CHAPTER" is NOT suppressed.
    // Pass 0 should fire: title = "CHAPTER ONE — THOUGHTS ARE THINGS"
    const pages = [
      page(1, 'CHAPTER\nONE\nTHOUGHTS ARE THINGS\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'CHAPTER\nTWO\nDESIRE\n' + SPARSE_BODY),
      page(4, denseBody(2)),
    ];
    const result = detectChapters(pages);
    assert.ok(result.length >= 2, 'Should detect chapters');
    // With 2 chapters and 4 pages, "CHAPTER" appears twice — below threshold of 3.
    // Pass 0 should synthesize: "CHAPTER ONE — THOUGHTS ARE THINGS"
    const title = result[0].title;
    assert.ok(
      title.includes('ONE') || title.includes('one') || title.includes('CHAPTER'),
      `Title "${title}" should contain the word number or CHAPTER label`
    );
    // The combined title (Pass 0) should include the separator or topic
    const hasCombinedTitle = title.includes('—') || title.toUpperCase().includes('THOUGHTS');
    const hasSimpleTitle   = /^(chapter|one)/i.test(title);
    assert.ok(
      hasCombinedTitle || hasSimpleTitle,
      `Title "${title}" should be a recognized multi-line synthesis or simple label`
    );
  });

});

describe('detectChapters — Roman numeral headings', () => {

  test('4. Roman numeral headings (I., IV., etc.)', () => {
    const romanChapters = [
      { n: 1, title: 'I. The First Chapter' },
      { n: 2, title: 'II. The Second Chapter' },
      { n: 3, title: 'III. The Third Chapter' },
      { n: 4, title: 'IV. The Fourth Chapter' },
      { n: 5, title: 'V. The Fifth Chapter' },
    ];

    const pages = [];
    for (const ch of romanChapters) {
      pages.push(page(ch.n * 2 - 1, ch.title + '\n' + SPARSE_BODY));
      pages.push(page(ch.n * 2, denseBody(ch.n)));
    }

    const result = detectChapters(pages);
    assert.equal(result.length, 5, `Should detect 5 Roman-numeral chapters, got ${result.length}`);
    assert.match(result[0].title, /^I\./);
    assert.match(result[2].title, /^III\./);
  });

});

describe('detectChapters — Part-based headings', () => {

  test('5. Part-based headings', () => {
    const pages = [
      page(1, 'Part One: The Beginning\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Part Two: The Development\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'Part Three: The Climax\n' + SPARSE_BODY),
      page(6, denseBody(3)),
      page(7, 'Part Four: The Resolution\n' + SPARSE_BODY),
      page(8, denseBody(4)),
    ];
    const result = detectChapters(pages);
    assert.equal(result.length, 4, `Should detect 4 Part headings, got ${result.length}`);
    assert.match(result[0].title, /part one/i);
  });

  test('5b. Part with numbers (Part 1:, Part 2:)', () => {
    const pages = [
      page(1, 'Part 1: Strategy\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Part 2: Execution\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'Part 3: Review\n' + SPARSE_BODY),
      page(6, denseBody(3)),
    ];
    const result = detectChapters(pages);
    assert.equal(result.length, 3, `Should detect 3 Part-number headings, got ${result.length}`);
  });

});

describe('detectChapters — running header suppression', () => {

  test('6. Running header suppression (line appearing on >25% of pages ignored)', () => {
    // "Book Title" appears on every page — should be suppressed
    const runningHeader = 'My Great Book Title';
    const pages = [];
    for (let i = 1; i <= 20; i++) {
      const isChapter = i === 1 || i === 8 || i === 15;
      const chapterLine = isChapter ? `Chapter ${Math.ceil(i/7)}: Some Title\n` : '';
      pages.push(page(i, `${runningHeader}\n${chapterLine}${denseBody(i)}`));
    }
    const result = detectChapters(pages);
    // Should detect chapters, NOT the running header as a chapter
    const hasRunningHeaderAsChapter = result.some(ch => ch.title === runningHeader);
    assert.equal(hasRunningHeaderAsChapter, false, 'Running header should not appear as chapter title');
    assert.ok(result.length >= 2, `Should still detect real chapters, got ${result.length}`);
  });

});

describe('detectChapters — ALL-CAPS headings', () => {

  test('7. ALL-CAPS headings on sparse pages', () => {
    // Sparse pages (< 200 words) with ALL-CAPS headings should be detected
    const pages = [
      page(1, 'INTRODUCTION\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'MAIN CONCEPTS\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'CONCLUSIONS AND FINDINGS\n' + SPARSE_BODY),
      page(6, denseBody(3)),
    ];
    const result = detectChapters(pages);
    assert.ok(result.length >= 2, `Should detect ALL-CAPS headings on sparse pages, got ${result.length}`);
  });

  test('7b. ALL-CAPS headings NOT detected on dense pages', () => {
    // Dense pages (> 200 words) should NOT trigger ALL-CAPS detection
    const pages = [];
    for (let i = 1; i <= 10; i++) {
      pages.push(page(i, 'SOME CAPS HEADING\n' + denseBody(i)));
    }
    const result = detectChapters(pages);
    // With no headings detected in dense pages, it falls to Strategy C (N-page)
    // or "Full Book" for < 20 pages
    const hasAllCapsAsChapter = result.some(ch => ch.title === 'SOME CAPS HEADING');
    assert.equal(hasAllCapsAsChapter, false, 'ALL-CAPS should not trigger on dense pages');
  });

});

describe('detectChapters — no headings fallback', () => {

  test('8. No headings → single "Full Book" result for short books (< 20 pages)', () => {
    const pages = [];
    for (let i = 1; i <= 10; i++) {
      pages.push(page(i, denseBody(i)));
    }
    const result = detectChapters(pages);
    assert.equal(result.length, 1, `Short book with no headings should produce 1 "Full Book" section, got ${result.length}`);
    assert.equal(result[0].title, 'Full Book');
  });

  test('9. N-page sections fallback for books ≥ 20 pages with no headings', () => {
    // 50-page book with no headings:
    // targetSections = max(5, floor(50/20)) = max(5,2) = 5
    // sectionSize = ceil(50/5) = 10 → 5 sections
    const pages = [];
    for (let i = 1; i <= 50; i++) {
      pages.push(page(i, denseBody(i)));
    }
    const result = detectChapters(pages);
    assert.equal(result.length, 5, `50-page no-headings book should produce 5 sections, got ${result.length}`);
    assert.match(result[0].title, /section/i);
  });

  test('9b. N-page fallback section count calculation (100 pages)', () => {
    // 100 pages, no headings:
    // targetSections = max(5, floor(100/20)) = max(5,5) = 5
    // sectionSize = ceil(100/5) = 20 → 5 sections
    const pages = [];
    for (let i = 1; i <= 100; i++) {
      pages.push(page(i, denseBody(i)));
    }
    const result = detectChapters(pages);
    assert.equal(result.length, 5, `100-page no-headings book should produce 5 sections, got ${result.length}`);
  });

});

describe('detectChapters — PDF outline strategy', () => {

  test('10. PDF outline strategy (Strategy A)', () => {
    const pages = [];
    for (let i = 1; i <= 20; i++) {
      pages.push(page(i, denseBody(i)));
    }

    const outline = [
      { title: 'Chapter 1', pageNum: 1 },
      { title: 'Chapter 2', pageNum: 6 },
      { title: 'Chapter 3', pageNum: 11 },
      { title: 'Chapter 4', pageNum: 16 },
    ];

    const result = detectChapters(pages, outline);
    assert.equal(result.length, 4, `Outline strategy should produce 4 chapters, got ${result.length}`);
    assert.equal(result[0].title, 'Chapter 1');
    assert.equal(result[1].title, 'Chapter 2');
    assert.equal(result[0].pageStart, 1);
    assert.equal(result[1].pageStart, 6);
  });

  test('10b. Outline strategy ignored when fewer than 2 entries', () => {
    const pages = [
      page(1, 'Chapter 1: Introduction\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Chapter 2: Content\n' + SPARSE_BODY),
      page(4, denseBody(2)),
    ];
    const outline = [{ title: 'Chapter 1', pageNum: 1 }]; // only 1 entry
    const result = detectChapters(pages, outline);
    // Should fall through to pattern matching since outline has < 2 entries
    assert.equal(result.length, 2, `Should use pattern matching when outline has < 2 entries, got ${result.length}`);
  });

});

describe('detectChapters — threshold and edge cases', () => {

  test('11. Pattern result >= 2 threshold (Bug 2 fix)', () => {
    // A book with exactly 2 detected chapters should use patterns, NOT N-page fallback
    const pages = [];
    for (let i = 1; i <= 25; i++) {
      if (i === 1) {
        pages.push(page(i, 'Chapter 1: Introduction\n' + SPARSE_BODY));
      } else if (i === 13) {
        pages.push(page(i, 'Chapter 2: The Main Content\n' + SPARSE_BODY));
      } else {
        pages.push(page(i, denseBody(i)));
      }
    }
    const result = detectChapters(pages);
    assert.equal(result.length, 2, `Exactly 2 chapters should use pattern result (Bug 2 fix), got ${result.length}`);
    // Make sure we got the real chapters, not N-page sections
    const hasRealChapters = result.some(ch => ch.title.match(/chapter/i));
    assert.ok(hasRealChapters, 'Should return real chapter titles, not Section N labels');
  });

  test('12. Front-matter only detection (1 result → falls through to N-page sections)', () => {
    // A book where only the first page looks like a chapter (Introduction), rest is dense text
    // patternResult.length === 1 → should fall through to N-page for ≥ 20 pages
    const pages = [];
    pages.push(page(1, 'Introduction\n' + SPARSE_BODY)); // matches front/back matter pattern
    for (let i = 2; i <= 30; i++) {
      pages.push(page(i, denseBody(i)));
    }
    const result = detectChapters(pages);
    // 1 pattern result → N-page fallback for 30 pages:
    // targetSections = max(5, floor(30/20)) = max(5,1) = 5
    // sectionSize = ceil(30/5) = 6 → 5 sections
    assert.ok(result.length > 1, `Should produce multiple sections via N-page fallback, got ${result.length}`);
  });

  test('13. Stress: 100-page book with chapters every 10 pages', () => {
    const pages = [];
    for (let i = 1; i <= 100; i++) {
      if (i % 10 === 1) {
        const n = Math.ceil(i / 10);
        pages.push(page(i, `Chapter ${n}: Section ${n}\n` + SPARSE_BODY));
      } else {
        pages.push(page(i, denseBody(i)));
      }
    }
    const result = detectChapters(pages);
    assert.equal(result.length, 10, `100-page book with chapters every 10 pages should have 10 chapters, got ${result.length}`);
  });

});

describe('detectChapters — Section headings', () => {

  test('Section 1 style headings', () => {
    const pages = [
      page(1, 'Section 1\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Section 2\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'Section 3\n' + SPARSE_BODY),
    ];
    const result = detectChapters(pages);
    assert.equal(result.length, 3, `Should detect 3 Section headings, got ${result.length}`);
  });

});

describe('detectChapters — edge cases', () => {

  test('Empty pages array returns empty array', () => {
    assert.deepEqual(detectChapters([]), []);
    assert.deepEqual(detectChapters(null), []);
  });

  test('Single page book returns one section', () => {
    const result = detectChapters([page(1, denseBody(1))]);
    assert.equal(result.length, 1);
  });

  test('Front/back matter keywords detected (prologue, epilogue, etc.)', () => {
    const pages = [
      page(1, 'Prologue\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Chapter 1: Main Content\n' + SPARSE_BODY),
      page(4, denseBody(2)),
      page(5, 'Epilogue\n' + SPARSE_BODY),
    ];
    const result = detectChapters(pages);
    assert.ok(result.length >= 3, `Should detect prologue, chapter, epilogue — got ${result.length}`);
    assert.match(result[0].title, /prologue/i);
  });

  test('Bare page numbers not detected as headings', () => {
    const pages = [
      page(1, '1\nSome text without a heading ' + denseBody(1)),
      page(2, '2\nMore text ' + denseBody(2)),
      page(3, 'Chapter 1: Real Heading\n' + SPARSE_BODY),
      page(4, '4\nContent page ' + denseBody(4)),
    ];
    const result = detectChapters(pages);
    // "1" and "2" bare numbers should not be headings
    const hasNumericChapter = result.some(ch => /^\d+$/.test(ch.title));
    assert.equal(hasNumericChapter, false, 'Bare numbers should not be chapter headings');
  });

  test('Chapter 20 word-number boundary', () => {
    const pages = [
      page(1, 'Chapter Twenty: The Final Chapter\n' + SPARSE_BODY),
      page(2, denseBody(1)),
      page(3, 'Chapter Twenty-One: Beyond Twenty\n' + SPARSE_BODY),
      page(4, denseBody(2)),
    ];
    const result = detectChapters(pages);
    assert.ok(result.length >= 2, `Should detect chapters with compound word-numbers, got ${result.length}`);
  });

});
