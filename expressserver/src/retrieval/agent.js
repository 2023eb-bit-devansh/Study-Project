/**
 * Retrieval entry point. Selects a driver by RETRIEVAL_MODE.
 *
 * Only `heuristic` ships. An LLM function-calling driver over the identical
 * tool layer in `tools/` is deferred to Phase 3 as the comparison arm of the
 * evaluation — which is the point of keeping the tool layer driver-agnostic.
 */
import { retrieve as heuristicRetrieve } from './heuristicDriver.js';
import { config } from '../config/index.js';

const DRIVERS = { heuristic: heuristicRetrieve };

export function retrievalAgent(args) {
  const driver = DRIVERS[config.retrieval.mode];
  if (!driver) throw new Error(`Unknown RETRIEVAL_MODE "${config.retrieval.mode}"`);
  return driver(args);
}

export { shouldEscalate } from './heuristicDriver.js';
