/**
 * Boot-time Gemini model resolution.
 *
 * No model id is hardcoded anywhere in `src/`. Five generative roles and one
 * embedding role are declared in `.env`; blank means "pick the newest stable
 * model suitable for this role". Resolution happens once, at boot, against
 * ListModels — never at request time — and a pinned-but-missing model throws
 * with the available list printed rather than failing on the first user
 * request. This is the concrete mechanism behind NFR 4.4.
 */
import { config, resolvedModels } from './index.js';
import { listModels, hasApiKey } from '../providers/gemini/client.js';
import { logger } from '../util/logger.js';

const log = logger('models');

/** Tier preference per role. Earlier entries win. */
const ROLE_PREFERENCE = {
  // Cheap, high-volume, low-reasoning: one query reformulation per claim.
  retrieval:  ['flash-lite', 'flash', 'pro'],
  // Structured extraction from short text — accuracy matters more than cost.
  extraction: ['flash', 'flash-lite', 'pro'],
  // OCR/transcription of a screenshot.
  vision:     ['flash', 'flash-lite', 'pro'],
  // Grounded search call. Flash is the documented sweet spot for this tool.
  grounding:  ['flash', 'flash-lite', 'pro'],
  // The reasoning-heavy stance/quote call. Flash by default because a
  // student project runs on a quota; set GEMINI_MODEL_VERDICT to a pro id
  // in .env to trade cost for depth.
  verdict:    ['flash', 'pro', 'flash-lite'],
};

const GENERATE = 'generateContent';
const EMBED = 'embedContent';

/**
 * `gemini-3.8-flash-lite` → { major: 3, minor: 8, tier: 'flash-lite' }
 *
 * Version is kept as a (major, minor) pair rather than a float so that a
 * future `gemini-3.10-flash` sorts after `gemini-3.8-flash` instead of
 * before it.
 */
export function parseModelName(name) {
  const m = /^gemini-(\d+)(?:\.(\d+))?-(pro|flash-lite|flash)(?:-(.+))?$/.exec(name);
  if (!m) return null;
  const [, major, minor, tier, suffix = ''] = m;
  return {
    name,
    major: Number(major),
    minor: minor ? Number(minor) : 0,
    tier,
    preview: /preview|exp|latest|rc/i.test(suffix),
    suffix,
  };
}

/** Descending by version. */
const byVersionDesc = (a, b) =>
  (b.parsed.major - a.parsed.major) || (b.parsed.minor - a.parsed.minor);

function pickForRole(role, available) {
  const prefs = ROLE_PREFERENCE[role];
  const candidates = available
    .filter((m) => m.methods.includes(GENERATE))
    .map((m) => ({ ...m, parsed: parseModelName(m.name) }))
    .filter((m) => m.parsed && !m.parsed.preview);

  for (const tier of prefs) {
    const inTier = candidates
      .filter((m) => m.parsed.tier === tier)
      .sort(byVersionDesc);
    if (inTier.length) return inTier[0].name;
  }
  // Nothing matched the naming convention — fall back to any generateContent
  // model rather than failing the whole boot.
  const any = available.filter((m) => m.methods.includes(GENERATE));
  return any.length ? any[0].name : null;
}

function pickEmbed(available) {
  const embedders = available.filter((m) => m.methods.includes(EMBED)).map((m) => m.name);
  // gemini-embedding-001 is preferred: it is the only one that honours
  // `taskType`, and asymmetric RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY task
  // types are the single biggest retrieval-quality lever in this system.
  const preferred = embedders.find((n) => n === 'gemini-embedding-001')
    ?? embedders.find((n) => n.startsWith('gemini-embedding'))
    ?? embedders[0];
  return preferred ?? null;
}

/**
 * Resolve all six roles. Returns `resolvedModels` (also mutated in place so
 * every importer sees the same object).
 *
 * @param {{ required?: boolean }} opts  When `required` and the API key is
 *   missing or a pinned model is absent, throws instead of degrading.
 */
export async function resolveModels({ required = false } = {}) {
  const requested = config.gemini.requested;

  if (!hasApiKey()) {
    const msg = 'GEMINI_API_KEY is not set — model resolution skipped.';
    if (required) throw new Error(msg);
    log.warn(msg);
    Object.assign(resolvedModels, {
      ...requested, source: 'unresolved', available: [], error: 'no_api_key',
    });
    return resolvedModels;
  }

  if (!config.gemini.validateAtBoot) {
    Object.assign(resolvedModels, { ...requested, source: 'env', available: [] });
    log.info('GEMINI_MODEL_VALIDATE_AT_BOOT=false — using .env ids verbatim');
    return resolvedModels;
  }

  let available;
  try {
    available = await listModels();
  } catch (err) {
    const msg = `ListModels failed: ${err?.message ?? err}`;
    if (required) throw new Error(msg);
    log.warn(`${msg} — falling back to .env ids verbatim`);
    Object.assign(resolvedModels, { ...requested, source: 'fallback', available: [], error: msg });
    return resolvedModels;
  }

  const names = new Set(available.map((m) => m.name));
  const out = { source: 'listmodels', available, warnings: [] };

  for (const role of ['extraction', 'vision', 'retrieval', 'verdict', 'grounding']) {
    const pinned = requested[role];
    if (pinned) {
      if (!names.has(pinned)) {
        throw new Error(
          `GEMINI_MODEL_${role.toUpperCase()}="${pinned}" is not available to this API key.\n` +
          `Available generateContent models:\n  ${available.filter((m) => m.methods.includes(GENERATE)).map((m) => m.name).join('\n  ')}`,
        );
      }
      out[role] = pinned;
    } else {
      out[role] = pickForRole(role, available);
      if (!out[role]) throw new Error(`No model available for role "${role}".`);
    }
  }

  const pinnedEmbed = requested.embed;
  if (pinnedEmbed && names.has(pinnedEmbed)) {
    out.embed = pinnedEmbed;
  } else {
    if (pinnedEmbed) {
      out.warnings.push(`GEMINI_EMBED_MODEL="${pinnedEmbed}" is not available; auto-selecting.`);
    }
    out.embed = pickEmbed(available);
    if (!out.embed) throw new Error('No embedContent-capable model available to this API key.');
  }

  // gemini-embedding-2 silently ignores taskType rather than erroring — the
  // dangerous failure mode. Warn loudly if we end up on it.
  if (/gemini-embedding-2/.test(out.embed)) {
    out.warnings.push(
      `Embedding model "${out.embed}" does not support taskType; asymmetric ` +
      'RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY embedding is disabled and retrieval quality will drop. ' +
      'Prefer gemini-embedding-001.',
    );
  }

  Object.assign(resolvedModels, out);
  log.info(
    `resolved → extraction=${out.extraction} vision=${out.vision} retrieval=${out.retrieval} ` +
    `verdict=${out.verdict} grounding=${out.grounding} embed=${out.embed}`,
  );
  for (const w of out.warnings) log.warn(w);
  return resolvedModels;
}

/** Accessor used by every call site. Throws if boot resolution never ran. */
export function modelFor(role) {
  const id = resolvedModels[role];
  if (!id) {
    throw new Error(
      `Model for role "${role}" is unresolved. Is GEMINI_API_KEY set in expressserver/.env?`,
    );
  }
  return id;
}

/** Does taskType apply to the resolved embedding model? */
export function embedSupportsTaskType() {
  return !/gemini-embedding-2/.test(resolvedModels.embed ?? '');
}
