import type { GitHub, NewPullRequest, PullRequestState } from './port.js';

/** An in-memory GitHub. A test opens pull requests through it and then merges or closes them. */
export class FakeGitHub implements GitHub {
  readonly pullRequests: (NewPullRequest & { url: string; state: PullRequestState })[] = [];

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
}
