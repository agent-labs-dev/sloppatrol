/**
 * The data Sloppatrol keeps under `.sloppatrol/runs/`, and the rules that
 * belong to the data itself. Every other module speaks in these types.
 */
export { AGENT_ROLES, type AgentEvent, type AgentRole, type AgentStatus } from './lib/agents.js';
export type { CheckResult, CheckRun, GuardFinding } from './lib/checks.js';
export { newId } from './lib/ids.js';
export {
  type Guardrail,
  isMetricId,
  METRIC_IDS,
  type MetricId,
  type MetricScore,
  type Scorecard,
  type Signals,
  type UnitScores,
} from './lib/metrics.js';
export {
  fingerprintOf,
  gainOf,
  isOpportunityKind,
  OPPORTUNITY_KINDS,
  type Opportunity,
  type OpportunityKind,
  type Side,
  type Strength,
  sideOf,
  titleOf,
} from './lib/opportunity.js';
export type { Improvement, Mutation, Proof } from './lib/proof.js';
export type { GateVerdict, Refactor, Review } from './lib/refactor.js';
