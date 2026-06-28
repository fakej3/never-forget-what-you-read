#!/usr/bin/env node
// Forensic Chapter Detection Audit
// Usage: node audit.js <book.pdf> [--out-dir <directory>]
//
// Outputs:
//   audit-report-<slug>.json   — machine-readable full audit data
//   audit-report-<slug>.html   — human-readable report with stats + recommendations

import { createRequire }                        from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, resolve }               from 'path';
import { fileURLToPath }                         from 'url';

const require   = createRequire(import.meta.url);
const pdfjsLib  = require('./node_modules/pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

// ── Constants (mirrors chunker.js + pipeline.js exactly) ─────────────────────

const SCAN_LINES               = 12;
const RUNNING_HEADER_THRESHOLD = 0.20;
const SPARSE_WORDS             = 250;
const SEQ_MIN_COVERAGE         = 0.60;
const SEQ_MIN_CONTINUITY       = 0.75;
const MAX_CHAPTER_GROUPS       = 30;    // from pipeline.js
const SCORE_THRESHOLD          = 40;
const SCORE_THRESHOLD_RELAXED  = 25;
const SCORE_THRESHOLD_SEQ      = 0.35;  // quality floor for numbered-sequence
const SCORE_THRESHOLD_RAW      = 0.25;  // quality floor for raw scoring

// ── Heading patterns (mirrors chunker.js exactly) ─────────────────────────────

const HEADING_PATTERNS = [
  /^(chapter|ch\.?)\s*\d+(?:\s*$|\s*[:\-–—·]|\s+[A-ZÀ-ɏ0-9])/i,
  /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s*$|\s*[:\-–—]|\s+[A-ZÀ-ɏ])/i,
  /^\d{1,2}\.\s+[A-ZÀ-ɏ]/,
  /^part\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivxlcIVXLC]+)(?:\s*$|\s*[:\-–—])/i,
  /^section\s+\d+(\s|$)/i,
  /^[IVXLC]{1,6}\.\s+[A-Za-z]/,
  /^(prologue|epilogue|introduction|preface|foreword|conclusion|afterword|appendix|acknowledgements?|bibliography|interlude)(?:\s*$|\s*[:\-–—])/i,
];
const PATTERN_NAMES = ['PAT_CHAPTER_NUM','PAT_CHAPTER_WORD','PAT_ARABIC_BARE',
  'PAT_PART','PAT_SECTION','PAT_ROMAN','PAT_FRONTMATTER'];

const WORD_INT = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,'twenty-one':21,'twenty-two':22,
  'twenty-three':23,'twenty-four':24,'twenty-five':25,'twenty-six':26,
  'twenty-seven':27,'twenty-eight':28,'twenty-nine':29,thirty:30,
};
const WORD_NUMBERS_RE = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|\d{1,3})$/i;
const ROMAN_VAL = { I:1,V:5,X:10,L:50,C:100,D:500,M:1000 };

function wordToInt(s) {
  return WORD_INT[s.toLowerCase().replace(/\s+/g,'-').trim()] ?? null;
}
function romanToInt(s) {
  const u = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(u)) return null;
  let total=0, prev=0;
  for (const c of [...u].reverse()) {
    const v = ROMAN_VAL[c]; if (!v) return null;
    if (v<prev) total-=v; else { total+=v; prev=v; }
  }
  return total>0&&total<=500?total:null;
}
function extractChapterNum(title) {
  const t = title.trim();
  let m = t.match(/^(?:chapter|ch\.?)\s+(\d{1,3})(?:\s|$|[:\-–—·])/i);
  if (m) return { value:parseInt(m[1]), kind:'chapter' };
  m = t.match(/^(?:chapter|ch\.?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s|$|[:\-–—])/i);
  if (m) { const v=wordToInt(m[1]); if (v) return { value:v, kind:'chapter' }; }
  m = t.match(/^(?:chapter|ch\.?)\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v=romanToInt(m[1]); if (v) return { value:v, kind:'chapter' }; }
  m = t.match(/^part\s+(\d{1,2})(?:\s|$|[:\-–—])/i);
  if (m) return { value:parseInt(m[1]), kind:'part' };
  m = t.match(/^part\s+(one|two|three|four|five|six|seven|eight|nine|ten)(?:\s|$|[:\-–—])/i);
  if (m) { const v=wordToInt(m[1]); if (v) return { value:v, kind:'part' }; }
  m = t.match(/^part\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v=romanToInt(m[1]); if (v) return { value:v, kind:'part' }; }
  m = t.match(/^([IVXLC]{1,6})\.\s+[A-Za-z]/);
  if (m) { const v=romanToInt(m[1]); if (v) return { value:v, kind:'roman' }; }
  m = t.match(/^(\d{1,2})\.\s+[A-ZÀ-ɏ]/);
  if (m) return { value:parseInt(m[1]), kind:'arabic-bare' };
  return null;
}
function sequenceContinuity(values) {
  if (values.length<2) return 0;
  let good=0;
  for (let i=1;i<values.length;i++) {
    const gap=values[i]-values[i-1];
    if (gap===1) good+=1; else if (gap===2) good+=0.6;
  }
  return good/(values.length-1);
}
function chapterQuality(chapters, totalPages) {
  if (!chapters||chapters.length===0) return 0;
  const avgPages = totalPages/chapters.length;
  let densityScore=1;
  if (avgPages<2) densityScore=0.2;
  else if (avgPages<4) densityScore=0.6;
  else if (avgPages>80) densityScore=0.8;
  const varietyScore=Math.min(1,chapters.length/5);
  return (densityScore*0.7)+(varietyScore*0.3);
}
function sanityCheck(chapters, totalPages) {
  if (!chapters||chapters.length===0) return false;
  const avg=totalPages/chapters.length;
  if (avg<1.5) return false;
  if (chapters.length===1&&totalPages>30) return false;
  const titleCounts=new Map();
  for (const ch of chapters) titleCounts.set(ch.title,(titleCounts.get(ch.title)||0)+1);
  const dupCount=[...titleCounts.values()].filter(n=>n>1).reduce((a,b)=>a+b,0);
  if (dupCount/chapters.length>0.4) return false;
  return true;
}

// ── PDF extraction ────────────────────────────────────────────────────────────

async function extractPages(pdfPath) {
  const buf  = readFileSync(pdfPath);
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const pdf  = await pdfjsLib.getDocument({ data }).promise;

  // Extract outline
  let outlineEntries = [];
  try {
    const raw = await pdf.getOutline();
    if (raw) {
      for (const item of raw) {
        if (item.dest) {
          try {
            const dest = Array.isArray(item.dest) ? item.dest : await pdf.getDestination(item.dest);
            if (dest && dest[0]) {
              const ref  = dest[0];
              const idx  = await pdf.getPageIndex(ref);
              outlineEntries.push({ title: item.title, pageNum: idx + 1 });
            }
          } catch {}
        }
        if (item.items) {
          for (const sub of item.items) {
            if (sub.dest) {
              try {
                const dest = Array.isArray(sub.dest) ? sub.dest : await pdf.getDestination(sub.dest);
                if (dest && dest[0]) {
                  const idx = await pdf.getPageIndex(dest[0]);
                  outlineEntries.push({ title: sub.title, pageNum: idx + 1 });
                }
              } catch {}
            }
          }
        }
      }
    }
  } catch {}

  const pages = [];
  for (let p=1; p<=pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const vp      = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // Group items into visual lines by Y position (±3pt tolerance)
    const lineMap = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform[5];
      let bucketKey = null;
      for (const [key] of lineMap) {
        if (Math.abs(key - y) <= 3) { bucketKey = key; break; }
      }
      if (bucketKey === null) { bucketKey = y; lineMap.set(bucketKey, []); }
      lineMap.get(bucketKey).push(item);
    }

    // Sort lines top-to-bottom (PDF: y=0 at bottom, so descending Y = top first)
    const sortedKeys = [...lineMap.keys()].sort((a, b) => b - a);
    const lines = sortedKeys.map(y => {
      const items = lineMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const text  = items.map(i => i.str).join(' ').trim();
      const x     = items[0].transform[4];
      const lastItem = items[items.length - 1];
      const lineWidth = (lastItem.transform[4] + (lastItem.width || 0)) - x;
      const fontSizes = items.map(i => Math.abs(i.transform[3]) || 0).filter(s => s > 0);
      const fontSize  = fontSizes.length > 0 ? Math.max(...fontSizes) : 0;
      const fontName  = items[0].fontName || '';
      const bold      = /bold|heavy|black/i.test(fontName) || /[Bb]$/.test(fontName);
      return { text, y, x, lineWidth, fontSize, bold, italic: false };
    }).filter(l => l.text.length > 0);

    const fullText = lines.map(l => l.text).join('\n');

    pages.push({
      pageNum: p,
      text:    fullText,
      width:   vp.width,
      height:  vp.height,
      lines,
    });
  }

  return { pages, outlineEntries, totalPages: pdf.numPages };
}

