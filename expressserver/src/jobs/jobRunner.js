/**
 * Job queue. Runs at most JOB_CONCURRENCY pipelines at once so a burst from
 * the API tester cannot exhaust the Gemini quota in one second.
 */
import { runPipeline } from '../pipeline/pipeline.js';
import { createEmitter } from './trace.js';
import { getJob, updateJob, isCancelled } from './jobStore.js';
import { recordRun } from './runLog.js';
import { config } from '../config/index.js';
import { logger } from '../util/logger.js';
import { AppError } from '../util/errors.js';

const log = logger('runner');

const queue = [];
let active = 0;

export function enqueue(jobId) {
  queue.push(jobId);
  pump();
}

function pump() {
  while (active < config.jobs.concurrency && queue.length > 0) {
    const jobId = queue.shift();
    active++;
    execute(jobId).finally(() => { active--; pump(); });
  }
}

async function execute(jobId) {
  const job = getJob(jobId);
  if (!job) return;
  if (job.cancelRequested) { updateJob(jobId, { status: 'cancelled' }); return; }

  updateJob(jobId, { status: 'running' });
  const emit = createEmitter(jobId);

  try {
    const outcome = await runPipeline({
      job,
      emit,
      cancelled: () => isCancelled(jobId),
      onProgress: (patch) => updateJob(jobId, patch),
    });

    if (outcome.paused) return;                     // awaiting_confirmation
    if (outcome.cancelled) {
      updateJob(jobId, { status: 'cancelled' });
      emit({ stage: 'assembly', type: 'progress', label: 'Cancelled' });
      return;
    }

    updateJob(jobId, { status: 'done', result: outcome.result, timings: outcome.timings });
    recordRun(getJob(jobId));
  } catch (err) {
    const isApp = err instanceof AppError;
    log.error(`job ${jobId} failed: ${err.message}`);
    updateJob(jobId, {
      status: 'failed',
      error: {
        code: isApp ? err.code : 'internal_error',
        message: err.message,
        ...(isApp && err.detail ? { detail: err.detail } : {}),
      },
    });
    recordRun(getJob(jobId));
  }
}

export function queueStats() { return { queued: queue.length, active, concurrency: config.jobs.concurrency }; }
