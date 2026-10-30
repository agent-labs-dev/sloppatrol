import type { Opportunity, Strength } from './opportunity.js';
import type { Refactor } from './refactor.js';

const RANK: Record<Strength, number> = { strong: 0, 'worth-exploring': 1, speculative: 2 };

/**
 * The next opportunities to attempt: strongest first, then the least tried.
 * None while `maxOpen` pull requests wait for a person, and none that touch
 * a file an open pull request changes, so two pull requests never conflict.
 * A source file that waiting characterization tests cover waits too.
 */
export function pickOpportunities(
  opportunities: Opportunity[],
  refactors: Refactor[],
  limits: { count: number; maxOpen: number },
): Opportunity[] {
  const waiting = refactors.filter((r) => r.status === 'verified' || r.status === 'published');
  const room = Math.min(limits.count, limits.maxOpen - waiting.length);
  if (room <= 0) return [];
  // A waiting refactor's files are busy, and so is the source file its new
  // tests cover: a source refactor there waits for those tests to land.
  const busy = new Set(
    waiting.flatMap((r) => [
      ...(opportunities.find((o) => o.id === r.opportunityId)?.files ?? []),
      ...(r.proof?.behaviour.mutation ? [r.proof.behaviour.mutation.file] : []),
    ]),
  );

  return opportunities
    .filter((o) => o.status === 'open' && !o.files.some((file) => busy.has(file)))
    .sort((a, b) => RANK[a.strength] - RANK[b.strength] || a.attempts - b.attempts || a.id.localeCompare(b.id))
    .slice(0, room);
}
