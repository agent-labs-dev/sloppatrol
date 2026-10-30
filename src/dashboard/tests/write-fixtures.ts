import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIXTURE_SHAPES, writeFixture } from './fixtures.js';

// Writes one demo project per fixture shape under the folder in argv, to look
// at the dashboard on realistic data:
//   tsc -p tsconfig.json --outDir node_modules/.cache/demo
//   node node_modules/.cache/demo/dashboard/tests/write-fixtures.js /tmp/sloppatrol-fixtures
//   sloppatrol dashboard --cwd /tmp/sloppatrol-fixtures/busy
const root = resolve(process.argv[2] ?? 'sloppatrol-fixtures');
for (const shape of FIXTURE_SHAPES) {
  const dir = join(root, shape);
  rmSync(dir, { recursive: true, force: true });
  await writeFixture(dir, shape);
  process.stdout.write(`${dir}\n`);
}
