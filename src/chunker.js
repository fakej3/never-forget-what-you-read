// Chapter detection — confidence-based, multi-strategy, gracefully degrades
//
// Detection order:
//   A. PDF outline (TOC) — most reliable when present
//   B. Scoring engine — rich per-line features + keyword patterns
//   C. N-page sections — last resort

// ── Number conversion utilities ────────────────────────────────────────────────

const WORD_INT = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,'twenty-one':21,'twenty-two':22,
  'twenty-three':23,'twenty-four':24,'twenty-five':25,'twenty-six':26,
  'twenty-seven':27,'twenty-eight':28,'twenty-nine':29,thirty:30,
};

function wordToInt(s) {
  return WORD_INT[s.toLowerCase().replace(/\s+/g, '-').trim()] ?? null;
}

const ROMAN_VAL = { I:1,V:5,X:10,L:50,C:100,D:500,M:1000 };
function romanToInt(s) {
  const u = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(u)) return null;
  let total = 0, prev = 0;
  for (const c of [...u].reverse()) {
    const v = ROMAN_VAL[c];
    if (!v) return null;
    if (v < prev) total -= v; else { total += v; prev = v; }
  }
  return total > 0 && total <= 500 ? total : null;
}

// ── Tuning constants ──────────────────────────────────────────────────────────

const SCAN_LINES               = 12;   // lines to check per page for headings
const RUNNING_HEADER_THRESHOLD = 0.20; // fraction of pages → running header (stricter)
const SPARSE_WORDS             = 250;  // word count below which a page may be a title page
const SEQ_MIN_COVERAGE         = 0.60; // numbered seq must cover this fraction of all headings
const SEQ_MIN_CONTINUITY       = 0.75; // fraction of transitions that are +1 (or +2 max)

// ── Heading patterns ──────────────────────────────────────────────────────────

const HEADING_PATTERNS = [
  // "Chapter N" — title after number must start with uppercase, colon/dash, or be end-of-line
  /^(chapter|ch\.?)\s*\d+(?:\s*$|\s*[:\-–—·]|\s+[A-ZÀ-ɏ0-9])/i,
  // "Chapter One/Two/..." — same rule
  /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s*$|\s*[:\-–—]|\s+[A-ZÀ-ɏ])/i,
  /^\d{1,2}\.\s+[A-ZÀ-ɏ]/,
  // Part N must be at end-of-line or followed by colon/dash (not arbitrary prose words)
  /^part\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivxlcIVXLC]+)(?:\s*$|\s*[:\-–—])/i,
  /^section\s+\d+(\s|$)/i,
  /^[IVXLC]{1,6}\.\s+[A-Za-z]/,
  // Front/back matter keywords must be at end-of-line or followed by colon/dash (not prose)
  /^(prologue|epilogue|introduction|preface|foreword|conclusion|afterword|appendix|acknowledgements?|bibliography|interlude)(?:\s*$|\s*[:\-–—])/i,
];

// ── Running header suppression ─────────────────────────────────────────────────

function buildRunningHeaders(pages) {
  const freq = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim())
      .filter(l => l.length > 1 && l.length < 120);
    const candidates = new Set([...lines.slice(0, SCAN_LINES), ...lines.slice(-3)]);
    for (const line of candidates) freq.set(line, (freq.get(line) || 0) + 1);
  }
  const threshold = Math.max(3, pages.length * RUNNING_HEADER_THRESHOLD);
  const headers = new Set();
  for (const [line, count] of freq) {
    if (count >= threshold) headers.add(line);
  }
  return headers;
}

// ── Per-page heading detection ─────────────────────────────────────────────────

function isAllCapsHeading(line) {
  if (line.length < 3 || line.length > 80) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 12) return false;
  return /^[A-Z0-9\s\-–—:,.'!?"""'']+$/.test(line) && /[A-Z]{2,}/.test(line);
}

// Accepted on the line following a bare "CHAPTER" / "PART" label
const WORD_NUMBERS_RE = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|\d{1,3})$/i;

function findHeading(pageText, runningHeaders) {
  const lines     = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const wordCount = pageText.split(/\s+/).filter(Boolean).length;
  const isSparse  = wordCount < SPARSE_WORDS;
  const limit     = Math.min(SCAN_LINES, lines.length);

  // Pass 0: multi-line headings — "CHAPTER" / "ONE" / optional title on separate lines
  for (let i = 0; i < Math.min(limit, lines.length - 1); i++) {
    const line = lines[i];
    if (runningHeaders.has(line)) continue;
    if (/^(chapter|part)$/i.test(line)) {
      const next = lines[i + 1];
      if (next && !runningHeaders.has(next) && WORD_NUMBERS_RE.test(next.trim())) {
        const titleLine = lines[i + 2];
        const title = titleLine && !runningHeaders.has(titleLine)
          && !WORD_NUMBERS_RE.test(titleLine) && titleLine.length < 80
          ? `${line} ${next} — ${titleLine}`
          : `${line} ${next}`;
        return title;
      }
    }
  }

  // Pass 1: strict pattern match across first SCAN_LINES
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (runningHeaders.has(line)) continue;
    if (/^\d+$/.test(line)) continue; // bare page numbers
    if (line.length < 2 || line.length > 120) continue;
    for (const pat of HEADING_PATTERNS) {
      if (pat.test(line)) return line;
    }
  }

  // Pass 2: on sparse pages, also accept ALL-CAPS headings
  if (isSparse) {
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const line = lines[i];
      if (runningHeaders.has(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (isAllCapsHeading(line)) return line;
    }
  }

  return null;
}

