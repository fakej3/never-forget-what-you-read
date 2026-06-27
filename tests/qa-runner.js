#!/usr/bin/env node
// QA Runner — aggregates unit test + e2e results, computes scores, detects regressions

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { BOOKS, STRESS_BOOKS } from './books/index.js';
import { generateReport } from './helpers/reporter.js';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const EXPECTED_DIR  = join(__dirname, 'expected');
const REPORTS_DIR   = join(__dirname, 'reports');
const REGRESSION_DIR = join(__dirname, 'regression');

mkdirSync(REPORTS_DIR,    { recursive: true });
mkdirSync(REGRESSION_DIR, { recursive: true });

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute score as min/max ratio (0-1), clamped.
 */
function ratioScore(actual, expected) {
  if (expected === 0 && actual === 0) return 1;
  if (expected === 0 || actual === 0) return 0;
  return Math.min(actual, expected) / Math.max(actual, expected);
}

/**
 * Compute chapter detection score.
 * Perfect = detected/expected == 1.0, clamped.
 */
function chapterScore(actual, expected) {
  if (!expected || expected === 0) return actual > 0 ? 1 : 0;
  const ratio = actual / expected;
  return Math.min(1, ratio); // clamped to 0-1; over-detection doesn't help
}

/**
 * Compute weighted overall score for a book.
 */
function computeScores(expected, actual) {
  const cs = chapterScore(actual.chapterCount || 0, expected.expectedChapterCount || 0);
  const conceptS  = ratioScore(actual.conceptCount   || 0, expected.expectedConceptCount   || 0);
  const principleS = ratioScore(actual.principleCount || 0, expected.expectedPrincipleCount || 0);
  const vocabS    = ratioScore(actual.vocabCount     || 0, expected.expectedVocabularyCount || 0);
  const quoteS    = ratioScore(actual.quoteCount     || 0, expected.expectedQuoteCount     || 0);
  const aiS = (actual.aiCalls || 0) === (expected.expectedAICalls || 0) ? 1.0 : 0.5;

  const overall =
    cs         * 0.40 +
    conceptS   * 0.15 +
    principleS * 0.15 +
    vocabS     * 0.15 +
    quoteS     * 0.10 +
    aiS        * 0.05;

  return {
    chapterScore:   cs,
    conceptScore:   conceptS,
    principleScore: principleS,
    vocabScore:     vocabS,
    quoteScore:     quoteS,
    aiCallScore:    aiS,
    overallScore:   overall,
  };
}

// ── Playwright result parsing ─────────────────────────────────────────────────

