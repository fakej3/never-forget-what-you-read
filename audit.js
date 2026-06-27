#!/usr/bin/env node
// Chapter Detection Forensic Audit
// Usage: node audit.js <path-to-book.pdf>
//
// Produces a complete forensic report: every scored line, every candidate,
// every accepted/rejected chapter, rule statistics, confidence distribution,
// and root-cause analysis.

import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

// ── PDF.js setup ──────────────────────────────────────────────────────────────

const pdfjsLib = require('./node_modules/pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false; // disable worker in Node

// ── Inline detector constants (mirrors chunker.js exactly) ────────────────────

const SCAN_LINES               = 12;
const RUNNING_HEADER_THRESHOLD = 0.20;
const SPARSE_WORDS             = 250;
const SEQ_MIN_COVERAGE         = 0.60;
const SEQ_MIN_CONTINUITY       = 0.75;

const HEADING_PATTERNS = [
  /^(chapter|ch\.?)\s*\d+(?:\s*$|\s*[:\-–—·]|\s+[A-ZÀ-ɏ0-9])/i,
  /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s*$|\s*[:\-–—]|\s+[A-ZÀ-ɏ])/i,
  /^\d{1,2}\.\s+[A-ZÀ-ɏ]/,
  /^part\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivxlcIVXLC]+)(?:\s*$|\s*[:\-–—])/i,
  /^section\s+\d+(\s|$)/i,
  /^[IVXLC]{1,6}\.\s+[A-Za-z]/,
  /^(prologue|epilogue|introduction|preface|foreword|conclusion|afterword|appendix|acknowledgements?|bibliography|interlude)(?:\s*$|\s*[:\-–—])/i,
];

const PATTERN_NAMES = [
  'PAT_CHAPTER_NUM',
  'PAT_CHAPTER_WORD',
  'PAT_ARABIC_BARE',
  'PAT_PART',
  'PAT_SECTION',
  'PAT_ROMAN',
  'PAT_FRONTMATTER',
];

const WORD_INT = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,'twenty-one':21,'twenty-two':22,
  'twenty-three':23,'twenty-four':24,'twenty-five':25,'twenty-six':26,
  'twenty-seven':27,'twenty-eight':28,'twenty-nine':29,thirty:30,
};
function wordToInt(s) { return WORD_INT[s.toLowerCase().replace(/\s+/g,'-').trim()] ?? null; }

const ROMAN_VAL = {I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
function romanToInt(s) {
  const u = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(u)) return null;
  let total=0,prev=0;
  for (const c of [...u].reverse()) {
    const v=ROMAN_VAL[c]; if (!v) return null;
    if (v<prev) total-=v; else {total+=v;prev=v;}
  }
  return total>0&&total<=500?total:null;
}

function extractChapterNum(title) {
  const t = title.trim();
  let m = t.match(/^(?:chapter|ch\.?)\s+(\d{1,3})(?:\s|$|[:\-–—·])/i);
  if (m) return { value:parseInt(m[1]), kind:'chapter' };
  m = t.match(/^(?:chapter|ch\.?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?)(?:\s|$|[:\-–—])/i);
  if (m) { const v=wordToInt(m[1]); if(v) return {value:v,kind:'chapter'}; }
  m = t.match(/^(?:chapter|ch\.?)\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v=romanToInt(m[1]); if(v) return {value:v,kind:'chapter'}; }
  m = t.match(/^part\s+(\d{1,2})(?:\s|$|[:\-–—])/i);
  if (m) return {value:parseInt(m[1]),kind:'part'};
  m = t.match(/^part\s+(one|two|three|four|five|six|seven|eight|nine|ten)(?:\s|$|[:\-–—])/i);
  if (m) { const v=wordToInt(m[1]); if(v) return {value:v,kind:'part'}; }
  m = t.match(/^part\s+([IVXLC]{1,6})(?:\s|$|[:\-–—])/i);
  if (m) { const v=romanToInt(m[1]); if(v) return {value:v,kind:'part'}; }
  m = t.match(/^([IVXLC]{1,6})\.\s+[A-Za-z]/);
  if (m) { const v=romanToInt(m[1]); if(v) return {value:v,kind:'roman'}; }
  m = t.match(/^(\d{1,2})\.\s+[A-ZÀ-ɏ]/);
  if (m) return {value:parseInt(m[1]),kind:'arabic-bare'};
  return null;
}

// ── PDF extraction (mirrors uploader.js) ─────────────────────────────────────

