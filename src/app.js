// Entry point — wires storage, providers, pipeline, and UI together

import { Storage }       from './storage.js';
import { createProvider } from './providers/base.js';
import { PDFUploader }   from './uploader.js';
import { Pipeline }      from './pipeline.js';
import { UI }            from './ui.js';

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
    onFileSelected:    (file)   => handleFile(ui, file),
    onSettingsSaved:   ()       => { /* nothing extra needed */ },
    onBookOpen:        (bookId) => ui.openBook(bookId),
    onBookDelete:      (bookId) => handleDelete(ui, bookId),
    onCancelProcessing: ()      => handleCancel(ui),
  });

  await ui.renderLibrary();
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleFile(ui, file) {
  // Validate provider config first
  const cfg = await ui.getProviderConfig();
  if (!cfg.apiKey) {
    ui.showError('Please configure your API key before uploading. Click "Configure API" in the header.');
    ui.openSettings();
    return;
  }

  // Generate a unique book ID
  const bookId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Phase 1: Extract PDF text
  const uploader = new PDFUploader(({ status, pct, done, total }) => {
    const p = pct ?? Math.round((done / total) * 20);
    ui.setProgress(p, status, 'extract');
    if (done % 20 === 0 || done === total) {
      ui.appendLog(`Page ${done}/${total} extracted`);
    }
  });

  let extractedData;
  try {
    // Show processing UI before starting (need page count first)
    // We do a quick page count check from the PDF
    ui.showProcessing(file.name, '…');
    ui.appendLog(`Loading: ${file.name}`);

    extractedData = await uploader.extract(file);
    document.getElementById('processing-page-count').textContent = `${extractedData.pageCount} pages`;
    ui.appendLog(`✓ ${extractedData.pageCount} pages extracted`);
  } catch (err) {
    ui.hideProcessing();
    ui.showError(`PDF extraction failed: ${err.message}`);
    return;
  }

  // Save book stub so it appears in library immediately
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
  await ui.renderLibrary();

  // Phase 2–6: AI pipeline
  const provider = createProvider(cfg.provider, cfg.apiKey, cfg.model);

  activePipeline = new Pipeline(provider, ({ pct, status, phase, log }) => {
    if (log)    ui.appendLog(log);
    if (status) ui.setProgress(pct ?? 0, status, phase ?? 'summarize');
  });

  try {
    await activePipeline.run(bookId, file.name, extractedData.pages, extractedData.pageCount);
    ui.hideProcessing();
    await ui.renderLibrary();
  } catch (err) {
    if (err.message === 'Processing cancelled.') {
      await Storage.deleteBookAll(bookId);
      ui.hideProcessing();
      await ui.renderLibrary();
      return;
    }

    // Mark book as errored
    const book = await Storage.getBook(bookId);
    if (book) {
      book.status = 'error';
      await Storage.saveBook(book);
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
  console.error('Fatal init error:', err);
  document.body.innerHTML = `<div style="color:#ef4444;padding:2rem;font-family:monospace">
    Fatal error: ${err.message}
  </div>`;
});
