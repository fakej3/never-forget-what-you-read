// Deterministic mock AI responses for testing
// Each call returns unique data based on call index

/**
 * Create a mock AI response function.
 * callCount is a shared mutable object { n: 0 } so callers can reset or share state.
 *
 * Returns a function that takes a requestBody string and returns a mock response string.
 */
export function createMockAI(callCount = { n: 0 }) {
  return function mockResponse(requestBody) {
    const i = callCount.n++;

    // Detect if this is a book summary call:
    // - Chapter calls include "CHAPTER:" in the user message
    // - Book summary calls do NOT include vocabulary schema or CHAPTER:
    const isBookSummary = !requestBody.includes('CHAPTER:') && !requestBody.includes('"vocabulary"');

    if (isBookSummary) {
      return 'This book covers fundamental principles across all chapters, building from foundational concepts to advanced applications, with practical guidance for real-world implementation.';
    }

    const knowledge = {
      summary: `Chapter ${i + 1} explores core principles and key insights relevant to the subject matter, providing comprehensive analysis of the main themes and their practical applications.`,
      concepts: [
        `Concept ${i + 1}-A`,
        `Concept ${i + 1}-B`,
        `Concept ${i + 1}-C`,
      ],
      principles: [
        `Principle ${i + 1}-1`,
        `Principle ${i + 1}-2`,
      ],
      actionableIdeas: [
        `Action ${i + 1}-1`,
        `Action ${i + 1}-2`,
      ],
      vocabulary: [
        { term: `Term ${i + 1}-A`, definition: `Definition of term ${i + 1}-A in context of chapter ${i + 1}` },
        { term: `Term ${i + 1}-B`, definition: `Definition of term ${i + 1}-B in context of chapter ${i + 1}` },
      ],
      quotes: [
        { text: `Quote from chapter ${i + 1}`, context: `Chapter ${i + 1} context` },
      ],
    };

    return JSON.stringify(knowledge);
  };
}

/**
 * Wrap a mock response string in Gemini API response format.
 */
export function wrapGeminiResponse(text) {
  return JSON.stringify({
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: 'STOP',
    }],
  });
}

/**
 * Create a rate-limit error response body (HTTP 429).
 */
export function makeRateLimitBody() {
  return JSON.stringify({
    error: {
      code: 429,
      message: 'quota exceeded',
      status: 'RESOURCE_EXHAUSTED',
    },
  });
}

/**
 * Compute expected knowledge counts from mock formula.
 * Mock returns per chapter: 3 concepts, 2 principles, 2 actions, 2 vocab, 1 quote
 * After dedup+cap (concepts=20, principles=15, actions=15, vocab=20, quotes=10)
 */
export function computeExpectedCounts(chapterCount) {
  return {
    expectedConceptCount:     Math.min(chapterCount * 3, 20),
    expectedPrincipleCount:   Math.min(chapterCount * 2, 15),
    expectedActionableCount:  Math.min(chapterCount * 2, 15),
    expectedVocabularyCount:  Math.min(chapterCount * 2, 20),
    expectedQuoteCount:       Math.min(chapterCount * 1, 10),
    // +1 AI call for book summary (unless only 1 chapter)
    expectedAICalls:          chapterCount + (chapterCount > 1 ? 1 : 0),
  };
}
