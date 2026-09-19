/**
 * Ingest: document → chunks → Gemini embeddings → Chroma.
 *
 * Documents are embedded with taskType RETRIEVAL_DOCUMENT while queries use
 * RETRIEVAL_QUERY. That asymmetry is the single biggest retrieval-quality
 * lever available on gemini-embedding-001, and it is free.
 *
 * Ingest is idempotent per document: existing chunks for a doc_id are
 * deleted before the new ones are added, so re-ingesting an edited document
 * does not leave orphans behind.
 */
import { getCollection } from '../providers/chroma/collection.js';
import { embedTexts } from '../providers/gemini/embed.js';
import { config } from '../config/index.js';
import { chunkDocument } from './chunker.js';
import { buildChunkMetadata } from './metadata.js';
import { writeSource, deleteSource } from './sourceStore.js';
import { eq } from '../providers/chroma/where.js';
import { logger } from '../util/logger.js';
import { badRequest } from '../util/errors.js';
import { timer } from '../util/time.js';

const log = logger('ingest');

const REQUIRED = ['doc_id', 'doc_title', 'doc_type'];

export function validateDocument(doc) {
  for (const f of REQUIRED) {
    if (!doc?.[f]) throw badRequest(`Document is missing required field "${f}"`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(doc.doc_id)) {
    throw badRequest(`doc_id "${doc.doc_id}" must be alphanumeric with . _ - only`);
  }
  const hasBody = (doc.provisions?.length ?? 0) > 0 || (doc.paragraphs?.length ?? 0) > 0;
  if (!hasBody) throw badRequest(`Document "${doc.doc_id}" has no provisions or paragraphs`);
  return doc;
}

/** Remove every chunk belonging to a doc_id, and its stored source text. */
export async function deleteDocument(docId) {
  const col = await getCollection();
  const existing = await col.get({ where: eq('doc_id', docId), include: [] });
  if (existing.ids.length) await col.delete({ ids: existing.ids });
  deleteSource(docId);
  return { docId, deleted: existing.ids.length };
}

/**
 * @param {object} doc
 * @param {{ ingestBatch?: string, onProgress?: (msg:string)=>void }} opts
 */
export async function ingestDocument(doc, { ingestBatch = 'manual', onProgress } = {}) {
  validateDocument(doc);
  const t = timer();
  const say = (m) => { onProgress?.(m); log.debug(m); };

  const { text, chunks } = chunkDocument(doc, { ingestBatch });
  if (chunks.length === 0) throw badRequest(`Document "${doc.doc_id}" produced no chunks`);
  say(`${doc.doc_id}: ${chunks.length} chunks, ${text.length} chars`);

  // Embed first. If Gemini fails we have not yet touched the collection, so
  // a quota error leaves the corpus exactly as it was rather than half-wiped.
  const { vectors, calls, model } = await embedTexts(
    chunks.map((c) => c.text),
    { taskType: 'document', title: doc.doc_title },
  );
  say(`${doc.doc_id}: embedded via ${model} in ${calls} call${calls === 1 ? '' : 's'}`);

  const { deleted } = await deleteDocument(doc.doc_id);
  if (deleted) say(`${doc.doc_id}: replaced ${deleted} existing chunks`);

  const col = await getCollection();
  const ids = chunks.map((c) => c.chunk_id);
  const metadatas = chunks.map((c) => buildChunkMetadata(doc, c));
  const documents = chunks.map((c) => c.text);

  const batch = config.chroma.addBatch;
  for (let i = 0; i < ids.length; i += batch) {
    await col.add({
      ids: ids.slice(i, i + batch),
      embeddings: vectors.slice(i, i + batch),
      documents: documents.slice(i, i + batch),
      metadatas: metadatas.slice(i, i + batch),
    });
  }

  writeSource({
    doc_id: doc.doc_id,
    doc_title: doc.doc_title,
    doc_type: doc.doc_type,
    act_code: doc.act_code ?? '',
    source_url: doc.source_url ?? '',
    verification_status: doc.verification_status ?? 'unverified',
    text,
    chunks: chunks.map((c) => ({ chunk_id: c.chunk_id, char_start: c.char_start, char_end: c.char_end, seq: c.seq })),
    ingested_at: new Date().toISOString(),
  });

  return {
    doc_id: doc.doc_id,
    doc_title: doc.doc_title,
    chunks: chunks.length,
    replaced: deleted,
    chars: text.length,
    embedModel: model,
    ms: Math.round(t.ms()),
  };
}

export async function ingestDocuments(docs, opts = {}) {
  const results = [];
  for (const doc of docs) results.push(await ingestDocument(doc, opts));
  return {
    documents: results.length,
    chunks: results.reduce((a, r) => a + r.chunks, 0),
    ms: results.reduce((a, r) => a + r.ms, 0),
    results,
  };
}

/** Aggregate view for the corpus manager and /api/health. */
export async function corpusStats() {
  const col = await getCollection();
  const count = await col.count();
  if (count === 0) {
    return {
      collection: config.chroma.collection, count: 0, documents: [],
      byActCode: {}, byDocType: {}, byStatus: {}, unverified: 0,
    };
  }
  const all = await col.get({ include: ['metadatas'] });
  const docs = new Map();
  const byActCode = {};
  const byDocType = {};
  const byStatus = {};
  let unverified = 0;

  for (const meta of all.metadatas) {
    if (!meta) continue;
    const d = docs.get(meta.doc_id) ?? {
      doc_id: meta.doc_id, doc_title: meta.doc_title, doc_type: meta.doc_type,
      act_code: meta.act_code, source_url: meta.source_url,
      verification_status: meta.verification_status, chunks: 0,
    };
    d.chunks++;
    docs.set(meta.doc_id, d);
    byActCode[meta.act_code || '—'] = (byActCode[meta.act_code || '—'] ?? 0) + 1;
    byDocType[meta.doc_type] = (byDocType[meta.doc_type] ?? 0) + 1;
    byStatus[meta.status] = (byStatus[meta.status] ?? 0) + 1;
    if (meta.verification_status !== 'verified') unverified++;
  }

  return {
    collection: config.chroma.collection,
    count,
    documents: [...docs.values()].sort((a, b) => a.doc_id.localeCompare(b.doc_id)),
    byActCode, byDocType, byStatus, unverified,
  };
}
