import type { GitHub, NewPullRequest, PullRequestRefs, PullRequestState } from './port.js';

/** An in-memory GitHub. A test opens pull requests through it and then merges or closes them. */
export class FakeGitHub implements GitHub {
  readonly pullRequests: (NewPullRequest & { url: string; state: PullRequestState })[] = [];
  /** Pull requests someone else opened, by number, for a review to read. */
  readonly refs = new Map<number, PullRequestRefs>();

  async openPullRequest(request: NewPullRequest): Promise<string> {
    const url = `https://github.com/fake/repo/pull/${this.pullRequests.length + 1}`;
    this.pullRequests.push({ ...request, url, state: 'open' });
    return url;
  }

  async pullRequestState(url: string): Promise<PullRequestState> {
    const found = this.pullRequests.find((pr) => pr.url === url);
    if (!found) throw new Error(`No pull request ${url}`);
    return found.state;
  }

  setState(url: string, state: PullRequestState): void {
    const found = this.pullRequests.find((pr) => pr.url === url);
    if (!found) throw new Error(`No pull request ${url}`);
    found.state = state;
  }

  async pullRequestRefs(number: number): Promise<PullRequestRefs> {
    const found = this.refs.get(number);
    if (!found) throw new Error(`No pull request #${number}`);
    return found;
  }
}
