// PDF text extraction via PDF.js — page-by-page, batched to avoid memory pressure

const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PAGE_BATCH   = 10; // pages extracted concurrently

export class PDFUploader {
  constructor(onProgress) {
    this.onProgress = onProgress || (() => {});
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }

  /**
   * Extract all text from a PDF File object.
   * Returns { pageCount, pages: [{ pageNum, text }] }
   */
  async extract(file) {
    const arrayBuffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;

    this.onProgress({ phase: 'extract', done: 0, total: pageCount, status: `Loading PDF — ${pageCount} pages` });

    const pages = [];
    let extracted = 0;

    // Process in batches to cap concurrent GPU/memory use
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
        pct:    Math.round((extracted / pageCount) * 20), // extraction = 0–20% of overall
      });
    }

    // Release PDF resources
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