// ── Chapter number extraction ──────────────────────────────────────────────────

/**
 * Given a detected heading title, return its integer chapter/part number or null.
 * Handles: "Chapter 7", "Chapter Seven", "Chapter VII", "CHAPTER ONE — Title",
 *          "Part 3", "Part Three", "Part III", "7. Title", "I. Title"
 */
function extractChapterNum(title) {
  const t = title.trim();

  // "Chapter N" / "Ch. N" (arabic)
  let m = t.match(/^(?:chapter|ch\.?)\s+(\d{1,3})(?:\s|$|[:\-–—·])/i);
  if (m) return { value: parseInt(m[1]), kind: 'chapter' };

  // "Chapter Word" including multi-line synthesised "CHAPTER ONE — Title"
  m = t.match(/^(?:chapter|ch\.?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s|$|[:\-–—])/i);
  if (m) { const v = wordToInt(m[1]); if (v) return { value: v, kind: 'chapter' }; }

  // "Chapter VII" (roman)
  m = t.match(/^(?:chapter|ch\.?)\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v = romanToInt(m[1]); if (v) return { value: v, kind: 'chapter' }; }

  // "Part 3" / "Part Three" / "Part III"
  m = t.match(/^part\s+(\d{1,2})(?:\s|$|[:\-–—])/i);
  if (m) return { value: parseInt(m[1]), kind: 'part' };

  m = t.match(/^part\s+(one|two|three|four|five|six|seven|eight|nine|ten)(?:\s|$|[:\-–—])/i);
  if (m) { const v = wordToInt(m[1]); if (v) return { value: v, kind: 'part' }; }

  m = t.match(/^part\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v = romanToInt(m[1]); if (v) return { value: v, kind: 'part' }; }

  // "I. Title" or "IV. Title" (bare roman + period)
  m = t.match(/^([IVXLC]{1,6})\.\s+[A-Za-z]/);
  if (m) { const v = romanToInt(m[1]); if (v) return { value: v, kind: 'roman' }; }

  // "7. Title" (bare arabic + period + capital)
  m = t.match(/^(\d{1,2})\.\s+[A-ZÀ-ɏ]/);
  if (m) return { value: parseInt(m[1]), kind: 'arabic-bare' };

  return null;
}

// ── Sequence validation ────────────────────────────────────────────────────────

/**
 * Given an array of integer values in page order, compute the fraction of
 * consecutive transitions that increment by 1 (or at most 2).
 */
function sequenceContinuity(values) {
  if (values.length < 2) return 0;
  let good = 0;
  for (let i = 1; i < values.length; i++) {
    const gap = values[i] - values[i - 1];
    if (gap === 1)      good += 1;
    else if (gap === 2) good += 0.6; // single skip tolerated
  }
  return good / (values.length - 1);
}

/**
 * From a flat list of pattern-detected chapters (with _num and _kind attached),
 * find the longest internally-consistent subsequence of the dominant kind
 * (chapter > part > roman > arabic-bare).
 *
 * Returns the filtered array or null if no clean sequence found.
 */
function findBestSequence(numbered) {
  if (numbered.length < 2) return null;

  // Group by kind; prefer 'chapter' > 'part' > 'roman' > 'arabic-bare'
  const kindPriority = { chapter: 4, part: 3, roman: 2, 'arabic-bare': 1 };
  const kinds = [...new Set(numbered.map(c => c._kind))];
  kinds.sort((a, b) => (kindPriority[b] || 0) - (kindPriority[a] || 0));

  for (const kind of kinds) {
    const subset = numbered.filter(c => c._kind === kind);
    if (subset.length < 2) continue;

    const values = subset.map(c => c._num);
    const cont   = sequenceContinuity(values);
    if (cont >= SEQ_MIN_CONTINUITY) return { chapters: subset, continuity: cont, kind };
  }
  return null;
}

// ── Chapter list builder ───────────────────────────────────────────────────────

function buildChaptersFromBoundaries(boundaries, pages) {
  const lastPage = pages[pages.length - 1].pageNum;
  const chapters = [];

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].pageStart;
    const end   = i + 1 < boundaries.length ? boundaries[i + 1].pageStart - 1 : lastPage;
    const chPages = pages.filter(p => p.pageNum >= start && p.pageNum <= end);
    if (chPages.length === 0) continue;
    chapters.push({
      title:     boundaries[i].title,
      pages:     chPages,
      pageStart: start,
      pageEnd:   chPages[chPages.length - 1].pageNum,
    });
  }
  return chapters;
}

// ── Strategy A: PDF outline ───────────────────────────────────────────────────

function detectFromOutline(pages, outline) {
  if (!outline || outline.length < 2) return null;
  const lastPageNum = pages[pages.length - 1]?.pageNum ?? pages.length;
  const chapters    = [];

  for (let i = 0; i < outline.length; i++) {
    const entry     = outline[i];
    const nextEntry = outline[i + 1];
    const startPage = entry.pageNum;
    const endPage   = nextEntry ? nextEntry.pageNum - 1 : lastPageNum;
    const chPages   = pages.filter(p => p.pageNum >= startPage && p.pageNum <= endPage);
    if (chPages.length === 0) continue;
    chapters.push({ title: entry.title, pages: chPages, pageStart: startPage, pageEnd: endPage });
  }
  return chapters.length >= 2 ? chapters : null;
}

