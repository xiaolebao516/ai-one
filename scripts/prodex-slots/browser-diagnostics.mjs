import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WINDOWS_PROCESS_QUERY = [
  "$ErrorActionPreference = 'Stop'",
  "$items = @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Select-Object Name, ProcessId, CommandLine)",
  'ConvertTo-Json -InputObject $items -Compress -Depth 3',
].join('\n');

function processNameOf(process) {
  return path.win32.basename(String(process?.name ?? process?.Name ?? '')).toLowerCase();
}

function commandLineOf(process) {
  return process?.commandLine ?? process?.CommandLine ?? null;
}

function hasExactPort(commandLine, port) {
  return new RegExp('(?:^|\\s)--remote-debugging-port(?:=|\\s+)' + String(Number(port)) + '(?=\\s|$)', 'i').test(commandLine);
}

function profileArgument(commandLine) {
  const match = /(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+))(?=\s|$)/i.exec(commandLine);
  return match?.[1] ?? match?.[2] ?? null;
}

function normalizedWindowsPath(value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
}

function hasExactProfile(commandLine, profileDir) {
  const actual = normalizedWindowsPath(profileArgument(commandLine));
  const expected = normalizedWindowsPath(profileDir);
  return actual !== null && expected !== null && actual === expected;
}

function isChildProcess(commandLine) {
  return /(?:^|\s)--type(?:=|\s|$)/i.test(commandLine);
}

// Only a primary Edge/Chrome process with the exact port and full profile path counts as
// running. Partial matches are ambiguous, never proof that the slot is closed.
export function classifyWindowsBrowserProcesses(processes, slot) {
  if (!Array.isArray(processes)) return { state: 'unknown' };
  const browsers = processes.filter((item) => ['msedge.exe', 'chrome.exe'].includes(processNameOf(item)));
  if (browsers.some((item) => typeof commandLineOf(item) !== 'string' || !commandLineOf(item).trim())) {
    return { state: 'unknown' };
  }

  // Slot 1 delegates profile selection to Prodex, so its expected full profile path is not
  // available here. An empty browser list proves absence; any browser process leaves it unknown.
  if (!slot.profileDir) {
    if (browsers.length === 0) return { state: 'absent' };
    if (browsers.some((item) => hasExactPort(commandLineOf(item), slot.port))) return { state: 'ambiguous' };
    return { state: 'unknown' };
  }

  const exact = browsers.some((item) => {
    const commandLine = commandLineOf(item);
    return !isChildProcess(commandLine)
      && hasExactPort(commandLine, slot.port)
      && hasExactProfile(commandLine, slot.profileDir);
  });
  if (exact) return { state: 'running' };

  const related = browsers.some((item) => {
    const commandLine = commandLineOf(item);
    return hasExactPort(commandLine, slot.port) || hasExactProfile(commandLine, slot.profileDir);
  });
  return related ? { state: 'ambiguous' } : { state: 'absent' };
}

export function probeWindowsBrowserProcesses(slot, { platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  if (platform !== 'win32') return { state: 'unsupported' };

  let result;
  try {
    result = spawnSyncFn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_PROCESS_QUERY,
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  } catch {
    return { state: 'error' };
  }
  if (result?.error || result?.signal || result?.status !== 0) return { state: 'error' };

  try {
    const output = String(result.stdout ?? '').trim();
    if (!output) return { state: 'error' };
    const parsed = JSON.parse(output);
    const processes = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : null);
    if (!processes) return { state: 'error' };
    return classifyWindowsBrowserProcesses(processes, slot);
  } catch {
    return { state: 'error' };
  }
}

export async function probeCdpEndpoint(port, { fetchFn = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (typeof fetchFn !== 'function') return { state: 'unavailable' };
  const request = (suffix) => fetchFn('http://127.0.0.1:' + port + suffix, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  let versionResponse;
  try {
    versionResponse = await request('/json/version');
  } catch {
    return { state: 'unreachable' };
  }
  if (!versionResponse) return { state: 'unreachable' };
  if (!versionResponse.ok) return { state: 'responding', pageState: 'unknown' };

  let version;
  try {
    version = await versionResponse.json();
  } catch {
    return { state: 'responding', pageState: 'unknown' };
  }
  if (typeof version?.webSocketDebuggerUrl !== 'string') {
    return { state: 'responding', pageState: 'unknown' };
  }

  let targetsResponse;
  try {
    targetsResponse = await request('/json/list');
  } catch {
    return { state: 'responding', pageState: 'unknown' };
  }
  if (!targetsResponse?.ok) return { state: 'responding', pageState: 'unknown' };

  try {
    const targets = await targetsResponse.json();
    if (!Array.isArray(targets)) return { state: 'responding', pageState: 'unknown' };
    const chatGptPage = targets.some((target) => target?.type === 'page'
      && typeof target.url === 'string'
      && /^https?:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(target.url));
    return { state: 'responding', pageState: chatGptPage ? 'present' : 'absent' };
  } catch {
    return { state: 'responding', pageState: 'unknown' };
  }
}

export async function diagnoseBrowserUnreachable(slot, {
  platform = process.platform,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
} = {}) {
  const processEvidence = probeWindowsBrowserProcesses(slot, { platform, spawnSyncFn });
  const cdpEvidence = await probeCdpEndpoint(slot.port, { fetchFn });
  const nextStep = 'No automatic restart was attempted. Inspect the browser window and run node scripts/prodex-slots/cli.mjs list again.';

  if (cdpEvidence.state === 'responding') {
    if (processEvidence.state === 'running' && cdpEvidence.pageState === 'absent') {
      return { state: 'unknown', detail: 'The debugging port responds, but no ChatGPT page is available yet. ' + nextStep };
    }
    if (processEvidence.state === 'running' && cdpEvidence.pageState === 'present') {
      return { state: 'unknown', detail: 'The debugging port and a ChatGPT page respond, but page readiness could not be verified. ' + nextStep };
    }
    return { state: 'unknown', detail: 'The debugging port responds, but its process could not be confidently matched to this slot. ' + nextStep };
  }

  if (processEvidence.state === 'running') {
    return { state: 'unknown', detail: 'A matching browser process is running, but its debugging port is not responding. ' + nextStep };
  }
  if (processEvidence.state === 'absent') {
    return { state: 'down', detail: 'No matching browser process was found and the debugging endpoint is not responding.' };
  }
  if (processEvidence.state === 'unsupported') {
    return { state: 'unknown', detail: 'This platform cannot verify the browser process. ' + nextStep };
  }
  if (processEvidence.state === 'ambiguous') {
    return { state: 'unknown', detail: 'A browser process may be related to this slot, but its port/profile did not match exactly. ' + nextStep };
  }
  return { state: 'unknown', detail: 'Could not verify whether the browser is closed. ' + nextStep };
}
