/**
 * Embeddings.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. **Asymmetric task types.** Documents are embedded with
 *    RETRIEVAL_DOCUMENT and queries with RETRIEVAL_QUERY. On
 *    gemini-embedding-001 this is the single biggest retrieval-quality
 *    lever available. gemini-embedding-2 ignores taskType silently, so
 *    `embedSupportsTaskType()` gates it rather than sending a no-op.
 *
 * 2. **L2 normalisation.** gemini-embedding-001 returns unit-norm vectors
 *    only at its native 3072 dimensions. At GEMINI_EMBED_DIM=768 the vector
 *    is Matryoshka-truncated and NOT renormalised. Storing those raw in a
 *    cosine-space HNSW index makes distances subtly wrong, which in turn
 *    makes SUFFICIENCY_MIN_TOP_SCORE meaningless. So we renormalise here,
 *    on both the ingest and the query path, with the same code.
 */
import { getGenAI, withRetry } from './client.js';
import { modelFor, embedSupportsTaskType } from '../../config/models.js';
import { config } from '../../config/index.js';
import { upstream } from '../../util/errors.js';
import { timer } from '../../util/time.js';

export function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return vec;
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Embed an array of texts. Batched at GEMINI_EMBED_BATCH (API cap is 100
 * per batchEmbedContents call). Order is preserved.
 *
 * @param {string[]} texts
 * @param {{ taskType?: 'document'|'query', title?: string }} opts
 * @returns {Promise<{ vectors: number[][], ms: number, model: string, calls: number }>}
 */
export async function embedTexts(texts, { taskType = 'document', title } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { vectors: [], ms: 0, model: modelFor('embed'), calls: 0 };
  }
  const model = modelFor('embed');
  const t = timer();
  const batches = chunk(texts, config.gemini.embedBatch);
  const vectors = [];

  for (const batch of batches) {
    const cfg = { outputDimensionality: config.gemini.embedDim };
    if (embedSupportsTaskType()) {
      cfg.taskType = taskType === 'query' ? config.gemini.taskTypeQuery : config.gemini.taskTypeDoc;
      // `title` is only valid alongside RETRIEVAL_DOCUMENT.
      if (title && taskType === 'document') cfg.title = title;
    }
    const response = await withRetry(
      () => getGenAI().models.embedContent({ model, contents: batch, config: cfg }),
      { label: `embed:${taskType}` },
    );
    const embeddings = response?.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw upstream(
        `Embedding count mismatch: sent ${batch.length}, received ${embeddings.length}`,
      );
    }
    for (const e of embeddings) {
      const values = e?.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw upstream('Embedding response contained an empty vector');
      }
      vectors.push(config.gemini.embedNormalize ? l2normalize(values) : values);
    }
  }

  return { vectors, ms: t.ms(), model, calls: batches.length };
}

/** Convenience for the single-query path. */
export async function embedQuery(text) {
  const { vectors, ms, model } = await embedTexts([text], { taskType: 'query' });
  return { vector: vectors[0], ms, model };
}