// ── Strategy B: Pattern matching ──────────────────────────────────────────────

/**
 * Detect headings by pattern matching.
 * Front-matter pages (before the first heading) are prepended to the first real
 * chapter instead of being labelled "Introduction" — eliminates fake chapters.
 */
function detectFromPatterns(pages) {
  const runningHeaders = buildRunningHeaders(pages);
  const chapters       = [];
  let   current        = null;
  const frontMatter    = []; // pages before the very first heading

  for (const page of pages) {
    const heading = findHeading(page.text, runningHeaders);

    if (heading) {
      if (current) chapters.push(current);
      // Absorb any accumulated front matter into this first chapter
      const startPages = current === null && frontMatter.length > 0
        ? [...frontMatter, page]
        : [page];
      const startPage  = startPages[0].pageNum;
      frontMatter.length = 0;
      current = { title: heading, pages: startPages, pageStart: startPage };
    } else if (current) {
      current.pages.push(page);
    } else {
      frontMatter.push(page);
    }
  }

  if (current) chapters.push(current);

  // If we never found a single heading: return empty so caller falls through
  return chapters.map(ch => ({
    ...ch,
    pageEnd: ch.pages[ch.pages.length - 1]?.pageNum ?? ch.pageStart,
  }));
}

// ── Strategy B2: Numbered sequence extraction ─────────────────────────────────

/**
 * From the pattern-detected chapter list, attempt to isolate a clean numbered
 * sequence (Chapter 1..N, Part 1..N, etc.).
 */
function extractNumberedSequence(patternChapters, pages) {
  if (patternChapters.length < 2) return null;

  // Annotate each chapter with its extracted number
  const numbered = patternChapters
    .map(ch => {
      const n = extractChapterNum(ch.title);
      return n ? { ...ch, _num: n.value, _kind: n.kind } : null;
    })
    .filter(Boolean);

  if (numbered.length < 2) return null;

  // Coverage check: numbered must represent enough of all headings
  const coverage = numbered.length / patternChapters.length;
  if (coverage < SEQ_MIN_COVERAGE) return null;

  // Find the best internally-consistent subsequence
  const best = findBestSequence(numbered);
  if (!best) return null;
  const { chapters: seq } = best;

  // Merge chapters before the first sequence member into it
  const firstSeqStart = seq[0].pageStart;
  const beforeSeq = patternChapters.filter(ch => ch.pageStart < firstSeqStart);
  if (beforeSeq.length > 0) {
    const extraPages = beforeSeq.flatMap(ch => ch.pages);
    seq[0] = {
      ...seq[0],
      pages:     [...extraPages, ...seq[0].pages],
      pageStart: extraPages[0].pageNum,
    };
  }

  // Merge chapters after the last sequence member into it
  const lastSeqStart = seq[seq.length - 1].pageStart;
  const afterSeq = patternChapters.filter(ch => ch.pageStart > lastSeqStart
    && !seq.some(s => s.pageStart === ch.pageStart));
  if (afterSeq.length > 0) {
    const extraPages = afterSeq.flatMap(ch => ch.pages);
    const last = seq[seq.length - 1];
    seq[seq.length - 1] = {
      ...last,
      pages:   [...last.pages, ...extraPages],
      pageEnd: extraPages[extraPages.length - 1].pageNum,
    };
  }

  // Recompute pageEnd for each chapter
  return seq.map(({ _num, _kind, ...ch }) => ({
    ...ch,
    pageEnd: ch.pages[ch.pages.length - 1]?.pageNum ?? ch.pageStart,
  }));
}

// ── Strategy C: N-page sections fallback ─────────────────────────────────────

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

// ── Density validation ────────────────────────────────────────────────────────

/**
 * Returns a quality score 0–1 for a set of detected chapters.
 * Used to choose between competing detection results.
 */
function chapterQuality(chapters, totalPages) {
  if (chapters.length === 0) return 0;
  const avgPages = totalPages / chapters.length;

  // Ideal range: 3–80 pages per chapter
  let densityScore = 1;
  if (avgPages < 2)  densityScore = 0.2; // too dense → likely false positives
  if (avgPages < 4)  densityScore = 0.6;
  if (avgPages > 80) densityScore = 0.8; // very long chapters, but possible

  // Prefer results with multiple distinct chapters
  const varietyScore = Math.min(1, chapters.length / 5);

  return (densityScore * 0.7) + (varietyScore * 0.3);
}

// ── Sanity check ─────────────────────────────────────────────────────────────

