/**
 * Section-aware chunking.
 *
 * Statutes are chunked one provision per chunk with ZERO overlap. Overlap is
 * actively harmful in this system: a sentence duplicated across two chunks
 * makes the citation provenance guard ambiguous, and it lets the same text
 * be counted as two independent pieces of evidence by the decision table.
 * Judgments are continuous prose, so they get a small overlap.
 *
 * A provision longer than CHUNK_MAX_CHARS is split at sentence boundaries
 * and the parts share a ref_key — they are the same provision, so an exact
 * lookup should return all of them.
 */
import { config } from '../config/index.js';
import { buildRefKey, primaryAlias, ACTS } from './refKey.js';

/** Split long text at sentence boundaries, never mid-sentence. */
function splitLong(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  // Legal drafting uses "; and", ":—" and numbered clauses as much as ".".
  const sentences = text.split(/(?<=[.;:—])\s+(?=[A-Z(\d])/);
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + 1 + s.length > maxChars) { parts.push(buf); buf = s; }
    else buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) parts.push(buf);
  // A single sentence longer than the cap still has to be broken somewhere.
  return parts.flatMap((p) => {
    if (p.length <= maxChars) return [p];
    const hard = [];
    for (let i = 0; i < p.length; i += maxChars) hard.push(p.slice(i, i + maxChars));
    return hard;
  });
}

function provisionLabel(doc, prov) {
  const act = ACTS[doc.act_code];
  if (doc.act_code === 'CONST' || act?.unit === 'article') {
    return `Article ${prov.article}${prov.clause ? `(${prov.clause})` : ''}`;
  }
  return `Section ${prov.section}${prov.subsection ? `(${prov.subsection})` : ''}`;
}

/**
 * Turn a seed/ingest document into a full text plus chunk records.
 *
 * @param {object} doc  see `src/corpus/seed/documents/*.json`
 * @returns {{ text:string, chunks:Array<object> }}
 */
export function chunkDocument(doc, { ingestBatch = 'manual' } = {}) {
  return doc.doc_type === 'judgment'
    ? chunkJudgment(doc, ingestBatch)
    : chunkStatute(doc, ingestBatch);
}

function chunkStatute(doc, ingestBatch) {
  const maxChars = config.corpus.chunkMaxChars;
  let text = '';
  const chunks = [];
  let seq = 0;

  for (const prov of doc.provisions ?? []) {
    const label = provisionLabel(doc, prov);
    const heading = prov.heading ? `${label}. ${prov.heading}` : label;
    const body = String(prov.text ?? '').trim();
    if (!body) continue;

    for (const [i, part] of splitLong(body, maxChars).entries()) {
      // The header line is part of the chunk text: it is what makes an
      // isolated passage self-describing in the evidence packet, and it
      // gives dense retrieval the section number to match on.
      const block = `${heading}${i > 0 ? ` (continued ${i + 1})` : ''}\n${part}`;
      const char_start = text.length;
      text += block;
      const char_end = text.length;
      text += '\n\n';

      const refParts = {
        act_code: doc.act_code,
        section: prov.section ?? '',
        subsection: prov.subsection ?? '',
        article: prov.article ?? '',
        clause: prov.clause ?? '',
        sub: prov.sub ?? '',
      };
      const ref_key = buildRefKey(refParts);
      const status = prov.status ?? doc.default_status ?? 'in_force';

      chunks.push({
        chunk_id: `${doc.doc_id}::c${String(seq).padStart(3, '0')}`,
        text: block,
        seq,
        char_start,
        char_end,
        ref_key,
        ref_key_alt: prov.ref_key_alt ?? primaryAlias(ref_key),
        section_no: prov.section ?? '',
        subsection_no: prov.subsection ?? '',
        article_no: prov.article ?? '',
        heading: prov.heading ?? '',
        title_path: prov.title_path ?? doc.doc_title,
        status,
        effective_from: prov.effective_from ?? doc.effective_from ?? '',
        effective_to: prov.effective_to ?? doc.effective_to ?? '',
        // A provision that only governs prior offences has a successor; the
        // alias table already knows which one, so do not hand-enter it.
        superseded_by: prov.superseded_by ?? (status === 'applies_to_prior_offences' ? primaryAlias(ref_key) : ''),
        struck_down_by: prov.struck_down_by ?? '',
        ingest_batch: ingestBatch,
      });
      seq++;
    }
  }
  return { text: text.trimEnd(), chunks };
}

function chunkJudgment(doc, ingestBatch) {
  const maxChars = config.corpus.chunkMaxChars;
  const overlap = config.corpus.overlapJudgment;
  let text = '';
  const chunks = [];
  let seq = 0;
  let carry = '';

  for (const para of doc.paragraphs ?? []) {
    const label = para.para ? `Para ${para.para}` : `Extract ${seq + 1}`;
    const body = String(para.text ?? '').trim();
    if (!body) continue;

    for (const part of splitLong(body, maxChars)) {
      // Judgment prose is continuous, so each chunk carries the tail of the
      // previous one. That tail is prepended to the block BEFORE offsets are
      // taken, so char_start/char_end still describe this chunk exactly.
      const block = `${doc.case_name} — ${label}\n${carry ? `…${carry} ` : ''}${part}`;
      const char_start = text.length;
      text += block;
      const char_end = text.length;
      text += '\n\n';
      carry = overlap > 0 ? part.slice(-overlap) : '';

      chunks.push({
        chunk_id: `${doc.doc_id}::c${String(seq).padStart(3, '0')}`,
        text: block,
        seq,
        char_start,
        char_end,
        ref_key: '',
        ref_key_alt: '',
        section_no: '', subsection_no: '', article_no: '',
        heading: label,
        title_path: `${doc.case_name}${doc.citation_str ? ` ${doc.citation_str}` : ''}`,
        status: doc.default_status ?? 'in_force',
        effective_from: doc.effective_from ?? '',
        effective_to: '',
        superseded_by: '',
        struck_down_by: '',
        para_no: para.para ?? '',
        ingest_batch: ingestBatch,
      });
      seq++;
    }
  }
  return { text: text.trimEnd(), chunks };
}
