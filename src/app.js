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

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  await Storage.init();

  const ui = new UI({
    onFileSelected:     (file)   => handleFile(ui, file).catch(err => {
      // Last-resort catch — surfaces any error that escapes handleFile's own handler
      console.error('[app] Unhandled error in handleFile:', err);
      ui.hideProcessing();
      ui.showError(`Unexpected error: ${err.message}`);
      activePipeline = null;
    }),
    onSettingsSaved:    ()       => {},
    onBookOpen:         (bookId) => ui.openBook(bookId),
    onBookDelete:       (bookId) => handleDelete(ui, bookId),
    onCancelProcessing: ()       => handleCancel(ui),
  });

  await ui.renderLibrary();
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleFile(ui, file) {
  // Block concurrent uploads
  if (activePipeline) {
    ui.showError('A book is already being processed. Please wait or cancel it first.');
    return;
  }

  // Validate provider config
  const cfg = await ui.getProviderConfig();
  console.log('[app] Provider config:', { provider: cfg.provider, hasKey: !!cfg.apiKey, model: cfg.model });

  if (!cfg.apiKey) {
    ui.showError('Please configure your API key before uploading. Click "Configure API" in the header.');
    ui.openSettings();
    return;
  }

  const bookId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // ── Phase 1: PDF Extraction ───────────────────────────────────────────────
  ui.showProcessing(file.name, '…');
  ui.appendLog(`Loading: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

  let uploader;
  let extractedData;
  try {
    uploader = new PDFUploader(({ status, pct, done, total }) => {
      const p = pct ?? Math.round((done / total) * 20);
      ui.setProgress(p, status, 'extract');
      if (typeof done === 'number' && typeof total === 'number' && total > 1) {
        if (done % 25 === 0 || done === total) {
          ui.appendLog(`Extracted ${done} / ${total} pages`);
        }
      }
    });
    extractedData = await uploader.extract(file);
    console.log('[app] Extraction complete:', extractedData.pageCount, 'pages,', extractedData.pages.length, 'page objects');
    document.getElementById('processing-page-count').textContent = `${extractedData.pageCount} pages`;
    ui.appendLog(`✓ ${extractedData.pageCount} pages extracted`);
  } catch (err) {
    console.error('[app] Extraction failed:', err);
    ui.hideProcessing();
    ui.showError(`PDF extraction failed: ${err.message}`);
    return;
  }

  // ── Bridge: save stub + build provider ────────────────────────────────────
  // This section was previously unguarded — any throw here was a silent freeze.
  let provider;
  try {
    console.log('[app] Saving book stub to IndexedDB…');
    await Storage.saveBook({
      id:           bookId,
      title:        file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
      filename:     file.name,
      pageCount:    extractedData.pageCount,
      chapterCount: null,
      summary:      null,
      status:       'processing',
      createdAt:    Date.now(),
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
    // Clean up partial stub
    await Storage.deleteBookAll(bookId).catch(() => {});
    return;
  }

  // ── Phases 2–6: AI Pipeline ───────────────────────────────────────────────
  activePipeline = new Pipeline(provider, ({ pct, status, phase, log }) => {
    if (log)    ui.appendLog(log);
    if (status) ui.setProgress(pct ?? 0, status, phase ?? 'summarize');
  });

  try {
    console.log('[app] Starting pipeline for bookId:', bookId);
    await activePipeline.run(bookId, file.name, extractedData.pages, extractedData.pageCount);
    console.log('[app] Pipeline complete');
    ui.hideProcessing();
    await ui.renderLibrary();
  } catch (err) {
    if (err.message === 'Processing cancelled.') {
      console.log('[app] Processing cancelled by user');
      await Storage.deleteBookAll(bookId).catch(() => {});
      ui.hideProcessing();
      await ui.renderLibrary();
      return;
    }

    console.error('[app] Pipeline failed:', err);
    const book = await Storage.getBook(bookId).catch(() => null);
    if (book) {
      book.status = 'error';
      await Storage.saveBook(book).catch(() => {});
    }
    ui.hideProcessing();
    ui.showError(`Processing failed: ${err.message}`);
    await ui.renderLibrary();
  } finally {
    activePipeline = null;
  }
}

async function handleDelete(ui, bookId) {
  await Storage.deleteBookAll(bookId);
  ui.showLibrary();
  await ui.renderLibrary();
}

function handleCancel(ui) {
  if (activePipeline) activePipeline.cancel();
}

// ── Start ──────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[app] Fatal init error:', err);
  document.body.innerHTML = `<div style="color:#ef4444;padding:2rem;font-family:monospace">
    Fatal error during startup: ${err.message}<br><br>
    Check the browser console for details.
  </div>`;
});