function sanityCheck(chapters, totalPages) {
  if (!chapters || chapters.length === 0) return false;
  const avg = totalPages / chapters.length;
  if (avg < 1.5) return false; // too dense
  if (chapters.length === 1 && totalPages > 30) return false; // single chapter for big book
  // > 40% duplicate titles
  const titleCounts = new Map();
  for (const ch of chapters) titleCounts.set(ch.title, (titleCounts.get(ch.title) || 0) + 1);
  const dupCount = [...titleCounts.values()].filter(n => n > 1).reduce((a, b) => a + b, 0);
  if (dupCount / chapters.length > 0.4) return false;
  return true;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

function makeDiagnostics(chapters, strategy, totalPages) {
  if (!chapters || chapters.length === 0) return null;
  const pageCounts = chapters.map(ch => ch.pages.length);
  const avg  = Math.round(totalPages / chapters.length);
  const min  = Math.min(...pageCounts);
  const max  = Math.max(...pageCounts);
  const warnings = [];
  if (avg < 4)  warnings.push('suspicious density: average chapter < 4 pages');
  if (min === 0) warnings.push('one or more chapters have 0 pages');
  const titleCounts = new Map();
  for (const ch of chapters) titleCounts.set(ch.title, (titleCounts.get(ch.title) || 0) + 1);
  for (const [t, n] of titleCounts) if (n > 1) warnings.push(`duplicate heading: "${t}"`);

  return { strategy, detectedChapters: chapters.length, avgPagesPerChapter: avg, minPages: min, maxPages: max, warnings };
}

// ── Scoring engine ────────────────────────────────────────────────────────────

/**
 * Build context from pages for the scoring engine.
 */
function buildContext(pages) {
  // Compute medianFontSize from all line font sizes
  const allFontSizes = [];
  let hasRich = false;
  for (const page of pages) {
    if (page.lines && page.lines.length > 0) {
      hasRich = true;
      for (const line of page.lines) {
        if (line.fontSize > 0) allFontSizes.push(line.fontSize);
      }
    }
  }

  let medianFontSize = 12;
  if (allFontSizes.length > 0) {
    allFontSizes.sort((a, b) => a - b);
    const mid = Math.floor(allFontSizes.length / 2);
    medianFontSize = allFontSizes.length % 2 === 0
      ? (allFontSizes[mid - 1] + allFontSizes[mid]) / 2
      : allFontSizes[mid];
  }

  // Get page dimensions from first page that has them
  let pageWidth = 612, pageHeight = 792;
  for (const page of pages) {
    if (page.width && page.height) {
      pageWidth = page.width;
      pageHeight = page.height;
      break;
    }
  }

  // Build runningHeaders: lines appearing on >= max(3, pages.length * 0.20) pages
  const lineFreq = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim())
      .filter(l => l.length > 1 && l.length < 120);
    const candidates = new Set([...lines.slice(0, 3), ...lines.slice(-2)]);
    for (const line of candidates) {
      lineFreq.set(line, (lineFreq.get(line) || 0) + 1);
    }
  }
  const runningHeaderThreshold = Math.max(3, pages.length * 0.20);
  const runningHeaders = new Set();
  for (const [line, count] of lineFreq) {
    if (count >= runningHeaderThreshold) runningHeaders.add(line);
  }

  // Build everyPageLines: lines appearing on >= 60% of pages
  const everyPageLines = new Set();
  const everyPageThreshold = pages.length * 0.60;
  for (const [line, count] of lineFreq) {
    if (count >= everyPageThreshold) everyPageLines.add(line);
  }

  return { medianFontSize, pageWidth, pageHeight, runningHeaders, everyPageLines, hasRich };
}

/**
 * Score a single line for likelihood of being a chapter heading.
 * Returns { score, reasons }
 */
