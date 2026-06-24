import { AIProvider, registerProvider } from './base.js';

// Note: Anthropic's API does not allow direct browser calls by default.
// This works when the anthropic-dangerous-allow-browser header is accepted,
// or when requests go through a server-side proxy.

export class AnthropicProvider extends AIProvider {
  get name() { return 'Anthropic'; }

  async complete(systemPrompt, userPrompt, { maxTokens = 2048, temperature = 0.3 } = {}) {
    this.validateKey();

    const model      = this.model || 'claude-haiku-4-5-20251001';
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 45000);

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':                      'application/json',
          'x-api-key':                         this.apiKey,
          'anthropic-version':                 '2023-06-01',
          'anthropic-dangerous-allow-browser': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          system:   systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Anthropic request timed out after 45s');
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg     = errData?.error?.message || `HTTP ${res.status}`;
      const error   = new Error(`Anthropic error: ${msg}`);
      // 429 = rate limit, 529 = overloaded
      if (res.status === 429 || res.status === 529 ||
          msg.toLowerCase().includes('rate limit') ||
          msg.toLowerCase().includes('overloaded')) {
        error.isRateLimit = true;
      }
      throw error;
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('Anthropic returned an empty response.');
    return text.trim();
  }
}

registerProvider('anthropic', AnthropicProvider);