// ── Context builder (mirrors chunker.js buildContext) ─────────────────────────

function buildContext(pages) {
  const allFontSizes = [];
  let hasRich = false;
  for (const page of pages) {
    if (page.lines && page.lines.length > 0) {
      hasRich = true;
      for (const line of page.lines) {
        if (line.fontSize > 0) allFontSizes.push(line.fontSize);
      }
    }
  }
  let medianFontSize = 12;
  if (allFontSizes.length > 0) {
    allFontSizes.sort((a,b) => a-b);
    const mid = Math.floor(allFontSizes.length/2);
    medianFontSize = allFontSizes.length%2===0
      ? (allFontSizes[mid-1]+allFontSizes[mid])/2
      : allFontSizes[mid];
  }
  let pageWidth=612, pageHeight=792;
  for (const page of pages) {
    if (page.width && page.height) { pageWidth=page.width; pageHeight=page.height; break; }
  }
  const lineFreq = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map(l=>l.trim()).filter(l=>l.length>1&&l.length<120);
    const cands = new Set([...lines.slice(0,3),...lines.slice(-2)]);
    for (const line of cands) lineFreq.set(line,(lineFreq.get(line)||0)+1);
  }
  const rhThreshold = Math.max(3, pages.length*0.20);
  const runningHeaders  = new Set();
  const everyPageLines  = new Set();
  const runningHeaderFreq = {};
  for (const [line,count] of lineFreq) {
    runningHeaderFreq[line] = count;
    if (count >= rhThreshold)        runningHeaders.add(line);
    if (count >= pages.length*0.60)  everyPageLines.add(line);
  }
  return { medianFontSize, pageWidth, pageHeight, runningHeaders, everyPageLines,
           hasRich, runningHeaderFreq, rhThreshold };
}

// ── Detailed line scorer (mirrors scoreLine exactly, but adds notes) ──────────

function scoreLineDetailed(text, lineOpts, ctx) {
  const {
    y=0, fontSize=0, bold=false,
    x=0, lineWidth=0, lineIndex=0, pageWordCount=0,
    gapAbove=0, gapBelow=0,
    pageHeight=ctx.pageHeight||792,
    pageWidth =ctx.pageWidth ||612,
  } = lineOpts;

  let score = 0;
  const breakdown = [];
  const add = (rule, delta, note) => { score += delta; breakdown.push({ rule, delta, note }); };

  // CHAPTER_KEYWORD: +50
  let matchedPattern = null;
  for (let i=0; i<HEADING_PATTERNS.length; i++) {
    if (HEADING_PATTERNS[i].test(text)) { matchedPattern = PATTERN_NAMES[i]; break; }
  }
  if (matchedPattern) add('CHAPTER_KEYWORD', 50, `matched ${matchedPattern}`);

  // Font size (exclusive)
  if (fontSize > 0 && ctx.medianFontSize > 0) {
    const ratio = fontSize / ctx.medianFontSize;
    if (ratio >= 1.5)       add('LARGE_FONT_BIG',   25, `${fontSize.toFixed(1)}pt vs median ${ctx.medianFontSize.toFixed(1)}pt (${ratio.toFixed(2)}×)`);
    else if (ratio >= 1.25) add('LARGE_FONT',        20, `${fontSize.toFixed(1)}pt vs median ${ctx.medianFontSize.toFixed(1)}pt (${ratio.toFixed(2)}×)`);
    else if (ratio >= 1.1)  add('LARGE_FONT_SMALL',   8, `${fontSize.toFixed(1)}pt vs median ${ctx.medianFontSize.toFixed(1)}pt (${ratio.toFixed(2)}×)`);
  }

  if (bold) add('BOLD', 12, 'font name indicates bold');

  // CENTERED: +15
  const pageCenter = pageWidth / 2;
  const lineCenter = x + lineWidth / 2;
  if (lineWidth > 0 && Math.abs(lineCenter - pageCenter) < 60)
    add('CENTERED', 15, `lineCenter=${lineCenter.toFixed(0)} pageCenter=${pageCenter.toFixed(0)} diff=${Math.abs(lineCenter-pageCenter).toFixed(0)}pt`);

  // TOP_QUARTER: +15
  if (y >= pageHeight * 0.75)
    add('TOP_QUARTER', 15, `y=${y.toFixed(0)} >= ${(pageHeight*0.75).toFixed(0)}`);

  // WHITESPACE_ABOVE: +10
  if (gapAbove >= 18) add('WHITESPACE_ABOVE', 10, `gap=${gapAbove.toFixed(0)}pt`);

  // WHITESPACE_BELOW: +10
  if (gapBelow >= 18) add('WHITESPACE_BELOW', 10, `gap=${gapBelow.toFixed(0)}pt`);

  // SHORT_LINE: +8
  const isShortLine = text.length < 60;
  if (isShortLine) add('SHORT_LINE', 8, `${text.length} chars`);

  // ALL_CAPS: +10
  const alphaChars = text.replace(/[^a-zA-Z]/g,'');
  const upperChars = text.replace(/[^A-Z]/g,'');
  const isAllCaps  = alphaChars.length>=2 && upperChars.length/alphaChars.length>=0.70;
  if (isAllCaps) add('ALL_CAPS', 10, `${(upperChars.length/Math.max(1,alphaChars.length)*100).toFixed(0)}% uppercase alpha`);

  // STARTS_PAGE: +10
  if (lineIndex === 0) add('STARTS_PAGE', 10, 'lineIndex=0');

  // SPARSE_PAGE: +15
  if (pageWordCount < 200 && (isAllCaps || isShortLine))
    add('SPARSE_PAGE', 15, `${pageWordCount} words on page`);

  // ROMAN_NUMERAL: +12
  if (/^[IVXLC]{1,6}\.\s+[A-Za-z]/.test(text)) add('ROMAN_NUMERAL', 12, 'roman numeral heading');

  // WORD_NUMBER: +8
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i.test(text))
    add('WORD_NUMBER', 8, 'starts with spelled-out number');

  // ISOLATED: +8
  if (gapAbove >= 18 && gapBelow >= 18 && text.length < 60)
    add('ISOLATED', 8, `above=${gapAbove.toFixed(0)}pt below=${gapBelow.toFixed(0)}pt`);

  // ── Penalties ──

  if (ctx.runningHeaders.has(text)) {
    const freq = ctx.runningHeaderFreq[text] || 0;
    add('RUNNING_HEADER', -40, `appears on ${freq} pages (threshold=${ctx.rhThreshold.toFixed(1)})`);
  }
  if (ctx.everyPageLines.has(text))
    add('EVERY_PAGE', -60, 'appears on ≥60% of pages');
  if (/^[a-z]/.test(text))
    add('LOWERCASE_START', -30, 'starts with lowercase letter');
  if (text.length > 120)
    add('PROSE_LENGTH', -25, `${text.length} chars > 120`);
  if (y < pageHeight * 0.25)
    add('BOTTOM_QUARTER', -20, `y=${y.toFixed(0)} < ${(pageHeight*0.25).toFixed(0)}`);

  score = Math.max(0, Math.min(100, score));
  return { score, breakdown, hasKeyword: matchedPattern !== null, matchedPattern };
}

