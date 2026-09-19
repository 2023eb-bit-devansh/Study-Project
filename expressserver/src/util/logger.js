/** Minimal levelled logger. No dependency, no transport, no surprises. */
import { config } from '../config/index.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[config.server.logLevel] ?? LEVELS.info;

const COLOR = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  const tag = `${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const line = `${ts} ${tag} ${scope ? `[${scope}] ` : ''}${msg}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra !== undefined) stream(line, extra); else stream(line);
}

export function logger(scope = '') {
  return {
    debug: (m, e) => emit('debug', scope, m, e),
    info:  (m, e) => emit('info', scope, m, e),
    warn:  (m, e) => emit('warn', scope, m, e),
    error: (m, e) => emit('error', scope, m, e),
    child: (sub) => logger(scope ? `${scope}:${sub}` : sub),
  };
}

export default logger;
