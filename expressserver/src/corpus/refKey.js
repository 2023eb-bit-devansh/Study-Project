/**
 * Canonical legal reference keys.
 *
 * `ref_key` is the single most load-bearing piece of metadata in the corpus.
 * It turns "Section 302 of the Indian Penal Code" — which a user might write
 * six different ways — into one exact string that Chroma can match with an
 * `$eq` metadata filter. Without it, finding the operative provision means
 * a semantic search and a hope; with it, it is a 5ms indexed lookup.
 *
 * Two rules govern this module:
 *
 * 1. **Keys are derived in code, never asserted by a model.** The claim
 *    extraction schema deliberately has no `ref_key` field. The model
 *    returns the raw strings it saw and a best-effort parse; this module
 *    maps that onto a controlled vocabulary. Model output is untrusted
 *    input, and the key that drives an exact database lookup must be
 *    computed from a fixed table.
 *
 * 2. **Abbreviation expansion lives here, not in the citation matcher.**
 *    Expanding "IPC" to "Indian Penal Code" inside quote matching would
 *    wreck the Levenshtein ratio. It belongs in reference resolution.
 */

/**
 * Controlled vocabulary. `names` are matched case-insensitively against the
 * act name a claim mentions; longer patterns are tried first so that
 * "Bharatiya Nyaya Sanhita" does not get eaten by a shorter alias.
 */
export const ACTS = {
  CONST: {
    code: 'CONST',
    title: 'Constitution of India',
    unit: 'article',
    names: ['constitution of india', 'indian constitution', 'the constitution', 'constitution'],
  },
  IPC: {
    code: 'IPC',
    title: 'Indian Penal Code, 1860',
    unit: 'section',
    names: ['indian penal code', 'penal code', 'i.p.c.', 'ipc'],
  },
  BNS: {
    code: 'BNS',
    title: 'Bharatiya Nyaya Sanhita, 2023',
    unit: 'section',
    names: ['bharatiya nyaya sanhita', 'nyaya sanhita', 'b.n.s.', 'bns'],
  },
  CRPC: {
    code: 'CRPC',
    title: 'Code of Criminal Procedure, 1973',
    unit: 'section',
    names: ['code of criminal procedure', 'criminal procedure code', 'cr.p.c.', 'crpc', 'crpc 1973'],
  },
  BNSS: {
    code: 'BNSS',
    title: 'Bharatiya Nagarik Suraksha Sanhita, 2023',
    unit: 'section',
    names: ['bharatiya nagarik suraksha sanhita', 'nagarik suraksha sanhita', 'b.n.s.s.', 'bnss'],
  },
  IEA: {
    code: 'IEA',
    title: 'Indian Evidence Act, 1872',
    unit: 'section',
    names: ['indian evidence act', 'evidence act', 'i.e.a.', 'iea'],
  },
  BSA: {
    code: 'BSA',
    title: 'Bharatiya Sakshya Adhiniyam, 2023',
    unit: 'section',
    names: ['bharatiya sakshya adhiniyam', 'sakshya adhiniyam', 'b.s.a.', 'bsa'],
  },
  RTI: {
    code: 'RTI',
    title: 'Right to Information Act, 2005',
    unit: 'section',
    names: ['right to information act', 'right to information', 'r.t.i.', 'rti act', 'rti'],
  },
  IT: {
    code: 'IT',
    title: 'Information Technology Act, 2000',
    unit: 'section',
    names: ['information technology act', 'it act', 'i.t. act'],
  },
  MVA: {
    code: 'MVA',
    title: 'Motor Vehicles Act, 1988',
    unit: 'section',
    names: ['motor vehicles act', 'motor vehicle act', 'm.v. act', 'mv act'],
  },
  CPA: {
    code: 'CPA',
    title: 'Consumer Protection Act, 2019',
    unit: 'section',
    names: ['consumer protection act', 'consumer act'],
  },
};

export const ACT_CODES = Object.keys(ACTS);

