import { AIProvider, registerProvider } from './base.js';

const TIMEOUT_MS = 45000;

export class OpenAIProvider extends AIProvider {
  get name() { return 'OpenAI'; }

  async complete(systemPrompt, userPrompt, { maxTokens = 2048, temperature = 0.3 } = {}) {
    this.validateKey();

    const model      = this.model || 'gpt-4o-mini';
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
          max_tokens:  maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error(`OpenAI request timed out after ${TIMEOUT_MS / 1000}s`);
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenAI error: ${msg}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenAI returned an empty response.');
    return text.trim();
  }
}

registerProvider('openai', OpenAIProvider);
