/**
 * The verification API.
 *
 * A verification takes 30–90 seconds and an MV3 service worker dies after 30
 * seconds idle — and on any `fetch` that waits more than 30 seconds for a
 * response. So the API is job-based: create, then poll. The side panel (a
 * real document with a real lifetime) does the polling; the service worker
 * never does. That is the mitigation for risk R8.
 *
 * Polling and SSE read the SAME event array on the job record, so neither is
 * a special case: `?since=N` reads it directly, and the SSE endpoint
 * subscribes to the emitter that appends to it.
 */
import { Router } from 'express';
import multer from 'multer';
import {
  createJob, getJob, updateJob, listJobs, summariseJob,
  eventsSince, subscribe, requestCancel,
} from '../jobs/jobStore.js';
import { enqueue } from '../jobs/jobRunner.js';
import { summariseEvents } from '../jobs/trace.js';
import { listRuns, loadRun } from '../jobs/runLog.js';
import { config } from '../config/index.js';
import { asyncRoute, badRequest, notFound, conflict, payloadTooLarge } from '../util/errors.js';

export const verifyRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.claims.fileMaxBytes, files: 1 },
});

function projectJob(job, { since = 0, summary = false } = {}) {
  const events = eventsSince(job.id, since);
  return {
    ...summariseJob(job),
    input: { kind: job.input?.kind, sourceUrl: job.input?.sourceUrl ?? null, text: job.input?.text ?? null },
    transcription: job.transcription,
    result: job.result,
    latestSeq: job.latestSeq,
    timings: job.timings,
    trace: summary ? summariseEvents(events) : events,
  };
}

// ── create ───────────────────────────────────────────────────────────────

verifyRouter.post('/verify', upload.single('image'), asyncRoute(async (req, res) => {
  // Replay: re-serve a stored run with its original trace and timings.
  // Removes quota exhaustion, rate limits and Wi-Fi from demo-day risk.
  const replayId = req.query.replay ? String(req.query.replay) : null;
  if (replayId) {
    if (!config.jobs.replayEnabled) throw badRequest('Replay is disabled (REPLAY_ENABLED=false).');
    const stored = loadRun(replayId);
    if (!stored) throw notFound(`No stored run "${replayId}"`);
    const job = createJob({ kind: stored.input?.kind ?? 'text', text: stored.input?.text ?? '', sourceUrl: stored.input?.sourceUrl ?? null });
    updateJob(job.id, {
      status: stored.status,
      result: stored.result ? { ...stored.result, replay: true } : null,
      error: stored.error,
      trace: stored.trace ?? [],
      latestSeq: stored.trace?.length ?? 0,
      usage: stored.usage ?? job.usage,
      timings: stored.timings ?? {},
      replay: true,
      confirmedText: stored.input?.text ?? '',
    });
    res.setHeader('X-Job-Id', job.id);
    return res.status(202).json(created(job, req, { replayOf: replayId }));
  }

  let input;
  if (req.file) {
    if (req.file.size > config.claims.imageMaxBytes) {
      throw payloadTooLarge(`Image is ${(req.file.size / 1e6).toFixed(1)} MB; the limit is ${(config.claims.imageMaxBytes / 1e6).toFixed(0)} MB.`);
    }
    if (!config.claims.allowedMime.includes(req.file.mimetype)) {
      throw badRequest(`Unsupported file type "${req.file.mimetype}". Allowed: ${config.claims.allowedMime.join(', ')}`);
    }
    input = {
      kind: 'image',
      mimeType: req.file.mimetype,
      base64: req.file.buffer.toString('base64'),
      filename: req.file.originalname,
      sourceUrl: req.body?.sourceUrl || null,
    };
  } else if (req.body?.image_base64) {
    input = {
      kind: 'image',
      mimeType: req.body.mimeType || 'image/png',
      // Tolerate a data: URL prefix; the API wants a bare base64 payload.
      base64: String(req.body.image_base64).replace(/^data:[^;]+;base64,/, ''),
      sourceUrl: req.body?.sourceUrl || null,
    };
  } else if (req.body?.text) {
    const text = String(req.body.text).trim();
    if (!text) throw badRequest('`text` was empty.');
    if (text.length > 20000) throw badRequest(`Text is ${text.length} characters; the limit is 20000.`);
    input = { kind: 'text', text, sourceUrl: req.body?.sourceUrl || null };
  } else {
    throw badRequest('Provide `text`, an `image` file upload, or `image_base64`.');
  }

  const job = createJob(input);
  enqueue(job.id);
  res.setHeader('X-Job-Id', job.id);
  return res.status(202).json(created(job, req));
}));