/**
 * Statutory equivalence table for the 2023 recodification.
 *
 * ⚠️ EVERY ROW MUST BE HUMAN-VERIFIED against the official Gazette text on
 * indiacode.nic.in before this corpus is used for a demonstration. A wrong
 * mapping here produces a confidently WRONG "Supported" verdict — the exact
 * failure the rest of this architecture exists to prevent, arriving through
 * the one door that has no automated check. `scripts/verifyCorpus.js`
 * prints this table as a sign-off checklist.
 *
 * Mappings are symmetric: `expandAliases` follows them in both directions.
 */
export const EQUIVALENCES = [
  { a: 'IPC:S299', b: 'BNS:S100', note: 'Culpable homicide' },
  { a: 'IPC:S300', b: 'BNS:S101', note: 'Murder' },
  { a: 'IPC:S302', b: 'BNS:S103', note: 'Punishment for murder' },
  { a: 'IPC:S304', b: 'BNS:S105', note: 'Punishment for culpable homicide not amounting to murder' },
  { a: 'IPC:S304A', b: 'BNS:S106', note: 'Causing death by negligence' },
  { a: 'IPC:S375', b: 'BNS:S63', note: 'Rape' },
  { a: 'IPC:S378', b: 'BNS:S303', note: 'Theft' },
  { a: 'IPC:S420', b: 'BNS:S318', note: 'Cheating and dishonestly inducing delivery of property' },
  { a: 'IPC:S499', b: 'BNS:S356', note: 'Defamation' },
  { a: 'IPC:S124A', b: 'BNS:S152', note: 'Sedition → acts endangering sovereignty (NOT a like-for-like replacement)' },
  { a: 'CRPC:S154', b: 'BNSS:S173', note: 'Information in cognizable cases (FIR)' },
  { a: 'CRPC:S41', b: 'BNSS:S35', note: 'When police may arrest without warrant' },
  { a: 'CRPC:S41A', b: 'BNSS:S35(3)', note: 'Notice of appearance before police officer' },
  { a: 'CRPC:S436', b: 'BNSS:S478', note: 'Bail in bailable offences' },
  { a: 'CRPC:S437', b: 'BNSS:S480', note: 'Bail in non-bailable offences' },
  { a: 'CRPC:S438', b: 'BNSS:S482', note: 'Anticipatory bail' },
  { a: 'IEA:S25', b: 'BSA:S23', note: 'Confession to a police officer not to be proved' },
  { a: 'IEA:S24', b: 'BSA:S22', note: 'Confession caused by inducement, threat or promise' },
  { a: 'IEA:S45', b: 'BSA:S39', note: 'Opinions of experts' },
  { a: 'IEA:S101', b: 'BSA:S104', note: 'Burden of proof' },
];

const EQUIV_MAP = (() => {
  const m = new Map();
  for (const { a, b } of EQUIVALENCES) {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a).add(b);
    m.get(b).add(a);
  }
  return m;
})();

/**
 * Longest-first act-name matcher, built once.
 *
 * Matching is word-boundary anchored, not a plain substring test. Without
 * that, "Article 19(1)(a)" resolves to RTI because "a-RTI-cle" contains the
 * abbreviation — a silent, badly wrong answer.
 */
const NAME_INDEX = (() => {
  const entries = [];
  for (const act of Object.values(ACTS)) {
    for (const n of act.names) {
      // Dotted abbreviations ("i.p.c.") need the dots escaped and cannot
      // rely on a trailing \b, since "." is already a non-word character.
      const body = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const lead = /^\w/.test(n) ? '\\b' : '';
      const trail = /\w$/.test(n) ? '\\b' : '';
      entries.push({ name: n, code: act.code, re: new RegExp(`${lead}${body}${trail}`, 'i') });
    }
  }
  return entries.sort((x, y) => y.name.length - x.name.length);
})();

