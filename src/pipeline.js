// Pipeline — structure analysis → local compression → AI per chapter → book summary

import { detectChapters }                 from './chunker.js';
import { compressChapter, groupChapters } from './compressor.js';
import { Storage }                        from './storage.js';

const MAX_CHAPTER_GROUPS = 15;   // caps total AI calls at 16 (groups + book summary)
const COMPRESS_TARGET    = 15000; // chars sent to AI per chapter
const MAX_RETRIES        = 2;
const RETRY_BASE_MS      = 3000;

// ── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM = `You are an expert at extracting and preserving knowledge from books. Be concise, precise, and comprehensive. Never add padding or filler. Always return valid JSON when asked.`;

function promptChapter(title, text) {
  return `Analyze the following book chapter and return a JSON object containing all extractable knowledge.

CHAPTER: "${title}"

TEXT:
${text}

Return ONLY valid JSON with this exact structure:
{
  "summary": "4-8 sentence cohesive summary capturing the main themes, arguments, and key insights",
  "concepts": ["core concept 1", "core concept 2"],
  "principles": ["key principle or rule 1"],
  "actionableIdeas": ["specific thing a reader can DO based on this chapter"],
  "vocabulary": [{"term": "word or phrase", "definition": "concise definition"}],
  "quotes": [{"text": "memorable passage or paraphrase", "context": "brief context"}]
}

Extract:
- summary: 4-8 sentences covering main theme and arguments
- concepts: 4-8 core concepts (short noun phrases)
- principles: 3-6 key principles or rules stated or implied
- actionableIdeas: 3-6 specific actions a reader can take from this chapter
- vocabulary: 3-6 important terms or specialized language defined here
- quotes: 2-4 memorable quotes or important passages`;
}

function promptBookSummary(chapterSummaries) {
  return `Below are summaries of every chapter in a book.
Write a comprehensive book summary in 6-10 sentences. Cover: the central thesis, major themes, the progression of ideas, and the most important conclusions or takeaways.

CHAPTER SUMMARIES:
${chapterSummaries.map((s, i) => `[Chapter ${i + 1}] ${s}`).join('\n\n')}

Return only the summary text — no JSON, no headers.`;
}

// ── Knowledge helpers ─────────────────────────────────────────────────────────

function parseChapterKnowledge(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const p = JSON.parse(match[0]);
    return {
      summary:         typeof p.summary === 'string' ? p.summary.trim() : '',
      concepts:        Array.isArray(p.concepts)        ? p.concepts        : [],
      principles:      Array.isArray(p.principles)      ? p.principles      : [],
      actionableIdeas: Array.isArray(p.actionableIdeas) ? p.actionableIdeas : [],
      vocabulary:      Array.isArray(p.vocabulary)      ? p.vocabulary      : [],
      quotes:          Array.isArray(p.quotes)          ? p.quotes          : [],
    };
  } catch { return null; }
}

