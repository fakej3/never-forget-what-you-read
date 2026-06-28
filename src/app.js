// Entry point — wires storage, providers, pipeline, and UI together

import { Storage }        from './storage.js';
import { createProvider } from './providers/base.js';
import { PDFUploader }    from './uploader.js';
import { Pipeline }       from './pipeline.js';
import { UI }             from './ui.js';
import { rateLimiter }    from './rate-limiter.js';

// Register all providers
import './providers/gemini.js';
import './providers/openai.js';
import './providers/anthropic.js';

// ── State ──────────────────────────────────────────────────────────────────

let activePipeline = null;
let activeUploader = null; // tracked so cancel works during extraction too
let activeBookId   = null; // id of the book currently being processed

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  await Storage.init();

  const ui = new UI({
    onFileSelected:     (file)   => handleFile(ui, file).catch(err => {
      console.error('[app] Unhandled error in handleFile:', err);
      ui.hideProcessing();
      ui.showError(`Unexpected error: ${err.message}`);
      activePipeline = null;
      activeUploader = null;
      activeBookId   = null;
    }),
    onSettingsSaved:    ()       => {},
    onBookOpen:         (bookId) => ui.openBook(bookId).catch(err => {
      console.error('[app] openBook failed:', err);
      ui.showError(`Could not open book: ${err.message}`);
    }),
    onBookDelete:       (bookId) => handleDelete(ui, bookId).catch(err => {
      console.error('[app] handleDelete failed:', err);
      ui.showError(`Could not delete book: ${err.message}`);
    }),
    onBookResume:       (bookId) => handleResume(ui, bookId).catch(err => {
      console.error('[app] handleResume failed:', err);
      ui.showError(`Resume failed: ${err.message}`);
    }),
    onBookReprocess:    (bookId) => handleReprocess(ui, bookId).catch(err => {
      console.error('[app] handleReprocess failed:', err);
      ui.showError(`Reprocess failed: ${err.message}`);
    }),
    onCancelProcessing: ()       => handleCancel(),
    onDevTool:          (action, data) => handleDevTool(ui, action, data).catch(err => {
      console.error(`[app] Dev tool "${action}" failed:`, err);
      ui.showError(`Developer tool failed: ${err.message}`);
    }),
  });

  await ui.renderLibrary();
}

// ── Handlers ───────────────────────────────────────────────────────────────

function makePipelineCallback(ui) {
  return ({ pct, status, phase, log, metrics }) => {
    if (log)     ui.appendLog(log);
    if (status)  ui.setProgress(pct ?? 0, status, phase ?? 'analyze');
    if (metrics) ui.updateMetrics(metrics);
  };
}

