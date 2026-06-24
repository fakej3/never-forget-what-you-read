import { AIProvider, registerProvider } from './base.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS  = 45000;

export class GeminiProvider extends AIProvider {
  get name() { return 'Google Gemini'; }

  async complete(systemPrompt, userPrompt, { maxTokens = 2048, temperature = 0.3 } = {}) {
    this.validateKey();

    const model = this.model || 'gemini-1.5-flash';
    const url   = `${GEMINI_BASE}/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
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
      const errData = await res.json().catch(() => ({}));
      const msg     = errData?.error?.message || `HTTP ${res.status}`;
      const error   = new Error(`Gemini error: ${msg}`);
      // 429 = rate limit, 503 = quota / service unavailable, RESOURCE_EXHAUSTED in message
      if (res.status === 429 || res.status === 503 ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('resource_exhausted') ||
          msg.toLowerCase().includes('rate limit')) {
        error.isRateLimit = true;
      }
      throw error;
    }

    const data = await res.json();

    // Gemini can return finishReason=SAFETY or empty candidates
    const candidate = data?.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates.');
    if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini stopped with reason: ${candidate.finishReason}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response.');
    return text.trim();
  }
}

registerProvider('gemini', GeminiProvider);
