export type PullRequestState = 'open' | 'merged' | 'closed';

export type NewPullRequest = {
  /** The worktree that holds the branch. */
  worktree: string;
  branch: string;
  title: string;
  body: string;
  draft: boolean;
  labels: string[];
};

/**
 * Everything Sloppatrol asks of GitHub. The `gh` adapter runs in
 * production; the in-memory fake runs in the tests.
 */
export interface GitHub {
  /** Pushes the branch and opens a pull request. Returns its URL. */
  openPullRequest(request: NewPullRequest): Promise<string>;
  pullRequestState(url: string): Promise<PullRequestState>;
}
