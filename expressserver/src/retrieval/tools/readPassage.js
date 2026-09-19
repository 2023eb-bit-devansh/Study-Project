/**
 * Read a chunk together with its neighbours in the same document.
 *
 * This is FR8's "read the useful passage instead of relying only on short
 * search snippets". It is a pure metadata range query — no embedding call,
 * no semantic search, ~5ms — which is exactly why `seq` is stored as an
 * INTEGER and why prev_id/next_id pointers are unnecessary.
 */
import { getCollection } from '../../providers/chroma/collection.js';
import { and, eq, gte, lte } from '../../providers/chroma/where.js';
import { config } from '../../config/index.js';
import { truncate } from '../../util/text.js';

export async function readPassage({ chunk_id, window = config.retrieval.neighbourWindow }) {
  const col = await getCollection();

  const anchor = await col.get({ ids: [chunk_id], include: ['documents', 'metadatas'] });
  if (anchor.ids.length === 0) {
    return { tool: 'read_passage', chunk_id, hits: [], error: 'unknown_chunk_id' };
  }

  const meta = anchor.metadatas[0] ?? {};
  const seq = Number(meta.seq ?? 0);
  const w = Math.min(Math.max(Number(window) || 0, 0), 3);

  if (w === 0) {
    return {
      tool: 'read_passage',
      chunk_id,
      hits: [{
        chunk_id, text: anchor.documents[0] ?? '', meta,
        denseSim: 0, refHit: false, exactHit: false, isWeb: false, isNeighbour: false, routes: ['read'],
      }],
    };
  }

  const neighbours = await col.get({
    where: and(eq('doc_id', meta.doc_id), gte('seq', seq - w), lte('seq', seq + w)),
    include: ['documents', 'metadatas'],
  });

  const rows = neighbours.ids
    .map((id, i) => ({ id, text: neighbours.documents[i] ?? '', meta: neighbours.metadatas[i] ?? {} }))
    .sort((a, b) => Number(a.meta.seq) - Number(b.meta.seq));

  return {
    tool: 'read_passage',
    chunk_id,
    expanded: rows.length,
    // Concatenated view, for the trace and for a human reading the panel.
    passage: truncate(rows.map((r) => r.text).join('\n\n'), config.retrieval.readPassageMaxChars),
    hits: rows.map((r) => ({
      chunk_id: r.id,
      text: r.text,
      meta: r.meta,
      denseSim: 0,
      refHit: false,
      exactHit: false,
      isWeb: false,
      // The anchor keeps its own ranking; only the context around it is
      // penalised, so the verdict model quotes the operative provision.
      isNeighbour: r.id !== chunk_id,
      routes: [r.id === chunk_id ? 'read' : 'neighbour'],
    })),
  };
}
