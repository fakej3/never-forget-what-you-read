// PDF text extraction via PDF.js — page-by-page, batched to avoid memory pressure

const PDFJS_WORKER = 'lib/pdf.worker.min.js';
const PAGE_BATCH   = 10;

export class PDFUploader {
  constructor(onProgress) {
    this.onProgress = onProgress || (() => {});
    this._cancelled = false;

    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library failed to load. Please reload the page.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }

  cancel() { this._cancelled = true; }

  async extract(file) {
    this._cancelled = false;

    this.onProgress({
      phase: 'extract', done: 0, total: 1,
      status: `Reading file — ${(file.size / 1024 / 1024).toFixed(1)} MB…`, pct: 0,
    });

    const arrayBuffer = await file.arrayBuffer();

    if (this._cancelled) throw new Error('Processing cancelled.');

    const loadTask  = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf       = await loadTask.promise;
    const pageCount = pdf.numPages;

    this.onProgress({
      phase: 'extract', done: 0, total: pageCount,
      status: `Extracting text — 0 of ${pageCount} pages`, pct: 1,
    });

    const pages = [];
    let extracted = 0;

    for (let start = 1; start <= pageCount; start += PAGE_BATCH) {
      if (this._cancelled) {
        pdf.destroy();
        throw new Error('Processing cancelled.');
      }

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
        pct:    1 + Math.round((extracted / pageCount) * 19),
      });

      // Yield to event loop so the UI can repaint
      await new Promise(r => setTimeout(r, 0));
    }

    const outline = await this._extractOutline(pdf);
    pdf.destroy();
    return { pageCount, pages, outline };
  }

  /** Extract and resolve the PDF outline (bookmarks / TOC) to page numbers. */
  async _extractOutline(pdf) {
    try {
      const raw = await pdf.getOutline();
      if (!raw || raw.length === 0) return [];

      const entries = [];
      await this._flattenOutline(pdf, raw, entries, 0);
      entries.sort((a, b) => a.pageNum - b.pageNum);
      return entries;
    } catch (e) {
      console.warn('[uploader] Outline extraction failed:', e.message);
      return [];
    }
  }

  async _flattenOutline(pdf, items, out, depth) {
    for (const item of items) {
      const pageNum = await this._resolveDestPage(pdf, item.dest);
      if (pageNum !== null) {
        out.push({ title: (item.title || '').trim() || 'Untitled', pageNum });
      }
      if (item.items && item.items.length > 0 && depth < 2) {
        await this._flattenOutline(pdf, item.items, out, depth + 1);
      }
    }
  }

  async _resolveDestPage(pdf, dest) {
    try {
      if (!dest) return null;
      let resolved = dest;
      if (typeof dest === 'string') resolved = await pdf.getDestination(dest);
      if (!Array.isArray(resolved) || !resolved[0]) return null;
      const pageIndex = await pdf.getPageIndex(resolved[0]);
      return pageIndex + 1; // convert 0-based to 1-based
    } catch {
      return null;
    }
  }

  async _extractPage(pdf, pageNum) {
    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let lastY = null;
    let text  = '';

    for (const item of content.items) {
      if (!item.str) continue;
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
