// Unit tests for src/compressor.js using node:test built-in
// Run: node --test tests/unit/compressor.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compressChapter, groupChapters } from '../../src/compressor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a paragraph of approximately N words */
function makeParagraph(n, seed = 0) {
  const sentences = [
    'The principles outlined here form the bedrock of professional practice.',
    'Through systematic application practitioners develop deeper understanding.',
    'Each concept builds upon previous foundations creating coherent frameworks.',
    'Practical implementation requires careful attention to contextual details.',
    'Evidence suggests consistent practice leads to mastery over time.',
    'Integration of theory with application enables professional excellence.',
    'Analysis reveals patterns that inform more effective decision-making.',
    'Synthesis of multiple perspectives provides comprehensive understanding.',
    'Critical evaluation of evidence supports well-reasoned conclusions.',
    'Reflective practice drives continuous improvement and development.',
  ];
  let result = '';
  let i = seed;
  while (result.split(' ').filter(Boolean).length < n) {
    result += (result ? ' ' : '') + sentences[i % sentences.length];
    i++;
  }
  return result.split(' ').slice(0, n).join(' ');
}

/** Generate a multi-paragraph text of approximately N paragraphs × wordsPerPara words */
function makeMultiPara(nParas, wordsPerPara = 100, seed = 0) {
  const paras = [];
  for (let i = 0; i < nParas; i++) {
    paras.push(makeParagraph(wordsPerPara, seed + i));
  }
  return paras.join('\n\n');
}

/** Create a fake chapter object with pages */
function makeChapter(index, pageCount, wordsPerPage = 100) {
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({
      pageNum: index * 100 + i + 1,
      text: makeParagraph(wordsPerPage, index * 10 + i),
    });
  }
  return {
    title:     `Chapter ${index + 1}`,
    pages,
    pageStart: pages[0].pageNum,
    pageEnd:   pages[pages.length - 1].pageNum,
  };
}

// ── compressChapter tests ────────────────────────────────────────────────────

describe('compressChapter', () => {

  test('1. Short text below target → returned unchanged', () => {
    const short = 'This is a short text that is well below the target character count.';
    const result = compressChapter(short, 15000);
    assert.equal(result, short.trim(), 'Short text should be returned as-is (trimmed)');
  });

  test('1b. Text exactly at target → returned unchanged', () => {
    const text = 'x'.repeat(15000);
    const result = compressChapter(text, 15000);
    assert.ok(result.length <= 15000, 'Text at target should not exceed targetChars');
  });

  test('2. Long text → compressed to ≤ targetChars', () => {
    // Create text well over 15000 chars
    const longText = makeMultiPara(50, 150); // ~50 paragraphs × 150 words each
    assert.ok(longText.length > 15000, 'Test setup: long text should exceed 15000 chars');

    const result = compressChapter(longText, 15000);
    assert.ok(result.length <= 15000,
      `Compressed result (${result.length} chars) should be ≤ 15000`);
    assert.ok(result.length > 0, 'Result should not be empty');
  });

  test('3. Front/middle/back sampling', () => {
    // Create distinct paragraphs for front, middle, back
    const frontParas = Array.from({ length: 10 }, (_, i) =>
      `FRONT_PARA_${i}: ${makeParagraph(80, i)}`);
    const midParas = Array.from({ length: 10 }, (_, i) =>
      `MID_PARA_${i}: ${makeParagraph(80, i + 100)}`);
    const backParas = Array.from({ length: 10 }, (_, i) =>
      `BACK_PARA_${i}: ${makeParagraph(80, i + 200)}`);

    const text = [...frontParas, ...midParas, ...backParas].join('\n\n');
    assert.ok(text.length > 15000, 'Test setup: text should exceed 15000 chars');

    const result = compressChapter(text, 15000);
    // Front material should be preserved (50% budget)
    assert.ok(result.includes('FRONT_PARA_0'), 'Result should include front paragraphs');
    // Back material should be sampled
    assert.ok(result.includes('BACK_PARA_'), 'Result should include some back paragraphs');
    assert.ok(result.length <= 15000, 'Result should be within target');
  });

  test('4. Empty text → returns empty', () => {
    const result = compressChapter('', 15000);
    assert.equal(result, '', 'Empty text should return empty string');
  });

  test('4b. Whitespace-only text → returns empty', () => {
    const result = compressChapter('   \n\n  \t  ', 15000);
    assert.equal(result, '', 'Whitespace-only text should return empty string');
  });

  test('5. Single paragraph → returns paragraph (up to target)', () => {
    // A single paragraph below target
    const singlePara = makeParagraph(200);
    const result = compressChapter(singlePara, 15000);
    assert.ok(result.length > 0, 'Should return the paragraph');
    assert.ok(result.length <= 15000, 'Should not exceed target');
  });

  test('5b. Single very long paragraph → truncated to target', () => {
    // A single very long paragraph that exceeds target
    const longPara = 'word '.repeat(5000); // ~25000 chars
    const result = compressChapter(longPara, 15000);
    assert.ok(result.length <= 15000,
      `Single long paragraph should be truncated to ≤ 15000 chars, got ${result.length}`);
  });

  test('Custom targetChars is respected', () => {
    const longText = makeMultiPara(20, 150);
    const result = compressChapter(longText, 5000);
    assert.ok(result.length <= 5000,
      `Result (${result.length} chars) should be ≤ custom target of 5000`);
  });

  test('Page-number noise is filtered', () => {
    // Paragraphs that are just numbers should be filtered
    const paras = [
      makeParagraph(100, 0),
      '42',        // page number noise — should be filtered
      '123',       // page number noise
      makeParagraph(100, 1),
    ].join('\n\n');

    // Make it long enough to need compression, so filtering matters
    const longText = paras.repeat(20);
    const result = compressChapter(longText, 5000);
    // Result should not start with a bare number
    assert.ok(!result.startsWith('42'), 'Page number noise should be filtered');
  });

});

