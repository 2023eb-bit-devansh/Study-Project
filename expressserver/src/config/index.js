/**
 * THE config object.
 *
 * This is the only module in `src/` permitted to read `process.env`.
 * It parses and validates every key declared in `schema.js`, applies
 * clamps that other code relies on for safety, and freezes the result.
 *
 * Import it as `import { config } from '../config/index.js'`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { SCHEMA, GROUP_ORDER } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

function parseValue(key, spec, raw) {
  if (raw === undefined || raw === '') return spec.def;
  const s = String(raw).trim();
  switch (spec.type) {
    case 'string': return s;
    case 'csv':    return s.split(',').map((v) => v.trim()).filter(Boolean);
    case 'bool': {
      const l = s.toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(l)) return true;
      if (['0', 'false', 'no', 'off'].includes(l)) return false;
      throw new ConfigError(`${key}: expected a boolean, got "${s}"`);
    }
    case 'int': {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new ConfigError(`${key}: expected an integer, got "${s}"`);
      return n;
    }
    case 'float': {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new ConfigError(`${key}: expected a number, got "${s}"`);
      return n;
    }
    case 'enum':
      if (!spec.values.includes(s)) {
        throw new ConfigError(`${key}: expected one of ${spec.values.join(' | ')}, got "${s}"`);
      }
      return s;
    default:
      throw new ConfigError(`${key}: unknown schema type "${spec.type}"`);
  }
}

/** Raw, validated key→value map. Exposed for the Config dashboard view. */
export const env = {};
/** Per-key metadata (group, type, whether it is a secret) for the dashboard. */
export const envMeta = {};

for (const [key, spec] of Object.entries(SCHEMA)) {
  let value = parseValue(key, spec, process.env[key]);

  if (typeof value === 'number') {
    if (spec.min !== undefined && value < spec.min) {
      throw new ConfigError(`${key}: ${value} is below the minimum ${spec.min}`);
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new ConfigError(`${key}: ${value} is above the maximum ${spec.max}`);
    }
    // A hard clamp the rest of the code depends on for a safety property.
    // CITATION_MAX_RETRIES is clamped here so that no value in .env can turn
    // the single citation re-request into a loop.
    if (spec.clampMax !== undefined) value = Math.min(value, spec.clampMax);
  }

  env[key] = value;
  envMeta[key] = { group: spec.group, type: spec.type, secret: !!spec.secret, default: spec.def };
}

const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

