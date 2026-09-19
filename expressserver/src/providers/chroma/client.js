/**
 * ChromaClient singleton.
 *
 * `path` is deprecated in chromadb v3 — host/port/ssl are the current
 * options. Tenant and database are passed explicitly so the client does not
 * make an extra `GET /api/v2/auth/identity` round-trip on first use.
 */
import { ChromaClient } from 'chromadb';
import { config } from '../../config/index.js';
import { logger } from '../../util/logger.js';

const log = logger('chroma');

let client = null;

export function getChromaClient() {
  if (client) return client;
  client = new ChromaClient({
    host: config.chroma.host,
    port: config.chroma.port,
    ssl: config.chroma.ssl,
    tenant: config.chroma.tenant,
    database: config.chroma.database,
  });
  log.debug(`client → ${config.chroma.ssl ? 'https' : 'http'}://${config.chroma.host}:${config.chroma.port}`);
  return client;
}

export const chromaBaseUrl = () =>
  `${config.chroma.ssl ? 'https' : 'http'}://${config.chroma.host}:${config.chroma.port}`;

/** Liveness + version, used by /api/health. Never throws. */
export async function chromaHeartbeat() {
  const base = chromaBaseUrl();
  try {
    const [hb, ver, pre] = await Promise.all([
      fetch(`${base}/api/v2/heartbeat`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
      fetch(`${base}/api/v2/version`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
      fetch(`${base}/api/v2/pre-flight-checks`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()),
    ]);
    return {
      ok: true,
      url: base,
      version: ver,
      heartbeatNs: hb?.['nanosecond heartbeat'] ?? null,
      maxBatchSize: pre?.max_batch_size ?? null,
    };
  } catch (err) {
    return { ok: false, url: base, error: err?.message ?? String(err) };
  }
}
