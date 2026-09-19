export const now = () => Date.now();
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Elapsed-time helper: `const t = timer(); ...; t.ms()`. */
export function timer() {
  const start = process.hrtime.bigint();
  return { ms: () => Number(process.hrtime.bigint() - start) / 1e6 };
}
