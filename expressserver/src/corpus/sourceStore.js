/**
 * The Source Text Store.
 *
 * Citation verification matches a model's quote against *real source text*,
 * which means the full text of every ingested document has to survive
 * ingestion — a Chroma chunk alone is not enough, because `read_passage`
 * expands across chunk boundaries and a quote may straddle them.
 *
 * Each document is written to `data/sources/<doc_id>.json` holding the full
 * concatenated text plus the (char_start, char_end) span of every chunk. A
 * chunk's stored text is exactly `text.slice(char_start, char_end)`, so a
 * span in one is a span in the other with no re-alignment.
 *
 * Fetched web pages live under the same store with a `web::<sha1(uri)>` id,
 * which is what makes a grounded search result eligible for quote
 * verification at all.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { sha1 } from '../util/hash.js';

const dir = () => config.corpus.sourceTextDir;
const webDir = () => path.join(dir(), 'web');

function ensure(d) { mkdirSync(d, { recursive: true }); }

const safeId = (id) => String(id).replace(/[^A-Za-z0-9._:-]/g, '_');

export function sourcePath(docId) {
  return path.join(dir(), `${safeId(docId)}.json`);
}
export function webSourceId(uri) {
  return `web::${sha1(uri)}`;
}
function webPath(sourceId) {
  return path.join(webDir(), `${safeId(sourceId)}.json`);
}

/** @typedef {{ doc_id:string, doc_title:string, source_url:string, text:string, chunks:{chunk_id:string,char_start:number,char_end:number}[], ingested_at:string }} SourceRecord */

export function writeSource(record) {
  ensure(dir());
  writeFileSync(sourcePath(record.doc_id), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/** @returns {SourceRecord|null} */
export function readSource(docId) {
  const p = docId.startsWith('web::') ? webPath(docId) : sourcePath(docId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function deleteSource(docId) {
  const p = docId.startsWith('web::') ? webPath(docId) : sourcePath(docId);
  if (existsSync(p)) { unlinkSync(p); return true; }
  return false;
}

export function listSources() {
  ensure(dir());
  return readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/** Store a fetched web page so its quotes can be verified. */
export function writeWebSource({ uri, title, text }) {
  ensure(webDir());
  const id = webSourceId(uri);
  const record = {
    doc_id: id,
    doc_title: title || uri,
    source_url: uri,
    doc_type: 'web',
    text,
    chunks: [],
    ingested_at: new Date().toISOString(),
  };
  writeFileSync(webPath(id), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/**
 * The passage behind a chunk id, read from the source of truth rather than
 * from whatever Chroma happened to return. Citation verification always
 * reads through here.
 */
export function passageForChunk(docId, charStart, charEnd) {
  const src = readSource(docId);
  if (!src) return null;
  return src.text.slice(charStart, charEnd);
}
