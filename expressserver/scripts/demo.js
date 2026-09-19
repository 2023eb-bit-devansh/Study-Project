#!/usr/bin/env node
/**
 * Run the T0–T4 demonstration set end to end and print a pass/fail table.
 *
 * This is the regression suite for the whole system. Run it before every
 * supervisor meeting: it exercises the checkability guard, exact reference
 * lookup, counter-evidence retrieval, the live-search fallback, citation
 * verification and every branch of the decision table.
 *
 *   npm run demo                    against http://localhost:3000
 *   npm run demo -- --only T1,T3
 *   npm run demo -- --url http://host:port
 */
import { DEMO_CASES } from './demoCases.js';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const BASE = urlArg >= 0 ? args[urlArg + 1] : 'http://localhost:3000';
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? (args[onlyArg + 1] ?? '').split(',').map((s) => s.trim().toUpperCase()) : null;

const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const DIM = '\x1b[90m';
const YELLOW = '\x1b[33m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitFor(jobId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/verify/${jobId}`);
    const job = await res.json();
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms`);
}

function check(testCase, job) {
  const failures = [];
  const e = testCase.expect;

  if (job.status !== 'done') {
    failures.push(`job ${job.status}: ${job.error?.message ?? 'unknown error'}`);
    return failures;
  }

  const result = job.result;
  if (result.label !== e.label) failures.push(`label was "${result.label}", expected "${e.label}"`);

  if (e.rules) {
    const rules = result.sub_claims.map((s) => s.rule_id);
    if (rules.length && !rules.some((r) => e.rules.includes(r))) {
      failures.push(`fired ${rules.join('/')}, expected one of ${e.rules.join('/')}`);
    }
  }

  if (e.maxTraceEvents && job.trace.length > e.maxTraceEvents) {
    failures.push(`${job.trace.length} trace events, expected at most ${e.maxTraceEvents}`);
  }

  if (e.noRetrieval && job.trace.some((t) => t.stage === 'retrieval')) {
    failures.push('retrieval ran, but this case must short-circuit before it');
  }

  if (e.noVerdictCall && job.trace.some((t) => t.stage === 'verdict' && t.type === 'llm_result')) {
    failures.push('the verdict model was called, violating the evidence-first rule for this case');
  }

  if (e.refKeys) {
    const found = result.sub_claims.flatMap((s) => s.ref_keys);
    for (const k of e.refKeys) {
      if (!found.includes(k)) failures.push(`ref_key ${k} was not derived (got ${found.join(', ') || 'none'})`);
    }
  }

  if (e.minVerified) {
    const verified = result.sub_claims.flatMap((s) => s.evidence).filter((x) => x.citation.status === 'verified').length;
    if (verified < e.minVerified) failures.push(`${verified} verified citations, expected at least ${e.minVerified}`);
  }

  if (e.exactTier) {
    const any = result.sub_claims.flatMap((s) => s.evidence).some((x) => x.citation.tier === 'exact');
    if (!any) failures.push('no citation matched at the exact tier');
  }

  // The invariant, checked on every case that retrieved nothing.
  for (const sc of result.sub_claims) {
    if (sc.evidence.length === 0 && sc.label !== 'Insufficient Evidence') {
      failures.push(`sub-claim ${sc.id} has no evidence but was labelled ${sc.label}`);
    }
  }

  return failures;
}

// ── run ──────────────────────────────────────────────────────────────────

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`\n✖ Backend not reachable at ${BASE}. Start it with \`npm run dev\`.\n`);
  process.exit(1);
}
const corpus = health.checks?.collection?.meta;
console.log(`\n${BOLD}AI Fact Checker — demonstration set${RESET}`);
console.log(`${DIM}backend ${BASE} · corpus ${corpus?.name} (${corpus?.count} chunks) · status ${health.status}${RESET}\n`);
if (!corpus?.count) {
  console.error(`${RED}✖ The corpus is empty. Run \`npm run seed\` first.${RESET}\n`);
  process.exit(1);
}

const cases = only ? DEMO_CASES.filter((c) => only.includes(c.id)) : DEMO_CASES;
const rows = [];

for (const testCase of cases) {
  process.stdout.write(`${BOLD}${testCase.id}${RESET} ${DIM}${testCase.claim.slice(0, 78)}…${RESET}\n`);
  const started = Date.now();
  let job;
  try {
    const { job_id } = await post('/api/verify', { text: testCase.claim });
    job = await waitFor(job_id);
  } catch (err) {
    rows.push({ id: testCase.id, ok: false, label: '—', failures: [err.message], ms: Date.now() - started });
    console.log(`   ${RED}✖ ${err.message}${RESET}\n`);
    continue;
  }

  const failures = check(testCase, job);
  const ok = failures.length === 0;
  const label = job.result?.label ?? `(${job.status})`;
  const rules = (job.result?.sub_claims ?? []).map((s) => s.rule_id).join(',') || '—';
  const verified = (job.result?.sub_claims ?? []).flatMap((s) => s.evidence).filter((x) => x.citation.status === 'verified').length;
  const webUsed = (job.result?.sub_claims ?? []).some((s) => s.retrieval?.web_used);

  rows.push({ id: testCase.id, ok, label, rules, failures, ms: Date.now() - started, events: job.trace.length, verified, webUsed, jobId: job.id });

  console.log(`   ${ok ? `${GREEN}✔ PASS${RESET}` : `${RED}✖ FAIL${RESET}`}  ${label}  ${DIM}rule ${rules} · ${verified} verified citation(s) · ${job.trace.length} events · ${((Date.now() - started) / 1000).toFixed(1)}s${webUsed ? ' · live search used' : ''}${RESET}`);
  for (const f of failures) console.log(`     ${RED}→ ${f}${RESET}`);
  console.log(`     ${DIM}${testCase.why}${RESET}\n`);
}

// ── summary ──────────────────────────────────────────────────────────────
const pass = rows.filter((r) => r.ok).length;
console.log(`${BOLD}────────────────────────────────────────────────────────────${RESET}`);
console.log(`${BOLD}case  expected                verdict                 rule   result${RESET}`);
for (const r of rows) {
  const expected = DEMO_CASES.find((c) => c.id === r.id).expect.label;
  console.log(
    `${r.id.padEnd(6)}${expected.padEnd(24)}${String(r.label).padEnd(24)}${String(r.rules).padEnd(7)}`
    + `${r.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}`,
  );
}
const totalMs = rows.reduce((a, r) => a + r.ms, 0);
console.log(`${BOLD}────────────────────────────────────────────────────────────${RESET}`);
console.log(`${pass === rows.length ? GREEN : YELLOW}${pass}/${rows.length} passed${RESET} in ${(totalMs / 1000).toFixed(1)}s total`);
console.log(`${DIM}Job ids for the trace viewer: ${rows.map((r) => r.jobId).filter(Boolean).join(', ')}${RESET}\n`);

process.exit(pass === rows.length ? 0 : 1);
