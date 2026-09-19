#!/usr/bin/env node
/**
 * Measure the citation verification thresholds instead of asserting them.
 *
 * CITATION_FUZZY_VERIFY=0.90 has a plausible-sounding justification — at
 * ratio 0.90 on a 200-character quote at most 20 characters differ, which is
 * the size of a typography difference rather than a different legal
 * proposition. But an argument is not a measurement. This sweeps the
 * threshold over 40 hand-built fixtures (20 genuine quotes, some with
 * deliberate OCR and punctuation damage; 20 fabricated but plausible ones)
 * and prints precision and recall at each setting.
 *
 * The table it prints belongs in the report: it converts a hand-waved
 * constant into a measured one.
 *
 *   npm run tune
 *   npm run tune -- --no-guards     (isolate the ratio from the hard guards)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { matchQuote, withMatchedText } from '../src/citation/match.js';
import { runGuards, applyGuards, statusForSimilarity } from '../src/citation/guards.js';
import { config, ROOT } from '../src/config/index.js';

const noGuards = process.argv.includes('--no-guards');
const cases = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/quotes.json'), 'utf8'));

const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const DIM = '\x1b[90m';
const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';

// Score every fixture once; the sweep only reinterprets the results.
const scored = cases.map((c) => {
  const match = withMatchedText(c.source, matchQuote(c.source, c.quote));
  const guards = noGuards
    ? []
    : runGuards({ quote: c.quote, matchedText: match.matchedText, match, sourceType: 'corpus' });
  return { ...c, match, guards };
});

function evaluate(threshold) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  const errors = [];
  for (const s of scored) {
    const base = s.match.tier === 'exact' || s.match.tier === 'normalized'
      ? 'verified'
      : s.match.similarity >= threshold ? 'verified' : 'rejected';
    const accepted = (noGuards ? base : applyGuards(base, s.guards)) === 'verified';
    if (s.genuine && accepted) tp++;
    else if (s.genuine && !accepted) { fn++; errors.push({ kind: 'missed', ...s }); }
    else if (!s.genuine && accepted) { fp++; errors.push({ kind: 'accepted', ...s }); }
    else tn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { threshold, tp, fp, tn, fn, precision, recall, f1, errors };
}

console.log(`\n${BOLD}Citation threshold sweep${RESET}`);
console.log(`${DIM}${cases.length} fixtures (${cases.filter((c) => c.genuine).length} genuine, ${cases.filter((c) => !c.genuine).length} fabricated)`);
console.log(`hard guards: ${noGuards ? 'DISABLED (--no-guards)' : 'enabled'} · current CITATION_FUZZY_VERIFY = ${config.citation.fuzzyVerify}${RESET}\n`);

const sweep = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.99].map(evaluate);

console.log(`${BOLD}threshold   TP  FP  TN  FN   precision  recall     F1${RESET}`);
for (const r of sweep) {
  const marker = Math.abs(r.threshold - config.citation.fuzzyVerify) < 1e-9 ? '  ← current' : '';
  console.log(
    `${r.threshold.toFixed(2).padStart(8)}  ${String(r.tp).padStart(3)} ${String(r.fp).padStart(3)} `
    + `${String(r.tn).padStart(3)} ${String(r.fn).padStart(3)}   `
    + `${(r.precision * 100).toFixed(1).padStart(7)}%  ${(r.recall * 100).toFixed(1).padStart(5)}%  `
    + `${r.f1.toFixed(3)}${marker}`,
  );
}

const current = evaluate(config.citation.fuzzyVerify);
console.log(`\n${BOLD}Errors at the current threshold (${config.citation.fuzzyVerify})${RESET}`);
if (current.errors.length === 0) {
  console.log(`  ${GREEN}none — every genuine quote accepted, every fabricated one rejected${RESET}`);
} else {
  for (const e of current.errors) {
    const tag = e.kind === 'accepted' ? `${RED}FALSE ACCEPT${RESET}` : `${RED}MISSED${RESET}`;
    console.log(`  ${tag}  sim=${e.match.similarity.toFixed(3)} tier=${e.match.tier.padEnd(10)} ${DIM}${e.note}${RESET}`);
    console.log(`    ${DIM}${e.quote.slice(0, 100)}${RESET}`);
  }
}

// What the guards contribute on top of the ratio, stated as a number.
if (!noGuards) {
  const guardKills = scored.filter((s) => !s.genuine
    && s.match.similarity >= config.citation.fuzzyVerify
    && applyGuards(statusForSimilarity(s.match), s.guards) !== 'verified');
  console.log(`\n${BOLD}What the hard guards catch that the ratio alone would not${RESET}`);
  if (guardKills.length === 0) {
    console.log(`  ${DIM}nothing in this fixture set${RESET}`);
  } else {
    for (const s of guardKills) {
      console.log(`  ${GREEN}✔${RESET} sim=${s.match.similarity.toFixed(3)} caught by [${s.guards.map((g) => g.id).join(', ')}] ${DIM}— ${s.note}${RESET}`);
    }
    console.log(`\n  ${BOLD}${guardKills.length} fabricated quote(s) scored above ${config.citation.fuzzyVerify} and were rejected only because of a guard.${RESET}`);
  }
}
console.log();