/** Normalise an act name or abbreviation to a code, or null. */
export function actCodeFor(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[,’']/g, ' ').replace(/\s+/g, ' ').trim();
  if (ACTS[s.toUpperCase()]) return s.toUpperCase();
  for (const { re, code } of NAME_INDEX) {
    if (re.test(s)) return code;
  }
  return null;
}

const SECTION_TOKEN = String.raw`(\d+[A-Z]{0,2})`;

/**
 * Parse a free-text legal reference. Handles the shapes that actually turn
 * up in claims:
 *
 *   "Section 302 IPC"          "Sec. 302 of the IPC"     "S.302, Indian Penal Code"
 *   "IPC 302"                  "§302 IPC"                "Section 66A of the IT Act, 2000"
 *   "Article 19(1)(a)"         "Art. 21 of the Constitution"
 *   "Section 8(1) of the RTI Act"
 *
 * @returns {{act_code:string|null, section:string, subsection:string, article:string, clause:string, sub:string}|null}
 */
export function parseReference(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/ /g, ' ').trim();
  const lower = text.toLowerCase();

  const act_code = actCodeFor(text);

  // ── Constitution: Article N(clause)(sub) ────────────────────────────
  const artRe = new RegExp(String.raw`(?:article|art\.?)\s*(\d+[A-Z]?)(?:\s*\((\w+)\))?(?:\s*\((\w+)\))?`, 'i');
  const art = artRe.exec(text);
  if (art) {
    return {
      act_code: act_code ?? 'CONST',
      section: '', subsection: '',
      article: art[1].toUpperCase(),
      clause: art[2] ?? '',
      sub: art[3] ?? '',
    };
  }

  // ── Section N(subsection) ───────────────────────────────────────────
  const secRe = new RegExp(
    String.raw`(?:section|sections|sec\.?|s\.|§)\s*` + SECTION_TOKEN + String.raw`(?:\s*\((\w+)\))?`,
    'i',
  );
  let sec = secRe.exec(text);

  // ── Bare form: "IPC 302", "BNS 103" ─────────────────────────────────
  if (!sec && act_code) {
    const bare = new RegExp(String.raw`\b` + SECTION_TOKEN + String.raw`(?:\s*\((\w+)\))?\b`, 'i');
    // Reject a year like 1860/2005/2023 being read as a section number.
    const candidate = bare.exec(text.replace(/\b(1[6-9]\d{2}|20\d{2})\b/g, ' '));
    if (candidate) sec = candidate;
  }

  if (!sec) return act_code ? { act_code, section: '', subsection: '', article: '', clause: '', sub: '' } : null;

  return {
    act_code,
    section: sec[1].toUpperCase(),
    subsection: sec[2] ?? '',
    article: '', clause: '', sub: '',
    // Recorded so a downstream reader can see the reference was written for
    // the Constitution's "article" unit vs. a statute's "section" unit.
    _matchedLower: lower,
  };
}

/**
 * Build the canonical key.
 *   { act_code:'IPC', section:'302' }                    → 'IPC:S302'
 *   { act_code:'RTI', section:'8', subsection:'1' }      → 'RTI:S8(1)'
 *   { act_code:'CONST', article:'19', clause:'1', sub:'a'} → 'CONST:A19(1)(a)'
 * Returns '' when there is nothing addressable.
 */
export function buildRefKey(parts) {
  if (!parts?.act_code) return '';
  const code = String(parts.act_code).toUpperCase();
  if (!ACTS[code]) return '';

  if (parts.article) {
    let key = `${code}:A${String(parts.article).toUpperCase()}`;
    if (parts.clause) key += `(${parts.clause})`;
    if (parts.sub) key += `(${parts.sub})`;
    return key;
  }
  if (parts.section) {
    let key = `${code}:S${String(parts.section).toUpperCase()}`;
    if (parts.subsection) key += `(${parts.subsection})`;
    return key;
  }
  return '';
}

/** 'RTI:S8(1)' → ['RTI:S8'];  'CONST:A19(1)(a)' → ['CONST:A19(1)', 'CONST:A19'] */
export function parentKeys(refKey) {
  const out = [];
  let k = String(refKey ?? '');
  while (/\(\w+\)$/.test(k)) {
    k = k.replace(/\(\w+\)$/, '');
    out.push(k);
  }
  return out;
}

/**
 * A ref_key plus every statutory equivalent, plus the equivalents of its
 * parents. Used by `lookup_legal_reference` so that a claim about IPC s.302
 * also retrieves BNS s.103 — which is what makes the "is it still in force?"
 * class of claim answerable.
 */
