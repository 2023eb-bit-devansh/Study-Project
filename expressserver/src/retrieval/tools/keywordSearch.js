/**
 * Literal and pattern search over passage text.
 *
 * Legal claims carry exact strings that dense retrieval blurs: case
 * citations like "(2015) 5 SCC 1", distinctive phrases like "dying
 * declaration", section numbers embedded in prose.
 *
 * `whereDocument.$regex` works on this Chroma build but is undocumented, so
 * `probeRegexSupport()` decides at boot whether to use it. The fallback —
 * `$contains` on a literal substring plus an in-process regex filter — is
 * always correct, just less selective.
 */
import { getCollection, regexSupported } from '../../providers/chroma/collection.js';
import { contains, regex as regexDoc, all, eq } from '../../providers/chroma/where.js';
import { config } from '../../config/index.js';

export async function keywordSearch({ phrase, regex: pattern, act_code, doc_type, n_results }) {
  const col = await getCollection();
  const limit = Math.min(Math.max(Number(n_results) || config.retrieval.topK, 1), 20);

  const filters = [];
  if (act_code && act_code !== 'ANY') filters.push(eq('act_code', act_code));
  if (doc_type && doc_type !== 'ANY') filters.push(eq('doc_type', doc_type));

  let whereDocument;
  let postFilter = null;
  let mode;

  if (pattern) {
    if (regexSupported()) {
      whereDocument = regexDoc(`(?i)${pattern}`);
      mode = 'regex';
    } else {
      // No usable server-side pattern support: scan a bounded slice and
      // filter here. Correct, just less selective.
      mode = 'regex_fallback';
      postFilter = new RegExp(pattern, 'i');
    }
  } else if (phrase) {
    if (regexSupported()) {
      // Case-insensitive phrase matching; $contains is case-sensitive.
      whereDocument = regexDoc(`(?i)${escapeRegex(phrase)}`);
      mode = 'phrase_regex';
    } else {
      whereDocument = contains(phrase);
      mode = 'phrase_contains';
    }
  } else {
    return { tool: 'keyword_search', mode: 'noop', hits: [], error: 'neither phrase nor regex supplied' };
  }

  const result = await col.get({
    where: all(...filters),
    ...(whereDocument ? { whereDocument } : {}),
    limit: postFilter ? 500 : limit,
    include: ['documents', 'metadatas'],
  });

  let rows = result.ids.map((id, i) => ({ id, document: result.documents[i] ?? '', metadata: result.metadatas[i] ?? {} }));
  if (postFilter) rows = rows.filter((r) => postFilter.test(r.document)).slice(0, limit);

  return {
    tool: 'keyword_search',
    mode,
    query: pattern ?? phrase,
    hits: rows.map((r) => ({
      chunk_id: r.id,
      text: r.document,
      meta: r.metadata,
      denseSim: 0,
      refHit: false,
      exactHit: true,
      isWeb: false,
      isNeighbour: false,
      routes: ['exact'],
    })),
  };
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