async function handleFile(ui, file) {
  if (activePipeline || activeUploader) {
    ui.showError('A book is already being processed. Please wait or cancel it first.');
    return;
  }

  const cfg = await ui.getProviderConfig();
  console.log('[app] Provider config:', { provider: cfg.provider, hasKey: !!cfg.apiKey, model: cfg.model });

  if (!cfg.apiKey) {
    ui.showError('Please configure your API key before uploading. Click "Configure API" in the header.');
    ui.openSettings();
    return;
  }

  const bookId    = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = Date.now();

  // ── Phase 1: PDF Extraction ────────────────────────────────────────────
  ui.showProcessing(file.name, '…');
  ui.appendLog(`Loading: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

  let extractedData;
  try {
    const uploader = new PDFUploader(({ status, pct, done, total }) => {
      const p = pct ?? Math.round((done / total) * 20);
      ui.setProgress(p, status, 'extract');
      if (typeof done === 'number' && typeof total === 'number' && total > 1) {
        if (done % 25 === 0 || done === total) {
          ui.appendLog(`Extracted ${done} / ${total} pages`);
        }
      }
    });
    activeUploader = uploader;
    extractedData  = await uploader.extract(file);
    activeUploader = null;

    console.log('[app] Extraction complete:', extractedData.pageCount, 'pages');
    const pageCountEl = document.getElementById('processing-page-count');
    if (pageCountEl) pageCountEl.textContent = `${extractedData.pageCount} pages`;
    ui.appendLog(`✓ ${extractedData.pageCount} pages extracted`);
  } catch (err) {
    activeUploader = null;
    if (err.message === 'Processing cancelled.') {
      console.log('[app] Extraction cancelled by user');
      ui.hideProcessing();
      return;
    }
    console.error('[app] Extraction failed:', err);
    ui.hideProcessing();
    ui.showError(`PDF extraction failed: ${err.message}`);
    return;
  }

  // ── Bridge: save stub + build provider ────────────────────────────────
  let provider;
  try {
    const titleCase = file.name
      .replace(/\.pdf$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    console.log('[app] Saving book stub to IndexedDB…');
    await Storage.saveBook({
      id:           bookId,
      title:        titleCase,
      filename:     file.name,
      pageCount:    extractedData.pageCount,
      chapterCount: null,
      summary:      null,
      status:       'processing',
      createdAt,
    });
    console.log('[app] Book stub saved. Rendering library…');
    await ui.renderLibrary();

    console.log('[app] Creating provider:', cfg.provider, cfg.model || '(default model)');
    provider = createProvider(cfg.provider, cfg.apiKey, cfg.model);
    console.log('[app] Provider created:', provider.name);
  } catch (err) {
    console.error('[app] Bridge phase failed:', err);
    ui.hideProcessing();
    ui.showError(`Setup failed: ${err.message}`);
    await Storage.deleteBookAll(bookId).catch(() => {});
    return;
  }

  // ── AI Pipeline ───────────────────────────────────────────────────────
  activePipeline = new Pipeline(provider, makePipelineCallback(ui));
  activeBookId   = bookId;

  try {
    console.log('[app] Starting pipeline for bookId:', bookId, '| outline entries:', extractedData.outline?.length ?? 0);
    await activePipeline.run(bookId, file.name, extractedData.pages, extractedData.pageCount, extractedData.outline || []);
    console.log('[app] Pipeline complete');
    ui.hideProcessing();
    await ui.renderLibrary();
  } catch (err) {
    if (err.message === 'Processing cancelled.') {
      console.log('[app] Processing cancelled by user');
      await Storage.deleteBookAll(bookId).catch(() => {});
      ui.hideProcessing();
      await ui.renderLibrary();
    } else {
      console.error('[app] Pipeline failed:', err);

      if (!err.isRateLimit) {
        const book = await Storage.getBook(bookId).catch(() => null);
        if (book && book.status !== 'extracted' && book.status !== 'rate-limited') {
          book.status = 'error';
          await Storage.saveBook(book).catch(() => {});
        }
      }

      ui.hideProcessing();

      const msg = err.isRateLimit
        ? `Quota reached. Progress is saved — click "Resume AI" when your quota resets to continue without losing progress.`
        : `Processing failed: ${err.message}`;
      ui.showError(msg);

      await ui.renderLibrary();
    }
  } finally {
    activePipeline = null;
    activeBookId   = null;
  }
}

async function handleResume(ui, bookId) {
  if (activePipeline || activeUploader) {
    ui.showError('A book is already being processed. Please wait or cancel it first.');
    return;
  }

  const cfg = await ui.getProviderConfig();
  if (!cfg.apiKey) {
    ui.showError('Please configure your API key before resuming. Click "Configure API" in the header.');
    ui.openSettings();
    return;
  }

  const book = await Storage.getBook(bookId).catch(() => null);
  if (!book) { ui.showError('Book not found.'); return; }

  ui.showProcessing(book.filename || book.title, book.pageCount || '…');
  if (book.pipelineMetrics) ui.updateMetrics(book.pipelineMetrics);
  ui.appendLog(`Resuming: ${book.title}`);

  const provider = createProvider(cfg.provider, cfg.apiKey, cfg.model);
  activePipeline = new Pipeline(provider, makePipelineCallback(ui));
  activeBookId   = bookId;

  try {
    await activePipeline.resume(bookId);
    ui.hideProcessing();
    await ui.renderLibrary();
  } catch (err) {
    if (err.message === 'Processing cancelled.') {
      ui.hideProcessing();
      await ui.renderLibrary();
    } else {
      console.error('[app] Resume pipeline failed:', err);

      if (!err.isRateLimit) {
        const b = await Storage.getBook(bookId).catch(() => null);
        if (b && b.status !== 'extracted' && b.status !== 'rate-limited') {
          b.status = 'error';
          await Storage.saveBook(b).catch(() => {});
        }
      }

      ui.hideProcessing();

      const msg = err.isRateLimit
        ? `Quota reached again. Progress is saved — try again when your quota resets.`
        : `Resume failed: ${err.message}`;
      ui.showError(msg);

      await ui.renderLibrary();
    }
  } finally {
    activePipeline = null;
    activeBookId   = null;
  }
}

async function handleDelete(ui, bookId) {
  // Cancel the pipeline first if this exact book is being processed
  if (activeBookId === bookId) {
    handleCancel();
    // Give the pipeline a moment to acknowledge cancellation before wiping storage
    await new Promise(r => setTimeout(r, 100));
  }
  await Storage.deleteBookAll(bookId);
  ui.showLibrary();
  await ui.renderLibrary();
}

async function handleReprocess(ui, bookId) {
  if (activePipeline || activeUploader) {
    ui.showError('A book is already being processed. Please wait or cancel it first.');
    return;
  }

  const cfg = await ui.getProviderConfig();
  if (!cfg.apiKey) {
    ui.showError('Please configure your API key before reprocessing.');
    ui.openSettings();
    return;
  }

  const book = await Storage.getBook(bookId).catch(() => null);
  if (!book) { ui.showError('Book not found.'); return; }

  // Wipe all AI results and reset to extracted state
  await Storage.resetChaptersForReprocess(bookId);
  await Storage.deleteKnowledge(bookId);
  await Storage.saveBook({ ...book, status: 'extracted', summary: null });

  ui.showLibrary();
  await ui.renderLibrary();
  await handleResume(ui, bookId);
}

async function handleDevTool(ui, action, data) {
  switch (action) {
    case 'clearAllBooks': {
      await Storage.clearAllBooks();
      ui.closeSettings();
      await ui.renderLibrary();
      ui.showToast('All books cleared.');
      break;
    }
    case 'clearAll': {
      await Storage.clearAll();
      ui.closeSettings();
      ui.showToast('IndexedDB cleared. Reloading…');
      setTimeout(() => location.reload(), 1200);
      break;
    }
    case 'resetQueue': {
      const books = await Storage.getAllBooks();
      await Promise.all(
        books
          .filter(b => b.status === 'processing')
          .map(b => Storage.saveBook({ ...b, status: 'extracted' }))
      );
      await ui.renderLibrary();
      ui.showToast('Processing queue reset.');
      break;
    }
    case 'resetApiStats': {
      rateLimiter.reset();
      ui.showToast('API statistics reset.');
      break;
    }
    case 'exportDB': {
      const exported = await Storage.exportAll();
      const json     = JSON.stringify(exported, null, 2);
      const blob     = new Blob([json], { type: 'application/json' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `never-forget-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      ui.showToast('Export downloaded.');
      break;
    }
    case 'importDB': {
      const text = await data.text();
      const parsed = JSON.parse(text);
      await Storage.importAll(parsed);
      await ui.renderLibrary();
      ui.showToast('Import complete.');
      break;
    }
    default:
      console.warn('[app] Unknown dev tool action:', action);
  }
}

function handleCancel() {
  if (activeUploader)  activeUploader.cancel();
  if (activePipeline)  activePipeline.cancel();
}

// ── Start ──────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[app] Fatal init error:', err);
  document.body.innerHTML = `<div style="color:#ef4444;padding:2rem;font-family:monospace">
    Fatal error during startup: ${err.message}<br><br>
    Check the browser console for details.
  </div>`;
});
