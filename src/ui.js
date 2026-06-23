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

export class UI {
  constructor(callbacks) {
    this.cb = callbacks;
    this._deleteTarget = null;
    this._toastTimer   = null;
    this._bind();
  }

  // ── Binding ────────────────────────────────────────────────────────────

  _bind() {
    // Upload
    const zone  = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

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

    // Settings modal — only wire the backdrop that actually exists in HTML
    document.getElementById('open-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());
    document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', () => this.closeSettings());
    document.getElementById('save-settings').addEventListener('click', () => this._saveSettings());
    document.getElementById('provider-select').addEventListener('change', e => this._onProviderChange(e.target.value));

    // Cancel processing
    document.getElementById('cancel-processing').addEventListener('click', () => {
      this.cb.onCancelProcessing();
    });

    // Back to library
    document.getElementById('back-to-library').addEventListener('click', () => this.showLibrary());

    // Delete (in detail view)
    document.getElementById('delete-book').addEventListener('click', () => {
      this.openDeleteModal(this._currentBookId);
    });
    document.querySelector('#delete-modal .modal-backdrop').addEventListener('click', () => this.closeDeleteModal());
    document.getElementById('close-delete').addEventListener('click', () => this.closeDeleteModal());
    document.getElementById('cancel-delete').addEventListener('click', () => this.closeDeleteModal());
    document.getElementById('confirm-delete').addEventListener('click', () => {
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

    document.getElementById('provider-select').value = provider;
    document.getElementById('api-key-input').value   = apiKey;
    this._onProviderChange(provider, model);

    document.getElementById('settings-modal').classList.remove('hidden');
  }

  closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
  }

  _onProviderChange(provider, currentModel = null) {
    const models = PROVIDER_MODELS[provider] || [];
    const select = document.getElementById('model-select');
    select.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    if (currentModel && models.includes(currentModel)) select.value = currentModel;

    const note = document.getElementById('provider-note');
    const text = PROVIDER_NOTES[provider] || '';
    note.textContent = text;
    note.classList.toggle('visible', !!text);
  }

  async _saveSettings() {
    const provider = document.getElementById('provider-select').value;
    const apiKey   = document.getElementById('api-key-input').value.trim();
    const model    = document.getElementById('model-select').value;

    await Storage.saveSetting('provider', provider);
    await Storage.saveSetting('apiKey',   apiKey);
    await Storage.saveSetting('model',    model);

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
    document.getElementById('processing-book-title').textContent = filename;
    document.getElementById('processing-page-count').textContent = pageCount !== '…' ? `${pageCount} pages` : '';
    document.getElementById('processing-log').innerHTML = '';
    this.setProgress(0, 'Reading file…', 'extract');
    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('processing-section').classList.remove('hidden');
  }

  hideProcessing() {
    document.getElementById('processing-section').classList.add('hidden');
    document.getElementById('upload-section').classList.remove('hidden');
  }

  setProgress(pct, status, phase) {
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-status').textContent = status;
    this._updatePhaseTrack(phase);
  }

  appendLog(msg) {
    const log = document.getElementById('processing-log');
    // Prune log to last 80 entries to prevent unbounded DOM growth
    while (log.children.length >= 80) log.removeChild(log.firstChild);

    const entry  = document.createElement('div');
    const isErr  = msg.includes('⚠') || msg.toLowerCase().includes('failed');
    const isOk   = msg.includes('✓');
    entry.className = `log-entry${isErr ? ' log-err' : isOk ? ' log-ok' : ''}`;
    entry.textContent = msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  _updatePhaseTrack(activePhase) {
    const order = ['extract', 'chunk', 'summarize', 'knowledge', 'complete'];
    const idx   = order.indexOf(activePhase);

    document.querySelectorAll('.phase-step').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('done',   i < idx);
    });
  }

  // ── Library ────────────────────────────────────────────────────────────

  showLibrary() {
    document.getElementById('book-detail').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }

  async renderLibrary() {
    const books = await Storage.getAllBooks();
    const grid  = document.getElementById('book-grid');
    const empty = document.getElementById('empty-library');
    const count = document.getElementById('book-count');

    count.textContent = `${books.length} book${books.length !== 1 ? 's' : ''}`;
    grid.innerHTML    = '';

    if (books.length === 0) {
      grid.appendChild(empty);
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    books.sort((a, b) => b.createdAt - a.createdAt).forEach(book => {
      const card = this._makeBookCard(book);
      grid.appendChild(card);
    });
  }

  _makeBookCard(book) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.bookId = book.id;

    const statusClass = { complete: 'status-complete', processing: 'status-processing', error: 'status-error' }[book.status] || 'status-processing';
    const statusLabel = { complete: '✓ Complete', processing: '⟳ Processing', error: '✕ Error' }[book.status] || book.status;
    const date        = new Date(book.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    card.innerHTML = `
      <div class="book-card-title">${this._esc(book.title)}</div>
      <div class="book-card-meta">
        <span>${book.pageCount} pages</span>
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
      // Error and stuck-processing books show a delete button directly on the card
      const delBtn = document.createElement('button');
      delBtn.className   = 'btn-ghost btn-sm btn-danger-ghost';
      delBtn.textContent = 'Remove';
      delBtn.style.marginTop = '0.5rem';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDeleteModal(book.id);
      });
      card.appendChild(delBtn);
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

    if (!book) return;

    const date = new Date(book.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

    document.getElementById('detail-title').textContent         = book.title;
    document.getElementById('detail-pages').textContent         = `${book.pageCount} pages`;
    document.getElementById('detail-chapters').textContent      = `${chapters.length} chapters`;
    document.getElementById('detail-date').textContent          = date;
    document.getElementById('detail-book-summary').textContent  = book.summary || 'No summary available.';

    // Chapters
    const sortedChapters = [...chapters].sort((a, b) => a.index - b.index);
    const chList = document.getElementById('chapter-list');
    chList.innerHTML = '';
    sortedChapters.forEach(ch => chList.appendChild(this._makeChapterItem(ch)));

    // Knowledge
    if (knowledge) {
      this._renderPills('detail-concepts',   knowledge.concepts        || []);
      this._renderItems('detail-principles', knowledge.principles      || []);
      this._renderItems('detail-actions',    knowledge.actionableIdeas || []);
      this._renderVocab(knowledge.vocabulary || []);
      this._renderQuotes(knowledge.quotes    || []);
    }

    document.getElementById('app').style.display = 'none';
    document.getElementById('book-detail').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  _makeChapterItem(ch) {
    const div = document.createElement('div');
    div.className = 'chapter-item';

    const pages = ch.pageStart === ch.pageEnd
      ? `p. ${ch.pageStart}`
      : `pp. ${ch.pageStart}–${ch.pageEnd}`;

    div.innerHTML = `
      <div class="chapter-item-header">
        <span class="chapter-item-title">${this._esc(ch.title)}</span>
        <span class="chapter-item-pages">${pages}</span>
        ${ch.summary ? '<span class="chapter-item-toggle">▾</span>' : ''}
      </div>
      ${ch.summary ? `<p class="chapter-item-summary">${this._esc(ch.summary)}</p>` : ''}
    `;

    if (ch.summary) {
      div.querySelector('.chapter-item-header').addEventListener('click', () => {
        div.classList.toggle('open');
      });
    }

    return div;
  }

  // Split into two named methods — removes dead branch
  _renderPills(id, items) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.appendChild(li);
    });
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
    }
  }

  _renderItems(id, items) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      el.appendChild(li);
    });
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
    }
  }

  _renderVocab(vocab) {
    const el = document.getElementById('detail-vocab');
    el.innerHTML = '';
    if (vocab.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'None extracted.';
      li.style.opacity = '0.4';
      el.appendChild(li);
      return;
    }
    vocab.forEach(v => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="vocab-item-term">${this._esc(v.term || v)}</div><div class="vocab-item-def">${this._esc(v.definition || '')}</div>`;
      el.appendChild(li);
    });
  }

