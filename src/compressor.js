// Local text compression — samples representative paragraphs before sending to AI

const MIN_PARA_LENGTH = 30; // shorter lines are likely page-number noise

/**
 * Compress raw chapter text to targetChars by sampling representative paragraphs.
 * Always prioritises the opening (thesis) and closing (conclusions) of a chapter.
 */
export function compressChapter(rawText, targetChars = 15000) {
  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= targetChars) return cleaned;

  // Split into paragraphs; filter obvious noise (page numbers, blank lines, etc.)
  const paras = cleaned
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p.length >= MIN_PARA_LENGTH && !/^\d+$/.test(p));

  if (paras.length === 0) return cleaned.slice(0, targetChars);
  if (paras.length === 1) return paras[0].slice(0, targetChars);

  // Budget: 50% from the front, 20% from the middle, 20% from the back
  const frontCount = Math.ceil(paras.length * 0.5);
  const backCount  = Math.ceil(paras.length * 0.2);
  const midCount   = Math.min(6, Math.ceil(paras.length * 0.1));
  const midStart   = Math.floor(paras.length / 2) - Math.floor(midCount / 2);

  const seen = new Set();
  const candidates = [
    ...paras.slice(0, frontCount),
    ...paras.slice(Math.max(0, midStart), midStart + midCount),
    ...paras.slice(Math.max(0, paras.length - backCount)),
  ].filter(p => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  // Greedy pack to targetChars
  let result = '';
  for (const p of candidates) {
    const next = result ? result + '\n\n' + p : p;
    if (next.length > targetChars) break;
    result = next;
  }

  return result || cleaned.slice(0, targetChars);
}

/**
 * Merge smallest adjacent chapters until count <= maxGroups.
 * Caps the number of AI calls for very long books.
 */
export function groupChapters(chapters, maxGroups = 15) {
  if (chapters.length <= maxGroups) return chapters.map(ch => ({ ...ch }));

  let groups = chapters.map(ch => ({ ...ch }));

  while (groups.length > maxGroups) {
    let minPages = Infinity;
    let minIdx   = 0;
    for (let i = 0; i < groups.length - 1; i++) {
      const combined = groups[i].pages.length + groups[i + 1].pages.length;
      if (combined < minPages) { minPages = combined; minIdx = i; }
    }
    const a = groups[minIdx];
    const b = groups[minIdx + 1];
    groups[minIdx] = {
      title:     a.title,
      pages:     [...a.pages, ...b.pages],
      pageStart: a.pageStart,
      pageEnd:   b.pageEnd,
    };
    groups.splice(minIdx + 1, 1);
  }

  return groups;
}