// ── Confidence label ──────────────────────────────────────────────────────────

function confidence(score, hasKeyword) {
  if (hasKeyword) {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium-High';
    return 'Medium';
  }
  if (score >= 70) return 'Medium-High';
  if (score >= 55) return 'Medium';
  return 'Low';
}

// ── Audit a single page: score ALL meaningful lines ───────────────────────────

function auditPage(page, ctx) {
  const pageWordCount = page.text.split(/\s+/).filter(Boolean).length;
  const pageLines = (page.lines && page.lines.length > 0)
    ? page.lines
    : page.text.split('\n').map((text,idx) => ({
        text, y: 792-idx*12, x:0, lineWidth:0,
        fontSize: ctx.medianFontSize, bold: false, italic: false,
      })).filter(l => l.text.trim().length > 0);

  const limit = Math.min(SCAN_LINES, pageLines.length);
  const allScoredLines = [];

  // Pass 0: multi-line heading check
  for (let i=0; i<Math.min(limit, pageLines.length-1); i++) {
    const lineText = pageLines[i].text.trim();
    if (ctx.runningHeaders.has(lineText)) continue;
    if (/^(chapter|part)$/i.test(lineText)) {
      const next = pageLines[i+1];
      if (next && !ctx.runningHeaders.has(next.text.trim()) && WORD_NUMBERS_RE.test(next.text.trim())) {
        const titleLine = pageLines[i+2];
        const title = titleLine && !ctx.runningHeaders.has(titleLine.text.trim())
          && !WORD_NUMBERS_RE.test(titleLine.text.trim()) && titleLine.text.length<80
          ? `${lineText} ${next.text.trim()} — ${titleLine.text.trim()}`
          : `${lineText} ${next.text.trim()}`;
        return {
          pageNum: page.pageNum, pageWordCount,
          pass: 0, winner: { text: title, score: 85, lineIndex: i,
            breakdown: [{ rule:'MULTI_LINE_HEADING', delta:85, note:`"${lineText}" + "${next.text.trim()}"` }],
            hasKeyword: true, matchedPattern: 'PAT_MULTILINE', confidence: 'High' },
          allScoredLines: [],
        };
      }
    }
  }

  // Pass 1: score all top-N lines
  let bestScore = -1, bestIdx = -1;
  for (let i=0; i<limit; i++) {
    const lineObj  = pageLines[i];
    const lineText = lineObj.text.trim();
    if (!lineText || lineText.length<2 || lineText.length>120) continue;
    if (/^\d+$/.test(lineText)) continue;

    const prevLine = i>0 ? pageLines[i-1] : null;
    const nextLine = i<pageLines.length-1 ? pageLines[i+1] : null;
    const gapAbove = prevLine ? Math.abs(lineObj.y-prevLine.y)-(lineObj.fontSize||12) : 30;
    const gapBelow = nextLine ? Math.abs(nextLine.y-lineObj.y)-(lineObj.fontSize||12) : 30;

    const lineOpts = {
      y: lineObj.y, fontSize: lineObj.fontSize||ctx.medianFontSize,
      bold: lineObj.bold||false, x: lineObj.x||0, lineWidth: lineObj.lineWidth||0,
      lineIndex: i, pageWordCount,
      gapAbove: Math.max(0,gapAbove), gapBelow: Math.max(0,gapBelow),
      pageHeight: ctx.pageHeight, pageWidth: ctx.pageWidth,
    };
    const { score, breakdown, hasKeyword, matchedPattern } = scoreLineDetailed(lineText, lineOpts, ctx);

    const entry = {
      text: lineText, score, lineIndex: i, breakdown, hasKeyword, matchedPattern,
      confidence: confidence(score, hasKeyword),
      isWinner: false, meetsThreshold: score >= SCORE_THRESHOLD,
    };
    allScoredLines.push(entry);

    if (score >= SCORE_THRESHOLD && score > bestScore) {
      bestScore = score; bestIdx = allScoredLines.length - 1;
    }
  }

  if (bestIdx >= 0) {
    allScoredLines[bestIdx].isWinner = true;
    return { pageNum: page.pageNum, pageWordCount, pass: 1,
      winner: allScoredLines[bestIdx], allScoredLines };
  }

  // Pass 2: sparse ALL-CAPS check
  if (pageWordCount < 200) {
    for (let i=0; i<Math.min(8, pageLines.length); i++) {
      const lineObj  = pageLines[i];
      const lineText = lineObj.text.trim();
      if (!lineText || /^\d+$/.test(lineText)) continue;
      const alphaChars = lineText.replace(/[^a-zA-Z]/g,'');
      const upperChars = lineText.replace(/[^A-Z]/g,'');
      const isAllCapsLine = alphaChars.length>=2 && upperChars.length/alphaChars.length>=0.70;
      if (!isAllCapsLine || ctx.runningHeaders.has(lineText) || ctx.everyPageLines.has(lineText)) continue;

      const prevLine = i>0 ? pageLines[i-1] : null;
      const nextLine = i<pageLines.length-1 ? pageLines[i+1] : null;
      const gapAbove = prevLine ? Math.abs(lineObj.y-prevLine.y)-(lineObj.fontSize||12) : 30;
      const gapBelow = nextLine ? Math.abs(nextLine.y-lineObj.y)-(lineObj.fontSize||12) : 30;
      const lineOpts = {
        y: lineObj.y, fontSize: lineObj.fontSize||ctx.medianFontSize,
        bold: lineObj.bold||false, x: lineObj.x||0, lineWidth: lineObj.lineWidth||0,
        lineIndex: i, pageWordCount,
        gapAbove: Math.max(0,gapAbove), gapBelow: Math.max(0,gapBelow),
        pageHeight: ctx.pageHeight, pageWidth: ctx.pageWidth,
      };
      const { score, breakdown, hasKeyword, matchedPattern } = scoreLineDetailed(lineText, lineOpts, ctx);
      if (score >= SCORE_THRESHOLD_RELAXED) {
        const entry = { text:lineText, score, lineIndex:i, breakdown, hasKeyword, matchedPattern,
          confidence: confidence(score, hasKeyword), isWinner:true, meetsThreshold:score>=SCORE_THRESHOLD };
        allScoredLines.push(entry);
        return { pageNum:page.pageNum, pageWordCount, pass:2, winner:entry, allScoredLines };
      }
    }
  }

  return { pageNum:page.pageNum, pageWordCount, pass:1, winner:null, allScoredLines };
}

// ── Build chapters from candidates (mirrors chunker.js) ───────────────────────

function buildChaptersFromCandidates(candidates, pages) {
  if (candidates.length===0) return [];
  const chapters = [];
  for (let i=0;i<candidates.length;i++) {
    const cand=candidates[i], nextCand=candidates[i+1];
    const startPage=cand.pageNum;
    const endPage=nextCand?nextCand.pageNum-1:pages[pages.length-1].pageNum;
    const chPages=pages.filter(p=>p.pageNum>=startPage&&p.pageNum<=endPage);
    if (chPages.length===0) continue;
    chapters.push({ title:cand.title||cand.text, pages:chPages,
      pageStart:startPage, pageEnd:chPages[chPages.length-1].pageNum,
      score:cand.score, reasons:cand.reasons||[] });
  }
  if (chapters.length>0 && candidates[0].pageNum>pages[0].pageNum) {
    const firstCandPage=candidates[0].pageNum;
    const prePages=pages.filter(p=>p.pageNum<firstCandPage);
    if (prePages.length>0) {
      chapters[0]={ ...chapters[0], pages:[...prePages,...chapters[0].pages],
        pageStart:prePages[0].pageNum };
    }
  }
  return chapters;
}

