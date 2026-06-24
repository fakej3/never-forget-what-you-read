// Chapter detection — multi-strategy, gracefully degrades

// ── Heading patterns ──────────────────────────────────────────────────────────

const HEADING_PATTERNS = [
  // "Chapter 1", "Chapter 1:", "Chapter 1 —", "Ch. 3"
  /^(chapter|ch\.?)\s*\d+(\s|$|[:\-–—·])/i,
  // "Chapter One" … "Chapter Twenty"
  /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(\s|$|[:\-–—])/i,
  // Bare numbered: "1.", "12." followed by a capital letter
  /^\d{1,2}\.\s+[A-ZÀ-ɏ]/,
  // "Part 1", "Part One", "Part I"
  /^part\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivxlcIVXLC]+)(\s|$|[:\-–—])/i,
  // "Section 1"
  /^section\s+\d+(\s|$)/i,
  // Roman numeral heading: "I.", "IV.", "VIII." then a capital
  /^[IVXLC]{1,6}\.\s+[A-Za-z]/,
  // Common front/back matter
  /^(prologue|epilogue|introduction|preface|foreword|conclusion|afterword|appendix|acknowledgements?|bibliography|interlude)(\s|$|[:\-–—])/i,
];

// ── Tuning constants ──────────────────────────────────────────────────────────

const SCAN_LINES               = 10;   // lines to check per page for headings
const RUNNING_HEADER_THRESHOLD = 0.25; // fraction of pages a line must appear on to be a running header
const SPARSE_WORDS             = 200;  // word count below which a page may be a chapter title page
const FALLBACK_SECTION_SIZE    = 25;   // pages per section when all pattern detection fails

// ── Running header suppression ────────────────────────────────────────────────

/**
 * Build a set of lines that appear on ≥ RUNNING_HEADER_THRESHOLD of pages.
 * These are running headers/footers and should be ignored during chapter detection.
 */
function buildRunningHeaders(pages) {
  const freq = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim())
      .filter(l => l.length > 1 && l.length < 120);
    // Only examine the top and bottom few lines where headers/footers live
    const candidates = new Set([...lines.slice(0, SCAN_LINES), ...lines.slice(-3)]);
    for (const line of candidates) {
      freq.set(line, (freq.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(3, pages.length * RUNNING_HEADER_THRESHOLD);
  const headers   = new Set();
  for (const [line, count] of freq) {
    if (count >= threshold) headers.add(line);
  }
  return headers;
}

// ── Per-page heading detection ────────────────────────────────────────────────

function isAllCapsHeading(line) {
  if (line.length < 3 || line.length > 80) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 12) return false;
  // Must consist entirely of uppercase letters, digits, and common punctuation
  return /^[A-Z0-9\s\-–—:,.'!?"""'']+$/.test(line) && /[A-Z]{2,}/.test(line);
}

/**
 * Scan a page's text for a chapter heading.
 * Returns the heading string or null.
 * runningHeaders — set of lines to ignore (they appear on nearly every page)
 */
function findHeading(pageText, runningHeaders) {
  const lines     = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const wordCount = pageText.split(/\s+/).filter(Boolean).length;
  const isSparse  = wordCount < SPARSE_WORDS;

  const limit = Math.min(SCAN_LINES, lines.length);

  // Pass 1: strict pattern match across first SCAN_LINES
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (runningHeaders.has(line)) continue;
    if (/^\d+$/.test(line))      continue; // bare page numbers
    if (line.length < 2 || line.length > 120) continue;

    for (const pat of HEADING_PATTERNS) {
      if (pat.test(line)) return line;
    }
  }

  // Pass 2: on sparse pages, also accept ALL-CAPS headings
  // (covers books like T&GR where chapters use descriptive ALL-CAPS names)
  if (isSparse) {
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i];
      if (runningHeaders.has(line)) continue;
      if (/^\d+$/.test(line))      continue;
      if (isAllCapsHeading(line))  return line;
    }
  }

  return null;
}

// ── Detection strategies ──────────────────────────────────────────────────────

/** Strategy A — PDF outline (TOC). Most reliable when present. */
function detectFromOutline(pages, outline) {
  if (!outline || outline.length < 2) return null;

  const lastPageNum = pages[pages.length - 1]?.pageNum ?? pages.length;
  const chapters    = [];

  for (let i = 0; i < outline.length; i++) {
    const entry    = outline[i];
    const nextEntry = outline[i + 1];

    const startPage = entry.pageNum;
    const endPage   = nextEntry ? nextEntry.pageNum - 1 : lastPageNum;

    const chapterPages = pages.filter(p => p.pageNum >= startPage && p.pageNum <= endPage);
    if (chapterPages.length === 0) continue;

    chapters.push({
      title:     entry.title,
      pages:     chapterPages,
      pageStart: startPage,
      pageEnd:   endPage,
    });
  }

  return chapters.length >= 2 ? chapters : null;
}

