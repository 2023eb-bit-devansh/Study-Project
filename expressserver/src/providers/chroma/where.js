/**
 * Chroma filter builders that fail loudly at build time.
 *
 * Chroma's `validateWhere` requires a filter object to have EXACTLY ONE
 * top-level key, and `$and`/`$or` to carry at least two entries. Violating
 * either produces a server-side error mid-request. Catching it here — in a
 * builder, with a readable message — beats catching it in a 500 during a
 * demo, so every filter in this codebase is constructed through these.
 */

class WhereError extends Error {
  constructor(m) { super(m); this.name = 'WhereError'; }
}

/** Assert a filter fragment has exactly one top-level key. */
export function one(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new WhereError('where fragment must be a plain object');
  }
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new WhereError(
      `Chroma requires exactly one top-level key in a filter; got ${keys.length} (${keys.join(', ')}). ` +
      'Wrap multiple conditions in and(...).',
    );
  }
  return obj;
}

const cmp = (op) => (field, value) => one({ [field]: { [op]: value } });

export const eq    = cmp('$eq');
export const ne    = cmp('$ne');
export const gt    = cmp('$gt');
export const gte   = cmp('$gte');
export const lt    = cmp('$lt');
export const lte   = cmp('$lte');
export const inList = (field, values) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new WhereError(`$in on "${field}" needs a non-empty array`);
  }
  return one({ [field]: { $in: values } });
};
export const notIn = (field, values) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new WhereError(`$nin on "${field}" needs a non-empty array`);
  }
  return one({ [field]: { $nin: values } });
};

export function and(...conditions) {
  const cs = conditions.flat().filter(Boolean);
  if (cs.length < 2) throw new WhereError(`$and needs >= 2 conditions; got ${cs.length}`);
  cs.forEach(one);
  return { $and: cs };
}

export function or(...conditions) {
  const cs = conditions.flat().filter(Boolean);
  if (cs.length < 2) throw new WhereError(`$or needs >= 2 conditions; got ${cs.length}`);
  cs.forEach(one);
  return { $or: cs };
}

/**
 * Combine 0..n fragments into a legal filter, or `undefined` when empty.
 * This is the safe entry point when the number of conditions is dynamic.
 */
export function all(...conditions) {
  const cs = conditions.flat().filter(Boolean);
  if (cs.length === 0) return undefined;
  if (cs.length === 1) return one(cs[0]);
  return and(...cs);
}

// ── whereDocument ────────────────────────────────────────────────────────
export const contains    = (phrase) => ({ $contains: String(phrase) });
export const notContains = (phrase) => ({ $not_contains: String(phrase) });
export const regex       = (pattern) => ({ $regex: String(pattern) });

export { WhereError };
