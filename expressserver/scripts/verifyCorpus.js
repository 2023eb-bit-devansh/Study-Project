#!/usr/bin/env node
/**
 * Corpus sign-off checklist.
 *
 * Every provision in the seed corpus was transcribed by hand and is marked
 * verification_status="unverified" until a human has compared it, word for
 * word, against the official text. This script prints that checklist with
 * the source URL for each document, plus the statutory equivalence table.
 *
 * This matters more than it looks. Every other failure mode in this system
 * has an automated defence — the citation verifier catches invented quotes,
 * the decision table catches thin evidence, the number guard catches changed
 * penalties. A wrong section number IN THE CORPUS has none of them: it
 * produces a verified quote from real stored text supporting a false claim.
 */
import { loadSeedDocuments } from '../src/corpus/seed/loadSeed.js';
import { EQUIVALENCES, formatRefKey } from '../src/corpus/refKey.js';
import { buildRefKey } from '../src/corpus/refKey.js';

const docs = loadSeedDocuments();

console.log('\n════ CORPUS VERIFICATION CHECKLIST ════\n');
console.log('Compare each provision against the official text at the URL shown.');
console.log('When a document is fully checked, set "verification_status": "verified"');
console.log('in its JSON file and re-run `npm run seed -- --force`.\n');

let total = 0;
for (const { file, doc } of docs) {
  const items = doc.provisions ?? doc.paragraphs ?? [];
  total += items.length;
  const flag = doc.verification_status === 'verified' ? '✔' : '☐';
  console.log(`${flag} ${doc.doc_title}`);
  console.log(`   file:   src/corpus/seed/documents/${file}`);
  console.log(`   source: ${doc.source_url || '(none recorded)'}`);
  console.log(`   status: ${doc.verification_status}`);
  for (const p of items) {
    const label = p.para
      ? `para ${p.para}`
      : formatRefKey(buildRefKey({
          act_code: doc.act_code, section: p.section, subsection: p.subsection,
          article: p.article, clause: p.clause, sub: p.sub,
        })) || p.heading;
    console.log(`     ☐ ${String(label).padEnd(28)} ${(p.heading ?? '').slice(0, 60)}`);
  }
  console.log();
}

console.log('════ STATUTORY EQUIVALENCE TABLE ════\n');
console.log('These drive `lookup_legal_reference` alias expansion. A wrong row here');
console.log('means a claim about one provision retrieves the text of a different one.\n');
for (const { a, b, note } of EQUIVALENCES) {
  console.log(`  ☐ ${a.padEnd(14)} ↔ ${b.padEnd(14)} ${note}`);
}

console.log(`\n${total} provisions and ${EQUIVALENCES.length} equivalences require sign-off.\n`);