/** Strategy B — Pattern matching with running-header suppression. */
function detectFromPatterns(pages) {
  const runningHeaders = buildRunningHeaders(pages);
  const chapters       = [];
  let   current        = null;

  for (const page of pages) {
    const heading = findHeading(page.text, runningHeaders);

    if (heading) {
      if (current) chapters.push(current);
      current = { title: heading, pages: [page], pageStart: page.pageNum };
    } else if (current) {
      current.pages.push(page);
    } else {
      // Pages before the first detected chapter (front matter)
      current = { title: 'Introduction', pages: [page], pageStart: page.pageNum };
    }
  }

  if (current) chapters.push(current);

  return chapters.map(ch => ({
    ...ch,
    pageEnd: ch.pages[ch.pages.length - 1]?.pageNum ?? ch.pageStart,
  }));
}

/** Strategy C — N-page sections fallback. Used when no headings are detected. */
function createPageSections(pages, sectionSize) {
  const sections = [];
  for (let i = 0; i < pages.length; i += sectionSize) {
    const chunk = pages.slice(i, i + sectionSize);
    const num   = sections.length + 1;
    sections.push({
      title:     `Section ${num} (pp. ${chunk[0].pageNum}–${chunk[chunk.length - 1].pageNum})`,
      pages:     chunk,
      pageStart: chunk[0].pageNum,
      pageEnd:   chunk[chunk.length - 1].pageNum,
    });
  }
  return sections;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect chapters using three strategies in priority order:
 *   A. PDF outline (TOC)
 *   B. Heading pattern matching + running-header suppression
 *   C. N-page sections fallback
 *
 * @param {Array}  pages   - [{ pageNum, text }]
 * @param {Array}  outline - [{ title, pageNum }] from PDF.js getOutline(), or []
 * @returns Array of chapter objects: { title, pages, pageStart, pageEnd }
 */
export function detectChapters(pages, outline = []) {
  if (!pages || pages.length === 0) return [];

  // Strategy A: PDF outline
  if (outline && outline.length >= 2) {
    const result = detectFromOutline(pages, outline);
    if (result) return result;
  }

  // Strategy B: Pattern matching
  const patternResult = detectFromPatterns(pages);
  if (patternResult.length >= 3) return patternResult;

  // Strategy C: N-page sections (for books where heading detection fails)
  if (pages.length >= 20) {
    // Target ~8-20 sections regardless of book length
    const targetSections = Math.min(20, Math.max(5, Math.floor(pages.length / 20)));
    const sectionSize    = Math.ceil(pages.length / targetSections);
    return createPageSections(pages, sectionSize);
  }

  // Short book with no detected structure — single section
  return [{
    title:     'Full Book',
    pages,
    pageStart: pages[0]?.pageNum ?? 1,
    pageEnd:   pages[pages.length - 1]?.pageNum ?? pages.length,
  }];
}

// ── Chunking (kept for reference; pipeline no longer uses per-chunk AI calls) ─

const TARGET_CHARS  = 14000;
const OVERLAP_CHARS = 150;

export function chunkChapter(chapter, chapterIndex, bookId) {
  const fullText = chapter.pages.map(p => p.text).join('\n\n');

  if (!fullText.trim()) {
    return [{
      id:           `${bookId}-${chapterIndex}-0`,
      chapterIndex,
      chunkIndex:   0,
      chapterTitle: chapter.title,
      pageStart:    chapter.pageStart,
      pageEnd:      chapter.pageEnd,
      text:         '',
      summary:      null,
    }];
  }

  const chunks   = [];
  let   offset   = 0;
  let   chunkIdx = 0;

  while (offset < fullText.length) {
    const end = Math.min(offset + TARGET_CHARS, fullText.length);
    let breakAt = end;
    if (end < fullText.length) {
      const nlPos = fullText.lastIndexOf('\n\n', end);
      if (nlPos > offset + TARGET_CHARS * 0.6) breakAt = nlPos;
    }
    const text = fullText.slice(offset, breakAt).trim();
    if (text.length > 0) {
      chunks.push({
        id:           `${bookId}-${chapterIndex}-${chunkIdx}`,
        chapterIndex,
        chunkIndex:   chunkIdx,
        chapterTitle: chapter.title,
        pageStart:    chapter.pageStart,
        pageEnd:      chapter.pageEnd,
        text,
        summary:      null,
      });
      chunkIdx++;
    }
    const next = breakAt - OVERLAP_CHARS;
    offset = next > offset ? next : breakAt;
  }

  return chunks;
}

export function buildChunks(pages, bookId) {
  const chapters  = detectChapters(pages);
  const allChunks = [];
  chapters.forEach((ch, i) => allChunks.push(...chunkChapter(ch, i, bookId)));
  return { chapters, chunks: allChunks };
}
