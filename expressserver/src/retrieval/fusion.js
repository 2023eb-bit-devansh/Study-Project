/**
 * Candidate scoring, deduplication and ranking.
 *
 * WEIGHTED LINEAR FUSION, NOT RRF. Reciprocal rank fusion is the textbook
 * answer and is defensible in general, but it has a specific flaw here: it
 * gives an exact `IPC:S302` metadata hit roughly the same weight as the top
 * dense hit. In law that is wrong — if the claim names Section 302, the text
 * of Section 302 should essentially always be evidence item #1. RRF also
 * produces scores with no interpretable meaning, which costs us both in the
 * trace viewer and in the report.
 *
 *   score = W_DENSE·dense_sim + W_REF·ref_hit + W_EXACT·exact_hit
 *           − PENALTY_WEB·is_web − PENALTY_NEIGHBOUR·is_neighbour
 *
 * The weights sum to 1 and every component is in [0,1], so the maximum score
 * is 1.0 and a threshold like SUFFICIENCY_MIN_TOP_SCORE=0.55 means something
 * concrete rather than being a magic number.
 */
import { config } from '../config/index.js';
import { ngrams, jaccard, clamp } from '../util/text.js';
import { N2 } from '../citation/normalize.js';
import { sha1 } from '../util/hash.js';

/**
 * @typedef {object} Candidate
 * @property {string} chunk_id
 * @property {string} text
 * @property {object} meta
 * @property {number} denseSim      0..1, from the dense query
 * @property {boolean} refHit       carries a ref_key the claim named
 * @property {boolean} exactHit     matched a keyword/regex query
 * @property {boolean} isWeb
 * @property {boolean} isNeighbour  pulled in by read_passage expansion
 * @property {string[]} routes      which tools found it, for the trace
 */

/** Recompute `score` and the per-component breakdown. */
export function scoreCandidate(c, weights = config.ranking) {
  const dense = weights.wDense * clamp(c.denseSim ?? 0, 0, 1);
  const ref = weights.wRef * (c.refHit ? 1 : 0);
  const exact = weights.wExact * (c.exactHit ? 1 : 0);
  const web = weights.penaltyWeb * (c.isWeb ? 1 : 0);
  // Keeps the ANCHOR chunk above the context expanded around it, so the
  // verdict model quotes the operative provision rather than a marginal note.
  const neighbour = weights.penaltyNeighbour * (c.isNeighbour ? 1 : 0);

  c.components = { dense, ref, exact, web: -web, neighbour: -neighbour };
  c.score = clamp(dense + ref + exact - web - neighbour, 0, 1);
  return c;
}

/**
 * The candidate pool. Owns the three dedup layers and the ranking.
 *
 *   1. seenIds        — a chunk id is never admitted twice
 *   2. seenHashes     — the same passage under a different id (a corpus
 *                       chunk vs. a web page quoting the same section)
 *   3. near-duplicate — 5-gram Jaccard merge for near-identical text
 */
