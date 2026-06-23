// Intelligent chunking — detects chapter boundaries, then splits into AI-sized pieces

const CHAPTER_PATTERNS = [
  /^chapter\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|\w+)/i,
  /^(\d+)\.\s+[A-Z]/,
  /^part\s+(\d+|one|two|three|four|five|i|ii|iii|iv|v)/i,
  /^section\s+\d+/i,
  /^[IVXLC]+\.\s+[A-Z]/,  // Roman numeral chapters
];

// Target ~2500 words per chunk; overlap 150 chars
const TARGET_CHARS = 14000;
const OVERLAP_CHARS = 150;

/**
 * Detect chapter title on a page's first non-empty line.
 * Returns the title string or null.
 */
function detectChapterTitle(text) {
  const firstLine = text.split('\n').find(l => l.trim().length > 2)?.trim() || '';
  if (firstLine.length > 120) return null; // too long to be a heading
  for (const pat of CHAPTER_PATTERNS) {
    if (pat.test(firstLine)) return firstLine;
  }
  return null;
}

/**
 * Group pages into chapters.
 * If <2 chapters are detected, treat the whole book as one chapter.
 */
export function detectChapters(pages) {
  const chapters = [];
  let current    = null;

  for (const page of pages) {
    const title = detectChapterTitle(page.text);

    if (title && current) {
      chapters.push(current);
      current = { title, pages: [page], pageStart: page.pageNum };
    } else if (title && !current) {
      current = { title, pages: [page], pageStart: page.pageNum };
    } else if (!current) {
      current = { title: 'Introduction', pages: [page], pageStart: page.pageNum };
    } else {
      current.pages.push(page);
    }
  }

  if (current) chapters.push(current);

  // Too few chapters → treat whole book as one
  if (chapters.length < 2) {
    return [{
      title:     'Full Book',
      pages:     pages,
      pageStart: pages[0]?.pageNum ?? 1,
      pageEnd:   pages[pages.length - 1]?.pageNum ?? pages.length,
    }];
  }

  return chapters.map(ch => ({
    ...ch,
    pageEnd: ch.pages[ch.pages.length - 1]?.pageNum ?? ch.pageStart,
  }));
}

/**
 * Split a chapter's text into overlapping chunks small enough for AI.
 */
export function chunkChapter(chapter, chapterIndex) {
  const fullText = chapter.pages.map(p => p.text).join('\n\n');
  const chunks   = [];
  let offset     = 0;
  let chunkIndex = 0;

  while (offset < fullText.length) {
    const end  = Math.min(offset + TARGET_CHARS, fullText.length);

    // Try to break at a paragraph boundary
    let breakAt = end;
    if (end < fullText.length) {
      const nlPos = fullText.lastIndexOf('\n\n', end);
      if (nlPos > offset + TARGET_CHARS * 0.6) breakAt = nlPos;
    }

    chunks.push({
      id:           `${chapterIndex}-${chunkIndex}`,
      chapterIndex,
      chunkIndex,
      chapterTitle: chapter.title,
      pageStart:    chapter.pageStart,
      pageEnd:      chapter.pageEnd,
      text:         fullText.slice(offset, breakAt).trim(),
      summary:      null,
    });

    offset = Math.max(breakAt - OVERLAP_CHARS, breakAt);
    chunkIndex++;
  }

  return chunks;
}

/**
 * Main entry point — returns { chapters, chunks }
 */
export function buildChunks(pages) {
  const chapters = detectChapters(pages);
  const allChunks = [];

  chapters.forEach((ch, i) => {
    const chunks = chunkChapter(ch, i);
    allChunks.push(...chunks);
  });

  return { chapters, chunks: allChunks };
}
