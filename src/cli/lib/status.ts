import type { Store } from '../../store/index.js';

export async function status(store: Store, out: (line: string) => void): Promise<void> {
  const opportunities = await store.listOpportunities();
  const refactors = await store.listRefactors();
  out(`Opportunities (${opportunities.length})`);
  for (const o of opportunities)
    out(`  ${o.id}  ${o.status.padEnd(9)}  ${o.strength.padEnd(15)}  ${o.kind.padEnd(22)}  ${o.title}`);
  out(`\nRefactors (${refactors.length})`);
  for (const r of refactors) {
    const stat = r.diffStat ? ` +${r.diffStat.added} -${r.diffStat.removed}` : '';
    out(`  ${r.id}  ${r.status.padEnd(9)}${stat}  ${r.prUrl ?? r.reason?.split('\n')[0] ?? r.branch}`);
  }
  for (const s of await store.statuses()) out(`\n[${s.role}] ${s.state}: ${s.detail}`);
}
