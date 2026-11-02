import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, ConfigError } from '../../config/index.js';
import { ledger, vendor, vendoredIn } from './tools.js';

/**
 * One-shot move of a repository from `.sift/` to `.sloppatrol/`. Each of the
 * five repos that used Sift runs it once; the command is deleted after.
 */
const OLD = '.sift';
const OLD_SKILL = 'sift-project';
const NEW_SKILL = 'sloppatrol-project';
const SKILL_DIRS = ['.agents/skills', '.claude/skills'];
/** Kept as written: they record what happened under the old name. */
const UNTOUCHED = [`${CONFIG_DIR}/reports/`, `${CONFIG_DIR}/ledger.json`, 'CHANGELOG.md'];

const GATE_CODES =
  'config|base|unknown-id|weak-reason|bad-marker|trailing-marker|ast-grep-ignore|ast-grep|unused-marker|rule-test|script-test|script-protocol';
/** The mechanical renames, in order. Prose that names Sift is left for a person. */
const RENAMES: [RegExp, string][] = [
  [/\.sift\b/g, CONFIG_DIR],
  [/\bsift-project\b/g, NEW_SKILL],
  [/\bsift:(\s*[A-Za-z0-9][\w-]*\s+-\s)/g, 'sloppatrol:$1'],
  [/\bsift-(scope|fix|inputs)\b/g, 'sloppatrol-$1'],
  [/\bSIFT_(ROOT|RULE|FILES|BASE|CHANGED|LIB)\b/g, 'SLOPPATROL_$1'],
  [new RegExp(`\\bsift-(${GATE_CODES})\\b`, 'g'), 'sloppatrol-$1'],
];

function rename(text: string): string {
  return RENAMES.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function tracked(root: string): string[] {
  return git(root, 'ls-files', '-z').split('\0').filter(Boolean);
}

/** Renames the file and quote of each ledger item the source rewrite changed, then gives every item its true id. */
async function migrateLedger(root: string): Promise<string> {
  const path = join(root, CONFIG_DIR, 'ledger.json');
  if (!existsSync(path)) return '';
  const data = JSON.parse(readFileSync(path, 'utf8')) as { items: { file: string; quote: string }[] };
  const renamed = data.items.map((item) => ({ ...item, file: rename(item.file), quote: rename(item.quote) }));
  // Written only when something changed: the rekey below then rewrites it in the ledger's own format.
  if (renamed.some((item, i) => item.file !== data.items[i]?.file || item.quote !== data.items[i]?.quote))
    writeFileSync(path, `${JSON.stringify({ ...data, items: renamed }, null, 2)}\n`);
  const moved = (await ledger(root, 'rekey')).trim();
  return moved === 'every id matches' ? '' : moved;
}

export async function migrate(root: string, log: (line: string) => void): Promise<void> {
  if (!existsSync(join(root, OLD))) throw new ConfigError(`${join(root, OLD)} does not exist: nothing to migrate.`);
  if (existsSync(join(root, CONFIG_DIR))) throw new ConfigError(`${join(root, CONFIG_DIR)} exists already.`);
  if (git(root, 'status', '--porcelain').trim()) throw new ConfigError('Commit or stash your changes first.');

  // Ids retired before the move lose their history in the rename, so prove none is still named first.
  if (existsSync(join(root, OLD, 'history.py'))) {
    execFileSync('python3', [join(OLD, 'history.py'), '--check', '--limit', '0'], { cwd: root, stdio: 'pipe' });
    git(root, 'rm', '-q', '--', join(OLD, 'history.py'));
  }

  const present = vendoredIn(join(root, OLD));
  for (const name of present) git(root, 'rm', '-q', '--', join(OLD, name));
  git(root, 'mv', '--', OLD, CONFIG_DIR);
  const moved = [`${OLD}/ -> ${CONFIG_DIR}/`];

  for (const base of SKILL_DIRS) {
    const from = join(base, OLD_SKILL);
    const to = join(base, NEW_SKILL);
    const full = join(root, from);
    if (!existsSync(full) && !isLink(full)) continue;
    if (isLink(full)) {
      const link = readlinkSync(full).replace(OLD_SKILL, NEW_SKILL);
      git(root, 'rm', '-q', '--', from);
      mkdirSync(join(root, base), { recursive: true });
      symlinkSync(link, join(root, to));
      git(root, 'add', '--', to);
    } else git(root, 'mv', '--', from, to);
    moved.push(`${from} -> ${to}`);
  }

  const rewritten: string[] = [];
  for (const file of tracked(root)) {
    const full = join(root, file);
    if (UNTOUCHED.some((prefix) => file === prefix || file.startsWith(prefix)) || isLink(full)) continue;
    const text = readFileSync(full);
    if (text.includes(0)) continue;
    const before = text.toString('utf8');
    const after = rename(before);
    if (after === before) continue;
    writeFileSync(full, after);
    rewritten.push(file);
  }
  const rekeyed = await migrateLedger(root);

  if (present.length) {
    const { written, version } = await vendor(join(root, CONFIG_DIR), present);
    moved.push(`vendored ${written.join(', ')} from Sloppatrol ${version}`);
  }
  if (existsSync(join(root, CONFIG_DIR, 'SOURCE.md')) && !present.length)
    git(root, 'rm', '-q', '-f', '--', join(CONFIG_DIR, 'SOURCE.md'));
  git(root, 'add', '-A', '--', CONFIG_DIR, ...rewritten);

  for (const line of moved) log(line);
  log(`Rewrote ${rewritten.length} files:`);
  for (const file of rewritten) log(`  ${file}`);
  if (rekeyed)
    log(`Gave ${rekeyed.split('\n').length} ledger items the id their file and quote now hash to:\n${rekeyed}`);
  let left = '';
  try {
    left = git(root, 'grep', '-n', '-I', '-i', 'sift', '--', '.', ...UNTOUCHED.map((p) => `:!${p}`)).trim();
  } catch {
    // git grep exits 1 when nothing matches.
  }
  log(left ? `Still naming Sift, for a person to edit:\n${left}` : 'Nothing else names Sift.');
  log('Next: run the gate with --all, review the staged change and commit it.');
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
