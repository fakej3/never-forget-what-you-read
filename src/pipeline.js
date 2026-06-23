// Processing pipeline — orchestrates extraction → chunking → AI summarization → knowledge

import { buildChunks } from './chunker.js';
import { Storage }     from './storage.js';

const AI_CONCURRENCY  = 3;   // parallel AI calls at once
const MAX_RETRIES     = 3;   // per AI call
const RETRY_DELAY_MS  = 2000; // base delay, doubles each attempt
const FETCH_TIMEOUT_MS = 45000;

// ── Prompts ────────────────────────────────────────────────────────────────

const SYSTEM_SUMMARIZER = `You are an expert at extracting and preserving knowledge from books.
Be concise, precise, and comprehensive. Never add padding or filler.`;

function promptChunkSummary(chapterTitle, text) {
  return `Summarize the following passage from the chapter "${chapterTitle}".
Capture all key ideas, arguments, examples, and insights in 3–6 sentences.

PASSAGE:
${text}`;
}

function promptChapterSummary(chapterTitle, chunkSummaries) {
  return `Below are summaries of all passages from the chapter "${chapterTitle}".
Write a cohesive chapter summary in 4–8 sentences that captures the main theme, key arguments, and most important takeaways.

CHUNK SUMMARIES:
${chunkSummaries.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}`;
}

function promptBookSummary(chapterSummaries) {
  return `Below are summaries of every chapter in a book.
Write a comprehensive book summary in 6–10 sentences. Cover the central thesis, major themes, progression of ideas, and the most important conclusions.

CHAPTER SUMMARIES:
${chapterSummaries.map((s, i) => `[Chapter ${i + 1}] ${s}`).join('\n\n')}`;
}

function promptKnowledge(bookSummary, chapterSummaries) {
  const combined = `BOOK SUMMARY:\n${bookSummary}\n\nCHAPTER SUMMARIES:\n${chapterSummaries.join('\n\n')}`;
  return `Based on this book content, extract the following as JSON.
Be specific — extract real content from the text, not generic placeholders.

${combined}

Return ONLY valid JSON with this exact structure:
{
  "concepts": ["concept1", "concept2", ...],
  "principles": ["principle statement 1", "principle statement 2", ...],
  "quotes": [
    { "text": "exact or paraphrased quote", "context": "brief context" },
    ...
  ],
  "actionableIdeas": ["specific action 1", "specific action 2", ...],
  "vocabulary": [
    { "term": "word or phrase", "definition": "concise definition" },
    ...
  ]
}

Extract:
- concepts: 8–15 core concepts or ideas from the book (short noun phrases)
- principles: 5–10 key principles or rules stated or implied in the book
- quotes: 4–8 memorable or important quotes/passages
- actionableIdeas: 5–10 specific things a reader can DO based on this book
- vocabulary: 6–12 important terms, jargon, or specialized words defined in the book`;
}

// ── Retry wrapper ──────────────────────────────────────────────────────────

async function withRetry(fn, label, logFn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message === 'Processing cancelled.') throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logFn(`⚠ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message} — retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastErr.message}`);
}

// ── Batch runner ───────────────────────────────────────────────────────────

