import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT, redactedConfig } from '../../src/config/index.js';
import { SCHEMA } from '../../src/config/schema.js';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

test('NFR 4.4: only src/config may read process.env', () => {
  // Configuration must live in one place rather than being spread through
  // application code. This turns that requirement into a passing test.
  const offenders = walk(path.join(ROOT, 'src'))
    .filter((f) => !f.includes(`${path.sep}src${path.sep}config${path.sep}`))
    .filter((f) => /process\.env/.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [], `these modules read process.env directly:\n  ${offenders.join('\n  ')}`);
});

test('the citation retry ceiling cannot be raised past 1 from .env', () => {
  // A typo of CITATION_MAX_RETRIES=99 must not be able to create a loop.
  assert.ok(config.citation.maxRetries <= 1);
  assert.equal(SCHEMA.CITATION_MAX_RETRIES.clampMax, 1);
});

test('the config object is deeply frozen', () => {
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.retrieval));
  assert.throws(() => { config.retrieval.maxTurns = 999; }, TypeError);
});

test('secrets never appear in the redacted config', () => {
  const red = redactedConfig();
  const serialized = JSON.stringify(red);
  assert.ok(!serialized.includes(config.server.dashboardToken) || config.server.dashboardToken === '');
  assert.equal(red.groups.gemini.GEMINI_API_KEY.secret, true);
  assert.ok(['(not set)', '••••••••'].includes(red.groups.gemini.GEMINI_API_KEY.value));
});

test('every schema key is exposed to the dashboard exactly once', () => {
  const red = redactedConfig();
  const seen = Object.values(red.groups).flatMap((g) => Object.keys(g));
  assert.equal(seen.length, Object.keys(SCHEMA).length);
  assert.equal(new Set(seen).size, seen.length);
});

test('.env.example documents every schema key', () => {
  const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const missing = Object.keys(SCHEMA).filter((k) => !new RegExp(`^${k}=`, 'm').test(example));
  assert.deepEqual(missing, [], `undocumented keys: ${missing.join(', ')}`);
});

test('fusion weights sum to 1 so a score stays in [0,1]', () => {
  const { wDense, wRef, wExact } = config.ranking;
  assert.ok(Math.abs(wDense + wRef + wExact - 1) < 1e-9,
    `weights sum to ${wDense + wRef + wExact}; SUFFICIENCY_MIN_TOP_SCORE is only meaningful if they sum to 1`);
});
