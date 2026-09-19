/**
 * Exact provision lookup by canonical reference key.
 *
 * This is the hot path and the reason `ref_key` exists. "Section 302 IPC"
 * becomes an indexed metadata equality filter rather than a semantic search
 * and a hope. Alias expansion means a claim about IPC s.302 also retrieves
 * BNS s.103 — which is what makes the whole "is it still in force?" class of
 * claim answerable at all.
 */
import { getCollection } from '../../providers/chroma/collection.js';
import { inList, or } from '../../providers/chroma/where.js';
import { expandAllAliases, buildRefKey } from '../../corpus/refKey.js';

export async function lookupLegalReference({ act_code, section, subsection, article, clause, sub, ref_key, include_equivalents = true }) {
  const base = ref_key || buildRefKey({ act_code, section, subsection, article, clause, sub });
  if (!base) {
    return { tool: 'lookup_legal_reference', ref_key: '', keys: [], hits: [], error: 'no_resolvable_reference' };
  }

  const keys = include_equivalents ? expandAllAliases([base]) : [base];
  const col = await getCollection();

  // One `$or` of two `$in` clauses — still exactly one top-level key, and it
  // catches chunks that carry the reference in either direction.
  const result = await col.get({
    where: or(inList('ref_key', keys), inList('ref_key_alt', keys)),
    include: ['documents', 'metadatas'],
  });

  return {
    tool: 'lookup_legal_reference',
    ref_key: base,
    keys,
    hits: result.ids.map((id, i) => ({
      chunk_id: id,
      text: result.documents[i] ?? '',
      meta: result.metadatas[i] ?? {},
      // An exact reference hit is not a similarity measurement; it is a
      // categorical fact, carried by refHit rather than by denseSim.
      denseSim: 0,
      refHit: true,
      exactHit: false,
      isWeb: false,
      isNeighbour: false,
      routes: ['ref'],
    })),
  };
}
