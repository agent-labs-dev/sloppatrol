import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { censusMarkdown, takeCensus } from '../../census/index.js';
import { DEFAULT_TEST_PATTERNS } from '../../globs/index.js';

const scope = { tests: DEFAULT_TEST_PATTERNS, focus: [], ignore: [] };

describe('the navigation pre-pass', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-navigation-'));
    dirs.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return dir;
  }

  it('counts the distinct files that import each file, per language', async () => {
    const dir = repo({
      'src/ids.ts': 'export const id = 1;\n',
      'src/a.ts': "import { id } from './ids.js';\nimport { id as again } from './ids';\n",
      'src/b.tsx': "export { id } from './ids.js';\n",
      'src/c.test.ts': "import { id } from './ids.js';\nimport { left } from 'left-pad';\n",
      'app/models/user.py': 'class User: ...\n',
      'app/models/__init__.py': '',
      'app/api.py': 'from app.models import user\nfrom .models.user import User\n',
      'app/jobs.py': 'import app.models.user\nfrom . import api\n',
      'addon/core.lua': 'return {}\n',
      'addon/ui.lua': 'local core = require("addon.core")\n',
    });
    const { fanIn } = (await takeCensus(dir, scope)).navigation;
    expect(fanIn).toEqual([
      { path: 'src/ids.ts', importers: 3 },
      { path: 'app/models/user.py', importers: 2 },
      { path: 'addon/core.lua', importers: 1 },
      { path: 'app/api.py', importers: 1 },
    ]);
  });

  it('finds functions whose whole body forwards every parameter to one call', async () => {
    const dir = repo({
      'src/store.ts': [
        'export function load(id: string) {',
        '  return db.get(id);',
        '}',
        'export const save = (row: Row) => db.put(row);',
        'export function both(id: string) { return db.get(id) && db.put(id); }',
        'export function fixed() { return db.get("all"); }',
        'export function half(id: string, limit: number) { return db.get(id); }',
        'export function next(id: number) { return db.get(id + 1); }',
        'class Repo {',
        '  find(id: string): Row { return this.db.get(id); }',
        '  constructor(id: string) { return init(id); }',
        '}',
      ].join('\n'),
      'app/service.py': [
        'def fetch(self, key: str) -> str:',
        '    """Read one key."""',
        '    return self.client.get(key, timeout=5)',
        '',
        'def check(key):',
        '    return bool(key)',
        '',
        'def two(key):',
        '    return first(key)',
        '    print(key)',
      ].join('\n'),
      'addon/util.lua':
        'local function round(n) return math.floor(n + 0.5) end\nlocal function floor(n) return math.floor(n) end\n',
    });
    const found = (await takeCensus(dir, scope)).navigation.passThroughs.map((p) => `${p.path}:${p.line} ${p.name}`);
    expect(found.sort()).toEqual([
      'addon/util.lua:2 floor',
      'app/service.py:1 fetch',
      'src/store.ts:1 load',
      'src/store.ts:10 find',
      'src/store.ts:4 save',
    ]);
  });

  it('lists top-level source symbols named once elsewhere, not counting imports', async () => {
    const dir = repo({
      'src/math.ts': [
        'export function double(n: number) { return n * 2; }',
        'export function triple(n: number) { return n * 3; }',
        'export const unused = 1;',
      ].join('\n'),
      'src/use.ts': "import { double, triple } from './math.js';\ndouble(1);\ntriple(1);\n",
      'src/math.test.ts': "import { triple } from './math.js';\nit('triples', () => triple(2));\n",
      'app/core.py': 'def helper():\n    return 1\n',
      'app/main.py': 'from app.core import helper\nhelper()\n',
    });
    const { usedOnce } = (await takeCensus(dir, scope)).navigation;
    expect(usedOnce).toEqual([
      { path: 'app/core.py', line: 1, name: 'helper' },
      { path: 'src/math.ts', line: 1, name: 'double' },
    ]);
  });

  it('is labelled in the census as navigation aids, not evidence', async () => {
    const dir = repo({ 'src/a.ts': "import { b } from './b.js';\n", 'src/b.ts': 'export const b = 1;\n' });
    const text = censusMarkdown(await takeCensus(dir, scope));
    expect(text).toContain('## Navigation aids: where to look, not evidence');
    expect(text).toContain('- src/b.ts: imported by 1');
  });
});