export function expandAliases(refKey, { includeParents = true } = {}) {
  const seen = new Set();
  const queue = [];
  const push = (k) => { if (k && !seen.has(k)) { seen.add(k); queue.push(k); } };

  push(refKey);
  if (includeParents) for (const p of parentKeys(refKey)) push(p);

  for (let i = 0; i < queue.length; i++) {
    for (const eq of EQUIV_MAP.get(queue[i]) ?? []) push(eq);
  }
  return [...seen];
}

/** Expand a list of keys at once, de-duplicated. */
export function expandAllAliases(refKeys, opts) {
  const out = new Set();
  for (const k of refKeys ?? []) for (const e of expandAliases(k, opts)) out.add(e);
  return [...out];
}

/** The single direct equivalent stored on a chunk as `ref_key_alt`. */
export function primaryAlias(refKey) {
  const direct = EQUIV_MAP.get(refKey);
  return direct && direct.size ? [...direct][0] : '';
}

/** Human label: 'IPC:S302' → 'IPC s.302'; 'CONST:A19(1)(a)' → 'Constitution Art. 19(1)(a)' */
export function formatRefKey(refKey) {
  const m = /^([A-Z]+):([SA])(.+)$/.exec(String(refKey ?? ''));
  if (!m) return String(refKey ?? '');
  const [, code, kind, rest] = m;
  if (kind === 'A') return `${code === 'CONST' ? 'Constitution' : code} Art. ${rest}`;
  return `${code} s.${rest}`;
}

/**
 * Extract every legal reference mentioned anywhere in a block of free text.
 * Used as a code-side backstop when the model's `legal_refs` come back empty
 * but the claim clearly names a provision.
 */
export function extractReferences(text) {
  const found = new Map();
  const src = String(text ?? '');

  const patterns = [
    // "Section 302 of the Indian Penal Code" / "section 8(1) of the RTI Act"
    new RegExp(String.raw`(?:section|sec\.?|s\.|§)\s*${SECTION_TOKEN}(?:\s*\((\w+)\))?\s*(?:,?\s*of\s+(?:the\s+)?)?([A-Za-z .]{2,60}?)(?=[,.;)]|\s+(?:and|or|which|that|is|are|was|were|makes?|gives?|provides?|states?|says?)\b|$)`, 'gi'),
    // "IPC 302", "IT Act 66A"
    new RegExp(String.raw`\b(IPC|BNS|CrPC|BNSS|IEA|BSA|RTI|MVA|CPA)\s+${SECTION_TOKEN}\b`, 'gi'),
    // "Article 19(1)(a)"
    /(?:article|art\.?)\s*(\d+[A-Z]?)(?:\s*\((\w+)\))?(?:\s*\((\w+)\))?/gi,
  ];

  // Pattern 1: section + trailing act name
  for (const m of src.matchAll(patterns[0])) {
    const [raw, section, subsection, actName] = m;
    const code = actCodeFor(actName) ?? actCodeFor(src);
    if (!code) continue;
    const key = buildRefKey({ act_code: code, section, subsection });
    if (key) found.set(key, { raw: raw.trim(), act_code: code, section, subsection: subsection ?? '', article: '', clause: '', sub: '' });
  }
  // Pattern 2: bare "IPC 302"
  for (const m of src.matchAll(patterns[1])) {
    const [raw, abbr, section] = m;
    const code = actCodeFor(abbr);
    if (!code) continue;
    const key = buildRefKey({ act_code: code, section });
    if (key) found.set(key, { raw: raw.trim(), act_code: code, section, subsection: '', article: '', clause: '', sub: '' });
  }
  // Pattern 3: articles
  for (const m of src.matchAll(patterns[2])) {
    const [raw, article, clause, sub] = m;
    const key = buildRefKey({ act_code: 'CONST', article, clause, sub });
    if (key) found.set(key, { raw: raw.trim(), act_code: 'CONST', section: '', subsection: '', article, clause: clause ?? '', sub: sub ?? '' });
  }

  return [...found.entries()].map(([ref_key, parts]) => ({ ref_key, ...parts }));
}
