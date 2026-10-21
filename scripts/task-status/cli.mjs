#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createGitHubClient } from './github.mjs';
import { collectSnapshot, renderText, validateOptions } from './snapshot.mjs';

export const usage = 'Usage: node scripts/task-status/cli.mjs --repo OWNER/REPO [--json] [--page 1] [--limit 10]\nRead-only github.com snapshot via locally authenticated gh. Limit: 1..30. Exit: 0 complete, 2 partial, 1 error.';
export function parseArgs(args) {
  const options = { page: 1, limit: 10, json: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (!['--repo', '--page', '--limit'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
    if (arg !== '--repo' && !/^\d+$/.test(value)) throw new Error(`Invalid integer: ${arg}`);
    options[arg.slice(2)] = arg === '--repo' ? value : Number(value);
  }
  if (!options.help) validateOptions(options);
  return options;
}
export async function main(args, { client = createGitHubClient(), out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { out(usage); return 0; }
    const snapshot = await collectSnapshot(options, client);
    out(options.json ? JSON.stringify(snapshot, null, 2) : renderText(snapshot));
    return snapshot.status === 'complete' ? 0 : snapshot.status === 'partial' ? 2 : 1;
  } catch (error) {
    // Even usage errors preserve the --json contract.
    if (args.includes('--json')) out(JSON.stringify({ status: 'error', errors: [{ message: error.message }] }));
    else err(`${error.message}\n${usage}`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
