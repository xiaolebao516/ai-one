import { host } from '../host';
import { loadGitHubTasks } from './taskHudGithub';
import type { GitHubLoader } from './taskHudSource';

/** Production loader (#53): #52's adapter over #51's read-only gh bridge, first page of 10 per list. */
export const loadGitHubTasksFromHost: GitHubLoader = (repos) => loadGitHubTasks(repos, host.github, { limit: 10 });
