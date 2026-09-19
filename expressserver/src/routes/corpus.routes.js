/**
 * Corpus manager API (FR22 — "the project team shall be able to update the
 * legal corpus"). Read endpoints are open; anything that mutates the vector
 * store requires X-Dashboard-Token.
 */
import { Router } from 'express';
import multer from 'multer';
import { getCollection } from '../providers/chroma/collection.js';
import { corpusStats, ingestDocuments, deleteDocument, validateDocument } from '../corpus/ingest.js';
import { loadSeedDocuments } from '../corpus/seed/loadSeed.js';
import { readSource } from '../corpus/sourceStore.js';
import { requireDashboardToken } from '../middleware/dashboardAuth.js';
import { eq, all, contains, regex as regexDoc } from '../providers/chroma/where.js';
import { regexSupported } from '../providers/chroma/collection.js';
import { asyncRoute, badRequest, notFound } from '../util/errors.js';
import { config } from '../config/index.js';

export const corpusRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.claims.fileMaxBytes, files: 20 },
});

corpusRouter.get('/corpus/stats', asyncRoute(async (_req, res) => {
  res.json(await corpusStats());
}));

corpusRouter.get('/corpus/documents', asyncRoute(async (_req, res) => {
  const stats = await corpusStats();
  res.json({ collection: stats.collection, documents: stats.documents });
}));

/** The seed set on disk, whether or not it has been ingested. */
corpusRouter.get('/corpus/seed', asyncRoute(async (_req, res) => {
  const docs = loadSeedDocuments();
  res.json({
    dir: config.corpus.seedDir,
    documents: docs.map(({ file, doc }) => ({
      file,
      doc_id: doc.doc_id,
      doc_title: doc.doc_title,
      doc_type: doc.doc_type,
      act_code: doc.act_code ?? '',
      source_url: doc.source_url ?? '',
      verification_status: doc.verification_status ?? 'unverified',
      provisions: (doc.provisions ?? doc.paragraphs ?? []).length,
    })),
  });
}));

