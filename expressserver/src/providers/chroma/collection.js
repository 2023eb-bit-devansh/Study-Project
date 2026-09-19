/**
 * Collection access, plus the two capability facts the retrieval layer needs
 * to know about this particular Chroma server.
 *
 * 1. `embeddingFunction: null` — NOT omitted. Omitting it makes chromadb try
 *    to `import('@chroma-core/default-embed')`, warn on every boot, and
 *    persist the collection as using the default embedding function. We
 *    always supply our own Gemini vectors, so we want no EF at all.
 *
 * 2. `whereDocument.$regex` is accepted by this server build but is not in
 *    the published docs. We probe it once at boot; if it is rejected we set
 *    `regexSupported = false` and `keywordSearch` falls back to `$contains`
 *    plus an in-process regex filter.
 */
import { getChromaClient } from './client.js';
import { config } from '../../config/index.js';
import { logger } from '../../util/logger.js';

const log = logger('chroma:collection');

let collection = null;
let capabilities = { regexSupported: null, probedAt: null };

export function regexSupported() {
  // Until probed, assume unsupported — the fallback path is always correct,
  // just slower. Never assume a capability we have not observed.
  return capabilities.regexSupported === true;
}

export function chromaCapabilities() {
  return { ...capabilities };
}

export async function getCollection({ create = true } = {}) {
  if (collection) return collection;
  const client = getChromaClient();
  const args = {
    name: config.chroma.collection,
    embeddingFunction: null,
    configuration: { hnsw: { space: config.chroma.space } },
  };
  collection = create
    ? await client.getOrCreateCollection(args)
    : await client.getCollection(args);
  return collection;
}

/** Drop the cached handle (used after a collection delete/reindex). */
export function resetCollectionCache() { collection = null; }

/**
 * One throwaway `$regex` query. Runs at boot behind CHROMA_REGEX_SELFTEST.
 * Returns the resolved capability; never throws.
 */
export async function probeRegexSupport() {
  if (!config.chroma.regexSelftest) {
    capabilities = { regexSupported: false, probedAt: Date.now(), skipped: true };
    return capabilities;
  }
  try {
    const col = await getCollection();
    await col.get({ whereDocument: { $regex: '(?i)zzz_probe_[0-9]' }, limit: 1, include: [] });
    capabilities = { regexSupported: true, probedAt: Date.now() };
    log.debug('whereDocument.$regex supported');
  } catch (err) {
    capabilities = { regexSupported: false, probedAt: Date.now(), error: err?.message ?? String(err) };
    log.warn(`whereDocument.$regex unsupported — keyword search will use $contains + in-process regex (${capabilities.error})`);
  }
  return capabilities;
}

/** Collection stats for /api/health and the corpus manager. */
export async function collectionStats() {
  try {
    const col = await getCollection();
    const count = await col.count();
    return { ok: true, name: config.chroma.collection, count, space: config.chroma.space };
  } catch (err) {
    return { ok: false, name: config.chroma.collection, error: err?.message ?? String(err) };
  }
}