function parsePlaywrightResults() {
  const resultsPath = join(REPORTS_DIR, 'playwright-results.json');
  if (!existsSync(resultsPath)) {
    console.warn('No playwright-results.json found — skipping E2E scores');
    return { passed: 0, failed: 0, total: 0, tests: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const tests = [];
    let passed = 0, failed = 0;

    // Playwright JSON format: { suites: [{ specs: [{ tests: [{ results: [{status}] }] }] }] }
    function walkSuite(suite) {
      for (const spec of (suite.specs || [])) {
        for (const t of (spec.tests || [])) {
          const status = t.results?.[0]?.status || 'unknown';
          tests.push({ title: spec.title, status });
          if (status === 'passed') passed++;
          else failed++;
        }
      }
      for (const child of (suite.suites || [])) walkSuite(child);
    }

    for (const suite of (raw.suites || [])) walkSuite(suite);

    return { passed, failed, total: passed + failed, tests };
  } catch (err) {
    console.warn('Failed to parse playwright-results.json:', err.message);
    return { passed: 0, failed: 0, total: 0, tests: [] };
  }
}

// ── Unit test result parsing ──────────────────────────────────────────────────

function parseUnitResults(output) {
  // node:test outputs TAP-like format
  // Lines like: "ok 1 - test name" or "not ok 2 - test name"
  let passed = 0, failed = 0;
  const lines = (output || '').split('\n');
  for (const line of lines) {
    if (/^ok \d+/.test(line)) passed++;
    else if (/^not ok \d+/.test(line)) failed++;
  }
  return { passed, failed, total: passed + failed };
}

// ── Expected counts loader ────────────────────────────────────────────────────

function loadExpected(slug) {
  const p = join(EXPECTED_DIR, `${slug}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── Regression detection ──────────────────────────────────────────────────────

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: dirname(__dirname) })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}

function loadPreviousReport() {
  const files = readdirSync(REGRESSION_DIR)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  // Pick the latest (last sorted)
  const latest = files[files.length - 1];
  try {
    return JSON.parse(readFileSync(join(REGRESSION_DIR, latest), 'utf8'));
  } catch {
    return null;
  }
}

function detectRegressions(currentBooks, previousReport) {
  if (!previousReport) return [];
  const regressions = [];
  for (const book of currentBooks) {
    const prev = previousReport.books?.find(b => b.slug === book.slug);
    if (!prev) continue;
    const prevScore = prev.scores?.overallScore || 0;
    const currScore = book.scores?.overallScore || 0;
    if (prevScore - currScore > 0.05) {
      regressions.push({
        slug:     book.slug,
        previous: prevScore,
        current:  currScore,
        delta:    prevScore - currScore,
      });
    }
  }
  return regressions;
}

function saveRegressionReport(hash, bookResults) {
  const ts = Date.now();
  const path = join(REGRESSION_DIR, `report-${hash}-${ts}.json`);
  writeFileSync(path, JSON.stringify({
    gitHash:   hash,
    timestamp: ts,
    books:     bookResults.map(b => ({ slug: b.slug, scores: b.scores })),
  }, null, 2));
}

// ── Main aggregation ──────────────────────────────────────────────────────────

export async function runQA(options = {}) {
  const {
    unitOutput   = '',
    e2eResults   = null,
    bookResults  = [], // [{ slug, actual: {chapterCount, ...} }]
  } = options;

  const unitRes = parseUnitResults(unitOutput);
  const e2eRes  = e2eResults || parsePlaywrightResults();

  // Build per-book scores
  const allBooks = [...BOOKS, ...STRESS_BOOKS];
  const scoredBooks = [];

  for (const bookDef of allBooks) {
    const expected = loadExpected(bookDef.slug);
    if (!expected) continue;

    // Find actual results from bookResults param (populated by e2e tests or manual run)
    const actual = bookResults.find(b => b.slug === bookDef.slug)?.actual || {};

    const scores = computeScores(expected, actual);
    const pass   = scores.overallScore >= 0.80;

    scoredBooks.push({
      slug:           bookDef.slug,
      title:          bookDef.title,
      scores,
      expected,
      actual,
      processingTime: actual.processingTime || null,
      pass,
    });
  }

  // Regression detection
  const gitHash      = getGitHash();
  const prevReport   = loadPreviousReport();
  const regressions  = detectRegressions(scoredBooks, prevReport);

  // Save regression report
  saveRegressionReport(gitHash, scoredBooks);

  // Generate HTML + JSON reports
  const reportPath = generateReport({
    books:       scoredBooks,
    unitResults: unitRes,
    e2eResults:  e2eRes,
    regressions,
  });

  // Print summary
  const passing = scoredBooks.filter(b => b.pass).length;
  const pct     = scoredBooks.length > 0
    ? Math.round((scoredBooks.reduce((s, b) => s + b.scores.overallScore, 0) / scoredBooks.length) * 100)
    : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(`QA Summary: ${pct}% overall | ${passing}/${scoredBooks.length} books PASS`);
  console.log(`Unit tests: ${unitRes.passed}/${unitRes.total} passed`);
  console.log(`E2E tests:  ${e2eRes.passed}/${e2eRes.total} passed`);

  if (regressions.length > 0) {
    console.log('\n⚠ REGRESSIONS DETECTED:');
    for (const r of regressions) {
      console.log(`  ${r.slug}: ${(r.previous * 100).toFixed(0)}% → ${(r.current * 100).toFixed(0)}% (-${(r.delta * 100).toFixed(0)}%)`);
    }
  }

  console.log('\nReport: ' + reportPath);
  console.log('═'.repeat(60));

  return {
    overallPct:  pct,
    passing,
    total:       scoredBooks.length,
    regressions,
    books:       scoredBooks,
    unitResults: unitRes,
    e2eResults:  e2eRes,
    reportPath,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runQA().catch(err => { console.error(err); process.exit(1); });
}
