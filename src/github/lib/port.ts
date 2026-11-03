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

/** The commits a pull request compares. */
export type PullRequestRefs = {
  /** The last commit of the pull request. */
  headSha: string;
  headRef: string;
  /** The branch the pull request merges into, without a remote. */
  baseRef: string;
};

/**
 * Everything Sloppatrol asks of GitHub. The `gh` adapter runs in
 * production; the in-memory fake runs in the tests.
 */
export interface GitHub {
  /** Pushes the branch and opens a pull request. Returns its URL. */
  openPullRequest(request: NewPullRequest): Promise<string>;
  pullRequestState(url: string): Promise<PullRequestState>;
  /** The refs of the pull request `number`. */
  pullRequestRefs(number: number): Promise<PullRequestRefs>;
}
