/**
 * The project-rules tools: a stdlib Python gate, ledger and AGENTS.md check
 * that a repository vendors into `.sloppatrol/`, so its CI runs them with no
 * service, no API key and no Sloppatrol install.
 */
export { migrate } from './lib/migrate.js';
export { confirmedFindings, type Finding, vendor, vendoredIn } from './lib/tools.js';
