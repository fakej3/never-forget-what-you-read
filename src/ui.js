// UI controller — all DOM wiring, rendering, and view transitions

import { Storage } from './storage.js';

const PROVIDER_NOTES = {
  openai:    'OpenAI API calls from the browser require CORS to be enabled on your account or a proxy server.',
  anthropic: 'Anthropic API requires the anthropic-dangerous-allow-browser header. For production, use a server-side proxy.',
  gemini:    '',
};

const PROVIDER_MODELS = {
  gemini:    ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
  openai:    ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
};

// Null-safe getElementById shorthand
const $  = (id)  => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

export class UI {
  constructor(callbacks) {
    this.cb             = callbacks;
    this._deleteTarget  = null;
    this._toastTimer    = null;
    this._currentBookId = null;
    this._bind();
  }

  // ── Binding ────────────────────────────────────────────────────────────

  _bind() {
    // Upload
    const zone  = $('upload-zone');
    const input = $('file-input');

    if (zone && input) {
      zone.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (input.files[0]) this.cb.onFileSelected(input.files[0]);
        input.value = '';
      });
      zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.pdf')) {
          this.showError(`"${file.name}" is not a PDF. Please drop a .pdf file.`);
          return;
        }
        this.cb.onFileSelected(file);
      });
    }

    // Settings modal
    $('open-settings')?.addEventListener('click', () =>
      this.openSettings().catch(err => this.showError(`Settings error: ${err.message}`))
    );
    $('close-settings')?.addEventListener('click', () => this.closeSettings());
    document.querySelector('#settings-modal .modal-backdrop')?.addEventListener('click', () => this.closeSettings());
    $('save-settings')?.addEventListener('click', () =>
      this._saveSettings().catch(err => this.showError(`Failed to save settings: ${err.message}`))
    );
    $('provider-select')?.addEventListener('change', e => this._onProviderChange(e.target.value));

    // Cancel processing
    $('cancel-processing')?.addEventListener('click', () => this.cb.onCancelProcessing());

    // Back to library
    $('back-to-library')?.addEventListener('click', () => this.showLibrary());

    // Delete (in detail view)
    $('delete-book')?.addEventListener('click', () => this.openDeleteModal(this._currentBookId));
    document.querySelector('#delete-modal .modal-backdrop')?.addEventListener('click', () => this.closeDeleteModal());
    $('close-delete')?.addEventListener('click',  () => this.closeDeleteModal());
    $('cancel-delete')?.addEventListener('click', () => this.closeDeleteModal());
    $('confirm-delete')?.addEventListener('click', () => {
      if (this._deleteTarget) {
        this.cb.onBookDelete(this._deleteTarget);
        this.closeDeleteModal();
      }
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async openSettings() {
    const provider = await Storage.getSetting('provider') || 'gemini';
    const apiKey   = await Storage.getSetting('apiKey')   || '';
    const model    = await Storage.getSetting('model')    || '';

    const provSel = $('provider-select');
    const keyIn   = $('api-key-input');
    if (provSel) provSel.value = provider;
    if (keyIn)   keyIn.value   = apiKey;
    this._onProviderChange(provider, model);

    $('settings-modal')?.classList.remove('hidden');
  }

  closeSettings() {
    $('settings-modal')?.classList.add('hidden');
  }

  _onProviderChange(provider, currentModel = null) {
    const models = PROVIDER_MODELS[provider] || [];
    const select = $('model-select');
    if (select) {
      select.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
      if (currentModel && models.includes(currentModel)) select.value = currentModel;
    }

    const note = $('provider-note');
    if (note) {
      const text = PROVIDER_NOTES[provider] || '';
      note.textContent = text;
      note.classList.toggle('visible', !!text);
    }
  }

  async _saveSettings() {
    const provider = $('provider-select')?.value;
    const apiKey   = $('api-key-input')?.value?.trim() ?? '';
    const model    = $('model-select')?.value;

    if (provider) await Storage.saveSetting('provider', provider);
    await Storage.saveSetting('apiKey', apiKey);
    if (model)    await Storage.saveSetting('model', model);

    this.closeSettings();
    this.showToast('API configuration saved.');
  }

  async getProviderConfig() {
    return {
      provider: await Storage.getSetting('provider') || 'gemini',
      apiKey:   await Storage.getSetting('apiKey')   || '',
      model:    await Storage.getSetting('model')    || '',
    };
  }

  // ── Processing UI ──────────────────────────────────────────────────────

  showProcessing(filename, pageCount) {
    const title = $('processing-book-title');
    const pages = $('processing-page-count');
    const log   = $('processing-log');
    if (title) title.textContent = filename;
    if (pages) pages.textContent = pageCount !== '…' ? `${pageCount} pages` : '';
    if (log)   log.innerHTML     = '';

    $('metrics-bar')?.classList.add('hidden');
    this.setProgress(0, 'Reading file…', 'extract');
    $('upload-section')?.classList.add('hidden');
    $('processing-section')?.classList.remove('hidden');
  }

  hideProcessing() {
    $('processing-section')?.classList.add('hidden');
    $('upload-section')?.classList.remove('hidden');
    $('metrics-bar')?.classList.add('hidden');
  }

  setProgress(pct, status, phase) {
    const bar  = $('progress-bar');
    const stat = $('progress-status');
    if (bar)  bar.style.width  = `${pct}%`;
    if (stat) stat.textContent = status;
    this._updatePhaseTrack(phase);
  }

  appendLog(msg) {
    const log = $('processing-log');
    if (!log) return;

    while (log.children.length >= 80) log.removeChild(log.firstChild);

    const entry = document.createElement('div');
    const isErr = msg.includes('⚠') || msg.toLowerCase().includes('failed');
    const isOk  = msg.includes('✓');
    entry.className   = `log-entry${isErr ? ' log-err' : isOk ? ' log-ok' : ''}`;
    entry.textContent = msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  updateMetrics(metrics) {
    if (!metrics) return;
    const bar = $('metrics-bar');
    if (bar) bar.classList.remove('hidden');

    if ($('metric-pages'))    $('metric-pages').textContent    = metrics.pages ?? '—';
    if ($('metric-chapters')) $('metric-chapters').textContent = metrics.aiCallsTotal != null
      ? `${metrics.aiCallsDone ?? 0} / ${metrics.chapters ?? '—'}`
      : (metrics.chapters ?? '—');
    if ($('metric-ai-calls')) $('metric-ai-calls').textContent = metrics.aiCallsTotal != null
      ? `${metrics.aiCallsDone ?? 0} / ${metrics.aiCallsTotal}`
      : '—';
    if ($('metric-session'))  $('metric-session').textContent  = metrics.sessionRequests ?? '—';
    if ($('metric-rate'))     $('metric-rate').textContent     = metrics.remainingThisMinute != null
      ? `${metrics.remainingThisMinute}/12`
      : '—';
  }

  _updatePhaseTrack(activePhase) {
    const order = ['extract', 'analyze', 'complete'];
    const idx   = order.indexOf(activePhase);

    $$('.phase-step').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('done',   i < idx);
    });
  }

  // ── Library ────────────────────────────────────────────────────────────

  showLibrary() {
    $('book-detail')?.classList.add('hidden');
    const app = $('app');
    if (app) app.style.display = 'flex';
  }

  async renderLibrary() {
    const grid  = $('book-grid');
    const count = $('book-count');
    if (!grid || !count) return;

    let books;
    try {
      books = await Storage.getAllBooks();
    } catch (err) {
      console.error('[ui] renderLibrary: getAllBooks failed:', err);
      this.showError('Could not load your archive. Please reload the page.');
      return;
    }

    count.textContent = `${books.length} book${books.length !== 1 ? 's' : ''}`;

    // Remove only book cards — never destroy #empty-library via innerHTML reset
    grid.querySelectorAll('.book-card').forEach(el => el.remove());

    // #empty-library may have been detached by a prior innerHTML='' call; re-anchor it
    let empty = $('empty-library');
    if (!empty) {
      empty           = document.createElement('div');
      empty.id        = 'empty-library';
      empty.className = 'empty-library';
      empty.innerHTML = '<p>No books processed yet.</p>'
        + '<p class="muted">Upload a PDF above to begin building your knowledge archive.</p>';
      grid.appendChild(empty);
    } else if (!grid.contains(empty)) {
      grid.appendChild(empty);
    }

    if (books.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(book => {
      try {
        grid.appendChild(this._makeBookCard(book));
      } catch (err) {
        console.error('[ui] _makeBookCard failed for book:', book?.id, err);
      }
    });
  }

  _makeBookCard(book) {
    const card = document.createElement('div');
    card.className      = 'book-card';
    card.dataset.bookId = book.id || '';

    const statusClass = {
      complete:       'status-complete',
      processing:     'status-processing',
      extracted:      'status-extracted',
      'rate-limited': 'status-rate-limited',
      error:          'status-error',
    }[book.status] || 'status-processing';

    const statusLabel = {
      complete:       '✓ Complete',
      processing:     '⟳ Processing',
      extracted:      '⧖ Ready to Analyze',
      'rate-limited': '⏸ Paused — Rate Limited',
      error:          '✕ Error',
    }[book.status] || (book.status || 'Unknown');

    const date = book.createdAt
      ? new Date(book.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';

    card.innerHTML = `
      <div class="book-card-title">${this._esc(book.title || 'Untitled')}</div>
      <div class="book-card-meta">
        <span>${book.pageCount ?? '?'} pages</span>
        <span class="sep">·</span>
        <span>${book.chapterCount ?? '?'} chapters</span>
        <span class="sep">·</span>
        <span>${date}</span>
      </div>
      <span class="book-card-status ${statusClass}">${statusLabel}</span>
      ${book.summary ? `<p class="book-card-summary">${this._esc(book.summary)}</p>` : ''}
    `;

    if (book.status === 'complete') {
      card.addEventListener('click', () => this.cb.onBookOpen(book.id));
    } else {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;';

      if ((book.status === 'extracted' || book.status === 'rate-limited') && this.cb.onBookResume) {
        const resumeBtn       = document.createElement('button');
        resumeBtn.className   = 'btn-ghost btn-sm btn-resume';
        resumeBtn.textContent = '▶ Resume AI';
        resumeBtn.addEventListener('click', e => {
          e.stopPropagation();
          this.cb.onBookResume(book.id);
        });
        actions.appendChild(resumeBtn);
      }

      const delBtn       = document.createElement('button');
      delBtn.className   = 'btn-ghost btn-sm btn-danger-ghost';
      delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.openDeleteModal(book.id);
      });
      actions.appendChild(delBtn);
      card.appendChild(actions);
    }

    return card;
  }

  // ── Book Detail ────────────────────────────────────────────────────────

  async openBook(bookId) {
    this._currentBookId = bookId;

    const [book, chapters, knowledge] = await Promise.all([
      Storage.getBook(bookId),
      Storage.getChapters(bookId),
      Storage.getKnowledge(bookId),
    ]);
    console.log(`[ui] STAGE loaded-chapters: Storage.getChapters(${bookId}) returned ${(chapters||[]).length} chapters`);

    if (!book) {
      this.showError('Book not found in archive.');
      return;
    }

    const date = book.createdAt
      ? new Date(book.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
      : '—';

    this._setText('detail-title',        book.title   || 'Untitled');
    this._setText('detail-pages',        `${book.pageCount ?? '?'} pages`);
    this._setText('detail-chapters',     `${(chapters || []).length} chapters`);
    console.log(`[ui] STAGE displayed-chapters: rendering ${(chapters||[]).length} chapters in detail view`);
    this._setText('detail-date',         date);
    this._setText('detail-book-summary', book.summary || 'No summary available.');

    // Chapters
    const chList = $('chapter-list');
    if (chList) {
      chList.innerHTML = '';
      const sorted = [...(chapters || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      sorted.forEach(ch => chList.appendChild(this._makeChapterItem(ch)));
    }

    // Knowledge
    const k = knowledge || {};
    this._renderPills('detail-concepts',   k.concepts        || []);
    this._renderItems('detail-principles', k.principles      || []);
    this._renderItems('detail-actions',    k.actionableIdeas || []);
    this._renderVocab(k.vocabulary  || []);
    this._renderQuotes(k.quotes     || []);

    const app = $('app');
    if (app) app.style.display = 'none';
    $('book-detail')?.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  _setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  _makeChapterItem(ch) {
    const div = document.createElement('div');
    div.className = 'chapter-item';

    const ps    = ch.pageStart ?? '?';
    const pe    = ch.pageEnd   ?? '?';
    const pages = ps === pe ? `p. ${ps}` : `pp. ${ps}–${pe}`;

    div.innerHTML = `
      <div class="chapter-item-header">
        <span class="chapter-item-title">${this._esc(ch.title || 'Untitled')}</span>
        <span class="chapter-item-pages">${pages}</span>
        ${ch.summary ? '<span class="chapter-item-toggle">▾</span>' : ''}
      </div>
      ${ch.summary ? `<p class="chapter-item-summary">${this._esc(ch.summary)}</p>` : ''}
    `;

    if (ch.summary) {
      div.querySelector('.chapter-item-header')?.addEventListener('click', () => {
        div.classList.toggle('open');
      });
    }

    return div;
  }

  _renderPills(id, items) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
      return;
    }
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = String(item ?? '');
      el.appendChild(li);
    });
  }

  _renderItems(id, items) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
      return;
    }
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = String(item ?? '');
      el.appendChild(li);
    });
  }

  _renderVocab(vocab) {
    const el = $('detail-vocab');
    if (!el) return;
    el.innerHTML = '';
    if (!vocab.length) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
      return;
    }
    vocab.forEach(v => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="vocab-item-term">${this._esc(v.term || String(v))}</div>`
        + `<div class="vocab-item-def">${this._esc(v.definition || '')}</div>`;
      el.appendChild(li);
    });
  }

  _renderQuotes(quotes) {
    const el = $('detail-quotes');
    if (!el) return;
    el.innerHTML = '';
    if (!quotes.length) {
      el.innerHTML = '<p class="muted" style="font-size:0.85rem">No quotes extracted.</p>';
      return;
    }
    quotes.forEach(q => {
      const block     = document.createElement('div');
      block.className = 'quote-block';
      const text      = typeof q === 'string' ? q : (q.text    || '');
      const context   = typeof q === 'string' ? '' : (q.context || '');
      block.innerHTML = `<p class="quote-text">"${this._esc(text)}"</p>`
        + (context ? `<p class="quote-context">${this._esc(context)}</p>` : '');
      el.appendChild(block);
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  openDeleteModal(bookId) {
    this._deleteTarget = bookId;
    $('delete-modal')?.classList.remove('hidden');
  }

  closeDeleteModal() {
    this._deleteTarget = null;
    $('delete-modal')?.classList.add('hidden');
  }

  // ── Toast ──────────────────────────────────────────────────────────────

  showError(msg) { this._showToastInternal(msg, 'error'); }
  showToast(msg) { this._showToastInternal(msg, 'info');  }

  _showToastInternal(msg, type) {
    let toast = $('app-toast');
    if (!toast) {
      toast    = document.createElement('div');
      toast.id = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = `app-toast app-toast--${type} app-toast--visible`;
    clearTimeout(this._toastTimer);
    this._toastTimer  = setTimeout(
      () => toast.classList.remove('app-toast--visible'),
      type === 'error' ? 6000 : 3000
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
