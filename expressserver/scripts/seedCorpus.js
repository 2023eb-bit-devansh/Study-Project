#!/usr/bin/env node
/**
 * Ingest the seed corpus into Chroma.
 *
 *   npm run seed              ingest every seed document
 *   npm run seed -- --force   re-ingest even if the collection is populated
 *   npm run seed -- --only ipc-1860,rti-2005
 *
 * Requires GEMINI_API_KEY: every chunk is embedded with
 * taskType=RETRIEVAL_DOCUMENT before it reaches the collection.
 */
import { loadSeedDocuments } from '../src/corpus/seed/loadSeed.js';
import { ingestDocument, corpusStats } from '../src/corpus/ingest.js';
import { chromaHeartbeat } from '../src/providers/chroma/client.js';
import { resolveModels } from '../src/config/models.js';
import { hasApiKey } from '../src/providers/gemini/client.js';
import { config } from '../src/config/index.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? (args[onlyArg + 1] ?? '').split(',').filter(Boolean) : null;

const BATCH = `seed-${new Date().toISOString().slice(0, 10)}`;

function bail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

const hb = await chromaHeartbeat();
if (!hb.ok) bail(`Chroma is not reachable at ${hb.url}: ${hb.error}\n  Start it with:  chroma run --port ${config.chroma.port}`);
console.log(`Chroma v${hb.version} at ${hb.url}`);

if (!hasApiKey()) {
  bail(
    'GEMINI_API_KEY is not set.\n' +
    '  Seeding embeds every chunk with the Gemini embedding model, so a key is required.\n' +
    `  Add it to ${config.root}/.env and run this again.\n` +
    '  Get one at https://aistudio.google.com/apikey',
  );
}
await resolveModels({ required: true });

const before = await corpusStats();
if (before.count > 0 && !force) {
  console.log(`\nCollection "${before.collection}" already holds ${before.count} chunks.`);
  console.log('Re-ingest is idempotent per document, but pass --force to confirm.\n');
  process.exit(0);
}

let docs = loadSeedDocuments();
if (only) docs = docs.filter(({ doc }) => only.includes(doc.doc_id));
if (docs.length === 0) bail('No seed documents matched.');

console.log(`\nIngesting ${docs.length} documents into "${config.chroma.collection}" (batch ${BATCH})\n`);

let totalChunks = 0;
for (const { doc } of docs) {
  process.stdout.write(`  ${doc.doc_id.padEnd(32)}`);
  try {
    const r = await ingestDocument(doc, { ingestBatch: BATCH });
    totalChunks += r.chunks;
    console.log(`${String(r.chunks).padStart(3)} chunks  ${String(r.chars).padStart(6)} chars  ${r.ms}ms`);
  } catch (err) {
    console.log('FAILED');
    bail(`${doc.doc_id}: ${err.message}`);
  }
}

const after = await corpusStats();
console.log(`\n✔ ${totalChunks} chunks ingested. Collection now holds ${after.count}.`);
console.log(`  by act:  ${Object.entries(after.byActCode).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`  by type: ${Object.entries(after.byDocType).map(([k, v]) => `${k}=${v}`).join('  ')}`);
if (after.unverified > 0) {
  console.log(
    `\n⚠  ${after.unverified} chunks are marked verification_status="unverified".\n` +
    '   Statutory text must be checked against indiacode.nic.in before this corpus is\n' +
    '   used for a demonstration — a mistranscribed clause produces a confidently\n' +
    '   WRONG "Supported" verdict, which is the one failure mode with no automated check.\n' +
    '   Run `npm run verify-corpus` for the sign-off checklist.\n',
  );
}
