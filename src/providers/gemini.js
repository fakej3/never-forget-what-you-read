import { AIProvider, registerProvider } from './base.js';

const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS     = 45000;

export class GeminiProvider extends AIProvider {
  get name() { return 'Google Gemini'; }

  async complete(systemPrompt, userPrompt, { maxTokens = 2048, temperature = 0.3 } = {}) {
    this.validateKey();

    const model = this.model || 'gemini-1.5-flash';
    const url   = `${GEMINI_BASE}/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      // Gemini 1.5+ supports systemInstruction separately
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error(`Gemini request timed out after ${TIMEOUT_MS / 1000}s`);
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Gemini error: ${msg}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return text.trim();
  }
}

registerProvider('gemini', GeminiProvider);