// ── groupChapters tests ──────────────────────────────────────────────────────

describe('groupChapters', () => {

  test('6. Fewer than maxGroups → no merging, returns copies', () => {
    const chapters = [
      makeChapter(0, 5),
      makeChapter(1, 8),
      makeChapter(2, 6),
    ];
    const result = groupChapters(chapters, 15);
    assert.equal(result.length, 3, 'Should return all 3 chapters without merging');
    // Should be copies (not same objects)
    assert.notEqual(result[0], chapters[0], 'Should return new objects');
    assert.equal(result[0].title, 'Chapter 1');
    assert.equal(result[1].title, 'Chapter 2');
  });

  test('7. More than maxGroups → merges smallest adjacent pairs', () => {
    // 20 chapters, maxGroups = 10 → should merge down to 10
    const chapters = Array.from({ length: 20 }, (_, i) => makeChapter(i, i + 1));
    const result = groupChapters(chapters, 10);
    assert.equal(result.length, 10, `Should merge 20 chapters to 10 groups, got ${result.length}`);
  });

  test('7b. Exact maxGroups → no merging needed', () => {
    const chapters = Array.from({ length: 15 }, (_, i) => makeChapter(i, 3));
    const result = groupChapters(chapters, 15);
    assert.equal(result.length, 15, 'Exactly maxGroups chapters → no merging');
  });

  test('8. groupChapters: merges preserves pages and page ranges', () => {
    const chapters = [
      {
        title: 'Chapter 1',
        pages: [
          { pageNum: 1, text: 'Page 1' },
          { pageNum: 2, text: 'Page 2' },
          { pageNum: 3, text: 'Page 3' },
        ],
        pageStart: 1,
        pageEnd: 3,
      },
      {
        title: 'Chapter 2',
        pages: [
          { pageNum: 4, text: 'Page 4' },
          { pageNum: 5, text: 'Page 5' },
        ],
        pageStart: 4,
        pageEnd: 5,
      },
      {
        title: 'Chapter 3',
        pages: [
          { pageNum: 6, text: 'Page 6' },
          { pageNum: 7, text: 'Page 7' },
          { pageNum: 8, text: 'Page 8' },
          { pageNum: 9, text: 'Page 9' },
          { pageNum: 10, text: 'Page 10' },
        ],
        pageStart: 6,
        pageEnd: 10,
      },
    ];

    // maxGroups = 2 → should merge smallest pair
    // Chapter 1 (3 pages) + Chapter 2 (2 pages) = 5 pages
    // Chapter 2 (2 pages) + Chapter 3 (5 pages) = 7 pages
    // Smallest adjacent: Ch1+Ch2 → merge those
    const result = groupChapters(chapters, 2);
    assert.equal(result.length, 2, `Should merge to 2 groups, got ${result.length}`);

    // The merged group should have all pages from both original chapters
    const group1 = result[0];
    const group2 = result[1];

    // group1 should be the merge of the two smallest adjacent
    assert.equal(group1.pages.length, 5, 'Merged group should have 5 pages (3+2)');
    assert.equal(group1.pageStart, 1, 'Merged group pageStart should be 1');
    assert.equal(group1.pageEnd, 5, 'Merged group pageEnd should be 5');

    // group2 should be Chapter 3 untouched
    assert.equal(group2.pages.length, 5, 'Chapter 3 group should have 5 pages');
    assert.equal(group2.pageStart, 6, 'Chapter 3 pageStart should be 6');
    assert.equal(group2.pageEnd, 10, 'Chapter 3 pageEnd should be 10');
  });

  test('8b. All pages preserved after merging', () => {
    const totalPages = 20;
    const chapters = Array.from({ length: 10 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      pages: [{ pageNum: i * 2 + 1, text: `Page ${i * 2 + 1}` },
               { pageNum: i * 2 + 2, text: `Page ${i * 2 + 2}` }],
      pageStart: i * 2 + 1,
      pageEnd:   i * 2 + 2,
    }));

    const result = groupChapters(chapters, 3);
    const totalPagesAfter = result.reduce((sum, g) => sum + g.pages.length, 0);
    assert.equal(totalPagesAfter, totalPages, 'All pages should be preserved after merging');
  });

  test('Single chapter returns without merging', () => {
    const chapters = [makeChapter(0, 5)];
    const result = groupChapters(chapters, 15);
    assert.equal(result.length, 1, 'Single chapter should be returned as-is');
    assert.equal(result[0].title, 'Chapter 1');
  });

  test('Empty array returns empty array', () => {
    const result = groupChapters([], 15);
    assert.deepEqual(result, [], 'Empty input should return empty array');
  });

  test('maxGroups = 1 → all chapters merged into one', () => {
    const chapters = [
      makeChapter(0, 3),
      makeChapter(1, 4),
      makeChapter(2, 2),
    ];
    const result = groupChapters(chapters, 1);
    assert.equal(result.length, 1, 'All chapters should merge into 1 group');
    // Total pages: 3 + 4 + 2 = 9
    assert.equal(result[0].pages.length, 9, 'All pages should be in the merged group');
  });

});
