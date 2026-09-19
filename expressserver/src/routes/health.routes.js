/**
 * GET /api/health — one call that answers "can this system actually run?"
 *
 * Every dependency the pipeline needs is probed: Chroma reachability, the
 * collection and its chunk count, the undocumented $regex capability, and
 * whether the Gemini model roles resolved at boot. The dashboard Overview
 * renders this directly.
 */
import { Router } from 'express';
import { chromaHeartbeat } from '../providers/chroma/client.js';
import { collectionStats, chromaCapabilities } from '../providers/chroma/collection.js';
import { hasApiKey } from '../providers/gemini/client.js';
import { resolvedModels, packageVersion, config } from '../config/index.js';
import { asyncRoute } from '../util/errors.js';

export const healthRouter = Router();

healthRouter.get('/health', asyncRoute(async (_req, res) => {
  const [heartbeat, stats] = await Promise.all([chromaHeartbeat(), collectionStats()]);
  const caps = chromaCapabilities();

  const checks = {
    chroma: {
      ok: heartbeat.ok,
      label: 'Chroma server',
      detail: heartbeat.ok ? `v${heartbeat.version} at ${heartbeat.url}` : heartbeat.error,
      meta: heartbeat,
    },
    collection: {
      ok: stats.ok,
      label: 'Legal corpus collection',
      detail: stats.ok
        ? `${config.chroma.collection} — ${stats.count} chunk${stats.count === 1 ? '' : 's'}`
        : stats.error,
      // An empty collection is reachable but not usable: retrieval will
      // return nothing and every claim will abstain.
      warn: stats.ok && stats.count === 0,
      warnDetail: 'Collection is empty. Run `npm run seed` to ingest the seed corpus.',
      meta: stats,
    },
    chromaRegex: {
      ok: true,
      label: 'whereDocument.$regex',
      detail: caps.regexSupported === true
        ? 'supported — pattern search enabled'
        : caps.skipped
          ? 'probe skipped (CHROMA_REGEX_SELFTEST=false) — using $contains fallback'
          : 'unsupported — using $contains + in-process regex fallback',
      warn: caps.regexSupported !== true,
      meta: caps,
    },
    geminiKey: {
      ok: hasApiKey(),
      label: 'Gemini API key',
      detail: hasApiKey() ? 'set' : 'GEMINI_API_KEY is empty in expressserver/.env',
    },
    geminiModels: {
      ok: resolvedModels.source === 'listmodels' || resolvedModels.source === 'env',
      label: 'Gemini model roles',
      detail: resolvedModels.source === 'listmodels'
        ? `resolved against ListModels (${resolvedModels.available?.length ?? 0} models visible)`
        : resolvedModels.source === 'env'
          ? 'taken from .env without validation'
          : resolvedModels.error === 'no_api_key'
            ? 'unresolved — no API key'
            : `unresolved (${resolvedModels.error ?? 'unknown'})`,
      meta: {
        source: resolvedModels.source,
        extraction: resolvedModels.extraction,
        vision: resolvedModels.vision,
        retrieval: resolvedModels.retrieval,
        verdict: resolvedModels.verdict,
        grounding: resolvedModels.grounding,
        embed: resolvedModels.embed,
        warnings: resolvedModels.warnings ?? [],
      },
    },
  };

  const failing = Object.values(checks).filter((c) => !c.ok);
  const warning = Object.values(checks).filter((c) => c.ok && c.warn);
  const status = failing.length ? 'down' : warning.length ? 'degraded' : 'ok';

  res.status(failing.length ? 503 : 200).json({
    status,
    version: packageVersion(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    checks,
  });
}));