async function extractPages(pdfPath) {
  const buf  = readFileSync(pdfPath);
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const pdf  = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();

    const lineMap = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform[5];
      let bucketKey = null;
      for (const key of lineMap.keys()) {
        if (Math.abs(key - y) <= 3) { bucketKey = key; break; }
      }
      if (bucketKey === null) lineMap.set(y, [item]);
      else lineMap.get(bucketKey).push(item);
    }

    const sortedYs = [...lineMap.keys()].sort((a,b) => b-a);
    const lines = sortedYs.map(y => {
      const items   = lineMap.get(y).sort((a,b) => a.transform[4]-b.transform[4]);
      const text    = items.map(it=>it.str).join('');
      const x       = items[0].transform[4];
      const lw      = items.reduce((s,it)=>s+(it.width||0),0);
      let fontSize=0,bold=false,italic=false;
      for (const it of items) {
        const fs=Math.abs(it.transform[3]||it.transform[0]||0);
        if (fs>fontSize) fontSize=fs;
        const fn=(it.fontName||'').toLowerCase();
        if (fn.includes('bold')||fn.includes('heavy')||fn.includes('black')) bold=true;
        if (/[a-z]{3,}b$/.test(fn)) bold=true;
        if (fn.includes('italic')||fn.includes('oblique')) italic=true;
      }
      return { text, y, x, lineWidth:lw, fontSize, bold, italic };
    });

    const viewport = page.getViewport({scale:1});
    const text = lines.map(l=>l.text).join('\n').trim();
    page.cleanup();
    pages.push({ pageNum:p, text, width:viewport.width, height:viewport.height, lines });
  }

  // Extract outline
  let outline = [];
  try {
    const raw = await pdf.getOutline();
    if (raw && raw.length > 0) {
      const flat = [];
      async function walk(items, depth=0) {
        for (const item of items) {
          try {
            let dest = item.dest;
            if (typeof dest === 'string') dest = await pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
              const idx = await pdf.getPageIndex(dest[0]);
              flat.push({ title:(item.title||'').trim()||'Untitled', pageNum:idx+1 });
            }
          } catch {}
          if (item.items && item.items.length && depth<2) await walk(item.items, depth+1);
        }
      }
      await walk(raw);
      flat.sort((a,b)=>a.pageNum-b.pageNum);
      outline = flat;
    }
  } catch {}

  pdf.destroy();
  return { pages, outline };
}

// ── Audit engine ──────────────────────────────────────────────────────────────

function buildRunningHeadersAudit(pages) {
  const freq = new Map();
  for (const page of pages) {
    const lines = page.text.split('\n').map(l=>l.trim()).filter(l=>l.length>1&&l.length<120);
    const candidates = new Set([...lines.slice(0,SCAN_LINES),...lines.slice(-3)]);
    for (const line of candidates) freq.set(line,(freq.get(line)||0)+1);
  }
  const threshold = Math.max(3, pages.length*RUNNING_HEADER_THRESHOLD);
  const headers = new Map();
  for (const [line,count] of freq) {
    if (count>=threshold) headers.set(line,count);
  }
  return { headers, threshold, freq };
}

function buildEveryPageLinesAudit(pages, freq) {
  const threshold = pages.length * 0.60;
  const lines = new Map();
  for (const [line,count] of freq) {
    if (count >= threshold) lines.set(line, count);
  }
  return { lines, threshold };
}

