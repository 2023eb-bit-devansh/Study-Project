import { randomId } from './hash.js';

/** Monotonic-ish, sortable, readable job id: job_<base36 ts>_<rand>. */
export const newJobId = () => `job_${Date.now().toString(36)}_${randomId(4)}`;
export const newRequestId = () => `req_${Date.now().toString(36)}_${randomId(3)}`;
