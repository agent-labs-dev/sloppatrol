import { randomBytes } from 'node:crypto';

/** Sortable by time, to the millisecond: `20261028T043100123-3f9a`. */
export function newId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '').replace(/Z$/, '');
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}