function scoreLineAudit(text, lineOpts, ctx) {
  const {
    y=0, fontSize=0, bold=false, italic=false,
    x=0, lineWidth=0, lineIndex=0, pageWordCount=0,
    gapAbove=0, gapBelow=0,
    pageHeight=ctx.pageHeight||792,
    pageWidth=ctx.pageWidth||612,
  } = lineOpts;

  let score = 0;
  const details = [];

  // CHAPTER_KEYWORD
  for (let pi=0; pi<HEADING_PATTERNS.length; pi++) {
    if (HEADING_PATTERNS[pi].test(text)) {
      score += 50;
      details.push({ rule:'CHAPTER_KEYWORD', delta:+50, note:`matched ${PATTERN_NAMES[pi]}` });
      break;
    }
  }

  // Font size
  if (fontSize>0 && ctx.medianFontSize>0) {
    const ratio = fontSize/ctx.medianFontSize;
    if (ratio>=1.5) {
      score+=25; details.push({rule:'LARGE_FONT_BIG',delta:+25,note:`${fontSize.toFixed(1)} vs median ${ctx.medianFontSize.toFixed(1)} (${ratio.toFixed(2)}×)`});
    } else if (ratio>=1.25) {
      score+=20; details.push({rule:'LARGE_FONT',delta:+20,note:`${fontSize.toFixed(1)} vs median ${ctx.medianFontSize.toFixed(1)} (${ratio.toFixed(2)}×)`});
    } else if (ratio>=1.1) {
      score+=8; details.push({rule:'LARGE_FONT_SMALL',delta:+8,note:`${fontSize.toFixed(1)} vs median ${ctx.medianFontSize.toFixed(1)} (${ratio.toFixed(2)}×)`});
    }
  }

  // BOLD
  if (bold) { score+=12; details.push({rule:'BOLD',delta:+12,note:'fontName contains bold/heavy/black'}); }

  // CENTERED
  const pageCenter = pageWidth/2;
  const lineCenter = x+lineWidth/2;
  if (lineWidth>0 && Math.abs(lineCenter-pageCenter)<60) {
    score+=15; details.push({rule:'CENTERED',delta:+15,note:`lineCenter=${lineCenter.toFixed(0)} pageCenter=${pageCenter.toFixed(0)} diff=${Math.abs(lineCenter-pageCenter).toFixed(0)}`});
  }

  // TOP_QUARTER
  if (y>=pageHeight*0.75) {
    score+=15; details.push({rule:'TOP_QUARTER',delta:+15,note:`y=${y.toFixed(0)} >= ${(pageHeight*0.75).toFixed(0)}`});
  }

  // WHITESPACE_ABOVE
  if (gapAbove>=18) { score+=10; details.push({rule:'WHITESPACE_ABOVE',delta:+10,note:`gap=${gapAbove.toFixed(0)}pt`}); }

  // WHITESPACE_BELOW
  if (gapBelow>=18) { score+=10; details.push({rule:'WHITESPACE_BELOW',delta:+10,note:`gap=${gapBelow.toFixed(0)}pt`}); }

  // SHORT_LINE
  const isShortLine = text.length<60;
  if (isShortLine) { score+=8; details.push({rule:'SHORT_LINE',delta:+8,note:`${text.length} chars`}); }

  // ALL_CAPS
  const alphaChars = text.replace(/[^a-zA-Z]/g,'');
  const upperChars = text.replace(/[^A-Z]/g,'');
  const isAllCaps = alphaChars.length>=2 && upperChars.length/alphaChars.length>=0.70;
  if (isAllCaps) { score+=10; details.push({rule:'ALL_CAPS',delta:+10,note:`${upperChars.length}/${alphaChars.length} uppercase`}); }

  // STARTS_PAGE
  if (lineIndex===0) { score+=10; details.push({rule:'STARTS_PAGE',delta:+10,note:'lineIndex=0'}); }

  // SPARSE_PAGE
  if (pageWordCount<200&&(isAllCaps||isShortLine)) {
    score+=15; details.push({rule:'SPARSE_PAGE',delta:+15,note:`${pageWordCount} words`});
  }

  // ROMAN_NUMERAL
  if (/^[IVXLC]{1,6}\.\s+[A-Za-z]/.test(text)) {
    score+=12; details.push({rule:'ROMAN_NUMERAL',delta:+12,note:'roman pattern'});
  }

  // WORD_NUMBER
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i.test(text)) {
    score+=8; details.push({rule:'WORD_NUMBER',delta:+8,note:'starts with word number'});
  }

  // ISOLATED
  if (gapAbove>=18&&gapBelow>=18&&text.length<60) {
    score+=8; details.push({rule:'ISOLATED',delta:+8,note:'large gaps both sides'});
  }

  // RUNNING_HEADER penalty
  if (ctx.runningHeaders.has(text)) {
    score-=40; details.push({rule:'RUNNING_HEADER',delta:-40,note:`appears on ${ctx.runningHeaderFreq.get(text)} pages`});
  }

  // EVERY_PAGE penalty
  if (ctx.everyPageLines.has(text)) {
    score-=60; details.push({rule:'EVERY_PAGE',delta:-60,note:`appears on ${ctx.everyPageFreq.get(text)} pages`});
  }

  // LOWERCASE_START penalty
  if (/^[a-z]/.test(text)) {
    score-=30; details.push({rule:'LOWERCASE_START',delta:-30,note:'starts with lowercase'});
  }

  // PROSE_LENGTH penalty
  if (text.length>120) {
    score-=25; details.push({rule:'PROSE_LENGTH',delta:-25,note:`${text.length} chars`});
  }

  // BOTTOM_QUARTER penalty
  if (y<pageHeight*0.25) {
    score-=20; details.push({rule:'BOTTOM_QUARTER',delta:-20,note:`y=${y.toFixed(0)} < ${(pageHeight*0.25).toFixed(0)}`});
  }

  score = Math.max(0, Math.min(100, score));
  return { score, details };
}

