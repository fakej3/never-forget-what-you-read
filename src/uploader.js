// PDF text extraction via PDF.js — page-by-page, batched to avoid memory pressure

const PDFJS_WORKER = 'lib/pdf.worker.min.js';
const PAGE_BATCH   = 10; // pages extracted concurrently

export class PDFUploader {
  constructor(onProgress) {
    this.onProgress = onProgress || (() => {});
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library failed to load. Please check your network connection and reload the page.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }

  /**
   * Extract all text from a PDF File object.
   * Returns { pageCount, pages: [{ pageNum, text }] }
   */
  async extract(file) {
    // Report file-read start so UI is never frozen at 0%
    this.onProgress({ phase: 'extract', done: 0, total: 1, status: `Reading file — ${(file.size / 1024 / 1024).toFixed(1)} MB…`, pct: 0 });

    const arrayBuffer = await file.arrayBuffer();

    // Load PDF from the buffer, then immediately release our reference —
    // PDF.js takes ownership; we don't need to hold arrayBuffer anymore.
    const loadTask  = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf       = await loadTask.promise;
    const pageCount = pdf.numPages;

    this.onProgress({ phase: 'extract', done: 0, total: pageCount, status: `Extracting text — 0 of ${pageCount} pages`, pct: 1 });

    const pages = [];
    let extracted = 0;

    for (let start = 1; start <= pageCount; start += PAGE_BATCH) {
      const end   = Math.min(start + PAGE_BATCH - 1, pageCount);
      const batch = [];

      for (let p = start; p <= end; p++) {
        batch.push(this._extractPage(pdf, p));
      }

      const results = await Promise.all(batch);
      pages.push(...results);
      extracted += results.length;

      this.onProgress({
        phase:  'extract',
        done:   extracted,
        total:  pageCount,
        status: `Extracting text — page ${extracted} of ${pageCount}`,
        pct:    1 + Math.round((extracted / pageCount) * 19), // 1–20% of overall
      });

      // Yield to the event loop every batch so the UI can breathe
      await new Promise(r => setTimeout(r, 0));
    }

    pdf.destroy();
    return { pageCount, pages };
  }

  async _extractPage(pdf, pageNum) {
    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Preserve line breaks by checking item positions
    let lastY   = null;
    let text    = '';

    for (const item of content.items) {
      if (!item.str) continue;

      // New line when Y position changes significantly
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        text += '\n';
      }
      text  += item.str;
      lastY  = item.transform[5];
    }

    page.cleanup();
    return { pageNum, text: text.trim() };
  }
}
