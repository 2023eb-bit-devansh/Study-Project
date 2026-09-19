/** API monitoring endpoints backing the dashboard Overview and Requests views. */
import { Router } from 'express';
import { listRequests, getRequest, metricsSnapshot } from '../middleware/requestMonitor.js';
import { notFound } from '../util/errors.js';

export const metricsRouter = Router();

metricsRouter.get('/metrics', (req, res) => {
  const windowMs = Number(req.query.windowMs) || 0;
  res.json(metricsSnapshot({ windowMs }));
});

metricsRouter.get('/requests', (req, res) => {
  res.json(listRequests({
    limit: Math.min(Number(req.query.limit) || 100, 500),
    since: Number(req.query.since) || 0,
    path: req.query.path ? String(req.query.path) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
  }));
});

metricsRouter.get('/requests/:id', (req, res, next) => {
  const entry = getRequest(req.params.id);
  if (!entry) return next(notFound(`No captured request "${req.params.id}"`));
  return res.json(entry);
});
