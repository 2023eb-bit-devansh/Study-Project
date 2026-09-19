/**
 * Chunk metadata construction and validation.
 *
 * Chroma metadata values must be SCALARS — string, number or boolean. No
 * arrays, no nested objects. Every design decision in the schema respects
 * that: "this IPC section maps to these BNS sections" is one scalar
 * `ref_key_alt` plus the static table in `refKey.js`, not an array field.
 *
 * `status` is an enum rather than a boolean `in_force`. IPC s.302 is not
 * simply "repealed": it still governs offences committed before 1 July 2024,
 * while BNS s.103 governs those after. A boolean here would make the system
 * confidently wrong on exactly the class of claim it is meant to catch.
 */

export const STATUS_VALUES = [
  'in_force',
  'applies_to_prior_offences',
  'repealed',
  'struck_down',
  'read_down',
  'amended',
];

export const DOC_TYPES = ['act', 'constitution', 'judgment', 'rule', 'web'];

export const VERIFICATION_VALUES = ['unverified', 'verified', 'disputed'];

/** Fields the retrieval layer filters or sorts on. Kept explicit. */
export const METADATA_FIELDS = [
  'doc_id', 'doc_title', 'doc_type', 'jurisdiction', 'act_code',
  'section_no', 'subsection_no', 'article_no', 'ref_key', 'ref_key_alt',
  'seq', 'title_path', 'heading', 'status', 'effective_from', 'effective_to',
  'superseded_by', 'struck_down_by', 'court', 'case_year', 'citation_str',
  'case_name', 'para_no', 'source_url', 'char_start', 'char_end',
  'ingest_batch', 'verification_status',
];

class MetadataError extends Error {
  constructor(m) { super(m); this.name = 'MetadataError'; }
}

/** Build the flat, scalar-only metadata object for one chunk. */
export function buildChunkMetadata(doc, chunk) {
  const meta = {
    doc_id: doc.doc_id,
    doc_title: doc.doc_title ?? '',
    doc_type: doc.doc_type ?? 'act',
    jurisdiction: doc.jurisdiction ?? 'IN',
    act_code: doc.act_code ?? '',

    section_no: chunk.section_no ?? '',
    subsection_no: chunk.subsection_no ?? '',
    article_no: chunk.article_no ?? '',
    ref_key: chunk.ref_key ?? '',
    ref_key_alt: chunk.ref_key_alt ?? '',

    seq: chunk.seq,                       // INTEGER — neighbour expansion is a range query
    title_path: chunk.title_path ?? '',
    heading: chunk.heading ?? '',

    status: chunk.status ?? 'in_force',
    effective_from: chunk.effective_from ?? '',
    effective_to: chunk.effective_to ?? '',
    superseded_by: chunk.superseded_by ?? '',
    struck_down_by: chunk.struck_down_by ?? '',

    court: doc.court ?? '',
    case_year: Number(doc.case_year ?? 0),
    citation_str: doc.citation_str ?? '',
    case_name: doc.case_name ?? '',
    para_no: chunk.para_no ?? '',

    source_url: doc.source_url ?? '',
    char_start: chunk.char_start,
    char_end: chunk.char_end,

    ingest_batch: chunk.ingest_batch ?? 'manual',
    // Statutory text authored without a page-by-page check against the
    // official Gazette is flagged here and surfaced in the corpus manager.
    // A mistranscribed clause is the one failure mode this architecture has
    // no automated defence against.
    verification_status: doc.verification_status ?? 'unverified',
  };

  validateMetadata(meta);
  return meta;
}

export function validateMetadata(meta) {
  for (const [k, v] of Object.entries(meta)) {
    const t = typeof v;
    if (v === null || v === undefined) {
      throw new MetadataError(`metadata.${k} is ${v}; Chroma requires a scalar`);
    }
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      throw new MetadataError(
        `metadata.${k} is ${Array.isArray(v) ? 'an array' : t}; Chroma metadata must be string, number or boolean`,
      );
    }
    if (t === 'number' && !Number.isFinite(v)) {
      throw new MetadataError(`metadata.${k} is ${v}`);
    }
  }
  if (!STATUS_VALUES.includes(meta.status)) {
    throw new MetadataError(`metadata.status "${meta.status}" is not one of ${STATUS_VALUES.join(' | ')}`);
  }
  if (!DOC_TYPES.includes(meta.doc_type)) {
    throw new MetadataError(`metadata.doc_type "${meta.doc_type}" is not one of ${DOC_TYPES.join(' | ')}`);
  }
  if (!VERIFICATION_VALUES.includes(meta.verification_status)) {
    throw new MetadataError(`metadata.verification_status "${meta.verification_status}" is invalid`);
  }
  return meta;
}

/** Display label used in the evidence packet handed to the verdict model. */
export function sourceLabel(meta) {
  if (meta.doc_type === 'judgment') {
    return [meta.case_name, meta.citation_str, meta.para_no ? `para ${meta.para_no}` : '']
      .filter(Boolean).join(' — ');
  }
  if (meta.doc_type === 'web') return meta.doc_title || meta.source_url;
  const unit = meta.article_no
    ? `Article ${meta.article_no}`
    : `Section ${meta.section_no}${meta.subsection_no ? `(${meta.subsection_no})` : ''}`;
  return [meta.doc_title, unit, meta.heading].filter(Boolean).join(' — ');
}

export { MetadataError };
