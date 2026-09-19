/**
 * Load the seed corpus from disk.
 *
 * The seed lives as plain JSON so it can be reviewed, diffed and corrected
 * by a human without touching code — which matters, because verifying this
 * text against the official Gazette is a manual step that has to happen
 * before the corpus is trustworthy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config/index.js';
import { validateDocument } from '../ingest.js';

export function loadSeedDocuments({ dir = config.corpus.seedDir } = {}) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.map((file) => {
    const doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    validateDocument(doc);
    return { file, doc };
  });
}
