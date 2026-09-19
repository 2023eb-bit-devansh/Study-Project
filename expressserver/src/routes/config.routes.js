/**
 * GET /api/config — every resolved model id and every threshold in one
 * response, secrets redacted. This is the NFR 4.4 evidence: one screenshot
 * showing that nothing is hardcoded.
 */
import { Router } from 'express';
import { redactedConfig } from '../config/index.js';

export const configRouter = Router();

configRouter.get('/config', (_req, res) => {
  res.json(redactedConfig());
});