/** Structured, frozen view. This is what application code reads. */
export const config = Object.freeze({
  root: ROOT,
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',

  server: Object.freeze({
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    corsOrigins: Object.freeze(env.CORS_ALLOWED_ORIGINS),
    maxBodyMb: env.REQUEST_MAX_BODY_MB,
    dashboardEnabled: env.DASHBOARD_ENABLED,
    dashboardToken: env.DASHBOARD_TOKEN,
    requestMonitorRing: env.REQUEST_MONITOR_RING,
  }),

  gemini: Object.freeze({
    apiKey: env.GEMINI_API_KEY,
    // Requested ids. `config/models.js` resolves these against ListModels at
    // boot and publishes the resolved ids on `config.resolvedModels`.
    requested: Object.freeze({
      extraction: env.GEMINI_MODEL_EXTRACTION,
      vision:     env.GEMINI_MODEL_VISION,
      retrieval:  env.GEMINI_MODEL_RETRIEVAL,
      verdict:    env.GEMINI_MODEL_VERDICT,
      grounding:  env.GEMINI_MODEL_GROUNDING,
      embed:      env.GEMINI_EMBED_MODEL,
    }),
    validateAtBoot: env.GEMINI_MODEL_VALIDATE_AT_BOOT,
    embedDim: env.GEMINI_EMBED_DIM,
    embedBatch: env.GEMINI_EMBED_BATCH,
    embedNormalize: env.GEMINI_EMBED_NORMALIZE,
    taskTypeDoc: env.GEMINI_EMBED_TASKTYPE_DOC,
    taskTypeQuery: env.GEMINI_EMBED_TASKTYPE_QUERY,
    tempExtraction: env.GEMINI_TEMPERATURE_EXTRACTION,
    tempVerdict: env.GEMINI_TEMPERATURE_VERDICT,
    tempRefiner: env.GEMINI_TEMPERATURE_REFINER,
    maxOutputTokensVerdict: env.GEMINI_MAX_OUTPUT_TOKENS_VERDICT,
    timeoutMs: env.GEMINI_TIMEOUT_MS,
    maxRetries: env.GEMINI_MAX_RETRIES,
    retryBaseMs: env.GEMINI_RETRY_BASE_MS,
  }),

  chroma: Object.freeze({
    host: env.CHROMA_HOST,
    port: env.CHROMA_PORT,
    ssl: env.CHROMA_SSL,
    tenant: env.CHROMA_TENANT,
    database: env.CHROMA_DATABASE,
    collection: env.CHROMA_COLLECTION,
    space: env.CHROMA_HNSW_SPACE,
    addBatch: env.CHROMA_ADD_BATCH,
    regexSelftest: env.CHROMA_REGEX_SELFTEST,
  }),

  corpus: Object.freeze({
    seedDir: abs(env.CORPUS_SEED_DIR),
    sourceTextDir: abs(env.SOURCE_TEXT_DIR),
    chunkMaxChars: env.CHUNK_MAX_CHARS,
    chunkMinChars: env.CHUNK_MIN_CHARS,
    overlapStatute: env.CHUNK_OVERLAP_CHARS_STATUTE,
    overlapJudgment: env.CHUNK_OVERLAP_CHARS_JUDGMENT,
  }),

  retrieval: Object.freeze({
    mode: env.RETRIEVAL_MODE,
    maxTurns: env.RETRIEVAL_MAX_TURNS,
    maxToolCalls: env.RETRIEVAL_MAX_TOOL_CALLS,
    maxLlmCalls: env.RETRIEVAL_MAX_LLM_CALLS,
    maxEvidenceChars: env.RETRIEVAL_MAX_EVIDENCE_CHARS,
    deadlineMs: env.RETRIEVAL_DEADLINE_MS,
    topK: env.RETRIEVAL_TOP_K,
    candidatePool: env.RETRIEVAL_CANDIDATE_POOL,
    finalK: env.RETRIEVAL_FINAL_K,
    neighbourWindow: env.RETRIEVAL_NEIGHBOUR_WINDOW,
    snippetChars: env.TOOL_SNIPPET_CHARS,
    readPassageMaxChars: env.READ_PASSAGE_MAX_CHARS,
  }),

  ranking: Object.freeze({
    wDense: env.RANK_W_DENSE,
    wRef: env.RANK_W_REF,
    wExact: env.RANK_W_EXACT,
    penaltyWeb: env.RANK_PENALTY_WEB,
    penaltyNeighbour: env.RANK_PENALTY_NEIGHBOUR,
    nearDupJaccard: env.RANK_NEAR_DUP_JACCARD,
  }),

  sufficiency: Object.freeze({
    minTermCoverage: env.SUFFICIENCY_MIN_TERM_COVERAGE,
    minTopScore: env.SUFFICIENCY_MIN_TOP_SCORE,
    minChunkScore: env.SUFFICIENCY_MIN_CHUNK_SCORE,
    minChunks: env.SUFFICIENCY_MIN_CHUNKS,
    // A fact checker never concludes on its first search: the loop may not
    // report `sufficient` before the counter-evidence turn has run.
    minTurns: env.SUFFICIENCY_MIN_TURNS,
  }),

  web: Object.freeze({
    enabled: env.LIVE_SEARCH_ENABLED,
    minCorpusTurns: env.WEB_MIN_CORPUS_TURNS,
    escalateMaxTopScore: env.WEB_ESCALATE_MAX_TOP_SCORE,
    maxCalls: env.WEB_MAX_CALLS,
    fetchTimeoutMs: env.WEB_FETCH_TIMEOUT_MS,
    fetchMaxBytes: env.WEB_FETCH_MAX_BYTES,
    allowUnfetchable: env.WEB_ALLOW_UNFETCHABLE_AS_EVIDENCE,
  }),

  claims: Object.freeze({
    maxSubclaims: env.MAX_SUBCLAIMS,
    imageConfirmRequired: env.IMAGE_CONFIRM_REQUIRED,
    imageMaxBytes: env.IMAGE_MAX_BYTES,
    fileMaxBytes: env.FILE_MAX_BYTES,
    allowedMime: Object.freeze(env.FILE_ALLOWED_MIME),
  }),

  citation: Object.freeze({
    fuzzyVerify: env.CITATION_FUZZY_VERIFY,
    fuzzyPartial: env.CITATION_FUZZY_PARTIAL,
    jaccardPrefilter: env.CITATION_JACCARD_PREFILTER,
    minQuoteChars: env.CITATION_MIN_QUOTE_CHARS,
    maxQuoteChars: env.CITATION_MAX_QUOTE_CHARS,
    windowSlack: env.CITATION_WINDOW_SLACK,
    maxRetries: env.CITATION_MAX_RETRIES, // clamped to <= 1 above
    numberGuard: env.CITATION_NUMBER_GUARD,
    negationGuard: env.CITATION_NEGATION_GUARD,
  }),

  verdict: Object.freeze({
    weightVerified: env.VERDICT_WEIGHT_VERIFIED,
    weightPartial: env.VERDICT_WEIGHT_PARTIAL,
    minEvidence: env.VERDICT_MIN_EVIDENCE,
    coverageFull: env.VERDICT_COVERAGE_FULL,
    requireMissingConditionQuote: env.VERDICT_REQUIRE_MISSING_CONDITION_QUOTE,
    aggregationMode: env.AGGREGATION_MODE,
  }),

  jobs: Object.freeze({
    ringSize: env.JOB_RING_SIZE,
    ttlMs: env.JOB_TTL_MS,
    confirmTimeoutMs: env.JOB_CONFIRM_TIMEOUT_MS,
    concurrency: env.JOB_CONCURRENCY,
    traceMaxDetailChars: env.TRACE_MAX_DETAIL_CHARS,
    sseEnabled: env.TRACE_SSE_ENABLED,
    sseHeartbeatMs: env.TRACE_SSE_HEARTBEAT_MS,
    runLogEnabled: env.RUN_LOG_ENABLED,
    runLogDir: abs(env.RUN_LOG_DIR),
    replayEnabled: env.REPLAY_ENABLED,
  }),
});

