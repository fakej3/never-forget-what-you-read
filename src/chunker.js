// Chapter detection — confidence-based, multi-strategy, gracefully degrades
//
// Detection order:
//   A. PDF outline (TOC) — most reliable when present
//   B. Numbered sequence — finds Chapter 1..N / Part 1..N with sequence validation;
//      collapses front/back matter into adjacent chapters → exact chapter count
//   C. Pattern + ALL-CAPS scoring — unnumbered books (T&GR, descriptive titles)
//   D. N-page sections — last resort

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
 *
 * When a clean sequence covers ≥ SEQ_MIN_COVERAGE of all detected headings:
 *   - Keep only the numbered chapters as the primary structure
 *   - Merge content before the first numbered chapter into that chapter
 *   - Merge content after the last numbered chapter into that chapter
 *
 * Returns the refined chapter list or null if no clean sequence found.
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect chapters using strategies in priority order:
 *   A. PDF outline (TOC)
 *   B. Numbered sequence (Chapter 1..N with sequence validation)
 *   C. Pattern matching (all headings, unnumbered books)
 *   D. N-page sections fallback
 *
 * @param {Array}  pages   - [{ pageNum, text }]
 * @param {Array}  outline - [{ title, pageNum }] from PDF.js getOutline(), or []
 * @returns Array of chapter objects: { title, pages, pageStart, pageEnd, _diagnostics? }
 */
export function detectChapters(pages, outline = []) {
  if (!pages || pages.length === 0) return [];

  // Strategy A: PDF outline
  if (outline && outline.length >= 2) {
    const result = detectFromOutline(pages, outline);
    if (result) {
      result._diagnostics = makeDiagnostics(result, 'pdf-outline', pages.length);
      return result;
    }
  }

  // Strategy B: Pattern detection + numbered-sequence extraction
  const patternResult = detectFromPatterns(pages);

  if (patternResult.length >= 2) {
    // Try to refine to a clean numbered sequence (eliminates front/back matter inflation)
    const seqResult = extractNumberedSequence(patternResult, pages);
    if (seqResult && seqResult.length >= 2) {
      const q = chapterQuality(seqResult, pages.length);
      if (q >= 0.4) {
        seqResult._diagnostics = makeDiagnostics(seqResult, 'numbered-sequence', pages.length);
        return seqResult;
      }
    }
    // Fall back to raw pattern result
    const q = chapterQuality(patternResult, pages.length);
    if (q >= 0.3) {
      patternResult._diagnostics = makeDiagnostics(patternResult, 'patterns', pages.length);
      return patternResult;
    }
  }

  // Strategy C: N-page sections
  if (pages.length >= 20) {
    const targetSections = Math.min(20, Math.max(5, Math.floor(pages.length / 20)));
    const sectionSize    = Math.ceil(pages.length / targetSections);
    const sections       = createPageSections(pages, sectionSize);
    sections._diagnostics = makeDiagnostics(sections, 'n-page-sections', pages.length);
    return sections;
  }

  // Short book with no detected structure
  const full = [{
    title:     'Full Book',
    pages,
    pageStart: pages[0]?.pageNum ?? 1,
    pageEnd:   pages[pages.length - 1]?.pageNum ?? pages.length,
  }];
  full._diagnostics = makeDiagnostics(full, 'single-section', pages.length);
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