export function createPool(weights = config.ranking) {
  /** @type {Map<string, Candidate>} */
  const byId = new Map();
  const byHash = new Map();
  const seenIds = new Set();
  const queryFingerprints = new Set();

  function textHash(text) { return sha1(N2(text)); }

  return {
    seenIds,

    /** Has this chunk already been shown to the loop? */
    hasSeen(chunkId) { return seenIds.has(chunkId); },
    markSeen(chunkId) { seenIds.add(chunkId); },

    /** Returns true if the query is new (and records it). */
    claimQuery(fingerprint) {
      if (queryFingerprints.has(fingerprint)) return false;
      queryFingerprints.add(fingerprint);
      return true;
    },

    /**
     * Admit a candidate, or merge it into one already in the pool.
     *
     * MERGING MATTERS AS MUCH AS ADMITTING. A chunk that dense search
     * already returned and that keyword search then finds again is not
     * noise to be discarded — the second route is exactly the corroboration
     * the fusion formula is built to reward. Dropping the repeat would cap
     * such a chunk at its dense-only score and make the `exact_hit`
     * component unreachable for any claim whose keyword hits overlap its
     * dense hits, which is the common case.
     *
     * @returns {{candidate:Candidate, created:boolean, scoreBefore:number, scoreAfter:number}}
     */
    upsert(input) {
      const existing = byId.get(input.chunk_id);
      if (existing) {
        const scoreBefore = existing.score;
        // A chunk found by a second route keeps the best of each signal.
        existing.denseSim = Math.max(existing.denseSim ?? 0, input.denseSim ?? 0);
        existing.refHit = existing.refHit || input.refHit;
        existing.exactHit = existing.exactHit || input.exactHit;
        existing.isNeighbour = existing.isNeighbour && input.isNeighbour;
        existing.routes = [...new Set([...existing.routes, ...input.routes])];
        scoreCandidate(existing, weights);
        return { candidate: existing, created: false, scoreBefore, scoreAfter: existing.score };
      }

      const hash = textHash(input.text);
      const twin = byHash.get(hash);
      if (twin) {
        const scoreBefore = twin.score;
        twin.routes = [...new Set([...twin.routes, ...input.routes])];
        twin.duplicates = [...(twin.duplicates ?? []), input.chunk_id];
        twin.denseSim = Math.max(twin.denseSim ?? 0, input.denseSim ?? 0);
        twin.refHit = twin.refHit || input.refHit;
        twin.exactHit = twin.exactHit || input.exactHit;
        scoreCandidate(twin, weights);
        return { candidate: twin, created: false, scoreBefore, scoreAfter: twin.score };
      }

      // Near-duplicate: same passage with trivial differences.
      const grams = ngrams(input.text, 5);
      for (const c of byId.values()) {
        if (jaccard(grams, c._grams ?? ngrams(c.text, 5)) >= weights.nearDupJaccard) {
          const scoreBefore = c.score;
          c.routes = [...new Set([...c.routes, ...input.routes])];
          c.duplicates = [...(c.duplicates ?? []), input.chunk_id];
          c.denseSim = Math.max(c.denseSim ?? 0, input.denseSim ?? 0);
          c.refHit = c.refHit || input.refHit;
          c.exactHit = c.exactHit || input.exactHit;
          scoreCandidate(c, weights);
          return { candidate: c, created: false, scoreBefore, scoreAfter: c.score };
        }
      }

      const candidate = scoreCandidate({ routes: [], duplicates: [], ...input, _grams: grams }, weights);
      byId.set(candidate.chunk_id, candidate);
      byHash.set(hash, candidate);
      return { candidate, created: true, scoreBefore: 0, scoreAfter: candidate.score };
    },

    /** Re-score everything, e.g. after a weight change in the playground. */
    rescore(nextWeights) {
      for (const c of byId.values()) scoreCandidate(c, nextWeights ?? weights);
    },

    size() { return byId.size; },

    /** Ranked, highest first. */
    ranked(limit = config.retrieval.candidatePool) {
      return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    },

    /** Trace-safe view: no n-gram sets, text truncated. */
    forTrace(limit = 12) {
      return this.ranked(limit).map((c) => ({
        chunk_id: c.chunk_id,
        score: Number(c.score.toFixed(4)),
        components: Object.fromEntries(Object.entries(c.components).map(([k, v]) => [k, Number(v.toFixed(4))])),
        routes: c.routes,
        ref_key: c.meta?.ref_key ?? '',
        source: c.meta?.doc_title ?? '',
        heading: c.meta?.heading ?? '',
        status: c.meta?.status ?? '',
        is_web: !!c.isWeb,
        is_neighbour: !!c.isNeighbour,
        duplicates: c.duplicates ?? [],
      }));
    },
  };
}

/** Strip internals before a candidate leaves the retrieval stage. */
export function toEvidence(c) {
  const { _grams, ...rest } = c;
  return rest;
}