function extractNumberedSequence(chapters, pages) {
  const numbered = chapters.map(ch => {
    const n = extractChapterNum(ch.title); return n ? { ...ch, _num:n.value, _kind:n.kind } : null;
  }).filter(Boolean);
  if (numbered.length<2) return null;
  const kindPriority = { chapter:4, part:3, roman:2, 'arabic-bare':1 };
  const kinds = [...new Set(numbered.map(c=>c._kind))];
  kinds.sort((a,b)=>(kindPriority[b]||0)-(kindPriority[a]||0));
  for (const kind of kinds) {
    const subset = numbered.filter(c=>c._kind===kind);
    if (subset.length<2) continue;
    const values = subset.map(c=>c._num);
    const cont = sequenceContinuity(values);
    if (cont>=SEQ_MIN_CONTINUITY) return subset;
  }
  return null;
}

// ── Group chapters (mirrors compressor.js groupChapters) ─────────────────────

function groupChapters(chapters, maxGroups=15) {
  if (chapters.length<=maxGroups) return chapters.map(ch=>({ ...ch, merged:false }));
  let groups = chapters.map(ch=>({ ...ch, merged:false, mergedOriginals:[ch.title] }));
  while (groups.length>maxGroups) {
    let minPages=Infinity, minIdx=0;
    for (let i=0;i<groups.length-1;i++) {
      const combined=groups[i].pages.length+groups[i+1].pages.length;
      if (combined<minPages) { minPages=combined; minIdx=i; }
    }
    const a=groups[minIdx], b=groups[minIdx+1];
    groups[minIdx]={ ...a,
      pages:[...a.pages,...b.pages],
      pageEnd:b.pageEnd,
      merged:true,
      mergedOriginals:[...(a.mergedOriginals||[a.title]),...(b.mergedOriginals||[b.title])],
    };
    groups.splice(minIdx+1,1);
  }
  return groups;
}

// ── Full audit run ────────────────────────────────────────────────────────────

