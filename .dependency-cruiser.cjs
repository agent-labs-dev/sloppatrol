// @ts-check
// Each folder under src/ is a deep module (playbook/principles.md). Its root
// files are its interface; its subfolders (lib/, tests/) are private. Adapted
// from Matt Pocock's setup-ts-deep-modules skill.

const R = 'src';
/** A module's internals: anything inside a subfolder of a module. */
const INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'entrypoint-boundary-across-modules',
      comment: 'A module reaches another module only through its root files, never its internals.',
      severity: 'error',
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: { path: INTERNALS, pathNot: `^${R}/$1/` },
    },
    {
      name: 'tests-through-entrypoints',
      comment: 'Tests use a module through its root files, like every other caller.',
      severity: 'error',
      from: { path: `^${R}/([^/]+)/tests/` },
      to: { path: INTERNALS, pathNot: `^${R}/$1/tests/` },
    },
    {
      name: 'tests-folder-is-private',
      comment: 'Only tests import test fixtures.',
      severity: 'error',
      from: { pathNot: `^${R}/[^/]+/tests/` },
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: 'cli-is-the-composition-root',
      comment: 'Only the CLI wires adapters together; no module depends on it.',
      severity: 'error',
      from: { pathNot: `^${R}/cli/` },
      to: { path: `^${R}/cli/` },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs', '.json'] },
  },
};