function aggregateKnowledge(chapterKnowledge) {
  const all = { concepts: [], principles: [], actionableIdeas: [], vocabulary: [], quotes: [] };
  for (const k of chapterKnowledge) {
    if (!k) continue;
    all.concepts.push(...(k.concepts        || []));
    all.principles.push(...(k.principles     || []));
    all.actionableIdeas.push(...(k.actionableIdeas || []));
    all.vocabulary.push(...(k.vocabulary     || []));
    all.quotes.push(...(k.quotes             || []));
  }

  const dedupStr = arr => {
    const seen = new Set();
    return arr.filter(s => {
      const key = String(s ?? '').toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  };

  const dedupObj = (arr, keyFn) => {
    const seen = new Set();
    return arr.filter(o => {
      const key = keyFn(o).toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  };

  return {
    concepts:        dedupStr(all.concepts).slice(0, 20),
    principles:      dedupStr(all.principles).slice(0, 15),
    actionableIdeas: dedupStr(all.actionableIdeas).slice(0, 15),
    vocabulary:      dedupObj(all.vocabulary, v => v?.term || String(v)).slice(0, 20),
    quotes:          dedupObj(all.quotes, q => q?.text || String(q)).slice(0, 10),
  };
}

function inferTitle(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const emptyKnowledge = () => ({
  summary: '', concepts: [], principles: [], actionableIdeas: [], vocabulary: [], quotes: [],
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

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

  _progress(pct, status, phase) { this.onProgress({ pct, status, phase }); }
  _log(msg)                     { this.onProgress({ log: msg }); }

  async _call(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err.message === 'Processing cancelled.') throw err;
        if (err.isRateLimit) { this._log(`⚠ ${label}: quota/rate-limit reached`); throw err; }
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * attempt;
          this._log(`⚠ ${label}: ${err.message} — retrying in ${delay / 1000}s`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  // ── Phase: detect + compress + save stubs ─────────────────────────────────

  async _prepare(bookId, filename, pages, pageCount) {
    this._progress(20, 'Detecting chapter structure…', 'extract');
    await new Promise(r => setTimeout(r, 0));
    this._check();

    const rawChapters  = detectChapters(pages);
    const chapters     = groupChapters(rawChapters, MAX_CHAPTER_GROUPS);
    const aiCallsTotal = chapters.length + 1;

    this._log(`${rawChapters.length} chapters → ${chapters.length} groups → ~${aiCallsTotal} AI calls`);
    this._progress(22, `Compressing text for ${chapters.length} chapters…`, 'extract');

    // Local compression — no API calls
    for (let i = 0; i < chapters.length; i++) {
      const rawText = chapters[i].pages.map(p => p.text).join('\n\n');
      chapters[i]   = { ...chapters[i], compressedText: compressChapter(rawText, COMPRESS_TARGET) };
    }

    // Save chapter stubs with compressedText for resumability
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      await Storage.saveChapter({
        id:             `${bookId}-ch-${i}`,
        bookId,
        index:          i,
        title:          ch.title,
        pageStart:      ch.pageStart,
        pageEnd:        ch.pageEnd,
        compressedText: ch.compressedText,
        aiProcessed:    false,
        summary:        null,
        aiKnowledge:    null,
      }).catch(e => console.error('[pipeline] saveChapter stub failed:', e));
    }

    // Mark 'extracted' — survives any subsequent quota failure
    const stub    = await Storage.getBook(bookId).catch(() => null);
    const title   = stub?.title || inferTitle(filename);
    const metrics = { pages: pageCount, chapters: chapters.length, aiCallsTotal, aiCallsDone: 0 };

    await Storage.saveBook({
      id:              bookId,
      title,
      filename,
      pageCount,
      chapterCount:    chapters.length,
      summary:         null,
      status:          'extracted',
      createdAt:       stub?.createdAt || Date.now(),
      pipelineMetrics: metrics,
    });

    return { chapters, title, metrics, stub };
  }

  // ── Phase: AI per chapter ─────────────────────────────────────────────────

  async _analyzeChapters(bookId, chapters, metrics) {
    const { aiCallsTotal } = metrics;
    const chapterKnowledge = [];
    let   aiCallsDone      = 0;

    for (let i = 0; i < chapters.length; i++) {
      this._check();
      const ch  = chapters[i];
      const pct = 25 + Math.round((i / chapters.length) * 60);
      this._progress(pct, `Analyzing chapter ${i + 1} / ${chapters.length}: "${ch.title}"`, 'analyze');

      let knowledge = emptyKnowledge();
      try {
        const raw = await this._call(
          () => this.provider.complete(SYSTEM, promptChapter(ch.title, ch.compressedText), { maxTokens: 1500, temperature: 0.2 }),
          `Chapter ${i + 1}`
        );
        knowledge = parseChapterKnowledge(raw) || emptyKnowledge();
      } catch (err) {
        if (err.message === 'Processing cancelled.') throw err;
        if (err.isRateLimit) throw err; // caller handles persistence
        this._log(`⚠ Chapter ${i + 1} failed: ${err.message}`);
      }

      chapterKnowledge.push(knowledge);
      aiCallsDone++;

      await Storage.saveChapter({
        id:             `${bookId}-ch-${i}`,
        bookId,
        index:          i,
        title:          ch.title,
        pageStart:      ch.pageStart,
        pageEnd:        ch.pageEnd,
        compressedText: ch.compressedText ?? '',
        aiProcessed:    true,
        summary:        knowledge.summary,
        aiKnowledge:    knowledge,
      }).catch(e => console.error('[pipeline] saveChapter result failed:', e));

      this._log(`✓ Chapter ${i + 1} / ${chapters.length} analyzed`);
      this.onProgress({ metrics: { ...metrics, aiCallsDone } });
    }

    return { chapterKnowledge, aiCallsDone };
  }

  // ── Phase: book summary + finalize ────────────────────────────────────────

  async _finalize(bookId, chapterKnowledge, aiCallsDone, existingBook, metrics, existingSummary = '') {
    this._progress(85, 'Generating book summary…', 'analyze');

    const chapterSummaries = chapterKnowledge.map(k => k?.summary || '').filter(Boolean);
    let bookSummary = existingSummary;

    if (!bookSummary && chapterSummaries.length > 0) {
      try {
        bookSummary = chapterSummaries.length === 1
          ? chapterSummaries[0]
          : await this._call(
              () => this.provider.complete(SYSTEM, promptBookSummary(chapterSummaries), { maxTokens: 1024, temperature: 0.25 }),
              'Book summary'
            );
        aiCallsDone++;
        this._log('✓ Book summary complete');
      } catch (err) {
        if (err.message === 'Processing cancelled.') throw err;
        if (err.isRateLimit) throw err;
        this._log(`⚠ Book summary failed: ${err.message}`);
        bookSummary = chapterSummaries[0] || '';
      }
    }

    this._progress(95, 'Aggregating knowledge…', 'complete');
    const knowledge = aggregateKnowledge(chapterKnowledge.filter(Boolean));
    await Storage.saveKnowledge({ bookId, ...knowledge }).catch(e => console.error('[pipeline] saveKnowledge failed:', e));

    const finalMetrics = { ...metrics, aiCallsDone };
    await Storage.saveBook({
      ...existingBook,
      summary:         bookSummary,
      status:          'complete',
      pipelineMetrics: finalMetrics,
    });

    this._progress(100, 'Complete', 'complete');
    this._log('✓ Book archived — never needs reprocessing');
  }

  // ── Public: run (fresh book) ──────────────────────────────────────────────

  async run(bookId, filename, pages, pageCount) {
    console.log('[pipeline] run() —', bookId, '| pages:', pages.length);

    const { chapters, title, metrics, stub } = await this._prepare(bookId, filename, pages, pageCount);

    this._progress(25, `AI analysis starting — ${chapters.length} chapters, ${metrics.aiCallsTotal} calls`, 'analyze');
    this._check();

    let chapterKnowledge, aiCallsDone;
    try {
      ({ chapterKnowledge, aiCallsDone } = await this._analyzeChapters(bookId, chapters, metrics));
    } catch (err) {
      if (err.isRateLimit) {
        // Book is already 'extracted' in DB — user can resume later
        console.log('[pipeline] Quota hit during chapter analysis — progress saved');
        throw err;
      }
      throw err;
    }

    const existingBook = await Storage.getBook(bookId).catch(() => ({})) || {};
    try {
      await this._finalize(bookId, chapterKnowledge, aiCallsDone, existingBook, metrics);
    } catch (err) {
      if (err.isRateLimit) {
        console.log('[pipeline] Quota hit during book summary — chapter progress saved');
        throw err;
      }
      throw err;
    }

    console.log('[pipeline] run() COMPLETE —', title);
  }

  // ── Public: resume (after quota recovery) ────────────────────────────────

  async resume(bookId) {
    console.log('[pipeline] resume() —', bookId);
    this._progress(25, 'Loading saved progress…', 'analyze');

    const book = await Storage.getBook(bookId);
    if (!book) throw new Error('Book not found');

    const allChapters = (await Storage.getChapters(bookId)).sort((a, b) => a.index - b.index);
    if (!allChapters.length) throw new Error('No chapter data found — please reprocess this book');

    const pageCount    = book.pageCount;
    const aiCallsTotal = allChapters.length + 1;
    const alreadyDone  = allChapters.filter(ch => ch.aiProcessed).length;

    this._log(`Resuming: ${alreadyDone} / ${allChapters.length} chapters already processed`);

    // Pre-populate from DB
    const chapterKnowledge = allChapters.map(ch => ch.aiKnowledge || (ch.aiProcessed ? emptyKnowledge() : null));
    const metrics = { pages: pageCount, chapters: allChapters.length, aiCallsTotal, aiCallsDone: alreadyDone };

    let aiCallsDone = alreadyDone;

    for (let i = 0; i < allChapters.length; i++) {
      const ch = allChapters[i];
      if (ch.aiProcessed) continue;

      this._check();
      const pct = 25 + Math.round((i / allChapters.length) * 60);
      this._progress(pct, `Analyzing chapter ${i + 1} / ${allChapters.length}: "${ch.title}"`, 'analyze');

      let knowledge = emptyKnowledge();
      try {
        const raw = await this._call(
          () => this.provider.complete(SYSTEM, promptChapter(ch.title, ch.compressedText || ''), { maxTokens: 1500, temperature: 0.2 }),
          `Chapter ${i + 1}`
        );
        knowledge = parseChapterKnowledge(raw) || emptyKnowledge();
      } catch (err) {
        if (err.message === 'Processing cancelled.') throw err;
        if (err.isRateLimit) {
          await Storage.saveBook({ ...book, status: 'extracted', pipelineMetrics: { ...metrics, aiCallsDone } }).catch(() => {});
          throw err;
        }
        this._log(`⚠ Chapter ${i + 1} failed: ${err.message}`);
      }

      chapterKnowledge[i] = knowledge;
      aiCallsDone++;

      await Storage.saveChapter({ ...ch, aiProcessed: true, summary: knowledge.summary, aiKnowledge: knowledge }).catch(() => {});
      this._log(`✓ Chapter ${i + 1} / ${allChapters.length} analyzed`);
      this.onProgress({ metrics: { ...metrics, aiCallsDone } });
    }

    this._check();
    await this._finalize(bookId, chapterKnowledge, aiCallsDone, book, metrics, book.summary || '');
    console.log('[pipeline] resume() COMPLETE');
  }
}
