#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalThread, digest, finish, skip, statusFor } from './archive.mjs';
import { slotsHome } from '../prodex-slots/slots.mjs';

export const usage = [
  'Usage: node scripts/prodex-archive/cli.mjs <finish|retry|skip|status> [options]',
  '  finish --slot N --task ISSUE --thread-url URL --request-id ID --handoff-url GITHUB_COMMENT_URL',
  '  retry  --slot N --task ISSUE --thread-url URL --request-id ID --handoff-url GITHUB_COMMENT_URL',
  '  skip   --task ISSUE --thread-url URL',
  '  status --thread-url URL',
  'finish/retry verify an exact Archive-ready Handoff before touching a browser.',
  'This tool never archives a chat merely because one ask finished or a slot was released.',
  'Errors never print supplied thread URLs or conversation text.',
].join('\n');

export function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['finish', 'retry', 'skip', 'status'].includes(command)) throw new Error('Unknown command');
  const keys = {
    '--slot': 'slot', '--task': 'task', '--thread-url': 'threadUrl',
    '--request-id': 'requestId', '--handoff-url': 'handoffUrl',
  };
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i], value = rest[i + 1];
    if (!(name in keys) || value === undefined || value.startsWith('--'))
      throw new Error('Invalid or missing command option');
    if (keys[name] in options) throw new Error('Duplicate command option');
    options[keys[name]] = value;
  }
  const allowed = command === 'status' ? ['threadUrl'] :
    command === 'skip' ? ['task', 'threadUrl'] :
      ['slot', 'task', 'threadUrl', 'requestId', 'handoffUrl'];
  if (!Object.keys(options).every((k) => allowed.includes(k)) ||
      !allowed.every((k) => options[k] !== undefined)) throw new Error('Incorrect options for command');
  if (options.slot !== undefined) {
    if (!/^[1-9]\d*$/.test(options.slot)) throw new Error('Invalid slot number');
    options.slot = Number(options.slot);
  }
  if (options.threadUrl) options.threadUrl = canonicalThread(options.threadUrl);
  return { command, options };
}

export async function main(args, { runFinish = finish, runSkip = skip,
  home = slotsHome(), out = console.log, err = console.error } = {}) {
  try {
    if (!args.length || args[0] === '--help') { out(usage); return 0; }
    const { command, options } = parseArgs(args);
    if (command === 'status') {
      const record = statusFor(home, options.threadUrl);
      out(JSON.stringify(record ?? { status: 'untracked' }));
      return 0;
    }
    if (command === 'skip') {
      const result = await runSkip(options, { home });
      out('archive ' + result.status + ' for thread SHA256 ' + digest(options.threadUrl));
      return 0;
    }
    const result = await runFinish({ ...options, retry: command === 'retry' }, { home });
    out('archive ' + result.status + (result.alreadyArchived ? ' (previously confirmed)' : '') +
      ' for thread SHA256 ' + digest(options.threadUrl));
    return 0;
  } catch (error) {
    err('prodex-archive: ' + String(error?.message ?? 'unknown error').replace(/https?:\/\/\S+/g, '[url]'));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));
