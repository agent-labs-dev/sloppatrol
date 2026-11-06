import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FAKE_AGENT = resolve(import.meta.dirname, 'fake-agent.mjs');

export function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
}

const PRICE = `export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum = sum + item.price * item.qty;
  }
  return Math.round(sum * 100) / 100;
}

export function receipt(items) {
  const lines = items.map((item) => item.name + ' x' + item.qty);
  return lines.join('\\n') + '\\nTotal: ' + total(items);
}
`;

const TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receipt, total } from '../src/price.js';

const cart = [{ name: 'book', price: 10.1, qty: 2 }, { name: 'pen', price: 0.333, qty: 3 }];

test('total sums price times quantity, to the cent', () => {
  assert.equal(total(cart), 21.2);
});

test('receipt lists each item and the total', () => {
  assert.equal(receipt(cart), 'book x2\\npen x3\\nTotal: 21.2');
});
`;

/** A small repo with one source file, its tests, and a Sloppatrol config that runs every role on the fake agent. */
export function fixtureRepo(github = true): string {
  const repo = mkdtempSync(join(tmpdir(), 'sloppatrol-fixture-'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'test'));
  mkdirSync(join(repo, '.sloppatrol'));
  writeFileSync(join(repo, 'package.json'), '{ "name": "shop", "type": "module" }\n');
  writeFileSync(join(repo, 'src/price.js'), PRICE);
  writeFileSync(join(repo, 'test/price.test.js'), TEST);
  writeFileSync(join(repo, '.gitignore'), '.sloppatrol/runs/\n');
  const agent = (role: string) => `{ runtime: cli, command: "node ${FAKE_AGENT} {mcp} ${role}" }`;
  writeFileSync(
    join(repo, '.sloppatrol/sloppatrol.yml'),
    `project: { name: shop }
checks:
  - name: test
    run: node --test
    tests: true
agents:
  surveyor: { use: ${agent('surveyor')}, timeoutMinutes: 2 }
  refactorer: { use: ${agent('refactorer')}, timeoutMinutes: 2 }
  assessor: { use: ${agent('assessor')}, timeoutMinutes: 2 }
  reviewer: { use: ${agent('reviewer')}, timeoutMinutes: 2 }
github: { enabled: ${github} }
patrol: { pull: main }
`,
  );
  gitIn(repo, 'init', '-q', '-b', 'main');
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'shop');
  return repo;
}

export function script(role: 'surveyor' | 'refactorer' | 'assessor' | 'reviewer', steps: unknown[]): void {
  process.env[`FAKE_AGENT_${role.toUpperCase()}`] = JSON.stringify(steps);
}

/** A queue a role's session consumes step by step, so a second session resumes where the first stopped. */
export function scriptQueue(role: 'refactorer', steps: unknown[]): string {
  const file = join(tmpdir(), `sloppatrol-steps-${role}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(steps));
  process.env[`FAKE_AGENT_${role.toUpperCase()}_QUEUE`] = file;
  return file;
}

/** The fake CLI command for one role, for a config a test writes itself. */
export function agentCommand(role: string): string {
  return `{ runtime: cli, command: "node ${FAKE_AGENT} {mcp} ${role}" }`;
}

export function read(repo: string, path: string): string {
  return readFileSync(join(repo, path), 'utf8');
}
