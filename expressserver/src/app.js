import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config/index.js';
import { requestMonitor } from './middleware/requestMonitor.js';
import { healthRouter } from './routes/health.routes.js';
import { configRouter } from './routes/config.routes.js';
import { metricsRouter } from './routes/metrics.routes.js';
import { corpusRouter } from './routes/corpus.routes.js';
import { verifyRouter } from './routes/verify.routes.js';
import { AppError } from './util/errors.js';
import { logger } from './util/logger.js';

const log = logger('http');

/**
 * CORS.
 *
 * An unpacked Chrome extension gets a new ID on every fresh load, so pinning
 * `chrome-extension://<id>` in .env is unworkable during development. In
 * development any chrome-extension:// origin is accepted; in production only
 * the explicit CORS_ALLOWED_ORIGINS list is.
 */
function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true); // curl, same-origin, server-to-server
  if (config.server.corsOrigins.includes(origin)) return callback(null, true);
  if (config.isDev && origin.startsWith('chrome-extension://')) return callback(null, true);
  return callback(new AppError(`Origin not allowed: ${origin}`, { status: 403, code: 'cors_denied' }));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(cors({
    origin: corsOriginCheck,
    allowedHeaders: ['Content-Type', 'X-Dashboard-Token'],
    exposedHeaders: ['X-Request-Id', 'X-Job-Id'],
  }));

  const limit = `${config.server.maxBodyMb}mb`;
  app.use(express.json({ limit }));
  app.use(express.urlencoded({ extended: true, limit }));

  app.use(requestMonitor());

  const api = express.Router();
  api.use(healthRouter);
  api.use(configRouter);
  api.use(metricsRouter);
  api.use(corpusRouter);
  api.use(verifyRouter);
  app.use('/api', api);

  // Built dashboard, when present. SPA fallback must not swallow /api.
  const publicDir = path.join(config.root, 'public');
  if (config.server.dashboardEnabled && existsSync(path.join(publicDir, 'index.html'))) {
    app.use(express.static(publicDir, { index: 'index.html', maxAge: config.isDev ? 0 : '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  } else if (config.server.dashboardEnabled) {
    app.get('/', (_req, res) => res.status(200).type('text/plain').send(
      'Dashboard is not built yet.\n\n' +
      '  cd expressserver/dashboard && npm install && npm run build\n\n' +
      'Or run it in dev mode on http://localhost:5173:\n\n' +
      '  npm run dashboard:dev\n',
    ));
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
  });

  // eslint-disable-next-line no-unused-vars -- express identifies error middleware by arity
  app.use((err, req, res, _next) => {
    const status = err instanceof AppError ? err.status : (err.status ?? 500);
    const code = err instanceof AppError ? err.code : 'internal_error';
    res.locals.errorCode = code;
    if (status >= 500) log.error(`${req.method} ${req.path} → ${status} ${code}: ${err.message}`, err.cause ?? '');
    else log.warn(`${req.method} ${req.path} → ${status} ${code}: ${err.message}`);
    res.status(status).json({
      error: {
        code,
        message: err.message,
        ...(err.detail ? { detail: err.detail } : {}),
        requestId: req.requestId,
      },
    });
  });

  return app;
}
