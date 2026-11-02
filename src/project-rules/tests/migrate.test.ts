import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../../project-rules/index.js';

const SHIPPED = new URL('../../../skills/sloppatrol/scripts/', import.meta.url);

describe('sloppatrol migrate', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

  /** A repository shaped like the largest user: rules, scripts, markers, a linked project skill and an old ledger. */
  function siftRepo(files: Record<string, string>): string {
    const repo = mkdtempSync(join(tmpdir(), 'sloppatrol-migrate-'));
    dirs.push(repo);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    mkdirSync(join(repo, '.claude/skills'), { recursive: true });
    symlinkSync('../../.agents/skills/sift-project', join(repo, '.claude/skills/sift-project'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'sift');
    return repo;
  }

  const MARKER = '# sift: no-print - the CLI prints its own output';

  it('moves .sift to .sloppatrol, renames every mechanical token and keeps the ledger readable', async () => {
    const item = {
      id: '0000000000',
      lens: 'comment-narration',
      file: 'src/cli.py',
      quote: MARKER,
      what: 'A defect.',
      why: 'The evidence.',
      confidence: 'high',
      status: 'dismissed',
      reason: 'The marker states the contract.',
      first_seen: '2026-11-02',
      updated: '2026-11-02',
    };
    const repo = siftRepo({
      '.sift/gate.py': 'old gate\n',
      '.sift/LICENSE': 'old licence\n',
      '.sift/history.py': 'print("no retired ids")\n',
      '.sift/sgconfig.yml': 'ruleDirs: [.sift/rules]\n',
      '.sift/rules/no-print.yml': 'id: no-print\nmetadata: { sift-scope: changed }\n',
      '.sift/scripts/no-todo.py': '# sift-fix: Remove the TODO.\nimport os\nos.environ["SIFT_FILES"]\n',
      '.sift/ledger.json': `${JSON.stringify({ schema_version: 1, items: [item] })}\n`,
      '.sift/reports/2026-10-01.md': 'Ran `.sift/gate.py`.\n',
      '.agents/skills/sift-project/SKILL.md': '# sift project skill\n\nRun `python3 .sift/gate.py`.\n',
      'src/cli.py': `${MARKER}\nprint("hi")\n`,
      'AGENTS.md': 'Load `.agents/skills/sift-project/SKILL.md`. Codes: sift-unknown-id.\n',
      'CHANGELOG.md': 'Added `.sift/gate.py`.\n',
    });
    const lines: string[] = [];

    await migrate(repo, (line) => lines.push(line));

    expect(existsSync(join(repo, '.sift'))).toBe(false);
    expect(existsSync(join(repo, '.sloppatrol/history.py'))).toBe(false);
    expect(readFileSync(join(repo, '.sloppatrol/gate.py'), 'utf8')).toBe(
      readFileSync(new URL('gate.py', SHIPPED), 'utf8'),
    );
    expect(existsSync(join(repo, '.sloppatrol/agents.py'))).toBe(false);
    expect(readFileSync(join(repo, '.sloppatrol/SOURCE.md'), 'utf8')).toContain('| `gate.py` |');
    expect(readFileSync(join(repo, '.sloppatrol/sgconfig.yml'), 'utf8')).toBe('ruleDirs: [.sloppatrol/rules]\n');
    expect(readFileSync(join(repo, '.sloppatrol/rules/no-print.yml'), 'utf8')).toContain('sloppatrol-scope: changed');
    expect(readFileSync(join(repo, '.sloppatrol/scripts/no-todo.py'), 'utf8')).toBe(
      '# sloppatrol-fix: Remove the TODO.\nimport os\nos.environ["SLOPPATROL_FILES"]\n',
    );
    expect(readFileSync(join(repo, 'src/cli.py'), 'utf8')).toContain('# sloppatrol: no-print - the CLI');
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toBe(
      'Load `.agents/skills/sloppatrol-project/SKILL.md`. Codes: sloppatrol-unknown-id.\n',
    );
    expect(readlinkSync(join(repo, '.claude/skills/sloppatrol-project'))).toBe(
      '../../.agents/skills/sloppatrol-project',
    );
    // History stays as written.
    expect(readFileSync(join(repo, '.sloppatrol/reports/2026-10-01.md'), 'utf8')).toBe('Ran `.sift/gate.py`.\n');
    expect(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')).toBe('Added `.sift/gate.py`.\n');
    // The rewritten quote gets the id it now hashes to, and the ledger reads.
    const ledger = JSON.parse(readFileSync(join(repo, '.sloppatrol/ledger.json'), 'utf8'));
    expect(ledger.items[0]).toMatchObject({ quote: MARKER.replace('sift:', 'sloppatrol:'), status: 'dismissed' });
    expect(ledger.items[0].id).not.toBe('0000000000');
    execFileSync('python3', [new URL('ledger.py', SHIPPED).pathname, '--root', repo, 'list']);
    // What is left is prose for a person, and the move is staged for review.
    expect(lines.join('\n')).toContain('.agents/skills/sloppatrol-project/SKILL.md:1:# sift project skill');
    expect(git(repo, 'status', '--porcelain')).not.toMatch(/^\?\?/m);
  });

  it('refuses a repository with uncommitted changes', async () => {
    const repo = siftRepo({ '.sift/ledger.json': '{"schema_version": 1, "items": []}\n' });
    writeFileSync(join(repo, 'new.txt'), 'x\n');
    await expect(migrate(repo, () => {})).rejects.toThrow('Commit or stash your changes first.');
  });
});
