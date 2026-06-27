#!/usr/bin/env node
// Entry point for the full QA suite.
// 1. npm install in tests/
// 2. Generate test PDFs
// 3. Run unit tests (node --test)
// 4. Start serve on port 3333
// 5. Run E2E tests (playwright)
// 6. Stop server
// 7. Aggregate results and generate report

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const APP_ROOT    = dirname(__dirname);
const TESTS_DIR   = __dirname;

function step(msg) {
  console.log('\n' + '─'.repeat(60));
  console.log(`▶ ${msg}`);
  console.log('─'.repeat(60));
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  const result = spawnSync(cmd, {
    shell:  true,
    stdio:  opts.silent ? 'pipe' : 'inherit',
    cwd:    opts.cwd || TESTS_DIR,
    env:    { ...process.env, ...opts.env },
    timeout: opts.timeout || 300000,
  });
  if (opts.silent) {
    return {
      stdout: result.stdout?.toString() || '',
      stderr: result.stderr?.toString() || '',
      code:   result.status || 0,
    };
  }
  return { code: result.status || 0 };
}

async function main() {
  let unitOutput = '';
  let e2eFailed  = false;

  // ── Step 1: npm install ────────────────────────────────────────────────────
  step('Installing dependencies');
  run('npm install --prefer-offline 2>&1 || npm install', { cwd: TESTS_DIR });

  // ── Step 2: Generate PDFs ─────────────────────────────────────────────────
  step('Generating test PDFs');
  const genResult = run('node generator.js', { cwd: TESTS_DIR });
  if (genResult.code !== 0) {
    console.error('PDF generation failed — cannot continue');
    process.exit(1);
  }

  // ── Step 3: Unit tests ────────────────────────────────────────────────────
  step('Running unit tests');
  const unitResult = run(
    'node --test unit/chunker.test.js unit/compressor.test.js',
    { cwd: TESTS_DIR, silent: true }
  );
  unitOutput = unitResult.stdout + '\n' + unitResult.stderr;
  console.log(unitOutput);

  const unitPassed = (unitOutput.match(/^ok \d+/mg) || []).length;
  const unitFailed = (unitOutput.match(/^not ok \d+/mg) || []).length;
  console.log(`\nUnit tests: ${unitPassed} passed, ${unitFailed} failed`);

  // ── Step 4–6: E2E tests ───────────────────────────────────────────────────
  step('Running E2E tests (Playwright)');
  const e2eResult = run(
    'npx playwright test --reporter=list,json',
    {
      cwd: TESTS_DIR,
      env: { PLAYWRIGHT_JSON_OUTPUT_NAME: 'reports/playwright-results.json' },
    }
  );
  e2eFailed = e2eResult.code !== 0;
  if (e2eFailed) {
    console.warn('\n⚠ Some E2E tests failed (see output above)');
  }

  // ── Step 7: Aggregate and report ──────────────────────────────────────────
  step('Aggregating results and generating report');
  const { runQA } = await import('./qa-runner.js');
  const results = await runQA({ unitOutput });

  // Exit with non-zero if there are regressions or too many failures
  if (results.regressions.length > 0) {
    console.error('\n⚠ Regressions detected — exiting with code 2');
    process.exit(2);
  }

  if (results.overallPct < 70) {
    console.error('\n⚠ Overall score below 70% — exiting with code 1');
    process.exit(1);
  }

  console.log('\n✓ QA run complete');
}

main().catch(err => { console.error(err); process.exit(1); });
