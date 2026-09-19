/**
 * Corpus inverse document frequency.
 *
 * Used to pick which two tokens of a claim are worth a literal keyword
 * search. "punishment" appears in most of a criminal-law corpus and finds
 * nothing; "dying declaration" appears in one place and finds it exactly.
 *
 * Computed once from the collection at first use and cached. The corpus is
 * ~100 chunks, so this is a single `get` and a few milliseconds — small
 * enough that there is no reason to precompute it into a file.
 */
import { getCollection } from '../providers/chroma/collection.js';
import { contentTokens } from '../util/text.js';
import { logger } from '../util/logger.js';

const log = logger('idf');

let table = null;      // Map<token, idf>
let docCount = 0;
let building = null;

export async function buildIdf({ force = false } = {}) {
  if (table && !force) return table;
  if (building) return building;

  building = (async () => {
    const col = await getCollection();
    const all = await col.get({ include: ['documents'] });
    const df = new Map();
    docCount = all.documents.length;

    for (const doc of all.documents) {
      for (const t of new Set(contentTokens(doc ?? ''))) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }

    const next = new Map();
    for (const [t, n] of df) next.set(t, Math.log((docCount + 1) / (n + 1)) + 1);
    table = next;
    log.debug(`built over ${docCount} chunks, ${table.size} distinct tokens`);
    building = null;
    return table;
  })();

  return building;
}

export function invalidateIdf() { table = null; }

/** IDF of a token; unseen tokens get the maximum score — they are rare. */
export function idfOf(token) {
  if (!table) return 1;
  return table.get(token) ?? (Math.log(docCount + 1) + 1);
}

/** The `n` most distinctive content tokens of a piece of text. */
export function distinctiveTokens(text, n = 2) {
  const tokens = contentTokens(text);
  return tokens
    .map((t) => ({ token: t, idf: idfOf(t) }))
    .sort((a, b) => b.idf - a.idf)
    .slice(0, n)
    .map((x) => x.token);
}

export function idfReady() { return table !== null; }
