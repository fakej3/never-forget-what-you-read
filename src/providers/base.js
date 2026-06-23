// AIProvider base class — all providers implement this interface

export class AIProvider {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model  = model;
  }

  get name() { throw new Error('Provider must define name'); }

  /**
   * Complete a prompt and return the text response.
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {object} opts  — { maxTokens, temperature }
   * @returns {Promise<string>}
   */
  async complete(systemPrompt, userPrompt, opts = {}) {
    throw new Error('Provider must implement complete()');
  }

  /** Quick validation — throws if key looks obviously wrong */
  validateKey() {
    if (!this.apiKey || this.apiKey.trim().length < 10) {
      throw new Error('API key appears invalid. Please check your configuration.');
    }
  }
}

// ── Provider registry ──────────────────────────────────────────────────────

const _registry = {};

export function registerProvider(id, ProviderClass) {
  _registry[id] = ProviderClass;
}

export function createProvider(id, apiKey, model) {
  const Cls = _registry[id];
  if (!Cls) throw new Error(`Unknown provider: ${id}`);
  return new Cls(apiKey, model);
}

export function getProviderIds() {
  return Object.keys(_registry);
}
