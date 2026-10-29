import type { MetricId } from '../../domain/index.js';

export type Metric = {
  id: MetricId;
  name: string;
  /** Which files the metric judges. */
  appliesTo: 'source' | 'tests' | 'all';
  /** The one question the score answers. */
  question: string;
  /** What each score means, 0 to 4. A judge picks the highest level the file fully meets. */
  levels: [string, string, string, string, string];
  /** Concrete things to count against the file. */
  lookFor: string[];
};

/**
 * The rubric (ADR 0004). Each level is anchored in things a reader can
 * point at, so two judges reach the same score. A change to this text is a
 * new rubric version: old scores are not compared with new ones.
 */
export const METRICS: Metric[] = [
  {
    id: 'simplicity',
    name: 'Simplicity',
    appliesTo: 'all',
    question: 'Can a reader follow each function without holding much in their head?',
    levels: [
      'Functions of hundreds of lines, nesting 5+ deep, many flags or modes that change behaviour.',
      'Several functions over ~80 lines or nested 4 deep; boolean or string flags select behaviour.',
      'Most functions are readable, but a few are long, deeply nested, or mix several steps.',
      'Functions are short and do one step; nesting stays at 2-3; early returns keep the main path flat.',
      'Every function reads top to bottom at one level of abstraction; no flags; nothing to simplify.',
    ],
    lookFor: [
      'long functions',
      'deep nesting',
      'flag parameters',
      'long parameter lists',
      'repeated switches on the same type',
    ],
  },
  {
    id: 'modularity',
    name: 'Modularity',
    appliesTo: 'source',
    question: 'Does the file own one concept, behind a small interface, apart from other concerns?',
    levels: [
      'A god file: routing, rules, I/O and formatting for many concepts, in one place.',
      'Two or more unrelated concerns mixed; callers reach into its internals or it into theirs.',
      'One main concept, but with a leaked detail, a second concern, or a shallow pass-through layer.',
      'One concept with one owner; a small interface hides the detail; I/O kept apart from decisions.',
      'A deep module: much behaviour behind a minimal interface that is also the test surface.',
    ],
    lookFor: [
      'mixed concerns',
      'shallow wrappers',
      'deep imports of another module',
      'duplicated owners of one concept',
    ],
  },
  {
    id: 'injection',
    name: 'Injection',
    appliesTo: 'source',
    question: 'Does the code receive what it depends on, or reach out for it?',
    levels: [
      'Logic creates its clients, reads globals and env, and calls the clock and network inline; untestable without patches.',
      'Most collaborators are created or imported concretely inside logic; a test must patch module state.',
      'Some seams are injected, but hidden dependencies (singletons, env, clock, `new Client()`) remain in logic.',
      'Collaborators come in through parameters or constructors; only the composition root creates adapters.',
      'Every seam is a small port the consumer owns; each real seam has a fake beside it.',
    ],
    lookFor: [
      '`new Client()` in logic',
      'module singletons',
      'env reads below the root',
      'clock or random in logic',
      'concrete types where a port fits',
    ],
  },
  {
    id: 'purity',
    name: 'Purity',
    appliesTo: 'source',
    question:
      'How much of the logic lives in pure functions (same input, same output, no side effects), with state and effects kept small and at the edge?',
    levels: [
      'Almost no pure function: logic reads and writes shared mutable state, globals or caches, and does I/O as it decides; results depend on call order.',
      'A few pure helpers, but most decisions mutate their inputs or objects across functions, or call I/O, the clock or randomness mid-calculation.',
      'About half the logic is pure; the rest mixes calculation with effects or hidden state (exposed mutable fields, lazy caches, in-place updates).',
      'Most logic is pure functions over values; state has one owner; effects (I/O, clock, randomness, mutation) sit in a thin layer at the edge.',
      'A pure core with immutable data by default; every effect is at the edge and every decision can be tested with values alone.',
    ],
    lookFor: [
      'functions that both decide and do I/O',
      'mutated arguments or shared objects',
      'module-level mutable state and caches',
      'clock, randomness or env read inside a calculation',
      'loops that build results by mutation where a map or fold returns them',
    ],
  },
  {
    id: 'tests',
    name: 'Test quality',
    appliesTo: 'tests',
    question: 'Do the tests prove behaviour through the interface, and would they fail if it broke?',
    levels: [
      'Tests assert nothing real: snapshots of everything, tautologies, or mocks verifying calls only.',
      'Mocks of the team’s own modules; assertions on calls, call order or private state.',
      'Mostly behaviour, but some implementation coupling, loose assertions, or patches of own code.',
      'Tests use the public interface with fakes at real seams; literal expected values; one behaviour each.',
      'Tests read as a specification, survive any refactor, and cover edge cases with table rows.',
    ],
    lookFor: [
      'mocks of own code',
      'assertions on calls',
      'tautological expected values',
      'loose assertions',
      'sleeps and order dependence',
    ],
  },
  {
    id: 'clarity',
    name: 'Clarity',
    appliesTo: 'all',
    question: 'Does every name, comment and abstraction earn its place?',
    levels: [
      'Misleading names, dead code, commented-out code, and abstractions with no second use everywhere.',
      'Comments that repeat the code, generic names (`data`, `utils`, `manager`), speculative layers.',
      'Mostly clear, with some noise: a useless comment, an unused parameter, a one-use wrapper.',
      'Names say what things are; comments say why; no dead code; each abstraction has a real use.',
      'Nothing to delete and nothing to rename: the code explains itself.',
    ],
    lookFor: [
      'comments that restate code',
      'dead or commented-out code',
      'lineage names (`v2`, `legacy`, `new`)',
      'one-use abstractions',
    ],
  },
  {
    id: 'guardrails',
    name: 'Agent-friendliness',
    appliesTo: 'all',
    question:
      'How hard is it for an agent (or a new person) to change this file wrong, and is it a pattern worth copying?',
    levels: [
      'Contracts live only in heads: untyped or stringly-typed values, magic constants, order-dependent calls, copy-paste variants; a plausible wrong edit passes every check.',
      'Weak types (`any`, raw dicts, untyped returns); several near-duplicate ways to do the same job, so it is unclear which to copy; import-time side effects.',
      'Typed, but invariants rest on comments or call order; a wrong edit fails only at run time or in a distant test.',
      'Types and the interface enforce correct use (unions with exhaustive matches, required parameters, distinct id types); one obvious pattern; a wrong edit fails a fast check.',
      'Wrong use is unrepresentable or fails at compile or lint time; the file is a clean template to copy, its contract pinned by tests and enforced by tooling.',
    ],
    lookFor: [
      'untyped or `any` values crossing an interface',
      'strings or booleans that select behaviour',
      'non-exhaustive matches on a union',
      'two patterns for one job',
      'invariants kept only by a comment',
      'import-time side effects',
    ],
  },
];