  _renderQuotes(quotes) {
    const el = document.getElementById('detail-quotes');
    el.innerHTML = '';
    if (quotes.length === 0) {
      el.innerHTML = '<p class="muted" style="font-size:0.85rem">No quotes extracted.</p>';
      return;
    }
    quotes.forEach(q => {
      const block = document.createElement('div');
      block.className = 'quote-block';
      // q may be a string or { text, context }
      const text    = typeof q === 'string' ? q : (q.text || '');
      const context = typeof q === 'string' ? '' : (q.context || '');
      block.innerHTML = `
        <p class="quote-text">"${this._esc(text)}"</p>
        ${context ? `<p class="quote-context">${this._esc(context)}</p>` : ''}
      `;
      el.appendChild(block);
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  openDeleteModal(bookId) {
    this._deleteTarget = bookId;
    document.getElementById('delete-modal').classList.remove('hidden');
  }

  closeDeleteModal() {
    this._deleteTarget = null;
    document.getElementById('delete-modal').classList.add('hidden');
  }

  // ── Toast (replaces alert) ─────────────────────────────────────────────

  showError(msg) {
    this._showToastInternal(msg, 'error');
  }

  showToast(msg) {
    this._showToastInternal(msg, 'info');
  }

  _showToastInternal(msg, type) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent  = msg;
    toast.className    = `app-toast app-toast--${type} app-toast--visible`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('app-toast--visible');
    }, type === 'error' ? 6000 : 3000);
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