corpusRouter.get('/corpus/chunks', asyncRoute(async (req, res) => {
  const col = await getCollection();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;

  const filters = [];
  if (req.query.doc_id) filters.push(eq('doc_id', String(req.query.doc_id)));
  if (req.query.act_code) filters.push(eq('act_code', String(req.query.act_code)));
  if (req.query.doc_type) filters.push(eq('doc_type', String(req.query.doc_type)));
  if (req.query.ref_key) filters.push(eq('ref_key', String(req.query.ref_key)));
  if (req.query.status) filters.push(eq('status', String(req.query.status)));

  let whereDocument;
  if (req.query.q) {
    const q = String(req.query.q);
    // Case-insensitive text search: $regex when the server supports it,
    // otherwise the literal $contains fallback.
    whereDocument = regexSupported()
      ? regexDoc(`(?i)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      : contains(q);
  }

  const result = await col.get({
    where: all(...filters),
    ...(whereDocument ? { whereDocument } : {}),
    limit,
    offset,
    include: ['documents', 'metadatas'],
  });

  res.json({
    count: result.ids.length,
    limit,
    offset,
    chunks: result.ids.map((id, i) => ({
      id,
      document: result.documents[i],
      metadata: result.metadatas[i],
    })),
  });
}));

corpusRouter.get('/corpus/source/:docId', asyncRoute(async (req, res, next) => {
  const src = readSource(req.params.docId);
  if (!src) return next(notFound(`No stored source text for "${req.params.docId}"`));
  return res.json(src);
}));

// ── mutating ────────────────────────────────────────────────────────────

corpusRouter.post(
  '/corpus/ingest',
  requireDashboardToken,
  upload.array('files'),
  asyncRoute(async (req, res) => {
    let docs = [];

    if (req.files?.length) {
      for (const f of req.files) {
        let parsed;
        try {
          parsed = JSON.parse(f.buffer.toString('utf8'));
        } catch {
          throw badRequest(`"${f.originalname}" is not valid JSON. Expected a corpus document — see src/corpus/seed/documents/ for the shape.`);
        }
        docs.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
    } else if (req.body?.documents) {
      docs = Array.isArray(req.body.documents) ? req.body.documents : [req.body.documents];
    } else if (req.body?.seed) {
      docs = loadSeedDocuments().map(({ doc }) => doc);
    } else {
      throw badRequest('Provide `documents`, upload `files`, or set `seed: true`.');
    }

    docs.forEach(validateDocument);
    const batch = req.body?.ingest_batch || `api-${new Date().toISOString().slice(0, 10)}`;
    res.json(await ingestDocuments(docs, { ingestBatch: batch }));
  }),
);

corpusRouter.delete('/corpus/documents/:docId', requireDashboardToken, asyncRoute(async (req, res) => {
  res.json(await deleteDocument(req.params.docId));
}));

/**
 * Retrieval playground.
 *
 * Runs the seed query plan for an arbitrary claim and returns the ranked
 * candidates with their score components — WITHOUT calling the verdict
 * model. Ranking weights can be overridden per call, which is what powers
 * the RANK_W_REF ablation: run "punishment for murder in India" with
 * `w_ref: 0` and a semantically similar but wrong section tends to rank
 * first; restore the default 0.3 and the section the claim actually names
 * comes top. That single slider is the empirical justification for hybrid
 * retrieval, and it costs one endpoint.
 */
corpusRouter.post('/corpus/search', asyncRoute(async (req, res) => {
  const { createPool } = await import('../retrieval/fusion.js');
  const { planSeedQueries, counterQuery } = await import('../retrieval/queryPlanner.js');
  const { buildIdf } = await import('../retrieval/idf.js');
  const { TOOLS } = await import('../retrieval/tools/index.js');
  const { expandAllAliases, extractReferences } = await import('../corpus/refKey.js');
  const { assess } = await import('../retrieval/sufficiency.js');

  const text = String(req.body?.text ?? '').trim();
  if (!text) throw badRequest('`text` is required.');

  const weights = {
    wDense: num(req.body?.w_dense, config.ranking.wDense),
    wRef: num(req.body?.w_ref, config.ranking.wRef),
    wExact: num(req.body?.w_exact, config.ranking.wExact),
    penaltyWeb: config.ranking.penaltyWeb,
    penaltyNeighbour: config.ranking.penaltyNeighbour,
    nearDupJaccard: config.ranking.nearDupJaccard,
  };

  await buildIdf().catch(() => {});

  const refKeys = req.body?.ref_keys ?? extractReferences(text).map((r) => r.ref_key);
  const claim = { id: 'p1', text, claim_type: req.body?.claim_type ?? 'statutory_content', ref_keys: refKeys };
  const wanted = expandAllAliases(refKeys);

  const pool = createPool(weights);
  const steps = planSeedQueries(claim);
  if (req.body?.include_counter_evidence !== false) {
    steps.push({ tool: 'search_corpus', args: { query: counterQuery(claim) }, label: 'counter-evidence' });
  }

  const executed = [];
  for (const step of steps) {
    let hits = [];
    let error;
    try {
      const result = await TOOLS[step.tool](step.args);
      hits = result.hits ?? [];
    } catch (err) { error = err.message; }

    for (const hit of hits) {
      const refHit = hit.refHit
        || (hit.meta?.ref_key && wanted.includes(hit.meta.ref_key))
        || (hit.meta?.ref_key_alt && wanted.includes(hit.meta.ref_key_alt));
      pool.upsert({ ...hit, refHit: Boolean(refHit) });
    }
    executed.push({ tool: step.tool, label: step.label, args: step.args, hits: hits.length, error });
  }

  const ranked = pool.ranked(20);
  res.json({
    claim: text,
    ref_keys: refKeys,
    weights,
    steps: executed,
    sufficiency: assess({ subClaimText: text, refKeys, candidates: ranked, progress: ranked.length, turnsDone: 99 }),
    candidates: ranked.map((c) => ({
      chunk_id: c.chunk_id,
      score: Number(c.score.toFixed(4)),
      components: Object.fromEntries(Object.entries(c.components).map(([k, v]) => [k, Number(v.toFixed(4))])),
      routes: c.routes,
      ref_key: c.meta?.ref_key ?? '',
      source_label: [c.meta?.doc_title, c.meta?.heading].filter(Boolean).join(' — '),
      status: c.meta?.status ?? '',
      text: c.text,
    })),
  });
}));

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
