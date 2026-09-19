/**
 * In-memory job store: a Map plus an insertion-ordered ring, with a TTL
 * sweeper.
 *
 * This is a PoC limitation and the report should say so plainly rather than
 * dress it up: single process, no clustering, history lost on restart,
 * unsuitable for production. Sizing: a finished job holds ~40 trace events,
 * up to 6 evidence passages (~1.2 KB each), the verdict object and the
 * result — call it ~60 KB generously, so 200 jobs is roughly 12 MB, which is
 * negligible against Node's default heap.
 *
 * The durable counterpart is `runLog.js`, which appends every finished job
 * to JSONL. That is what satisfies FR20 and seeds the Phase 3 benchmark.
 */
import { config } from '../config/index.js';
import { newJobId } from '../util/ids.js';
import { logger } from '../util/logger.js';

const log = logger('jobs');

/** @type {Map<string, object>} */
const jobs = new Map();
const ring = [];
const subscribers = new Map(); // jobId -> Set<(event)=>void>

export const JOB_STATES = ['queued', 'running', 'awaiting_confirmation', 'done', 'failed', 'cancelled'];
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export function createJob(input) {
  const id = newJobId();
  const now = new Date().toISOString();
  const job = {
    id,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    input,
    transcription: null,
    confirmedText: null,
    result: null,
    error: null,
    trace: [],
    latestSeq: 0,
    usage: { calls: 0, promptTokens: 0, outputTokens: 0, costUsd: 0 },
    timings: {},
    cancelRequested: false,
    replay: false,
  };
  jobs.set(id, job);
  ring.push(id);
  while (ring.length > config.jobs.ringSize) {
    const evicted = ring.shift();
    jobs.delete(evicted);
    subscribers.delete(evicted);
  }
  return job;
}

export function getJob(id) { return jobs.get(id) ?? null; }

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

export function listJobs({ limit = 50, status } = {}) {
  const out = [];
  for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
    const job = jobs.get(ring[i]);
    if (!job) continue;
    if (status && job.status !== status) continue;
    out.push(summariseJob(job));
  }
  return out;
}

export function summariseJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    kind: job.input?.kind ?? 'text',
    preview: (job.confirmedText ?? job.input?.text ?? '').slice(0, 140),
    label: job.result?.label ?? null,
    replay: job.replay,
    events: job.trace.length,
    usage: job.usage,
    error: job.error,
  };
}

export function requestCancel(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (TERMINAL.has(job.status)) return job;
  job.cancelRequested = true;
  return job;
}

export function isCancelled(id) { return jobs.get(id)?.cancelRequested === true; }

// ── trace events ─────────────────────────────────────────────────────────

export function appendEvent(jobId, event) {
  const job = jobs.get(jobId);
  if (!job) return null;
  const full = { ...event, seq: ++job.latestSeq, job_id: jobId, ts: new Date().toISOString() };
  job.trace.push(full);
  job.updatedAt = full.ts;
  for (const fn of subscribers.get(jobId) ?? []) {
    try { fn(full); } catch (err) { log.warn(`subscriber threw: ${err.message}`); }
  }
  return full;
}

export function eventsSince(jobId, since = 0) {
  const job = jobs.get(jobId);
  if (!job) return [];
  return job.trace.filter((e) => e.seq > since);
}

export function subscribe(jobId, fn) {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId).add(fn);
  return () => subscribers.get(jobId)?.delete(fn);
}

// ── sweeper ──────────────────────────────────────────────────────────────

let sweeper = null;

export function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const cutoff = Date.now() - config.jobs.ttlMs;
    const confirmCutoff = Date.now() - config.jobs.confirmTimeoutMs;
    for (const [id, job] of jobs) {
      // An abandoned confirmation must not pin memory forever.
      if (job.status === 'awaiting_confirmation' && Date.parse(job.updatedAt) < confirmCutoff) {
        job.status = 'failed';
        job.error = { code: 'confirmation_timeout', message: 'The extracted text was never confirmed.' };
      }
      if (Date.parse(job.updatedAt) < cutoff) {
        jobs.delete(id);
        subscribers.delete(id);
        const at = ring.indexOf(id);
        if (at >= 0) ring.splice(at, 1);
      }
    }
  }, 60_000);
  sweeper.unref();
}

export function stopSweeper() { if (sweeper) { clearInterval(sweeper); sweeper = null; } }

export function jobStats() {
  const byStatus = {};
  for (const job of jobs.values()) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
  return { held: jobs.size, ringSize: config.jobs.ringSize, byStatus };
}