/**
 * Boot-resolved Gemini model ids, filled in by `config/models.js`.
 * Kept mutable-by-one-writer rather than frozen into `config` because it is
 * only knowable after an async ListModels call.
 */
export const resolvedModels = {
  extraction: null, vision: null, retrieval: null,
  verdict: null, grounding: null, embed: null,
  source: 'unresolved', // 'env' | 'listmodels' | 'fallback' | 'unresolved'
  available: [],
};

/** Redacted snapshot for `GET /api/config`. Never leaks a secret. */
export function redactedConfig() {
  const groups = {};
  for (const g of GROUP_ORDER) groups[g] = {};
  for (const [key, meta] of Object.entries(envMeta)) {
    const value = env[key];
    groups[meta.group][key] = {
      value: meta.secret ? (value ? '••••••••' : '(not set)') : value,
      type: meta.type,
      isDefault: JSON.stringify(value) === JSON.stringify(
        meta.type === 'csv' && typeof meta.default === 'string'
          ? meta.default.split(',').map((v) => v.trim()).filter(Boolean)
          : meta.default,
      ),
      secret: meta.secret,
    };
  }
  return { groups, groupOrder: GROUP_ORDER, resolvedModels };
}

export function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch { return '0.0.0'; }
}

export { ConfigError };
export default config;