function sequenceContinuity(values) {
  if (values.length<2) return 0;
  let good=0;
  for (let i=1;i<values.length;i++) {
    const gap=values[i]-values[i-1];
    if (gap===1) good+=1;
    else if (gap===2) good+=0.6;
  }
  return good/(values.length-1);
}

function chapterQuality(chapters, totalPages) {
  if (chapters.length===0) return 0;
  const avgPages=totalPages/chapters.length;
  let densityScore=1;
  if (avgPages<2) densityScore=0.2;
  else if (avgPages<4) densityScore=0.6;
  else if (avgPages>80) densityScore=0.8;
  const varietyScore=Math.min(1,chapters.length/5);
  return (densityScore*0.7)+(varietyScore*0.3);
}

// ── Main audit function ───────────────────────────────────────────────────────

async function audit(pdfPath) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`CHAPTER DETECTION FORENSIC AUDIT`);
  console.log(`File: ${pdfPath}`);
  console.log(`${'═'.repeat(70)}\n`);

  // 1. Extract pages
  console.log('Extracting PDF text...');
  const { pages, outline } = await extractPages(pdfPath);
  console.log(`  Total pages: ${pages.length}`);
  console.log(`  Outline entries: ${outline.length}`);

  if (outline.length > 0) {
    console.log('\n── PDF OUTLINE (would be used as Strategy A) ─────────────────────────');
    for (const e of outline) {
      console.log(`  p.${e.pageNum}: ${e.title}`);
    }
    if (outline.length >= 2) {
      console.log('\n  ⚠ OUTLINE HAS ≥ 2 ENTRIES — detector will use outline and skip all other strategies.');
      console.log('  If outline is wrong/incomplete, this is the root cause.');
    }
  }

  // 2. Build running headers / every-page lines
  console.log('\n── RUNNING HEADERS ────────────────────────────────────────────────────');
  const { headers: runningHeaders, threshold: rhThreshold, freq: lineFreq } = buildRunningHeadersAudit(pages);
  console.log(`  Threshold: max(3, ${pages.length} × ${RUNNING_HEADER_THRESHOLD}) = ${rhThreshold.toFixed(1)} pages`);
  if (runningHeaders.size === 0) {
    console.log('  None detected');
  } else {
    for (const [line, count] of runningHeaders) {
      console.log(`  [${count}/${pages.length} pages] "${line}"`);
    }
  }

  const { lines: everyPageLines, threshold: epThreshold } = buildEveryPageLinesAudit(pages, lineFreq);
  console.log(`\n── EVERY-PAGE LINES (≥${(epThreshold).toFixed(1)} pages, get -60) ──────────────────`);
  if (everyPageLines.size === 0) {
    console.log('  None');
  } else {
    for (const [line, count] of everyPageLines) {
      console.log(`  [${count}/${pages.length}] "${line}"`);
    }
  }

  // Build context for scoring
  const allFontSizes = [];
  for (const page of pages) {
    if (page.lines) for (const l of page.lines) if (l.fontSize>0) allFontSizes.push(l.fontSize);
  }
  allFontSizes.sort((a,b)=>a-b);
  const mid = Math.floor(allFontSizes.length/2);
  const medianFontSize = allFontSizes.length===0 ? 12
    : allFontSizes.length%2===0 ? (allFontSizes[mid-1]+allFontSizes[mid])/2
    : allFontSizes[mid];

  let pageWidth=612, pageHeight=792;
  for (const p of pages) { if (p.width&&p.height) { pageWidth=p.width; pageHeight=p.height; break; } }

  const ctx = {
    medianFontSize, pageWidth, pageHeight,
    runningHeaders, runningHeaderFreq: runningHeaders,
    everyPageLines, everyPageFreq: everyPageLines,
    hasRich: allFontSizes.length > 0,
  };

  // Fix: we need the full freq map for penalty notes
  ctx.runningHeaderFreq = lineFreq;
  ctx.everyPageFreq     = lineFreq;

  console.log(`\n── FONT METRICS ────────────────────────────────────────────────────────`);
  console.log(`  Rich features: ${ctx.hasRich}`);
  console.log(`  Median font size: ${medianFontSize.toFixed(2)}pt`);
  console.log(`  Page dimensions: ${pageWidth}×${pageHeight}pt`);
  console.log(`  Font sizes sampled: ${allFontSizes.length}`);

  // 3. Score every page — detailed log
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`PER-PAGE SCORING (threshold = 40)`);
  console.log(`${'═'.repeat(70)}`);

  const WORD_NUMBERS_RE = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|\d{1,3})$/i;

  const candidates = [];
  const allRuleStats = {};
  const allScores   = [];

  for (const page of pages) {
    const pageWordCount = page.text.split(/\s+/).filter(Boolean).length;
    let pageLines;
    if (page.lines && page.lines.length > 0) {
      pageLines = page.lines;
    } else {
      const textLines = page.text.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
      pageLines = textLines.map((text,idx) => ({
        text, y:792-idx*12, x:0, lineWidth:0, fontSize:ctx.medianFontSize, bold:false, italic:false,
      }));
    }
    const limit = Math.min(SCAN_LINES, pageLines.length);

    // Pass 0: multi-line check
    let pass0Found = false;
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
          candidates.push({ pageNum:page.pageNum, title, score:85, reasons:['MULTI_LINE_HEADING'], details:[{rule:'MULTI_LINE_HEADING',delta:85,note:`"${lineText}" + "${next.text.trim()}"${titleLine?` + "${titleLine.text.trim()}"`:''}`}], wordCount:pageWordCount });
          allRuleStats['MULTI_LINE_HEADING'] = (allRuleStats['MULTI_LINE_HEADING']||0)+1;
          allScores.push(85);
          pass0Found = true;
          break;
        }
      }
    }
    if (pass0Found) continue;

    // Pass 1: score first 12 lines
    let bestScore = -1, bestCandidate = null;

    for (let i=0; i<limit; i++) {
      const lineObj  = pageLines[i];
      const lineText = lineObj.text.trim();
      if (!lineText||lineText.length<2||lineText.length>120) continue;
      if (/^\d+$/.test(lineText)) continue;

      const prevLine = i>0 ? pageLines[i-1] : null;
      const nextLine = i<pageLines.length-1 ? pageLines[i+1] : null;
      const gapAbove = prevLine ? Math.abs(lineObj.y-prevLine.y)-(lineObj.fontSize||12) : 30;
      const gapBelow = nextLine ? Math.abs(nextLine.y-lineObj.y)-(lineObj.fontSize||12) : 30;

      const lineOpts = {
        y:lineObj.y, fontSize:lineObj.fontSize||ctx.medianFontSize,
        bold:lineObj.bold||false, italic:lineObj.italic||false,
        x:lineObj.x||0, lineWidth:lineObj.lineWidth||0,
        lineIndex:i, pageWordCount,
        gapAbove:Math.max(0,gapAbove), gapBelow:Math.max(0,gapBelow),
        pageHeight:ctx.pageHeight, pageWidth:ctx.pageWidth,
      };

      const { score, details } = scoreLineAudit(lineText, lineOpts, ctx);

      if (score>=40 && score>bestScore) {
        bestScore=score;
        bestCandidate={ pageNum:page.pageNum, title:lineText, score, reasons:details.map(d=>d.rule), details, wordCount:pageWordCount };
      }
    }
    if (bestCandidate) {
      candidates.push(bestCandidate);
      for (const d of bestCandidate.details) if (d.delta>0) allRuleStats[d.rule]=(allRuleStats[d.rule]||0)+1;
      allScores.push(bestCandidate.score);
      continue;
    }

    // Pass 2: sparse ALL-CAPS
    if (pageWordCount<200) {
      for (let i=0; i<Math.min(8,pageLines.length); i++) {
        const lineObj  = pageLines[i];
        const lineText = lineObj.text.trim();
        if (!lineText||/^\d+$/.test(lineText)) continue;
        const alphaChars=lineText.replace(/[^a-zA-Z]/g,'');
        const upperChars=lineText.replace(/[^A-Z]/g,'');
        const isAllCapsLine=alphaChars.length>=2&&upperChars.length/alphaChars.length>=0.70;
        if (isAllCapsLine&&!ctx.runningHeaders.has(lineText)&&!ctx.everyPageLines.has(lineText)) {
          const prevLine=i>0?pageLines[i-1]:null;
          const nextLine=i<pageLines.length-1?pageLines[i+1]:null;
          const gapAbove=prevLine?Math.abs(lineObj.y-prevLine.y)-(lineObj.fontSize||12):30;
          const gapBelow=nextLine?Math.abs(nextLine.y-lineObj.y)-(lineObj.fontSize||12):30;
          const lineOpts={y:lineObj.y,fontSize:lineObj.fontSize||ctx.medianFontSize,bold:lineObj.bold||false,italic:lineObj.italic||false,x:lineObj.x||0,lineWidth:lineObj.lineWidth||0,lineIndex:i,pageWordCount,gapAbove:Math.max(0,gapAbove),gapBelow:Math.max(0,gapBelow),pageHeight:ctx.pageHeight,pageWidth:ctx.pageWidth};
          const {score,details}=scoreLineAudit(lineText,lineOpts,ctx);
          if (score>=25) {
            candidates.push({pageNum:page.pageNum,title:lineText,score,reasons:details.map(d=>d.rule),details,wordCount:pageWordCount,pass2:true});
            for (const d of details) if (d.delta>0) allRuleStats[d.rule]=(allRuleStats[d.rule]||0)+1;
            allScores.push(score);
            break;
          }
        }
      }
    }
  }

  // Print per-candidate detail
  for (const c of candidates) {
    console.log(`\n─────────────────────────────────────────────────────────────────────`);
    console.log(`Page ${c.pageNum}${c.pass2?' [PASS-2 SPARSE ALL-CAPS]':''}`);
    console.log(`  Text: "${c.title}"`);
    console.log(`  Score: ${c.score} (word count: ${c.wordCount})`);
    console.log(`  Rules:`);
    for (const d of c.details) {
      const sign = d.delta>0 ? `+${d.delta}` : String(d.delta);
      console.log(`    ${sign.padStart(4)}  ${d.rule.padEnd(20)} ${d.note||''}`);
    }
  }

  // 4. Build chapters from candidates
  const chapters = [];
  for (let i=0; i<candidates.length; i++) {
    const cand=candidates[i], nextCand=candidates[i+1];
    const startPage=cand.pageNum;
    const endPage=nextCand?nextCand.pageNum-1:pages[pages.length-1].pageNum;
    const chPages=pages.filter(p=>p.pageNum>=startPage&&p.pageNum<=endPage);
    if (chPages.length===0) continue;
    chapters.push({title:cand.title,pageStart:startPage,pageEnd:endPage,pageCount:chPages.length,score:cand.score,reasons:cand.reasons,wordCount:cand.wordCount});
  }

  // Merge front matter
  if (chapters.length>0 && candidates.length>0 && candidates[0].pageNum>pages[0].pageNum) {
    chapters[0].pageStart = pages[0].pageNum;
  }

  // 5. Numbered sequence check
  const numbered = candidates.map(c => {
    const n=extractChapterNum(c.title);
    return n?{...c,_num:n.value,_kind:n.kind}:null;
  }).filter(Boolean);
  const coverage = candidates.length>0 ? numbered.length/candidates.length : 0;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`SEQUENCE ANALYSIS`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Total candidates:        ${candidates.length}`);
  console.log(`  Numbered candidates:     ${numbered.length}`);
  console.log(`  Coverage:                ${(coverage*100).toFixed(1)}% (need ≥${SEQ_MIN_COVERAGE*100}%)`);
  if (numbered.length>=2) {
    const values=numbered.map(c=>c._num);
    const cont=sequenceContinuity(values);
    console.log(`  Sequence continuity:     ${(cont*100).toFixed(1)}% (need ≥${SEQ_MIN_CONTINUITY*100}%)`);
    console.log(`  Numbered sequence:       ${values.join(' → ')}`);
    const seqOk = coverage>=SEQ_MIN_COVERAGE && cont>=SEQ_MIN_CONTINUITY;
    console.log(`  Sequence valid:          ${seqOk}`);
  }

  // 6. Quality check
  const q = chapterQuality(chapters, pages.length);
  const avgPages = pages.length / Math.max(1, chapters.length);
  console.log(`\n── QUALITY CHECK ──────────────────────────────────────────────────────`);
  console.log(`  Raw scored candidates:   ${chapters.length}`);
  console.log(`  Avg pages/chapter:       ${avgPages.toFixed(1)}`);
  console.log(`  Quality score:           ${q.toFixed(3)} (need ≥ 0.25 for raw scoring)`);

  // Sanity check details
  const dupeMap = new Map();
  for (const ch of chapters) dupeMap.set(ch.title,(dupeMap.get(ch.title)||0)+1);
  const dupes = [...dupeMap.entries()].filter(([,n])=>n>1);
  console.log(`  Duplicate titles:        ${dupes.length>0?dupes.map(([t,n])=>`"${t}"×${n}`).join(', '):'none'}`);
  const sanity = chapters.length>0 && avgPages>=1.5 && (chapters.length!==1||pages.length<=30) && dupes.length/chapters.length<=0.4;
  console.log(`  Sanity check:            ${sanity}`);

  // Determine which strategy the actual detector would use
  const seqValid = numbered.length >= 2 && coverage >= SEQ_MIN_COVERAGE;
  let strategyUsed;
  if (seqValid) {
    const seqValues = numbered.map(c=>c._num);
    const seqCont = sequenceContinuity(seqValues);
    if (seqCont >= SEQ_MIN_CONTINUITY && q >= 0.35 && sanity) {
      strategyUsed = `numbered-sequence (${numbered.length} chapters extracted from ${candidates.length} candidates)`;
    } else {
      strategyUsed = `numbered-sequence FAILS continuity/quality — falls through`;
    }
  } else if (q >= 0.25 && sanity) {
    strategyUsed = `raw-scoring — ALL ${chapters.length} candidates returned as chapters ← LIKELY CAUSE OF OVERCOUNTING`;
  } else {
    strategyUsed = `SANITY/QUALITY FAILS — falls through to pattern/structural fallback`;
  }
  console.log(`  Strategy that fires:     ${strategyUsed}`);

  // 7. Final chapter list (these are the raw scored candidates, may include FPs)
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`RAW SCORED CANDIDATES (${chapters.length} total) — what the detector sees before strategy selection`);
  console.log(`${'═'.repeat(70)}`);
  for (const ch of chapters) {
    console.log(`  pp.${String(ch.pageStart).padStart(3)}–${String(ch.pageEnd).padStart(3)} (${String(ch.pageCount).padStart(3)}pp) [score:${ch.score}]  "${ch.title}"`);
    console.log(`     Rules: ${ch.reasons.join(', ')}`);
  }

  // 8. Rule statistics
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`RULE STATISTICS (positive rules only)`);
  console.log(`${'═'.repeat(70)}`);
  const sortedRules = Object.entries(allRuleStats).sort((a,b)=>b[1]-a[1]);
  for (const [rule, count] of sortedRules) {
    console.log(`  ${rule.padEnd(24)} ${count}`);
  }

  // 9. Confidence distribution
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`CONFIDENCE DISTRIBUTION`);
  console.log(`${'═'.repeat(70)}`);
  if (allScores.length > 0) {
    const avg = allScores.reduce((a,b)=>a+b,0)/allScores.length;
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);
    console.log(`  Count:   ${allScores.length}`);
    console.log(`  Average: ${avg.toFixed(1)}`);
    console.log(`  Min:     ${min}`);
    console.log(`  Max:     ${max}`);
    console.log(`  Histogram:`);
    const buckets = {
      '25–39': 0,'40–49':0,'50–59':0,'60–69':0,'70–79':0,'80–89':0,'90–100':0
    };
    for (const s of allScores) {
      if (s<40) buckets['25–39']++;
      else if (s<50) buckets['40–49']++;
      else if (s<60) buckets['50–59']++;
      else if (s<70) buckets['60–69']++;
      else if (s<80) buckets['70–79']++;
      else if (s<90) buckets['80–89']++;
      else buckets['90–100']++;
    }
    for (const [range, count] of Object.entries(buckets)) {
      const bar = '█'.repeat(count);
      console.log(`    ${range}: ${bar} (${count})`);
    }
  } else {
    console.log('  No candidates');
  }

  // 10. False positive analysis
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`FALSE POSITIVE ANALYSIS`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  (Review per-page log above to identify incorrectly matched chapters)`);
  console.log(`  Common false positive patterns:`);

  // Detect chapters with suspicious rules
  let fpCount = 0;
  for (const ch of chapters) {
    const hasPat = ch.reasons.includes('CHAPTER_KEYWORD');
    const hasSeq = ch.reasons.includes('MULTI_LINE_HEADING');
    const onlyHeuristic = !hasPat && !hasSeq;
    if (onlyHeuristic) {
      fpCount++;
      console.log(`\n  SUSPECT: pp.${ch.pageStart}  "${ch.title}"`);
      console.log(`    Score: ${ch.score}  Rules: ${ch.reasons.join(', ')}`);
      console.log(`    Reason: No chapter keyword pattern matched — accepted purely by score.`);
      const hasCaps    = ch.reasons.includes('ALL_CAPS');
      const hasSparse  = ch.reasons.includes('SPARSE_PAGE');
      const hasStarts  = ch.reasons.includes('STARTS_PAGE');
      const hasShort   = ch.reasons.includes('SHORT_LINE');
      if (hasCaps && hasSparse && hasShort) {
        console.log(`    Likely cause: Short ALL-CAPS line on a sparse page — scores ${(hasCaps?10:0)+(hasSparse?15:0)+(hasShort?8:0)} from those 3 rules alone.`);
      }
    }
  }
  if (fpCount === 0) {
    console.log('\n  All accepted chapters matched a CHAPTER_KEYWORD or MULTI_LINE_HEADING pattern.');
    console.log('  False positives likely caused by incorrect pattern matches (see per-page log).');
  }

  // 11. Root cause summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ROOT CAUSE SUMMARY`);
  console.log(`${'═'.repeat(70)}`);

  if (outline.length >= 2) {
    console.log(`  ★ OUTLINE PRESENT: Detector used PDF outline (${outline.length} entries).`);
    console.log(`    If count is wrong, the outline itself contains the wrong chapters.`);
  }

  const avgPagesPerChapter = pages.length / Math.max(1,chapters.length);
  if (avgPagesPerChapter < 10 && chapters.length > 15) {
    console.log(`  ★ DENSITY TOO HIGH: ${chapters.length} chapters in ${pages.length} pages = ${avgPagesPerChapter.toFixed(1)}pp avg.`);
    console.log(`    Many false positives. Likely causes:`);
    const keywordCount = chapters.filter(ch=>ch.reasons.includes('CHAPTER_KEYWORD')).length;
    const heuristicCount = chapters.length - keywordCount;
    console.log(`    - Pattern-matched (CHAPTER_KEYWORD): ${keywordCount}`);
    console.log(`    - Heuristic-only (no keyword): ${heuristicCount}`);
    if (heuristicCount > 0) {
      const topRules = sortedRules.slice(0,3).filter(([r])=>r!=='CHAPTER_KEYWORD'&&r!=='MULTI_LINE_HEADING');
      if (topRules.length) console.log(`    - Top heuristic rules: ${topRules.map(([r,n])=>`${r}(${n})`).join(', ')}`);
    }
    if (keywordCount > 0) {
      console.log(`    - Check per-page log: a keyword pattern may be matching non-chapter content.`);
      console.log(`      E.g., "1. Introduction" inside a table-of-contents or numbered list.`);
    }
  }

  const noKwdChapters = chapters.filter(ch=>!ch.reasons.includes('CHAPTER_KEYWORD')&&!ch.reasons.includes('MULTI_LINE_HEADING'));
  if (noKwdChapters.length > 0) {
    console.log(`\n  ★ ${noKwdChapters.length} chapters accepted with NO keyword pattern match.`);
    console.log(`    These passed purely on heuristic score (ALL_CAPS+SHORT_LINE+SPARSE+STARTS_PAGE etc.)`);
    console.log(`    They are likely subheadings, section dividers, or quote attributions.`);
  }

  const kwdChapters = chapters.filter(ch=>ch.reasons.includes('CHAPTER_KEYWORD'));
  if (kwdChapters.length > 0 && chapters.length > 20) {
    console.log(`\n  ★ ${kwdChapters.length} chapters matched CHAPTER_KEYWORD. If these are false positives,`);
    console.log(`    the regex patterns are matching non-chapter content.`);
    console.log(`    Examples: numbered lists (1. Item), TOC entries, footnotes with section refs.`);
  }

  if (allRuleStats['ALL_CAPS'] > allRuleStats['CHAPTER_KEYWORD']) {
    console.log(`\n  ★ ALL_CAPS fired more than CHAPTER_KEYWORD (${allRuleStats['ALL_CAPS']} vs ${allRuleStats['CHAPTER_KEYWORD']||0}).`);
    console.log(`    Book likely uses ALL-CAPS subheadings that the detector treats as chapters.`);
  }

  console.log(`\n${'═'.repeat(70)}\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node audit.js <path-to-book.pdf>');
  console.error('Example: node audit.js "Atomic Habits.pdf"');
  process.exit(1);
}

audit(pdfPath).catch(err => { console.error(err); process.exit(1); });
