import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONFIG_DIR } from '../../config/index.js';

/** The tools as the npm package ships them. */
const SHIPPED = fileURLToPath(new URL('../../../skills/sloppatrol/scripts/', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../../package.json', import.meta.url));
/** What a repository vendors. The ledger is read by the copy Sloppatrol ships. */
const TOOLS = ['gate.py', 'agents.py', 'LICENSE'];
const SOURCE = 'SOURCE.md';

const run = promisify(execFile);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A SOURCE.md row; a Markdown formatter may pad the cells. */
const ROW = /^\|[ \t]*`([^`]+)`[ \t]*\|[ \t]*`([0-9a-f]{64})`[ \t]*\|[ \t]*\r?$/gm;

/** The hashes SOURCE.md recorded when each tool was last vendored. */
function recorded(source: string): Map<string, string> {
  return new Map([...source.matchAll(ROW)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

type Vendored = { written: string[]; edited: string[]; version: string };

/** The tools a folder vendors today. */
export function vendoredIn(dir: string): string[] {
  return TOOLS.filter((name) => existsSync(join(dir, name)));
}

/**
 * Copies the named tools into `configDir` and records their hashes in
 * SOURCE.md. A copy whose hash no longer matches the record was edited in the
 * repo: it is kept, and reported, so a refresh never drops a local change. A
 * kept copy with no record gets none, so it stays kept on every later refresh.
 */
export async function vendor(configDir: string, names: readonly string[] = TOOLS): Promise<Vendored> {
  const { version } = JSON.parse(await readFile(PACKAGE, 'utf8')) as { version: string };
  const sourcePath = join(configDir, SOURCE);
  const before = recorded(existsSync(sourcePath) ? await readFile(sourcePath, 'utf8') : '');
  const written: string[] = [];
  const edited: string[] = [];
  const rows: string[] = [];
  for (const name of TOOLS.filter((tool) => names.includes(tool))) {
    const target = join(configDir, name);
    const shipped = await readFile(join(SHIPPED, name), 'utf8');
    if (existsSync(target)) {
      const current = sha256(await readFile(target, 'utf8'));
      if (current !== sha256(shipped) && current !== before.get(name)) {
        edited.push(name);
        const kept = before.get(name);
        if (kept) rows.push(`| \`${name}\` | \`${kept}\` |`);
        continue;
      }
    }
    await copyFile(join(SHIPPED, name), target);
    written.push(name);
    rows.push(`| \`${name}\` | \`${sha256(shipped)}\` |`);
  }
  await writeFile(
    sourcePath,
    `# Vendored tools

These files come from Sloppatrol ${version} (\`skills/sloppatrol/scripts\`). \`sloppatrol init --refresh\` updates them and keeps any file whose hash no longer matches this table, because it was edited here.

| File | sha256 |
|---|---|
${rows.join('\n')}
`,
  );
  return { written, edited, version };
}

/** One confirmed item of the repository's findings ledger. */
export type Finding = {
  id: string;
  lens: string;
  file: string;
  line: number;
  what: string;
};

/** Runs the shipped ledger tool on the ledger at `root`. */
async function ledger(root: string, ...args: string[]): Promise<string> {
  const script = join(SHIPPED, 'ledger.py');
  return (await run('python3', [script, '--root', root, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
}

/** The confirmed findings whose quote is still in the code at `root`; none when the repo has no ledger. */
export async function confirmedFindings(root: string): Promise<Finding[]> {
  if (!existsSync(join(root, CONFIG_DIR, 'ledger.json'))) return [];
  const items = JSON.parse(await ledger(root, 'list', '--status', 'confirmed', '--json')) as (Omit<Finding, 'line'> & {
    line: number | null;
  })[];
  return items.filter((item): item is Finding => item.line !== null);
}
