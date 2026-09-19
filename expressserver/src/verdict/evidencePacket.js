/**
 * Render the ranked evidence set for the verdict model.
 *
 * Note what is NOT in the packet: no URLs, no chunk ids, no retrieval
 * scores, no metadata beyond a display label and a status. A model that
 * never sees a URL cannot cite one it did not read; a model that never sees
 * a score cannot be steered by our ranking; and enumerated ids mean the
 * schema `enum` can make "cite only what you were given" a decode-time
 * constraint instead of a request.
 */
import { sourceLabel } from '../corpus/metadata.js';
import { truncate } from '../util/text.js';

const STATUS_NOTE = {
  in_force: 'currently in force',
  applies_to_prior_offences: 'applies to offences before 1 July 2024; superseded for later ones',
  repealed: 'repealed',
  struck_down: 'struck down by a court and no longer in force',
  read_down: 'read down or kept in abeyance by a court',
  amended: 'amended',
};

/**
 * @param {Array} evidence  ranked candidates from retrieval
 * @param {number} maxChars per-passage cap
 * @returns {{ packet:string, ids:string[], byId:Map<string,object> }}
 */
export function buildEvidencePacket(evidence, { maxChars = 1600 } = {}) {
  const ids = [];
  const byId = new Map();
  const blocks = [];

  evidence.forEach((c, i) => {
    const id = `E${i + 1}`;
    ids.push(id);

    const meta = c.meta ?? {};
    const label = sourceLabel(meta);
    const status = STATUS_NOTE[meta.status] ?? meta.status ?? '';
    const passage = truncate(c.text ?? '', maxChars);

    byId.set(id, {
      evidence_id: id,
      chunk_id: c.chunk_id,
      passage,
      fullText: c.text ?? '',
      meta,
      sourceType: c.sourceType ?? (c.isWeb ? 'web' : 'corpus'),
      sourceLabel: label,
      sourceUrl: meta.source_url ?? '',
      score: c.score,
      components: c.components,
      routes: c.routes ?? [],
    });

    blocks.push(
      `<evidence id="${id}" source="${escapeAttr(label)}"${status ? ` status="${escapeAttr(status)}"` : ''}>\n${passage}\n</evidence>`,
    );
  });

  return { packet: blocks.join('\n\n'), ids, byId };
}

/** A packet containing only the named ids — used by the single re-quote call. */
export function subsetPacket(byId, wantedIds, { maxChars = 1600 } = {}) {
  return wantedIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((e) => `<evidence id="${e.evidence_id}" source="${escapeAttr(e.sourceLabel)}">\n${truncate(e.passage, maxChars)}\n</evidence>`)
    .join('\n\n');
}

function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/[\n\r]/g, ' '); }
