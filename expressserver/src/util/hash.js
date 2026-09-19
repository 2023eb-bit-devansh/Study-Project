import { createHash, randomBytes } from 'node:crypto';

export const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');
export const sha1short = (s) => sha1(s).slice(0, 12);
export const randomId = (bytes = 8) => randomBytes(bytes).toString('hex');