function scoreLine(text, lineOpts, ctx) {
  const {
    y = 0, fontSize = 0, bold = false, italic = false,
    x = 0, lineWidth = 0, lineIndex = 0, pageWordCount = 0,
    gapAbove = 0, gapBelow = 0,
    pageHeight = ctx.pageHeight || 792,
    pageWidth  = ctx.pageWidth  || 612,
  } = lineOpts;

  let score = 0;
  const reasons = [];

  // CHAPTER_KEYWORD: +50
  for (const pat of HEADING_PATTERNS) {
    if (pat.test(text)) {
      score += 50;
      reasons.push('CHAPTER_KEYWORD');
      break;
    }
  }

  // Font size scoring (exclusive)
  if (fontSize > 0 && ctx.medianFontSize > 0) {
    const ratio = fontSize / ctx.medianFontSize;
    if (ratio >= 1.5) {
      score += 25; reasons.push('LARGE_FONT_BIG');
    } else if (ratio >= 1.25) {
      score += 20; reasons.push('LARGE_FONT');
    } else if (ratio >= 1.1) {
      score += 8; reasons.push('LARGE_FONT_SMALL');
    }
  }

  // BOLD: +12
  if (bold) { score += 12; reasons.push('BOLD'); }

  // CENTERED: +15 — only for lines narrower than 70% of page width.
  // Full-width justified body text has its midpoint at the page centre by geometry
  // (equal left/right margins); without this width gate, every body-text first-line
  // would earn CENTERED and generate a false-positive chapter candidate.
  const pageCenter = pageWidth / 2;
  const lineCenter = x + lineWidth / 2;
  if (lineWidth > 0 && lineWidth < pageWidth * 0.70 && Math.abs(lineCenter - pageCenter) < 60) {
    score += 15; reasons.push('CENTERED');
  }

  // TOP_QUARTER: +15  y >= pageHeight * 0.75 (PDF coords: 0=bottom)
  if (y >= pageHeight * 0.75) {
    score += 15; reasons.push('TOP_QUARTER');
  }

  // WHITESPACE_ABOVE: +10
  if (gapAbove >= 18) { score += 10; reasons.push('WHITESPACE_ABOVE'); }

  // WHITESPACE_BELOW: +10
  if (gapBelow >= 18) { score += 10; reasons.push('WHITESPACE_BELOW'); }

  // SHORT_LINE: +8
  const isShortLine = text.length < 60;
  if (isShortLine) { score += 8; reasons.push('SHORT_LINE'); }

  // ALL_CAPS: +10
  const alphaChars = text.replace(/[^a-zA-Z]/g, '');
  const upperChars = text.replace(/[^A-Z]/g, '');
  const isAllCaps  = alphaChars.length >= 2 && upperChars.length / alphaChars.length >= 0.70;
  if (isAllCaps) { score += 10; reasons.push('ALL_CAPS'); }

  // STARTS_PAGE: +10
  if (lineIndex === 0) { score += 10; reasons.push('STARTS_PAGE'); }

  // SPARSE_PAGE: +15 (only when ALL_CAPS or SHORT_LINE applies)
  if (pageWordCount < 200 && (isAllCaps || isShortLine)) {
    score += 15; reasons.push('SPARSE_PAGE');
  }

  // ROMAN_NUMERAL: +12  matches /^[IVXLC]{1,6}\.\s+[A-Za-z]/
  if (/^[IVXLC]{1,6}\.\s+[A-Za-z]/.test(text)) {
    score += 12; reasons.push('ROMAN_NUMERAL');
  }

  // WORD_NUMBER: +8  starts with spelled-out number
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i.test(text)) {
    score += 8; reasons.push('WORD_NUMBER');
  }

  // ISOLATED: +8  both gaps >= 18 AND text.length < 60
  if (gapAbove >= 18 && gapBelow >= 18 && text.length < 60) {
    score += 8; reasons.push('ISOLATED');
  }

  // ── Penalties ──

  // RUNNING_HEADER: -40
  if (ctx.runningHeaders.has(text)) {
    score -= 40; reasons.push('RUNNING_HEADER');
  }

  // EVERY_PAGE: -60
  if (ctx.everyPageLines.has(text)) {
    score -= 60; reasons.push('EVERY_PAGE');
  }

  // LOWERCASE_START: -30
  if (/^[a-z]/.test(text)) {
    score -= 30; reasons.push('LOWERCASE_START');
  }

  // PROSE_LENGTH: -25
  if (text.length > 120) {
    score -= 25; reasons.push('PROSE_LENGTH');
  }

  // BOTTOM_QUARTER: -20  y < pageHeight * 0.25 (PDF coords: 0=bottom)
  if (y < pageHeight * 0.25) {
    score -= 20; reasons.push('BOTTOM_QUARTER');
  }

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

/**
 * Score all pages and collect chapter candidates.
 */
