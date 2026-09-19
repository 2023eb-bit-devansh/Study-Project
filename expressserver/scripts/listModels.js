#!/usr/bin/env node
/** Print every model this API key can see, and what the boot resolver picks. */
import { listModels, hasApiKey } from '../src/providers/gemini/client.js';
import { resolveModels } from '../src/config/models.js';

if (!hasApiKey()) {
  console.error('\n✖ GEMINI_API_KEY is not set in expressserver/.env\n');
  process.exit(1);
}

const models = await listModels();
const gen = models.filter((m) => m.methods.includes('generateContent'));
const emb = models.filter((m) => m.methods.includes('embedContent'));

console.log(`\ngenerateContent (${gen.length}):`);
for (const m of gen) console.log(`  ${m.name.padEnd(34)} in ${String(m.inputTokenLimit ?? '—').padStart(9)}  out ${m.outputTokenLimit ?? '—'}`);
console.log(`\nembedContent (${emb.length}):`);
for (const m of emb) console.log(`  ${m.name}`);

const resolved = await resolveModels({ required: true });
console.log('\nResolved roles:');
for (const role of ['extraction', 'vision', 'retrieval', 'verdict', 'grounding', 'embed']) {
  console.log(`  ${role.padEnd(12)} ${resolved[role]}`);
}
for (const w of resolved.warnings ?? []) console.log(`\n⚠  ${w}`);
console.log();