async function runAudit(pdfPath) {
  process.stderr.write(`Extracting: ${pdfPath}\n`);
  const { pages, outlineEntries, totalPages } = await extractPages(pdfPath);
  process.stderr.write(`  ${totalPages} pages, outline entries: ${outlineEntries.length}\n`);

  const ctx = buildContext(pages);
  process.stderr.write(`  Median font: ${ctx.medianFontSize.toFixed(1)}pt  Running headers: ${ctx.runningHeaders.size}  Every-page: ${ctx.everyPageLines.size}\n`);

  // ── Audit every page ──
  const pageAudits = pages.map(p => auditPage(p, ctx));
  const rawCandidates = pageAudits
    .filter(pa => pa.winner !== null)
    .map(pa => ({ pageNum: pa.pageNum, title: pa.winner.text, score: pa.winner.score,
      reasons: pa.winner.breakdown.filter(b=>b.delta>0).map(b=>b.rule),
      breakdown: pa.winner.breakdown, hasKeyword: pa.winner.hasKeyword,
      matchedPattern: pa.winner.matchedPattern, confidence: pa.winner.confidence,
      pass: pa.pass, pageWordCount: pa.pageWordCount }));

  // ── Strategy simulation ──
  const decisions = [];
  let finalChapters = [], strategyUsed = 'unknown';

  // Strategy A: outline
  if (outlineEntries.length >= 2) {
    strategyUsed = 'pdf-outline';
    finalChapters = outlineEntries.map((e,i) => ({
      title: e.title, pageStart: e.pageNum,
      pageEnd: outlineEntries[i+1] ? outlineEntries[i+1].pageNum-1 : totalPages,
      pages: pages.filter(p=>p.pageNum>=e.pageNum&&p.pageNum<=(outlineEntries[i+1]?outlineEntries[i+1].pageNum-1:totalPages)),
      score: 100, merged: false,
    }));
    decisions.push({ stage:'pdf-outline', result:`accepted ${finalChapters.length} chapters`, chapters: finalChapters.length });
  } else {
    decisions.push({ stage:'pdf-outline', result:'skipped (< 2 outline entries)', chapters: 0 });

    if (rawCandidates.length >= 2) {
      const scoredChapters = buildChaptersFromCandidates(rawCandidates, pages);
      decisions.push({ stage:'build-from-candidates', result:`built ${scoredChapters.length} chapters from ${rawCandidates.length} candidates`, chapters: scoredChapters.length });

      if (scoredChapters.length >= 2) {
        // Try numbered sequence
        const seqResult = extractNumberedSequence(scoredChapters, pages);
        if (seqResult && seqResult.length >= 2) {
          const q = chapterQuality(seqResult, totalPages);
          const sane = sanityCheck(seqResult, totalPages);
          const coverage = seqResult.length / rawCandidates.length;
          decisions.push({ stage:'numbered-sequence', result:`${seqResult.length} chapters, quality=${q.toFixed(2)}, coverage=${(coverage*100).toFixed(0)}%, continuity=computed, sanity=${sane}`, chapters: seqResult.length });
          if (q >= SCORE_THRESHOLD_SEQ && sane) {
            strategyUsed = 'numbered-sequence';
            finalChapters = seqResult;
            decisions.push({ stage:'SELECTED', result:`numbered-sequence → ${seqResult.length} chapters`, chapters: seqResult.length });
          } else {
            decisions.push({ stage:'numbered-sequence', result:`REJECTED: quality=${q.toFixed(2)} < ${SCORE_THRESHOLD_SEQ} OR sanity=false`, chapters: 0 });
          }
        } else {
          decisions.push({ stage:'numbered-sequence', result:`SKIPPED: found ${seqResult?seqResult.length:0} numbered, need ≥2`, chapters: 0 });
        }

        // Try raw scoring
        if (!finalChapters.length) {
          const q = chapterQuality(scoredChapters, totalPages);
          const sane = sanityCheck(scoredChapters, totalPages);
          decisions.push({ stage:'raw-scoring', result:`${scoredChapters.length} chapters, quality=${q.toFixed(2)}, sanity=${sane}, avg=${(totalPages/scoredChapters.length).toFixed(1)}pp/ch`, chapters: scoredChapters.length });
          if (q >= SCORE_THRESHOLD_RAW && sane) {
            strategyUsed = 'raw-scoring';
            finalChapters = scoredChapters;
            decisions.push({ stage:'SELECTED', result:`raw-scoring → ${scoredChapters.length} chapters ← OVERCOUNTING`, chapters: scoredChapters.length });
          } else {
            decisions.push({ stage:'raw-scoring', result:`REJECTED: quality<0.25 or sanity=false (avg=${(totalPages/scoredChapters.length).toFixed(1)}pp/ch < 1.5)`, chapters: 0 });
          }
        }
      }

      // Relaxed threshold
      if (!finalChapters.length) {
        const relaxedCandidates = rawCandidates.filter(c => c.score >= SCORE_THRESHOLD_RELAXED);
        if (relaxedCandidates.length >= 2) {
          const relaxedChapters = buildChaptersFromCandidates(relaxedCandidates, pages);
          const qr = chapterQuality(relaxedChapters, totalPages);
          const saner = sanityCheck(relaxedChapters, totalPages);
          decisions.push({ stage:'relaxed-scoring', result:`${relaxedChapters.length} chapters, quality=${qr.toFixed(2)}, sanity=${saner}`, chapters: relaxedChapters.length });
          if (qr >= SCORE_THRESHOLD_RAW && saner) {
            strategyUsed = 'relaxed-scoring';
            finalChapters = relaxedChapters;
            decisions.push({ stage:'SELECTED', result:`relaxed-scoring → ${relaxedChapters.length} chapters`, chapters: relaxedChapters.length });
          }
        }
      }
    } else {
      decisions.push({ stage:'scoring', result:`SKIPPED: only ${rawCandidates.length} candidates < 2`, chapters: 0 });
    }

    // Pattern fallback (simplified)
    if (!finalChapters.length) {
      const patternChapters = rawCandidates.filter(c => c.hasKeyword);
      if (patternChapters.length >= 2) {
        const q = chapterQuality(patternChapters, totalPages);
        const sane = sanityCheck(buildChaptersFromCandidates(patternChapters, pages), totalPages);
        decisions.push({ stage:'pattern-fallback', result:`${patternChapters.length} keyword-matched chapters`, chapters: patternChapters.length });
        if (q >= SCORE_THRESHOLD_RAW && sane) {
          strategyUsed = 'pattern-fallback';
          finalChapters = buildChaptersFromCandidates(patternChapters, pages);
          decisions.push({ stage:'SELECTED', result:`pattern-fallback → ${finalChapters.length} chapters`, chapters: finalChapters.length });
        }
      }
    }

    // N-page sections
    if (!finalChapters.length && totalPages >= 20) {
      const targetSections = Math.min(20, Math.max(5, Math.floor(totalPages/20)));
      strategyUsed = 'n-page-sections';
      decisions.push({ stage:'SELECTED', result:`n-page-sections → ${targetSections} sections`, chapters: targetSections });
      finalChapters = Array.from({ length: targetSections }, (_, i) => ({
        title: `Section ${i+1}`,
        pageStart: Math.floor(i * totalPages / targetSections) + 1,
        pageEnd:   Math.floor((i+1) * totalPages / targetSections),
        pages: [], score: 0, merged: false,
      }));
    }

    if (!finalChapters.length) {
      strategyUsed = 'single-section';
      finalChapters = [{ title:'Full Book', pageStart:1, pageEnd:totalPages, pages, score:0, merged:false }];
      decisions.push({ stage:'SELECTED', result:`single-section → 1 chapter`, chapters: 1 });
    }
  }

  // ── Group chapters ──
  const preGroupCount = finalChapters.length;
  const grouped = groupChapters(finalChapters, MAX_CHAPTER_GROUPS);
  const postGroupCount = grouped.length;
  const capHit = preGroupCount > MAX_CHAPTER_GROUPS;

  // Mark which raw candidates got merged
  const mergedTitles = new Set();
  for (const g of grouped) {
    if (g.merged && g.mergedOriginals) {
      for (const t of g.mergedOriginals.slice(1)) mergedTitles.add(t);
    }
  }

  // ── Annotate candidates with final outcome ──
  const annotatedCandidates = rawCandidates.map(cand => {
    const inFinal = finalChapters.some(ch => (ch.title||'') === cand.title && ch.pageStart === cand.pageNum);
    const wasMerged = mergedTitles.has(cand.title);
    const inFinalGrouped = grouped.some(ch => (ch.title||'') === cand.title
      || (ch.mergedOriginals||[]).includes(cand.title));

    let outcome, outcomeReason;
    if (strategyUsed === 'numbered-sequence') {
      const isNumbered = extractChapterNum(cand.title) !== null;
      if (inFinal) {
        outcome = 'ACCEPTED'; outcomeReason = 'part of numbered sequence';
      } else {
        outcome = 'REJECTED'; outcomeReason = 'not in dominant numbered sequence';
      }
    } else if (strategyUsed === 'raw-scoring' || strategyUsed === 'relaxed-scoring') {
      outcome = 'ACCEPTED'; outcomeReason = `selected by ${strategyUsed}`;
    } else {
      outcome = inFinal ? 'ACCEPTED' : 'REJECTED';
      outcomeReason = inFinal ? `selected by ${strategyUsed}` : 'did not meet strategy criteria';
    }
    if (outcome === 'ACCEPTED' && wasMerged) {
      outcome = 'ACCEPTED-MERGED';
      outcomeReason = 'merged with adjacent chapter by groupChapters';
    }
    return { ...cand, outcome, outcomeReason, wasMerged, inFinalGrouped };
  });

  // Near-miss lines (scored > 0 but < threshold, on pages with no winner)
  const pagesWithNoWinner = pageAudits.filter(pa => pa.winner === null);
  const nearMisses = [];
  for (const pa of pagesWithNoWinner) {
    for (const line of pa.allScoredLines) {
      if (line.score >= 15 && line.score < SCORE_THRESHOLD) {
        nearMisses.push({ pageNum: pa.pageNum, text: line.text, score: line.score,
          breakdown: line.breakdown, reason: `score ${line.score} < threshold ${SCORE_THRESHOLD}` });
      }
    }
  }

  return {
    bookName: basename(pdfPath, '.pdf'),
    pdfPath: resolve(pdfPath),
    totalPages,
    outlineEntries,
    ctx: {
      medianFontSize: ctx.medianFontSize,
      pageWidth: ctx.pageWidth,
      pageHeight: ctx.pageHeight,
      runningHeaders: [...ctx.runningHeaders],
      everyPageLines: [...ctx.everyPageLines],
      hasRich: ctx.hasRich,
    },
    strategyUsed,
    decisions,
    rawCandidates: annotatedCandidates,
    nearMisses,
    preGroupCount,
    postGroupCount,
    capHit,
    grouped,
    pageAudits: pageAudits.map(pa => ({
      pageNum: pa.pageNum,
      pageWordCount: pa.pageWordCount,
      pass: pa.pass,
      winner: pa.winner ? { text:pa.winner.text, score:pa.winner.score, confidence:pa.winner.confidence } : null,
      nearMisseOnPage: pa.allScoredLines.filter(l=>!l.isWinner&&l.score>=15).map(l=>({ text:l.text, score:l.score })),
    })),
  };
}

// ── Statistics ────────────────────────────────────────────────────────────────

function computeStats(report) {
  const cands = report.rawCandidates;
  const accepted   = cands.filter(c => c.outcome.startsWith('ACCEPTED'));
  const rejected   = cands.filter(c => c.outcome === 'REJECTED');
  const withKeyword    = accepted.filter(c => c.hasKeyword);
  const withoutKeyword = accepted.filter(c => !c.hasKeyword);

  const avgScore = arr => arr.length ? arr.reduce((s,c)=>s+c.score,0)/arr.length : 0;

  // Rule frequency across accepted
  const ruleFreq = {};
  for (const c of accepted) {
    for (const b of c.breakdown) {
      if (b.delta > 0) ruleFreq[b.rule] = (ruleFreq[b.rule]||0)+1;
    }
  }
  const ruleFreqSorted = Object.entries(ruleFreq).sort((a,b)=>b[1]-a[1]);

  // Rule frequency for no-keyword accepted (false positive suspects)
  const fpRuleFreq = {};
  for (const c of withoutKeyword) {
    for (const b of c.breakdown) {
      if (b.delta > 0) fpRuleFreq[b.rule] = (fpRuleFreq[b.rule]||0)+1;
    }
  }
  const fpRuleFreqSorted = Object.entries(fpRuleFreq).sort((a,b)=>b[1]-a[1]);

  // Score histogram (buckets of 5)
  const histogram = {};
  for (let lo=25; lo<=100; lo+=5) histogram[`${lo}-${lo+4}`] = 0;
  for (const c of cands) {
    const bucket = Math.floor(c.score/5)*5;
    const key = `${bucket}-${bucket+4}`;
    if (histogram[key] !== undefined) histogram[key]++;
  }

  // Pages per chapter
  const avgPagesPerRawChapter = report.totalPages / Math.max(1, cands.length);
  const avgPagesPerFinalChapter = report.totalPages / Math.max(1, report.postGroupCount);

  // Confidence distribution
  const confDist = { High:0, 'Medium-High':0, Medium:0, Low:0 };
  for (const c of accepted) confDist[c.confidence] = (confDist[c.confidence]||0)+1;

  // The "CENTERED+TOP_QUARTER+STARTS_PAGE+WHITESPACE_ABOVE" false positive pattern
  const fpPattern1 = withoutKeyword.filter(c => {
    const rules = c.breakdown.filter(b=>b.delta>0).map(b=>b.rule);
    return rules.includes('CENTERED') && rules.includes('TOP_QUARTER') &&
           rules.includes('STARTS_PAGE') && !rules.includes('LARGE_FONT');
  });

  return {
    totalCandidates: cands.length,
    accepted: accepted.length,
    rejected: rejected.length,
    withKeyword: withKeyword.length,
    withoutKeyword: withoutKeyword.length,
    fpSuspectCount: withoutKeyword.length,
    fpSuspectPct: accepted.length > 0 ? (withoutKeyword.length/accepted.length*100).toFixed(1) : '0',
    avgScoreAccepted: avgScore(accepted).toFixed(1),
    avgScoreWithKeyword: avgScore(withKeyword).toFixed(1),
    avgScoreNoKeyword: avgScore(withoutKeyword).toFixed(1),
    avgScoreRejected: avgScore(rejected).toFixed(1),
    ruleFreqSorted,
    fpRuleFreqSorted,
    histogram,
    avgPagesPerRawChapter: avgPagesPerRawChapter.toFixed(1),
    avgPagesPerFinalChapter: avgPagesPerFinalChapter.toFixed(1),
    confDist,
    capHit: report.capHit,
    preGroupCount: report.preGroupCount,
    postGroupCount: report.postGroupCount,
    strategyUsed: report.strategyUsed,
    fpPattern1Count: fpPattern1.length,
    nearMissCount: report.nearMisses.length,
  };
}

