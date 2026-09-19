/**
 * API monitoring: an in-process ring buffer of every request, plus rolling
 * latency/status metrics. This is what the dashboard's Requests view and the
 * Overview tiles read.
 *
 * Bodies are captured but capped and redacted — an inline base64 image on
 * POST /api/verify would otherwise put megabytes into the ring, and the
 * dashboard token must never appear in a log the dashboard itself renders.
 */
import { config } from '../config/index.js';
import { newRequestId } from '../util/ids.js';

const MAX_BODY_CAPTURE = 4000;
const REDACT_HEADERS = new Set(['authorization', 'x-dashboard-token', 'cookie', 'x-goog-api-key']);
const REDACT_KEYS = /^(api[_-]?key|token|secret|password|authorization)$/i;

const ring = [];
let seq = 0;

function pushEntry(entry) {
  ring.push(entry);
  while (ring.length > config.server.requestMonitorRing) ring.shift();
}

function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? '••••••••' : v;
  }
  return out;
}

function summariseBody(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') {
    return { kind: 'text', preview: body.slice(0, MAX_BODY_CAPTURE), truncated: body.length > MAX_BODY_CAPTURE, bytes: Buffer.byteLength(body) };
  }
  if (Buffer.isBuffer(body)) return { kind: 'binary', bytes: body.length };
  try {
    const clone = JSON.parse(JSON.stringify(body, (k, v) => {
      if (REDACT_KEYS.test(k)) return '••••••••';
      // A base64 image field is data, not something to mirror into the ring.
      if (typeof v === 'string' && v.length > MAX_BODY_CAPTURE) {
        return `[${v.length} chars elided]`;
      }
      return v;
    }));
    const text = JSON.stringify(clone);
    return { kind: 'json', json: clone, bytes: Buffer.byteLength(text), truncated: false };
  } catch {
    return { kind: 'unserializable' };
  }
}

/** Express middleware. Mount before the routes. */
export function requestMonitor() {
  return (req, res, next) => {
    // SSE streams stay open for the life of a job; timing them as one
    // request would poison the latency percentiles.
    const isStream = req.path.endsWith('/events');
    const id = newRequestId();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);

    const startedAt = Date.now();
    const startHr = process.hrtime.bigint();

    let responseBody;
    if (!isStream) {
      const originalJson = res.json.bind(res);
      res.json = (body) => { responseBody = body; return originalJson(body); };
    }

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6;
      pushEntry({
        seq: ++seq,
        id,
        ts: new Date(startedAt).toISOString(),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        query: req.query && Object.keys(req.query).length ? req.query : null,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        stream: isStream,
        requestHeaders: redactHeaders(req.headers),
        requestBody: isStream ? null : summariseBody(req.body),
        responseBody: isStream ? null : summariseBody(responseBody),
        responseBytes: Number(res.getHeader('content-length')) || null,
        jobId: res.getHeader('X-Job-Id') || null,
        error: res.locals?.errorCode ?? null,
      });
    });

    next();
  };
}

export function listRequests({ limit = 100, since = 0, path: pathFilter, status } = {}) {
  let items = ring.filter((e) => e.seq > since);
  if (pathFilter) items = items.filter((e) => e.path.includes(pathFilter));
  if (status) {
    const bucket = Number(String(status)[0]);
    items = items.filter((e) => Math.floor(e.status / 100) === bucket);
  }
  return { total: ring.length, latestSeq: seq, items: items.slice(-limit).reverse() };
}

export function getRequest(id) {
  return ring.find((e) => e.id === id) ?? null;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
}

/** Rolling metrics over the ring. `windowMs` narrows it to recent traffic. */
export function metricsSnapshot({ windowMs = 0 } = {}) {
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const items = ring.filter((e) => !e.stream && (!cutoff || Date.parse(e.ts) >= cutoff));
  const durations = items.map((e) => e.durationMs).sort((a, b) => a - b);
  const byStatus = {};
  const byPath = {};
  for (const e of items) {
    const bucket = `${Math.floor(e.status / 100)}xx`;
    byStatus[bucket] = (byStatus[bucket] ?? 0) + 1;
    const key = `${e.method} ${e.path}`;
    const p = byPath[key] ?? (byPath[key] = { key, count: 0, errors: 0, totalMs: 0, maxMs: 0 });
    p.count++;
    p.totalMs += e.durationMs;
    p.maxMs = Math.max(p.maxMs, e.durationMs);
    if (e.status >= 400) p.errors++;
  }
  const errors = items.filter((e) => e.status >= 400).length;
  return {
    windowMs,
    ringSize: config.server.requestMonitorRing,
    count: items.length,
    errors,
    errorRate: items.length ? errors / items.length : 0,
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations.length ? Math.round(durations[durations.length - 1] * 100) / 100 : 0,
      avg: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100 : 0,
    },
    byStatus,
    byPath: Object.values(byPath)
      .map((p) => ({ ...p, avgMs: Math.round((p.totalMs / p.count) * 100) / 100 }))
      .sort((a, b) => b.count - a.count),
  };
}

export function resetMonitor() { ring.length = 0; seq = 0; }
