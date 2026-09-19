/**
 * Boot sequence.
 *
 * Order matters: config is validated first (a bad .env should fail before
 * anything opens a socket), then the Chroma capability probe, then Gemini
 * model resolution, and only then does the server listen. Anything that can
 * be known at boot is resolved at boot rather than on the first request.
 */
import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';
import { config, packageVersion } from './config/index.js';
import { probeRegexSupport } from './providers/chroma/collection.js';
import { chromaHeartbeat } from './providers/chroma/client.js';
import { resolveModels } from './config/models.js';
import { startSweeper } from './jobs/jobStore.js';
import { logger } from './util/logger.js';

const log = logger('boot');

async function main() {
  log.info(`AI Fact Checker backend v${packageVersion()} — ${config.server.nodeEnv}`);

  for (const dir of [config.corpus.sourceTextDir, config.jobs.runLogDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const hb = await chromaHeartbeat();
  if (hb.ok) {
    log.info(`Chroma v${hb.version} reachable at ${hb.url} (max batch ${hb.maxBatchSize})`);
    await probeRegexSupport();
  } else {
    log.warn(`Chroma unreachable at ${hb.url}: ${hb.error}`);
    log.warn('Retrieval will fail until it is running. Start it with: chroma run --port 8000');
  }

  await resolveModels();
  startSweeper();

  const app = createApp();
  const server = app.listen(config.server.port, () => {
    log.info(`listening on http://localhost:${config.server.port}`);
    log.info(`health   → http://localhost:${config.server.port}/api/health`);
    if (config.server.dashboardEnabled) {
      log.info(`dashboard → http://localhost:${config.server.port}/`);
    }
  });

  const shutdown = (signal) => {
    log.info(`${signal} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(`boot failed: ${err.message}`);
  if (err.cause) log.error(String(err.cause));
  process.exit(1);
});