// ── Ranked recommendations ────────────────────────────────────────────────────

function generateRecommendations(report, stats) {
  const recs = [];
  const total = stats.accepted || 1;

  if (stats.fpSuspectCount > 0) {
    const pct = stats.fpSuspectCount;
    const estImpact = Math.min(90, Math.round(pct / total * 100));
    recs.push({
      rank: 1,
      title: 'Require CHAPTER_KEYWORD for borderline scores',
      detail: `${stats.fpSuspectCount} of ${total} accepted chapters (${stats.fpSuspectPct}%) have NO keyword match. ` +
        `They passed purely on layout heuristics (CENTERED, TOP_QUARTER, STARTS_PAGE, WHITESPACE_ABOVE). ` +
        `A score ceiling of ~55 for non-keyword candidates would eliminate most false positives without affecting keyword-matched chapters.`,
      estimatedImpact: `-${estImpact}% false positives`,
      mechanism: 'Add a secondary threshold: if no CHAPTER_KEYWORD matched, score must exceed 60 (not 40) to qualify.',
      risk: 'Low — keyword-matched chapters are unaffected; ALL-CAPS title pages might be missed if score drops to 55-59.',
    });
  }

  // Check if CENTERED+TOP_QUARTER+STARTS_PAGE combo is a common FP driver
  const hasCenteredFP = stats.fpRuleFreqSorted.some(([r]) => r==='CENTERED');
  const hasTopQuarterFP = stats.fpRuleFreqSorted.some(([r]) => r==='TOP_QUARTER');
  if (hasCenteredFP && hasTopQuarterFP && stats.fpSuspectCount > 2) {
    recs.push({
      rank: 2,
      title: 'Reduce TOP_QUARTER + CENTERED combined weight',
      detail: `CENTERED(+15) + TOP_QUARTER(+15) + STARTS_PAGE(+10) + WHITESPACE_ABOVE(+10) = 50 ` +
        `— enough to pass threshold 40 with NO other signals. Any body-text paragraph that happens ` +
        `to start a page and be roughly centered triggers this. ${stats.fpPattern1Count} false positives show this exact pattern.`,
      estimatedImpact: `-60% of heuristic-only false positives`,
      mechanism: 'Make TOP_QUARTER and CENTERED additive only when a font or keyword signal is also present, OR lower either to +8.',
      risk: 'Medium — some real chapters without keywords (unnumbered titled chapters) rely on this combination.',
    });
  }

  // Check if numbered-sequence could have rescued more
  const numberedInAccepted = stats.withKeyword;
  const coverage = total > 0 ? numberedInAccepted / total : 0;
  if (coverage >= 0.4 && stats.strategyUsed !== 'numbered-sequence') {
    recs.push({
      rank: 3,
      title: 'Lower numbered-sequence coverage threshold from 60% to 40%',
      detail: `${numberedInAccepted} of ${total} accepted candidates (${(coverage*100).toFixed(0)}%) have explicit chapter numbers. ` +
        `If coverage were 40%, the numbered sequence would fire and automatically filter out the non-numbered false positives.`,
      estimatedImpact: `-${Math.round(stats.fpSuspectPct * 0.7)}% false positives (removes non-numbered FPs)`,
      mechanism: 'Change SEQ_MIN_COVERAGE from 0.60 to 0.40 in chunker.js.',
      risk: 'Low — numbered chapters that form a clean sequence are always real chapters.',
    });
  }

  // Duplicate title check
  const titleMap = {};
  for (const c of report.rawCandidates) titleMap[c.title] = (titleMap[c.title]||0)+1;
  const dupeCount = Object.values(titleMap).filter(n=>n>1).length;
  if (dupeCount > 1) {
    recs.push({
      rank: recs.length + 1,
      title: 'Reject duplicate heading titles within the same book',
      detail: `${dupeCount} heading texts appear more than once. Repeated headings are nearly always running headers, ` +
        `section dividers, or repeated boilerplate — not real chapters.`,
      estimatedImpact: `-${Math.round(dupeCount / total * 100)}% false positives`,
      mechanism: 'After scoring, deduplicate by title text (keep first occurrence only, or weight by page position).',
      risk: 'Low — legitimate chapter sequels (e.g., "Part II" after "Part I") have different titles.',
    });
  }

  // Cap hit recommendation
  if (report.capHit) {
    recs.push({
      rank: recs.length + 1,
      title: `Lower MAX_CHAPTER_GROUPS from ${MAX_CHAPTER_GROUPS}`,
      detail: `The scorer returned ${report.preGroupCount} chapters, hit the hard cap of ${MAX_CHAPTER_GROUPS}, ` +
        `and groupChapters merged down to ${report.postGroupCount}. This cap is too high; typical non-fiction books ` +
        `have 5-25 chapters. Lowering to 20 would force more aggressive merging of marginal chapters.`,
      estimatedImpact: `Reduces displayed chapters to ≤20 but does NOT fix root cause (false positives still exist)`,
      mechanism: 'Change MAX_CHAPTER_GROUPS in pipeline.js from 30 to 20.',
      risk: 'Medium — genuine books with >20 chapters (textbooks, anthologies) would have chapters merged incorrectly.',
    });
  }

  recs.sort((a,b) => a.rank - b.rank);
  return recs;
}

// ── JSON export ───────────────────────────────────────────────────────────────

