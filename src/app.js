// Entry point — wires storage, providers, pipeline, and UI together

import { Storage }        from './storage.js';
import { createProvider } from './providers/base.js';
import { PDFUploader }    from './uploader.js';
import { Pipeline }       from './pipeline.js';
import { UI }             from './ui.js';

// Register all providers
import './providers/gemini.js';
import './providers/openai.js';
import './providers/anthropic.js';

// ── State ──────────────────────────────────────────────────────────────────

let activePipeline = null;
let activeUploader = null; // tracked so cancel works during extraction too

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
    onCancelProcessing: ()       => handleCancel(),
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

      // On quota hit the book is already 'extracted' in DB — leave it resumable.
      // Only mark 'error' for non-quota failures.
      if (!err.isRateLimit) {
        const book = await Storage.getBook(bookId).catch(() => null);
        if (book && book.status !== 'extracted') {
          book.status = 'error';
          await Storage.saveBook(book).catch(() => {});
        }
      }

      ui.hideProcessing();

      const msg = err.isRateLimit
        ? `API quota or rate limit reached. The book is saved as "Ready to Analyze" — configure a key with remaining quota and click Resume.`
        : `Processing failed: ${err.message}`;
      ui.showError(msg);

      await ui.renderLibrary();
    }
  } finally {
    activePipeline = null;
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
        if (b && b.status !== 'extracted') {
          b.status = 'error';
          await Storage.saveBook(b).catch(() => {});
        }
      }

      ui.hideProcessing();

      const msg = err.isRateLimit
        ? `API quota or rate limit reached. Progress is saved — try again later.`
        : `Resume failed: ${err.message}`;
      ui.showError(msg);

      await ui.renderLibrary();
    }
  } finally {
    activePipeline = null;
  }
}

async function handleDelete(ui, bookId) {
  await Storage.deleteBookAll(bookId);
  ui.showLibrary();
  await ui.renderLibrary();
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
