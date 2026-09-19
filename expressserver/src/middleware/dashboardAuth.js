/**
 * Mutating corpus endpoints require a shared token. Trivial, but it means
 * the ingest endpoint is not an open write to the vector store for anything
 * that can reach localhost:3000.
 */
import { config } from '../config/index.js';
import { unauthorized } from '../util/errors.js';

export function requireDashboardToken(req, _res, next) {
  const supplied = req.get('X-Dashboard-Token');
  if (!supplied || supplied !== config.server.dashboardToken) {
    return next(unauthorized('X-Dashboard-Token missing or incorrect.'));
  }
  return next();
}
