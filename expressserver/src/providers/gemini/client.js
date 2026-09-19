/**
 * GoogleGenAI singleton plus the retry/backoff wrapper every call goes
 * through.
 *
 * The SDK exposes exactly one error class, `ApiError`, carrying `.status`.
 * Its `.message` is the JSON-stringified `{"error":{...}}` envelope, so we
 * unwrap it for logging. 429 (RESOURCE_EXHAUSTED) and 5xx are retried with
 * exponential backoff and jitter; 400/403 never are — those are our bug,
 * not a transient condition.
 */
import { GoogleGenAI, ApiError } from '@google/genai';
import { config } from '../../config/index.js';
import { logger } from '../../util/logger.js';
import { sleep } from '../../util/time.js';
import { upstream, unavailable, AppError } from '../../util/errors.js';

const log = logger('gemini');

let ai = null;

export function hasApiKey() {
  return Boolean(config.gemini.apiKey);
}

export function getGenAI() {
  if (!hasApiKey()) {
    throw unavailable(
      'GEMINI_API_KEY is not set. Add it to expressserver/.env and restart.',
      { hint: 'https://aistudio.google.com/apikey' },
    );
  }
  if (!ai) ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return ai;
}

/** Pull the human-readable message out of the SDK's stringified envelope. */
export function describeApiError(err) {
  if (!(err instanceof ApiError)) return err?.message ?? String(err);
  try {
    const parsed = JSON.parse(err.message);
    return parsed?.error?.message ?? err.message;
  } catch { return err.message; }
}

const RETRYABLE = (status) => status === 429 || (status >= 500 && status < 600);

/**
 * Run `fn` with backoff. `label` is used in logs and trace events.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export async function withRetry(fn, { label = 'gemini', maxRetries = config.gemini.maxRetries } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === undefined || !RETRYABLE(status) || attempt === maxRetries) break;
      const base = config.gemini.retryBaseMs * 2 ** attempt;
      const wait = Math.round(base + Math.random() * base * 0.3);
      log.warn(`${label}: ${status} — retry ${attempt + 1}/${maxRetries} in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw toAppError(lastErr, label);
}

export function toAppError(err, label = 'gemini') {
  if (err instanceof AppError) return err;
  if (err instanceof ApiError) {
    const msg = describeApiError(err);
    if (err.status === 429) {
      return new AppError(`Gemini quota or rate limit reached (${label}).`, {
        status: 429, code: 'gemini_rate_limited', detail: msg, cause: err,
      });
    }
    if (err.status === 400 || err.status === 403) {
      return new AppError(`Gemini rejected the request (${label}): ${msg}`, {
        status: 502, code: 'gemini_bad_request', detail: msg, cause: err,
      });
    }
    return upstream(`Gemini error ${err.status} (${label}): ${msg}`, msg);
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return upstream(`Gemini call timed out (${label})`, err.message);
  }
  return upstream(`Gemini call failed (${label}): ${err?.message ?? String(err)}`);
}

/** Raw ListModels, used by config/models.js and /api/health. */
export async function listModels() {
  const genai = getGenAI();
  const out = [];
  const pager = await genai.models.list({ config: { queryBase: true, pageSize: 100 } });
  for await (const m of pager) {
    out.push({
      name: String(m.name ?? '').replace(/^models\//, ''),
      displayName: m.displayName ?? '',
      inputTokenLimit: m.inputTokenLimit ?? null,
      outputTokenLimit: m.outputTokenLimit ?? null,
      methods: m.supportedGenerationMethods ?? m.supportedActions ?? [],
    });
  }
  return out;
}

export { ApiError };
