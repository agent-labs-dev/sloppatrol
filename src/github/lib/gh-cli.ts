import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '../../git/index.js';
import type { GitHub, NewPullRequest, PullRequestState } from './port.js';

const exec = promisify(execFile);

/** GitHub through the `gh` CLI, with the user's own login. */
export class GhCliGitHub implements GitHub {
  private labelsReady: Promise<void> | undefined;

  constructor(
    private readonly cwd: string,
    private readonly repo?: string,
  ) {}

  private async gh(args: string[], cwd = this.cwd): Promise<string> {
    const repo = this.repo ? ['--repo', this.repo] : [];
    const { stdout } = await exec('gh', [...args, ...repo], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  }

  /** A repo that has never seen Sloppatrol has none of its labels yet. */
  private ensureLabels(labels: string[]): Promise<void> {
    this.labelsReady ??= (async () => {
      for (const label of labels) {
        try {
          await this.gh(['label', 'create', label, '--color', '0e8a16', '--description', 'Opened by Sloppatrol']);
        } catch (error) {
          if (!/already exists/i.test((error as Error).message)) throw error;
        }
      }
    })();
    return this.labelsReady;
  }

  async openPullRequest(request: NewPullRequest): Promise<string> {
    await this.ensureLabels(request.labels);
    await git(request.worktree, ['push', '-u', 'origin', request.branch]);
    return this.gh(
      [
        'pr',
        'create',
        '--head',
        request.branch,
        '--title',
        request.title,
        '--body',
        request.body,
        ...(request.draft ? ['--draft'] : []),
        ...request.labels.flatMap((label) => ['--label', label]),
      ],
      request.worktree,
    );
  }

  async pullRequestState(url: string): Promise<PullRequestState> {
    const { state } = JSON.parse(await this.gh(['pr', 'view', url, '--json', 'state'])) as { state: string };
    return state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open';
  }
}
