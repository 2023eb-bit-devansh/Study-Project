/**
 * Append every finished job to `data/runs/YYYY-MM-DD.jsonl`.
 *
 * This is the durable half of the job model (FR20 — "record request and
 * evaluation information required for later benchmark testing and
 * debugging"), and it is what the Phase 3 benchmark will be built from. It
 * also backs replay: re-serving a stored run with its original trace removes
 * quota exhaustion, rate limits and Wi-Fi from demo-day risk for about
 * thirty lines of code.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../util/logger.js';

const log = logger('runlog');

function fileFor(date = new Date()) {
  return path.join(config.jobs.runLogDir, `${date.toISOString().slice(0, 10)}.jsonl`);
}

export function recordRun(job) {
  if (!config.jobs.runLogEnabled || job.replay) return;
  try {
    mkdirSync(config.jobs.runLogDir, { recursive: true });
    const record = {
      id: job.id,
      recordedAt: new Date().toISOString(),
      createdAt: job.createdAt,
      status: job.status,
      input: { kind: job.input?.kind, text: job.confirmedText ?? job.input?.text ?? '', sourceUrl: job.input?.sourceUrl ?? null },
      result: job.result,
      error: job.error,
      usage: job.usage,
      timings: job.timings,
      trace: job.trace,
    };
    appendFileSync(fileFor(), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    log.warn(`could not write run log: ${err.message}`);
  }
}

/** Most recent runs across the JSONL files, newest first. */
export function listRuns({ limit = 50 } = {}) {
  if (!existsSync(config.jobs.runLogDir)) return [];
  const files = readdirSync(config.jobs.runLogDir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
  const out = [];
  for (const file of files) {
    const lines = readFileSync(path.join(config.jobs.runLogDir, file), 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const r = JSON.parse(lines[i]);
        out.push({
          id: r.id,
          recordedAt: r.recordedAt,
          status: r.status,
          kind: r.input?.kind,
          preview: (r.input?.text ?? '').slice(0, 140),
          label: r.result?.label ?? null,
          usage: r.usage,
          events: r.trace?.length ?? 0,
        });
      } catch { /* a partial final line is expected while appending */ }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Load one stored run in full, for replay. */
export function loadRun(id) {
  if (!existsSync(config.jobs.runLogDir)) return null;
  const files = readdirSync(config.jobs.runLogDir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
  for (const file of files) {
    const lines = readFileSync(path.join(config.jobs.runLogDir, file), 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i]);
        if (r.id === id) return r;
      } catch { /* ignore */ }
    }
  }
  return null;
}
