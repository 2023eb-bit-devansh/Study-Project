/**
 * Bounded Levenshtein distance with early exit.
 *
 * Character-level, not token-level, and that choice is load-bearing. The
 * failure modes this layer exists to catch are character-scale: OCR drift, a
 * dropped article, `Sec.` where the source says `Section`, a changed comma.
 * Token-set similarity is blind to word order — "shall not be punished" and
 * "shall be punished not" score identically at 1.0 — which is disqualifying
 * for legal text where negation placement changes the proposition.
 *
 * `maxDist` lets the caller abandon a comparison as soon as it cannot beat
 * the best score so far, which is what keeps the sliding window cheap.
 */

/**
 * @param {string} a @param {string} b
 * @param {number} [maxDist] abandon and return maxDist+1 once exceeded
 * @returns {number}
 */
export function levenshtein(a, b, maxDist = Infinity) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  // Keep the shorter string on the inner axis so the row array is small.
  if (a.length > b.length) { const t = a; a = b; b = t; }

  const n = a.length;
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = curr[0];
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= n; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const v = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    // Every future distance is >= the minimum of this row.
    if (rowMin > maxDist) return maxDist + 1;
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[n];
}

/** 1 − distance/maxLength, clamped to [0,1]. */
export function ratio(a, b, minRatio = 0) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  // Anything below minRatio is uninteresting, so cap the DP accordingly.
  const maxDist = minRatio > 0 ? Math.floor((1 - minRatio) * maxLen) : Infinity;
  const d = levenshtein(a, b, maxDist);
  if (d > maxDist) return 0;
  return Math.max(0, 1 - d / maxLen);
}
