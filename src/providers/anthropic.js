import { AIProvider, registerProvider } from './base.js';

// Note: Anthropic's API does not allow direct browser calls by default.
// This implementation works when a CORS proxy is configured, or when
// running in an environment that permits cross-origin requests.
// For production use, route requests through a lightweight server-side proxy.

export class AnthropicProvider extends AIProvider {
  get name() { return 'Anthropic'; }

  async complete(systemPrompt, userPrompt, { maxTokens = 2048, temperature = 0.3 } = {}) {
    this.validateKey();

    const model = this.model || 'claude-haiku-4-5-20251001';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-api-key':               this.apiKey,
        'anthropic-version':       '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system:   systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Anthropic error: ${msg}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('Anthropic returned an empty response.');
    return text.trim();
  }
}

registerProvider('anthropic', AnthropicProvider);