async function runBatch(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const batch = await Promise.all(slice.map(fn));
    results.push(...batch);
  }
  return results;
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export class Pipeline {
  constructor(provider, onProgress) {
    this.provider   = provider;
    this.onProgress = onProgress || (() => {});
    this.cancelled  = false;
  }

  cancel() { this.cancelled = true; }

  _check() {
    if (this.cancelled) throw new Error('Processing cancelled.');
  }

  _progress(pct, status, phase) {
    this.onProgress({ pct, status, phase });
  }

  _log(msg) {
    this.onProgress({ log: msg });
  }

  /**
   * Full pipeline. Returns the complete book record ready to store.
   */
  async run(bookId, filename, pages, pageCount) {
    // ── Phase 1: Chunk (instant) ──────────────────────────────────────────
    this._progress(20, 'Analyzing structure and chunking text…', 'chunk');
    const { chapters, chunks } = buildChunks(pages, bookId);
    this._log(`Detected ${chapters.length} chapter(s), ${chunks.length} chunk(s)`);
    this._check();

    // Persist chapters skeletons immediately
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      await Storage.saveChapter({
        id:        `${bookId}-ch-${i}`,
        bookId,
        index:     i,
        title:     ch.title,
        pageStart: ch.pageStart,
        pageEnd:   ch.pageEnd,
        summary:   null,
      });
    }

    // ── Phase 2: Chunk summaries ──────────────────────────────────────────
    this._progress(25, `Summarizing ${chunks.length} chunks…`, 'summarize');
    let summarized = 0;

    const chunkResults = await runBatch(chunks, async (chunk) => {
      this._check();

      // Skip empty chunks (e.g. blank pages grouped as a chapter)
      if (!chunk.text.trim()) {
        return { ...chunk, bookId, summary: '' };
      }

      const summary = await withRetry(
        () => this.provider.complete(
          SYSTEM_SUMMARIZER,
          promptChunkSummary(chunk.chapterTitle, chunk.text),
          { maxTokens: 512, temperature: 0.2 }
        ),
        `Chunk ${chunk.id}`,
        (msg) => this._log(msg)
      );

      summarized++;
      const pct = 25 + Math.round((summarized / chunks.length) * 40);
      this._progress(pct, `Chunk ${summarized} / ${chunks.length} summarized`, 'summarize');
      this._log(`✓ Chunk ${chunk.id} summarized`);

      // Store WITHOUT raw text — only summary is needed after this point
      const record = { id: chunk.id, bookId, chapterIndex: chunk.chapterIndex, chunkIndex: chunk.chunkIndex, chapterTitle: chunk.chapterTitle, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, summary };
      await Storage.saveChunk(record);
      return { ...chunk, bookId, summary }; // keep text in memory for this run only
    }, AI_CONCURRENCY);

    this._check();

    // ── Phase 3: Chapter summaries ────────────────────────────────────────
    this._progress(65, `Generating ${chapters.length} chapter summaries…`, 'summarize');

    const chapterSummaries = [];

    for (let i = 0; i < chapters.length; i++) {
      this._check();
      const chapterChunks   = chunkResults.filter(c => c.chapterIndex === i);
      const chunkSummaries  = chapterChunks.map(c => c.summary).filter(Boolean);

      const summary = chunkSummaries.length === 1
        ? chunkSummaries[0]
        : await withRetry(
            () => this.provider.complete(
              SYSTEM_SUMMARIZER,
              promptChapterSummary(chapters[i].title, chunkSummaries),
              { maxTokens: 768, temperature: 0.2 }
            ),
            `Chapter ${i + 1} summary`,
            (msg) => this._log(msg)
          );

      chapterSummaries.push(summary);
      this._log(`✓ Chapter "${chapters[i].title}" summarized`);

      await Storage.saveChapter({
        id:        `${bookId}-ch-${i}`,
        bookId,
        index:     i,
        title:     chapters[i].title,
        pageStart: chapters[i].pageStart,
        pageEnd:   chapters[i].pageEnd,
        summary,
      });

      const pct = 65 + Math.round(((i + 1) / chapters.length) * 15);
      this._progress(pct, `Chapter ${i + 1} / ${chapters.length} summarized`, 'summarize');
    }

    this._check();

    // ── Phase 4: Book summary ─────────────────────────────────────────────
    this._progress(80, 'Generating book summary…', 'summarize');

    const bookSummary = chapterSummaries.length === 1
      ? chapterSummaries[0]
      : await withRetry(
          () => this.provider.complete(
            SYSTEM_SUMMARIZER,
            promptBookSummary(chapterSummaries),
            { maxTokens: 1024, temperature: 0.25 }
          ),
          'Book summary',
          (msg) => this._log(msg)
        );

    this._log('✓ Book summary complete');
    this._check();

    // ── Phase 5: Knowledge extraction ─────────────────────────────────────
    this._progress(85, 'Extracting knowledge — concepts, quotes, principles…', 'knowledge');

    let knowledge = { concepts: [], principles: [], quotes: [], actionableIdeas: [], vocabulary: [] };

    try {
      const raw = await withRetry(
        () => this.provider.complete(
          SYSTEM_SUMMARIZER,
          promptKnowledge(bookSummary, chapterSummaries),
          { maxTokens: 2048, temperature: 0.3 }
        ),
        'Knowledge extraction',
        (msg) => this._log(msg)
      );

      // Extract JSON even if model wraps it in a markdown code block
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Normalise — guard against model returning wrong field names
        knowledge = {
          concepts:       Array.isArray(parsed.concepts)       ? parsed.concepts       : [],
          principles:     Array.isArray(parsed.principles)     ? parsed.principles     : [],
          quotes:         Array.isArray(parsed.quotes)         ? parsed.quotes         : [],
          actionableIdeas:Array.isArray(parsed.actionableIdeas)? parsed.actionableIdeas: [],
          vocabulary:     Array.isArray(parsed.vocabulary)     ? parsed.vocabulary     : [],
        };
      } else {
        this._log('⚠ Knowledge JSON not found in response — empty knowledge saved');
      }
      this._log('✓ Knowledge extraction complete');
    } catch (err) {
      this._log(`⚠ Knowledge extraction failed after retries: ${err.message} — empty knowledge saved`);
    }

    await Storage.saveKnowledge({ bookId, ...knowledge });

    // ── Phase 6: Finalise book record ─────────────────────────────────────
    this._progress(98, 'Saving to archive…', 'complete');

    const title = this._inferTitle(filename, chapters);
    const book  = {
      id:        bookId,
      title,
      filename,
      pageCount,
      chapterCount: chapters.length,
      summary:   bookSummary,
      status:    'complete',
      createdAt: Date.now(),
    };

    await Storage.saveBook(book);
    this._progress(100, 'Complete', 'complete');
    this._log('✓ Book archived — never needs reprocessing');

    return book;
  }

  _inferTitle(filename, chapters) {
    // Remove extension, replace dashes/underscores, title-case
    const base = filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    return base.replace(/\b\w/g, c => c.toUpperCase());
  }
}