function created(job, req, extra = {}) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    job_id: job.id,
    status: job.status,
    poll_url: `${base}/api/verify/${job.id}`,
    events_url: `${base}/api/verify/${job.id}/events`,
    ...extra,
  };
}

// ── read ─────────────────────────────────────────────────────────────────

verifyRouter.get('/verify', asyncRoute(async (req, res) => {
  res.json({ jobs: listJobs({ limit: Math.min(Number(req.query.limit) || 50, 200), status: req.query.status }) });
}));

verifyRouter.get('/verify/:jobId', asyncRoute(async (req, res, next) => {
  const job = getJob(req.params.jobId);
  if (!job) return next(notFound(`No job "${req.params.jobId}". Jobs are held in memory and expire after ${Math.round(config.jobs.ttlMs / 60000)} minutes.`));
  return res.json(projectJob(job, {
    since: Number(req.query.since) || 0,
    summary: req.query.fields === 'summary',
  }));
}));

verifyRouter.get('/verify/:jobId/events', (req, res, next) => {
  if (!config.jobs.sseEnabled) return next(badRequest('SSE is disabled (TRACE_SSE_ENABLED=false).'));
  const job = getJob(req.params.jobId);
  if (!job) return next(notFound(`No job "${req.params.jobId}"`));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, name = 'trace') => {
    res.write(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // Everything so far, then live.
  for (const e of eventsSince(job.id, Number(req.query.since) || 0)) send(e);
  if (['done', 'failed', 'cancelled'].includes(job.status)) {
    send({ status: job.status, result: job.result, error: job.error }, 'end');
    return res.end();
  }

  const unsubscribe = subscribe(job.id, (event) => {
    send(event);
    const current = getJob(job.id);
    if (current && ['done', 'failed', 'cancelled'].includes(current.status)) {
      send({ status: current.status, result: current.result, error: current.error }, 'end');
      cleanup();
      res.end();
    }
  });

  // Comment heartbeat so an intermediate proxy does not idle-close the stream.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), config.jobs.sseHeartbeatMs);
  const cleanup = () => { clearInterval(heartbeat); unsubscribe(); };
  req.on('close', cleanup);
  return undefined;
});

// ── control ──────────────────────────────────────────────────────────────

verifyRouter.post('/verify/:jobId/confirm', asyncRoute(async (req, res, next) => {
  const job = getJob(req.params.jobId);
  if (!job) return next(notFound(`No job "${req.params.jobId}"`));
  if (job.status !== 'awaiting_confirmation') {
    return next(conflict(`Job is "${job.status}", not awaiting confirmation.`));
  }
  const corrected = String(req.body?.corrected_text ?? '').trim();
  if (!corrected) return next(badRequest('`corrected_text` was empty.'));

  updateJob(job.id, { confirmedText: corrected, status: 'queued' });
  enqueue(job.id);
  return res.json({ job_id: job.id, status: 'queued' });
}));

verifyRouter.post('/verify/:jobId/cancel', asyncRoute(async (req, res, next) => {
  const job = requestCancel(req.params.jobId);
  if (!job) return next(notFound(`No job "${req.params.jobId}"`));
  return res.json({ job_id: job.id, status: job.status, cancelRequested: job.cancelRequested });
}));

// ── run log ──────────────────────────────────────────────────────────────

verifyRouter.get('/runs', asyncRoute(async (req, res) => {
  res.json({
    replayEnabled: config.jobs.replayEnabled,
    runs: listRuns({ limit: Math.min(Number(req.query.limit) || 50, 200) }),
  });
}));

verifyRouter.get('/runs/:id', asyncRoute(async (req, res, next) => {
  const run = loadRun(req.params.id);
  if (!run) return next(notFound(`No stored run "${req.params.id}"`));
  return res.json(run);
}));