function exportJSON(report, stats, recommendations, outPath) {
  const out = {
    meta: {
      book: report.bookName,
      totalPages: report.totalPages,
      outlineEntries: report.outlineEntries.length,
      strategyUsed: report.strategyUsed,
      rawCandidateCount: report.rawCandidates.length,
      acceptedCount: stats.accepted,
      rejectedCount: stats.rejected,
      withKeywordCount: stats.withKeyword,
      withoutKeywordCount: stats.withoutKeyword,
      preGroupCount: report.preGroupCount,
      postGroupCount: report.postGroupCount,
      capHit: report.capHit,
      runningHeaders: report.ctx.runningHeaders,
      everyPageLines: report.ctx.everyPageLines,
      medianFontSize: report.ctx.medianFontSize,
    },
    decisions: report.decisions,
    candidates: report.rawCandidates,
    nearMisses: report.nearMisses.slice(0, 50),
    grouped: report.grouped.map(g => ({
      title: g.title, pageStart: g.pageStart, pageEnd: g.pageEnd,
      merged: g.merged, mergedOriginals: g.mergedOriginals,
    })),
    statistics: stats,
    recommendations,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
}

// ── HTML report ───────────────────────────────────────────────────────────────

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function outcomeClass(outcome) {
  if (outcome === 'ACCEPTED') return 'accepted';
  if (outcome === 'ACCEPTED-MERGED') return 'merged';
  return 'rejected';
}

function generateHTML(report, stats, recommendations, bookName) {
  const cands = report.rawCandidates;
  const accepted   = cands.filter(c=>c.outcome.startsWith('ACCEPTED'));
  const rejected   = cands.filter(c=>c.outcome==='REJECTED');
  const withoutKw  = accepted.filter(c=>!c.hasKeyword);

  const barHTML = (count, maxCount, color) => {
    const pct = maxCount > 0 ? Math.round(count/maxCount*100) : 0;
    return `<div class="bar" style="width:${pct}%;background:${color};min-width:2px;height:16px;display:inline-block;border-radius:2px"></div> ${count}`;
  };

  const maxHist = Math.max(1, ...Object.values(stats.histogram));

  const candRows = cands.map((c,i) => {
    const cls = outcomeClass(c.outcome);
    const kwBadge = c.hasKeyword
      ? `<span class="badge kw">✓ ${esc(c.matchedPattern)}</span>`
      : `<span class="badge nkw">no keyword</span>`;
    const bkdn = c.breakdown.map(b =>
      `<tr class="${b.delta>0?'pos':'neg'}"><td>${esc(b.rule)}</td><td class="delta">${b.delta>0?'+':''}${b.delta}</td><td class="note">${esc(b.note)}</td></tr>`
    ).join('');
    const ruleList = c.breakdown.filter(b=>b.delta>0).map(b=>b.rule).join(', ');
    return `
  <tr class="cand-row ${cls}">
    <td class="num">${i+1}</td>
    <td class="pg">${c.pageNum}</td>
    <td class="heading"><details><summary>${esc(c.title)}</summary>
      <table class="bkdn"><thead><tr><th>Rule</th><th>Δ</th><th>Note</th></tr></thead><tbody>${bkdn}</tbody></table>
    </details></td>
    <td class="score">${c.score}</td>
    <td class="conf ${c.confidence.replace(/[^a-z]/gi,'').toLowerCase()}">${c.confidence}</td>
    <td class="kw-cell">${kwBadge}</td>
    <td class="strategy">${esc(c.pass===0?'multi-line':c.pass===2?'pass-2-allcaps':'pass-1-scoring')}</td>
    <td class="outcome ${cls}">${esc(c.outcome)}</td>
    <td class="reason">${esc(c.outcomeReason)}</td>
  </tr>`;
  }).join('');

  const decisionRows = report.decisions.map(d =>
    `<tr><td>${esc(d.stage)}</td><td>${esc(d.result)}</td><td>${d.chapters}</td></tr>`
  ).join('');

  const ruleRows = stats.ruleFreqSorted.map(([r,n]) =>
    `<tr><td>${esc(r)}</td><td>${barHTML(n, stats.accepted, '#4caf50')}</td></tr>`
  ).join('');

  const fpRuleRows = stats.fpRuleFreqSorted.map(([r,n]) =>
    `<tr><td>${esc(r)}</td><td>${barHTML(n, withoutKw.length||1, '#f44336')}</td></tr>`
  ).join('');

  const histRows = Object.entries(stats.histogram).map(([range,n]) =>
    `<tr><td>${range}</td><td>${barHTML(n, maxHist, n>0?'#2196f3':'#ccc')}</td></tr>`
  ).join('');

  const recHTML = recommendations.map(r => `
  <div class="rec rank${r.rank}">
    <div class="rec-rank">Rank ${r.rank}</div>
    <div class="rec-title">${esc(r.title)}</div>
    <div class="rec-detail">${esc(r.detail)}</div>
    <div class="rec-meta">
      <span class="impact">Estimated impact: <strong>${esc(r.estimatedImpact)}</strong></span>
      <span class="mechanism">How: ${esc(r.mechanism)}</span>
      <span class="risk">Risk: ${esc(r.risk)}</span>
    </div>
  </div>`).join('');

  const groupedRows = report.grouped.map((g,i) =>
    `<tr><td>${i+1}</td><td>${esc(g.title)}</td><td>${g.pageStart}–${(g.pageEnd||'?')}</td><td>${g.merged?'<span class="badge merged-b">MERGED</span>':'No'}</td><td>${esc((g.mergedOriginals||[]).join(' + '))}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chapter Audit — ${esc(bookName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;background:#f5f5f5;color:#222;padding:24px}
h1{font-size:22px;margin-bottom:4px}h2{font-size:16px;margin:20px 0 8px;border-bottom:2px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:12px 0 6px;color:#555}
.meta{color:#666;font-size:12px;margin-bottom:20px}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:14px 20px;min-width:140px}
.card .val{font-size:28px;font-weight:700;color:#1976d2}.card .lbl{font-size:11px;color:#888;text-transform:uppercase}
.card.warn .val{color:#e53935}.card.ok .val{color:#43a047}.card.neutral .val{color:#555}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #ddd;border-radius:4px;margin-bottom:16px;font-size:13px}
th{background:#f0f0f0;text-align:left;padding:6px 10px;border-bottom:1px solid #ddd;white-space:nowrap}
td{padding:5px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top}
tr:last-child td{border-bottom:none}
.accepted{background:#e8f5e9!important}.merged{background:#fff9c4!important}.rejected{background:#fff}
.cand-row.accepted td:first-child{border-left:4px solid #43a047}
.cand-row.merged td:first-child{border-left:4px solid #ffb300}
.cand-row.rejected td:first-child{border-left:4px solid #bbb}
.outcome.accepted{color:#43a047;font-weight:600}.outcome.merged{color:#f57f17;font-weight:600}.outcome.rejected{color:#999}
.num{color:#999;font-size:11px;text-align:right;white-space:nowrap}.pg{font-weight:600;white-space:nowrap}
.score{font-weight:700;text-align:center}.heading details summary{cursor:pointer;list-style:none;color:#1565c0}
.heading details summary::before{content:"▶ "}.heading details[open] summary::before{content:"▼ "}
.bkdn{margin:6px 0 2px;font-size:12px;width:auto;border:none}.bkdn th{font-size:11px;padding:3px 8px}.bkdn td{padding:2px 8px}
.pos{color:#2e7d32}.neg{color:#c62828}.delta{font-family:monospace;white-space:nowrap;text-align:right}
.note{color:#666;font-size:11px}
.badge{font-size:10px;padding:1px 6px;border-radius:10px;white-space:nowrap;font-weight:600}
.badge.kw{background:#e3f2fd;color:#1565c0}.badge.nkw{background:#fce4ec;color:#c62828}
.badge.merged-b{background:#fff9c4;color:#e65100}
.conf{font-size:11px;white-space:nowrap}.high{color:#2e7d32}.mediumhigh{color:#43a047}
.medium{color:#f57f17}.low{color:#c62828}.kw-cell{white-space:nowrap}
.strategy{font-size:11px;color:#666}.reason{font-size:11px;color:#555;max-width:200px}
.rec{background:#fff;border:1px solid #ddd;border-radius:6px;padding:14px 18px;margin-bottom:12px}
.rec.rank1{border-color:#f44336;border-left-width:4px}.rec.rank2{border-color:#ff9800;border-left-width:4px}
.rec.rank3{border-color:#ffeb3b;border-left-width:4px}.rec.rank4,.rec.rank5{border-color:#ccc;border-left-width:4px}
.rec-rank{font-size:11px;font-weight:700;text-transform:uppercase;color:#999;margin-bottom:4px}
.rec-title{font-size:15px;font-weight:700;margin-bottom:6px}
.rec-detail{font-size:13px;color:#444;margin-bottom:8px;line-height:1.5}
.rec-meta{font-size:12px;display:flex;flex-direction:column;gap:3px;color:#666}
.impact strong{color:#c62828}
.decisions-table .stage{font-weight:600;white-space:nowrap;font-family:monospace;font-size:12px}
.section{background:#fff;border:1px solid #ddd;border-radius:6px;padding:16px;margin-bottom:20px}
</style>
</head>
<body>
<h1>Chapter Detection Forensic Audit</h1>
<div class="meta">${esc(report.pdfPath)} · ${report.totalPages} pages · strategy: <strong>${esc(report.strategyUsed)}</strong></div>

<div class="cards">
  <div class="card ${stats.accepted > 20 ? 'warn' : 'neutral'}"><div class="val">${stats.accepted}</div><div class="lbl">Raw Candidates</div></div>
  <div class="card ${stats.withKeyword > 0 ? 'ok' : 'warn'}"><div class="val">${stats.withKeyword}</div><div class="lbl">With Keyword</div></div>
  <div class="card ${stats.withoutKeyword > 0 ? 'warn' : 'ok'}"><div class="val">${stats.withoutKeyword}</div><div class="lbl">No Keyword (FP suspects)</div></div>
  <div class="card neutral"><div class="val">${stats.fpSuspectPct}%</div><div class="lbl">False Positive Rate</div></div>
  <div class="card neutral"><div class="val">${stats.preGroupCount}</div><div class="lbl">Pre-group Count</div></div>
  <div class="card ${report.capHit ? 'warn' : 'ok'}"><div class="val">${stats.postGroupCount}</div><div class="lbl">Final Chapters${report.capHit ? ' (CAP)' : ''}</div></div>
  <div class="card neutral"><div class="val">${stats.avgPagesPerFinalChapter}</div><div class="lbl">Avg Pages/Chapter</div></div>
</div>

<div class="section">
<h2>Strategy Decisions</h2>
<table class="decisions-table">
<thead><tr><th>Stage</th><th>Result</th><th>Chapter Count</th></tr></thead>
<tbody>${decisionRows}</tbody>
</table>
</div>

<div class="section">
<h2>All Candidates (${cands.length} total — click heading to expand score breakdown)</h2>
<table>
<thead><tr><th>#</th><th>Page</th><th>Heading</th><th>Score</th><th>Confidence</th><th>Keyword</th><th>Pass</th><th>Outcome</th><th>Reason</th></tr></thead>
<tbody>${candRows}</tbody>
</table>
</div>

<div class="section">
<h2>Final Grouped Chapters (${report.grouped.length} after groupChapters, max=${MAX_CHAPTER_GROUPS})</h2>
<table>
<thead><tr><th>#</th><th>Title</th><th>Pages</th><th>Merged?</th><th>Merged From</th></tr></thead>
<tbody>${groupedRows}</tbody>
</table>
</div>

<div class="section">
<h2>Statistics</h2>
<div style="display:flex;gap:24px;flex-wrap:wrap">
  <div>
    <h3>Score Averages</h3>
    <table style="width:auto"><thead><tr><th>Category</th><th>Avg Score</th></tr></thead><tbody>
      <tr><td>All accepted</td><td><strong>${stats.avgScoreAccepted}</strong></td></tr>
      <tr><td>With keyword</td><td>${stats.avgScoreWithKeyword}</td></tr>
      <tr><td>Without keyword</td><td>${stats.avgScoreNoKeyword}</td></tr>
      <tr><td>Rejected</td><td>${stats.avgScoreRejected}</td></tr>
    </tbody></table>
    <h3 style="margin-top:12px">Confidence Distribution (accepted)</h3>
    <table style="width:auto"><tbody>
      ${Object.entries(stats.confDist).map(([k,v])=>`<tr><td>${k}</td><td>${barHTML(v,stats.accepted,'#1976d2')}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div>
    <h3>Top Rules in Accepted Chapters</h3>
    <table style="width:300px"><thead><tr><th>Rule</th><th>Frequency</th></tr></thead><tbody>${ruleRows}</tbody></table>
  </div>
  <div>
    <h3>Top Rules in FP Suspects (no keyword)</h3>
    <table style="width:300px"><thead><tr><th>Rule</th><th>Count</th></tr></thead><tbody>${fpRuleRows}</tbody></table>
  </div>
  <div>
    <h3>Score Histogram (all candidates)</h3>
    <table style="width:300px"><thead><tr><th>Range</th><th>Count</th></tr></thead><tbody>${histRows}</tbody></table>
  </div>
</div>
</div>

<div class="section">
<h2>Recommendations (ranked by expected impact)</h2>
${recHTML}
</div>

</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.error('Usage: node audit.js <book.pdf> [--out-dir <dir>]');
    process.exit(1);
  }

  const pdfPath = args[0];
  let outDir = '.';
  const outIdx = args.indexOf('--out-dir');
  if (outIdx >= 0 && args[outIdx+1]) {
    outDir = args[outIdx+1];
    mkdirSync(outDir, { recursive: true });
  }

  const slug = basename(pdfPath, '.pdf').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,'');

  // Suppress pdf.js stderr warnings
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s, ...rest) => {
    if (typeof s === 'string' && (s.includes('Warning:') || s.includes('fetchStandard'))) return true;
    return origStderr(s, ...rest);
  };

  const report = await runAudit(pdfPath);

  process.stderr.write = origStderr;

  const stats    = computeStats(report);
  const recs     = generateRecommendations(report, stats);

  // Write JSON
  const jsonPath = join(outDir, `audit-report-${slug}.json`);
  exportJSON(report, stats, recs, jsonPath);
  process.stderr.write(`JSON: ${jsonPath}\n`);

  // Write HTML
  const htmlPath = join(outDir, `audit-report-${slug}.html`);
  writeFileSync(htmlPath, generateHTML(report, stats, recs, report.bookName));
  process.stderr.write(`HTML: ${htmlPath}\n`);

  // Print summary to stdout
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`AUDIT SUMMARY — ${report.bookName}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`Pages:             ${report.totalPages}`);
  console.log(`Strategy:          ${report.strategyUsed}`);
  console.log(`Raw candidates:    ${stats.totalCandidates}`);
  console.log(`  With keyword:    ${stats.withKeyword}`);
  console.log(`  No keyword (FP): ${stats.withoutKeyword}  (${stats.fpSuspectPct}% of accepted)`);
  console.log(`Pre-group count:   ${stats.preGroupCount}`);
  console.log(`Post-group count:  ${stats.postGroupCount}${report.capHit ? '  ← CAP HIT' : ''}`);
  console.log(`Avg score (kw):    ${stats.avgScoreWithKeyword}`);
  console.log(`Avg score (no kw): ${stats.avgScoreNoKeyword}`);
  console.log(`\nTOP RULES IN FALSE POSITIVE SUSPECTS:`);
  for (const [r,n] of stats.fpRuleFreqSorted.slice(0,8))
    console.log(`  ${r.padEnd(22)} ${n}`);
  console.log(`\nSTRATEGY DECISIONS:`);
  for (const d of report.decisions)
    console.log(`  [${d.stage}] ${d.result}`);
  console.log(`\nTOP RECOMMENDATIONS:`);
  for (const r of recs.slice(0,3))
    console.log(`  Rank ${r.rank}: ${r.title}\n          ${r.estimatedImpact}`);
  console.log(`\nFull reports: ${jsonPath}`);
  console.log(`              ${htmlPath}`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(e => { console.error('[audit] Fatal:', e.message); process.exit(1); });
