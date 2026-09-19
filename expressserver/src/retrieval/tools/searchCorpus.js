/**
 * Dense semantic search over the curated corpus.
 *
 * Queries are embedded with taskType=RETRIEVAL_QUERY while documents were
 * embedded with RETRIEVAL_DOCUMENT. That asymmetry is the largest free win
 * available on gemini-embedding-001.
 */
import { getCollection } from '../../providers/chroma/collection.js';
import { embedQuery } from '../../providers/gemini/embed.js';
import { config } from '../../config/index.js';
import { eq, all } from '../../providers/chroma/where.js';
import { clamp } from '../../util/text.js';

export async function searchCorpus({ query, act_code, doc_type, n_results }) {
  const col = await getCollection();
  const { vector, ms: embedMs, model } = await embedQuery(query);

  const filters = [];
  if (act_code && act_code !== 'ANY') filters.push(eq('act_code', act_code));
  if (doc_type && doc_type !== 'ANY') filters.push(eq('doc_type', doc_type));

  const result = await col.query({
    queryEmbeddings: [vector],
    nResults: Math.min(Math.max(Number(n_results) || config.retrieval.topK, 1), 20),
    where: all(...filters),
    include: ['documents', 'metadatas', 'distances'],
  });

  const rows = result.rows()[0] ?? [];
  return {
    tool: 'search_corpus',
    query,
    embedMs,
    embedModel: model,
    hits: rows.map((r) => ({
      chunk_id: r.id,
      text: r.document ?? '',
      meta: r.metadata ?? {},
      // Cosine distance in [0,2]; for unit-norm vectors relevant results
      // sit in [0,1], so 1 - d is a usable similarity.
      denseSim: clamp(1 - (r.distance ?? 1), 0, 1),
      refHit: false,
      exactHit: false,
      isWeb: false,
      isNeighbour: false,
      routes: ['dense'],
    })),
  };
}
