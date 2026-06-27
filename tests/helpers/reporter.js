// HTML + JSON report generation

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const REPORTS_DIR = new URL('../reports/', import.meta.url).pathname;

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileTimestamp() {
  return timestamp().replace(/[: ]/g, '-').replace('--', '-');
}

/**
 * Generate both HTML and JSON reports.
 *
 * @param {Object} results - { books: [{slug, title, scores, expected, actual, processingTime, pass}], unitResults, e2eResults, regressions }
 * @returns {string} - Path to HTML report
 */
export function generateReport(results) {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const ts       = timestamp();
  const fileTs   = fileTimestamp();
  const books    = results.books || [];
  const passing  = books.filter(b => b.pass).length;
  const total    = books.length;
  const pct      = total > 0 ? Math.round((books.reduce((s, b) => s + (b.scores?.overallScore || 0), 0) / total) * 100) : 0;

  // JSON report
  const jsonReport = {
    timestamp: ts,
    overall: { pct, passing, total },
    books,
    unitResults:  results.unitResults  || {},
    e2eResults:   results.e2eResults   || {},
    regressions:  results.regressions  || [],
  };

  const jsonPath = join(REPORTS_DIR, `qa-report-${fileTs}.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  // HTML report
  const html = buildHTML(ts, pct, passing, total, books, results);
  const htmlPath = join(REPORTS_DIR, `qa-report-${fileTs}.html`);
  writeFileSync(htmlPath, html);

  console.log(`\nReports saved:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  HTML: ${htmlPath}`);

  return htmlPath;
}

function scoreColor(score) {
  if (score >= 0.95) return '#22c55e'; // green
  if (score >= 0.80) return '#f59e0b'; // amber
  return '#ef4444';                     // red
}

function pctStr(score) { return `${Math.round(score * 100)}%`; }

function buildHTML(ts, pct, passing, total, books, results) {
  const regressions = results.regressions || [];
  const hasReg = regressions.length > 0;

  const bookCards = books.map(b => {
    const s = b.scores || {};
    const e = b.expected || {};
    const a = b.actual   || {};
    const passIcon = b.pass ? '&#10003;' : '&#10007;';
    const passColor = b.pass ? '#22c55e' : '#ef4444';

    function row(label, actual, expected, score) {
      const icon = score >= 0.99 ? '&#10003;' : (score >= 0.80 ? '~' : '&#10007;');
      const color = scoreColor(score);
      return `<tr>
        <td>${label}</td>
        <td>${actual}/${expected}</td>
        <td style="color:${color}">${icon}</td>
      </tr>`;
    }

    return `
<div class="book-card" style="border-left: 4px solid ${passColor}">
  <div class="book-header">
    <strong>${b.title || b.slug}</strong>
    <span style="color:${passColor}; font-weight:bold">${passIcon} ${pctStr(s.overallScore || 0)}</span>
  </div>
  <table class="score-table">
    <tbody>
      ${row('Chapter detection', a.chapterCount || 0, e.expectedChapterCount || 0, s.chapterScore || 0)}
      ${row('Concepts',          a.conceptCount  || 0, e.expectedConceptCount  || 0, s.conceptScore   || 0)}
      ${row('Principles',        a.principleCount|| 0, e.expectedPrincipleCount|| 0, s.principleScore || 0)}
      ${row('Vocabulary',        a.vocabCount    || 0, e.expectedVocabularyCount||0, s.vocabScore     || 0)}
      ${row('Quotes',            a.quoteCount    || 0, e.expectedQuoteCount    || 0, s.quoteScore     || 0)}
      ${row('AI calls',          a.aiCalls       || 0, e.expectedAICalls       || 0, s.aiCallScore    || 0)}
      <tr><td>Processing time</td><td colspan="2">${b.processingTime ? b.processingTime.toFixed(1) + 's' : 'N/A'}</td></tr>
    </tbody>
  </table>
</div>`;
  }).join('\n');

  const regressionSection = hasReg ? `
<div class="regression-alert">
  <h2>&#9888; REGRESSIONS DETECTED</h2>
  <table>
    <thead><tr><th>Book</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead>
    <tbody>
      ${regressions.map(r => `<tr>
        <td>${r.slug}</td>
        <td>${pctStr(r.previous)}</td>
        <td>${pctStr(r.current)}</td>
        <td style="color:#ef4444">-${pctStr(r.previous - r.current)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>` : '';

  const unitSection = results.unitResults ? `
<div class="section">
  <h2>Unit Tests</h2>
  <p>Passed: ${results.unitResults.passed || 0} / ${results.unitResults.total || 0}</p>
</div>` : '';

  const e2eSection = results.e2eResults ? `
<div class="section">
  <h2>E2E Tests</h2>
  <p>Passed: ${results.e2eResults.passed || 0} / ${results.e2eResults.total || 0}</p>
</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QA Report — ${ts}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 2rem; background: #0f172a; color: #e2e8f0; }
    h1 { color: #f8fafc; }
    h2 { color: #94a3b8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .summary { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0; }
    .books-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; }
    .book-card { background: #1e293b; border-radius: 8px; padding: 1.25rem; }
    .book-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .score-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .score-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #334155; }
    .regression-alert { background: #7f1d1d; border: 1px solid #ef4444; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .regression-alert table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
    .regression-alert td, .regression-alert th { padding: 0.4rem 0.75rem; border: 1px solid #b91c1c; }
    .section { background: #1e293b; border-radius: 8px; padding: 1.25rem; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>QA Report &mdash; ${ts}</h1>

  <div class="summary">
    <p style="font-size:1.25rem">Overall: <strong>${pct}%</strong> &nbsp;|&nbsp; ${passing}/${total} books PASS</p>
  </div>

  ${regressionSection}
  ${unitSection}
  ${e2eSection}

  <h2 style="margin-top:2rem">Book Results</h2>
  <div class="books-grid">
    ${bookCards}
  </div>
</body>
</html>`;
}
