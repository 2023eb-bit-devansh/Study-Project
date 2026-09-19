/** Typed application errors that map cleanly onto HTTP status codes. */

export class AppError extends Error {
  /** @param {string} message @param {object} [opts] */
  constructor(message, { status = 500, code = 'internal_error', detail = undefined, cause = undefined } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) } };
  }
}

export const badRequest   = (m, d) => new AppError(m, { status: 400, code: 'bad_request', detail: d });
export const unauthorized = (m = 'Missing or invalid dashboard token') => new AppError(m, { status: 401, code: 'unauthorized' });
export const notFound     = (m = 'Not found') => new AppError(m, { status: 404, code: 'not_found' });
export const conflict     = (m, d) => new AppError(m, { status: 409, code: 'conflict', detail: d });
export const payloadTooLarge = (m) => new AppError(m, { status: 413, code: 'payload_too_large' });
export const upstream     = (m, d) => new AppError(m, { status: 502, code: 'upstream_error', detail: d });
export const unavailable  = (m, d) => new AppError(m, { status: 503, code: 'service_unavailable', detail: d });

/** Wrap an async express handler so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
