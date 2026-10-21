import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Never echo gh stderr: it can contain account details or server-supplied text.
export function queryError(error) {
  if (error?.code === 'ENOENT') return 'gh is not installed; install GitHub CLI and run gh auth login.';
  if (error?.killed || error?.code === 'ETIMEDOUT') return 'gh query timed out; snapshot is incomplete.';
  return 'GitHub query failed; check gh auth status, repository access, network and API rate limits.';
}

export function createGitHubClient({ run = execute, timeout = 15000 } = {}) {
  async function invoke(args) {
    let stdout;
    try {
      ({ stdout } = await run('gh', args, {
        timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
      }));
    } catch (error) {
      throw new Error(queryError(error), { cause: error });
    }
    try { return JSON.parse(stdout); }
    catch { throw new Error('GitHub returned invalid JSON; snapshot is incomplete.'); }
  }
  return {
    get: (path) => invoke(['api', '--hostname', 'github.com', '--method', 'GET', path]),
    // GraphQL uses POST transport, but this fixed operation is a query, never a mutation.
    associations: (repo, numbers) => {
      const [owner, name] = repo.split('/');
      const fields = numbers.map((n) => `p${n}: pullRequest(number: ${n}) { headRefOid closingIssuesReferences(first: 100) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage } } }`).join('\n');
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`;
      return invoke(['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`]);
    },
  };
}