function scorePages(pages, ctx, threshold = 40) {
  const candidates = [];

  for (const page of pages) {
    const pageWordCount = page.text.split(/\s+/).filter(Boolean).length;
    let pageLines;

    if (page.lines && page.lines.length > 0) {
      // Rich mode: use actual line data
      pageLines = page.lines;
    } else {
      // Text-only mode: reconstruct pseudo-lines
      const textLines = page.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      pageLines = textLines.map((text, idx) => ({
        text,
        y:         792 - idx * 12,   // simulate top-of-page ordering
        x:         0,
        lineWidth: 0,
        fontSize:  ctx.medianFontSize,
        bold:      false,
        italic:    false,
      }));
    }

    const limit = Math.min(SCAN_LINES, pageLines.length);

    // Pass 0: multi-line headings check (first 12 lines)
    let pass0Found = false;
    for (let i = 0; i < Math.min(limit, pageLines.length - 1); i++) {
      const lineText = pageLines[i].text.trim();
      if (ctx.runningHeaders.has(lineText)) continue;
      if (/^(chapter|part)$/i.test(lineText)) {
        const next = pageLines[i + 1];
        if (next && !ctx.runningHeaders.has(next.text.trim()) && WORD_NUMBERS_RE.test(next.text.trim())) {
          const titleLine = pageLines[i + 2];
          const title = titleLine && !ctx.runningHeaders.has(titleLine.text.trim())
            && !WORD_NUMBERS_RE.test(titleLine.text.trim()) && titleLine.text.length < 80
            ? `${lineText} ${next.text.trim()} — ${titleLine.text.trim()}`
            : `${lineText} ${next.text.trim()}`;
          candidates.push({ pageNum: page.pageNum, title, score: 85, reasons: ['MULTI_LINE_HEADING'] });
          pass0Found = true;
          break;
        }
      }
    }
    if (pass0Found) continue;

    // Pass 1: score first 12 lines
    let bestScore = -1;
    let bestCandidate = null;

    for (let i = 0; i < limit; i++) {
      const lineObj = pageLines[i];
      const lineText = lineObj.text.trim();
      if (!lineText || lineText.length < 2 || lineText.length > 120) continue;
      if (/^\d+$/.test(lineText)) continue; // bare page numbers

      // Compute gaps between lines
      const prevLine = i > 0 ? pageLines[i - 1] : null;
      const nextLine = i < pageLines.length - 1 ? pageLines[i + 1] : null;
      const gapAbove = prevLine ? Math.abs(lineObj.y - prevLine.y) - (lineObj.fontSize || 12) : 30;
      const gapBelow = nextLine ? Math.abs(nextLine.y - lineObj.y) - (lineObj.fontSize || 12) : 30;

      const lineOpts = {
        y:             lineObj.y,
        fontSize:      lineObj.fontSize || ctx.medianFontSize,
        bold:          lineObj.bold || false,
        italic:        lineObj.italic || false,
        x:             lineObj.x || 0,
        lineWidth:     lineObj.lineWidth || 0,
        lineIndex:     i,
        pageWordCount,
        gapAbove:      Math.max(0, gapAbove),
        gapBelow:      Math.max(0, gapBelow),
        pageHeight:    ctx.pageHeight,
        pageWidth:     ctx.pageWidth,
      };

      const { score, reasons } = scoreLine(lineText, lineOpts, ctx);

      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestCandidate = { pageNum: page.pageNum, title: lineText, score, reasons };
      }
    }

    if (bestCandidate) {
      // On dense pages (≥200 words) with no structural signal, a high-scoring line
      // is almost certainly a positional false-positive (first body paragraph line at
      // the top of a page).  Require at least one signal that isn't purely geometric.
      const hasMeaningfulSignal = bestCandidate.reasons.some(r => [
        'CHAPTER_KEYWORD', 'LARGE_FONT', 'LARGE_FONT_BIG', 'BOLD',
        'ALL_CAPS', 'ROMAN_NUMERAL', 'MULTI_LINE_HEADING',
      ].includes(r));
      if (hasMeaningfulSignal || pageWordCount < 200) {
        candidates.push(bestCandidate);
      }
      continue;
    }

    // Pass 2: sparse pages — check ALL-CAPS lines with lower bar
    if (pageWordCount < 200) {
      for (let i = 0; i < Math.min(8, pageLines.length); i++) {
        const lineObj  = pageLines[i];
        const lineText = lineObj.text.trim();
        if (!lineText || /^\d+$/.test(lineText)) continue;

        const alphaChars = lineText.replace(/[^a-zA-Z]/g, '');
        const upperChars = lineText.replace(/[^A-Z]/g, '');
        const isAllCapsLine = alphaChars.length >= 2 && upperChars.length / alphaChars.length >= 0.70;

        if (isAllCapsLine && !ctx.runningHeaders.has(lineText) && !ctx.everyPageLines.has(lineText)) {
          const prevLine = i > 0 ? pageLines[i - 1] : null;
          const nextLine = i < pageLines.length - 1 ? pageLines[i + 1] : null;
          const gapAbove = prevLine ? Math.abs(lineObj.y - prevLine.y) - (lineObj.fontSize || 12) : 30;
          const gapBelow = nextLine ? Math.abs(nextLine.y - lineObj.y) - (lineObj.fontSize || 12) : 30;

          const lineOpts = {
            y: lineObj.y, fontSize: lineObj.fontSize || ctx.medianFontSize,
            bold: lineObj.bold || false, italic: lineObj.italic || false,
            x: lineObj.x || 0, lineWidth: lineObj.lineWidth || 0,
            lineIndex: i, pageWordCount,
            gapAbove: Math.max(0, gapAbove), gapBelow: Math.max(0, gapBelow),
            pageHeight: ctx.pageHeight, pageWidth: ctx.pageWidth,
          };
          const { score, reasons } = scoreLine(lineText, lineOpts, ctx);
          if (score >= 25) {
            candidates.push({ pageNum: page.pageNum, title: lineText, score, reasons });
            break;
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Build chapter list from scored candidates.
 */
function buildChaptersFromCandidates(candidates, pages) {
  if (candidates.length === 0) return [];

  const chapters = [];
  let frontMatter = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const nextCand = candidates[i + 1];
    const startPage = cand.pageNum;
    const endPage   = nextCand ? nextCand.pageNum - 1 : pages[pages.length - 1].pageNum;
    const chPages   = pages.filter(p => p.pageNum >= startPage && p.pageNum <= endPage);

    if (chPages.length === 0) continue;
    chapters.push({
      title:     cand.title,
      pages:     chPages,
      pageStart: startPage,
      pageEnd:   chPages[chPages.length - 1].pageNum,
      _score:    cand.score,
    });
  }

  // Merge front-matter (pages before first candidate) into first chapter
  if (chapters.length > 0 && candidates[0].pageNum > pages[0].pageNum) {
    const firstCandPage = candidates[0].pageNum;
    const prePages = pages.filter(p => p.pageNum < firstCandPage);
    if (prePages.length > 0) {
      chapters[0] = {
        ...chapters[0],
        pages:     [...prePages, ...chapters[0].pages],
        pageStart: prePages[0].pageNum,
      };
    }
  }

  return chapters.map(({ _score, ...ch }) => ({
    ...ch,
    pageEnd: ch.pages[ch.pages.length - 1]?.pageNum ?? ch.pageStart,
  }));
}

/**
 * Smart structural fallback: dense page followed by sparse page with short capitalized first line.
 */
function smartStructuralFallback(pages) {
  const breaks = [];

  for (let i = 1; i < pages.length; i++) {
    const prevPage = pages[i - 1];
    const currPage = pages[i];
    const prevWords = prevPage.text.split(/\s+/).filter(Boolean).length;
    const currWords = currPage.text.split(/\s+/).filter(Boolean).length;

    if (prevWords > 80 && currWords < 60) {
      // Check if first non-empty line of current page is short and capitalized
      const firstLine = currPage.text.split('\n').map(l => l.trim()).find(l => l.length > 0);
      if (firstLine && /^[A-Z]/.test(firstLine) && firstLine.length < 60) {
        breaks.push({ pageNum: currPage.pageNum, title: firstLine });
      }
    }
  }

  if (breaks.length < 2) return null;
  return buildChaptersFromCandidates(breaks, pages);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect chapters using strategies in priority order:
 *   A. PDF outline (TOC)
 *   B. Scoring engine (rich features + keyword patterns)
 *   C. N-page sections fallback
 *
 * @param {Array}  pages   - [{ pageNum, text }] or [{ pageNum, text, width, height, lines }]
 * @param {Array}  outline - [{ title, pageNum }] from PDF.js getOutline(), or []
 * @param {Object} opts    - { debug: boolean }
 * @returns Array of chapter objects: { title, pages, pageStart, pageEnd, _diagnostics? }
 */
export function detectChapters(pages, outline = [], opts = {}) {
  if (!pages || pages.length === 0) return [];
  console.log(`[chunker] detectChapters: ${pages.length} pages, outline entries: ${(outline||[]).length}`);

  // Strategy A: PDF outline
  if (outline && outline.length >= 2) {
    const result = detectFromOutline(pages, outline);
    if (result) {
      console.log(`[chunker] STRATEGY=pdf-outline → returning ${result.length} chapters`);
      result._diagnostics = makeDiagnostics(result, 'pdf-outline', pages.length);
      if (opts.debug) {
        result._debug = {
          strategy: 'pdf-outline',
          richFeatures: false,
          medianFontSize: 12,
          runningHeaders: [],
          allCandidates: [],
          rejectedCandidates: [],
        };
      }
      return result;
    }
    console.log(`[chunker] pdf-outline rejected (detectFromOutline returned null)`);
  }

  // Build scoring context
  const ctx = buildContext(pages);

  // Stage 3: Score all pages and collect candidates
  const allCandidates = scorePages(pages, ctx, 40);
  const rejectedCandidates = [];
  console.log(`[chunker] raw candidates (score≥40): ${allCandidates.length}`);

  // Try scoring-based approach
  if (allCandidates.length >= 2) {
    // Build chapter list from candidates
    const scoredChapters = buildChaptersFromCandidates(allCandidates, pages);
    console.log(`[chunker] scored chapters (built from candidates): ${scoredChapters.length}`);

    if (scoredChapters.length >= 2) {
      // Try numbered sequence from scored results
      const seqResult = extractNumberedSequence(scoredChapters, pages);
      if (seqResult && seqResult.length >= 2) {
        const q = chapterQuality(seqResult, pages.length);
        const sane = sanityCheck(seqResult, pages.length);
        console.log(`[chunker] numbered-sequence from scoring: ${seqResult.length} chapters, quality=${q.toFixed(2)}, sanity=${sane}`);
        if (q >= 0.35 && sane) {
          console.log(`[chunker] STRATEGY=numbered-sequence → returning ${seqResult.length} chapters`);
          seqResult._diagnostics = makeDiagnostics(seqResult, 'numbered-sequence', pages.length);
          if (opts.debug) {
            seqResult._debug = {
              strategy: 'numbered-sequence',
              richFeatures: ctx.hasRich,
              medianFontSize: ctx.medianFontSize,
              runningHeaders: [...ctx.runningHeaders],
              allCandidates,
              rejectedCandidates,
            };
          }
          return seqResult;
        }
        console.log(`[chunker] numbered-sequence rejected (quality<0.35 or sanity=false)`);
      } else {
        console.log(`[chunker] numbered-sequence from scoring: none found or <2`);
      }

      // Try raw scored chapters
      const q = chapterQuality(scoredChapters, pages.length);
      const sane = sanityCheck(scoredChapters, pages.length);
      console.log(`[chunker] raw-scoring: ${scoredChapters.length} chapters, quality=${q.toFixed(2)}, sanity=${sane}`);
      if (q >= 0.25 && sane) {
        console.log(`[chunker] STRATEGY=raw-scoring → returning ${scoredChapters.length} chapters ← LIKELY OVERCOUNTING`);
        scoredChapters._diagnostics = makeDiagnostics(scoredChapters, 'scoring', pages.length);
        if (opts.debug) {
          scoredChapters._debug = {
            strategy: 'scoring',
            richFeatures: ctx.hasRich,
            medianFontSize: ctx.medianFontSize,
            runningHeaders: [...ctx.runningHeaders],
            allCandidates,
            rejectedCandidates,
          };
        }
        return scoredChapters;
      }
      console.log(`[chunker] raw-scoring rejected (quality<0.25 or sanity=false)`);
    }

    // Retry with relaxed threshold (threshold - 15 = 25)
    const relaxedCandidates = scorePages(pages, ctx, 25);
    console.log(`[chunker] relaxed candidates (score≥25): ${relaxedCandidates.length}`);
    if (relaxedCandidates.length >= 2) {
      const relaxedChapters = buildChaptersFromCandidates(relaxedCandidates, pages);
      console.log(`[chunker] relaxed chapters: ${relaxedChapters.length}`);
      if (relaxedChapters.length >= 2) {
        const qr = chapterQuality(relaxedChapters, pages.length);
        const saner = sanityCheck(relaxedChapters, pages.length);
        console.log(`[chunker] relaxed-scoring: quality=${qr.toFixed(2)}, sanity=${saner}`);
        if (qr >= 0.25 && saner) {
          console.log(`[chunker] STRATEGY=relaxed-scoring → returning ${relaxedChapters.length} chapters`);
          relaxedChapters._diagnostics = makeDiagnostics(relaxedChapters, 'scoring', pages.length);
          if (opts.debug) {
            relaxedChapters._debug = {
              strategy: 'scoring',
              richFeatures: ctx.hasRich,
              medianFontSize: ctx.medianFontSize,
              runningHeaders: [...ctx.runningHeaders],
              allCandidates: relaxedCandidates,
              rejectedCandidates,
            };
          }
          return relaxedChapters;
        }
        console.log(`[chunker] relaxed-scoring rejected`);
      }
    }
  } else {
    console.log(`[chunker] scoring: <2 candidates, skipping scoring strategies`);
  }

  // Fall back to old pattern detection for backward compat
  const patternResult = detectFromPatterns(pages);
  console.log(`[chunker] pattern-detection: ${patternResult.length} chapters`);

  if (patternResult.length >= 2) {
    // Try to refine to a clean numbered sequence
    const seqResult = extractNumberedSequence(patternResult, pages);
    if (seqResult && seqResult.length >= 2) {
      const q = chapterQuality(seqResult, pages.length);
      const sane = sanityCheck(seqResult, pages.length);
      console.log(`[chunker] numbered-sequence from patterns: ${seqResult.length} chapters, quality=${q.toFixed(2)}, sanity=${sane}`);
      if (q >= 0.35 && sane) {
        console.log(`[chunker] STRATEGY=numbered-sequence(patterns) → returning ${seqResult.length} chapters`);
        seqResult._diagnostics = makeDiagnostics(seqResult, 'numbered-sequence', pages.length);
        if (opts.debug) {
          seqResult._debug = {
            strategy: 'numbered-sequence',
            richFeatures: ctx.hasRich,
            medianFontSize: ctx.medianFontSize,
            runningHeaders: [...ctx.runningHeaders],
            allCandidates,
            rejectedCandidates,
          };
        }
        return seqResult;
      }
      console.log(`[chunker] numbered-sequence(patterns) rejected`);
    } else {
      console.log(`[chunker] numbered-sequence from patterns: none found or <2`);
    }
    // Fall back to raw pattern result
    const q = chapterQuality(patternResult, pages.length);
    const sane = sanityCheck(patternResult, pages.length);
    console.log(`[chunker] raw-patterns: quality=${q.toFixed(2)}, sanity=${sane}`);
    if (q >= 0.25 && sane) {
      console.log(`[chunker] STRATEGY=raw-patterns → returning ${patternResult.length} chapters`);
      patternResult._diagnostics = makeDiagnostics(patternResult, 'patterns', pages.length);
      if (opts.debug) {
        patternResult._debug = {
          strategy: 'patterns',
          richFeatures: ctx.hasRich,
          medianFontSize: ctx.medianFontSize,
          runningHeaders: [...ctx.runningHeaders],
          allCandidates,
          rejectedCandidates,
        };
      }
      return patternResult;
    }
    console.log(`[chunker] raw-patterns rejected`);
  }

  // Stage 7: Smart structural fallback
  const structResult = smartStructuralFallback(pages);
  if (structResult && structResult.length >= 2) {
    console.log(`[chunker] STRATEGY=structural-fallback → returning ${structResult.length} chapters`);
    structResult._diagnostics = makeDiagnostics(structResult, 'structural-fallback', pages.length);
    if (opts.debug) {
      structResult._debug = {
        strategy: 'structural-fallback',
        richFeatures: ctx.hasRich,
        medianFontSize: ctx.medianFontSize,
        runningHeaders: [...ctx.runningHeaders],
        allCandidates,
        rejectedCandidates,
      };
    }
    return structResult;
  }
  console.log(`[chunker] structural-fallback: no result or <2`);

  // Stage 8: N-page sections
  if (pages.length >= 20) {
    const targetSections = Math.min(20, Math.max(5, Math.floor(pages.length / 20)));
    const sectionSize    = Math.ceil(pages.length / targetSections);
    const sections       = createPageSections(pages, sectionSize);
    console.log(`[chunker] STRATEGY=n-page-sections → returning ${sections.length} sections`);
    sections._diagnostics = makeDiagnostics(sections, 'n-page-sections', pages.length);
    if (opts.debug) {
      sections._debug = {
        strategy: 'n-page-sections',
        richFeatures: ctx.hasRich,
        medianFontSize: ctx.medianFontSize,
        runningHeaders: [...ctx.runningHeaders],
        allCandidates,
        rejectedCandidates,
      };
    }
    return sections;
  }

  // Short book with no detected structure
  const full = [{
    title:     'Full Book',
    pages,
    pageStart: pages[0]?.pageNum ?? 1,
    pageEnd:   pages[pages.length - 1]?.pageNum ?? pages.length,
  }];
  console.log(`[chunker] STRATEGY=single-section → returning 1 chapter (Full Book)`);
  full._diagnostics = makeDiagnostics(full, 'single-section', pages.length);
  if (opts.debug) {
    full._debug = {
      strategy: 'single-section',
      richFeatures: ctx.hasRich,
      medianFontSize: ctx.medianFontSize,
      runningHeaders: [...ctx.runningHeaders],
      allCandidates,
      rejectedCandidates,
    };
  }
  return full;
}

// ── Chunking (pipeline uses per-chapter AI calls, not per-chunk) ──────────────

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
