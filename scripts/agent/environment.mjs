import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { root } from './contract.mjs';
import { windowsShellCommand } from './windows-command.mjs';

export const supportedNodeRange = '^22.13.0 || >=24.0.0';

const RUSTUP_URL = 'https://rustup.rs/';
export const msvcInstallHint = 'Not found. Install Visual Studio Build Tools from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and select "Desktop development with C++", including the MSVC x64/x86 build tools and a Windows 10/11 SDK. Then reopen PowerShell and rerun "node scripts/agent/doctor.mjs".';

export function commandFailureDetail(command, status, platform = process.platform) {
  if (platform === 'win32') {
    return `${command} was not found or exited unsuccessfully (exit code ${status ?? 'unknown'})`;
  }
  return `${command} exited unsuccessfully (exit code ${status ?? 'unknown'})`;
}

export function rustToolchainHint(command, state, cargoBin = '', platform = process.platform) {
  const label = command === 'cargo' ? 'Cargo' : 'rustc';
  if (state === 'not-on-path') {
    return `Found ${label} under "${cargoBin}", but its directory is not on PATH. Close and reopen PowerShell. If it is still missing, add "${cargoBin}" to your user PATH, then rerun "node scripts/agent/doctor.mjs".`;
  }
  if (state === 'failed') {
    return `Found ${label} under "${cargoBin}", but it did not run successfully. Run "rustup show" and "rustup toolchain list". If the stable MSVC toolchain is missing, run "rustup toolchain install stable-x86_64-pc-windows-msvc" and "rustup default stable-x86_64-pc-windows-msvc", then rerun doctor.`;
  }
  if (platform === 'win32') {
    return `${label} was not found. Install Rust using rustup from ${RUSTUP_URL} and select the stable "x86_64-pc-windows-msvc" toolchain. Close and reopen PowerShell, then rerun "node scripts/agent/doctor.mjs".`;
  }
  return `${label} was not found. Install Rust using rustup from ${RUSTUP_URL}, select the stable toolchain, reopen the terminal, then rerun "node scripts/agent/doctor.mjs".`;
}

export function pnpmCorepackHint(version, platform = process.platform) {
  const writableShimHint = platform === 'win32'
    ? 'If Corepack cannot write beside Node.js, run `corepack enable --install-directory "$env:USERPROFILE\\.local\\bin" pnpm`, add that directory to your user PATH, and reopen PowerShell.'
    : 'If Corepack cannot write to its shim directory, run `corepack enable --install-directory <writable-directory> pnpm` and ensure that directory is on PATH.';
  return `Corepack can run pnpm ${version}, but Tauri's beforeDevCommand calls "pnpm" directly. Run "corepack enable", reopen the terminal, and confirm "pnpm --version" works. ${writableShimHint}`;
}

export function isSupportedNodeVersion(version) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major === 22 && minor >= 13) || major >= 24;
}

export function collectEnvironmentChecks() {
  const checks = [
    {
      name: 'repository',
      ok: existsSync(path.join(root, 'package.json')) && existsSync(path.join(root, 'src-tauri', 'Cargo.toml')),
      detail: root,
    },
    {
      name: 'node',
      ok: isSupportedNodeVersion(process.versions.node),
      detail: `${process.version} (requires ${supportedNodeRange})`,
    },
    resolvePnpmCheck(),
    rustCommandCheck('cargo'),
    rustCommandCheck('rustc'),
  ];

  if (process.platform === 'win32') checks.push(windowsMsvcCheck());
  if (process.platform === 'darwin') checks.push(commandCheck('xcode-select', ['-p'], 'xcode-command-line-tools'));
  if (process.platform === 'linux') {
    checks.push({
      name: 'desktop-session',
      ok: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
      detail: process.env.WAYLAND_DISPLAY
        ? `WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY}`
        : process.env.DISPLAY
          ? `DISPLAY=${process.env.DISPLAY}`
          : 'No graphical desktop detected',
    });
    checks.push(commandCheck('pkg-config', ['--exists', 'webkit2gtk-4.1'], 'webkit2gtk-4.1'));
  }

  return checks;
}

export function resolvePnpmCommand() {
  if (commandCheck('pnpm', ['--version']).ok) return { command: 'pnpm', prefixArgs: [] };
  return { command: 'corepack', prefixArgs: ['pnpm'] };
}

export function commandCheck(command, args, name = command) {
  const windowsCommand = process.platform === 'win32' ? windowsShellCommand(command, args) : undefined;
  if (process.platform === 'win32' && !windowsCommand) {
    return { name, ok: false, detail: 'unsafe Windows command token' };
  }
  const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : command;
  const executableArgs = process.platform === 'win32'
    ? ['/d', '/v:off', '/s', '/c', windowsCommand]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = String(result.stdout || result.stderr || result.error?.message || '').trim().split(/\r?\n/, 1)[0];
  const detail = result.status === 0
    ? output || 'available'
    : process.platform === 'win32'
      ? commandFailureDetail(command, result.status, 'win32')
      : output || commandFailureDetail(command, result.status);
  return { name, ok: result.status === 0, detail };
}

function resolvePnpmCheck() {
  const direct = commandCheck('pnpm', ['--version']);
  if (direct.ok) return direct;

  const viaCorepack = commandCheck('corepack', ['pnpm', '--version'], 'pnpm');
  if (viaCorepack.ok) {
    if (process.platform === 'win32') {
      const located = commandCheck('where', ['pnpm']);
      if (located.ok) {
        return {
          name: 'pnpm',
          ok: false,
          detail: `The pnpm command was found on PATH but failed when run. ${direct.detail}. Check that the shim points to a working Corepack installation, then rerun "node scripts/agent/doctor.mjs".`,
        };
      }
    }
    return { name: 'pnpm', ok: false, detail: pnpmCorepackHint(viaCorepack.detail) };
  }

  return {
    name: 'pnpm',
    ok: false,
    detail: 'pnpm was not found. Install pnpm or enable Corepack, then ensure the "pnpm" command is available on PATH. Tauri calls it directly during startup.',
  };
}

function rustCommandCheck(command) {
  const check = commandCheck(command, ['--version']);
  if (check.ok) return check;

  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || process.env.HOME;
    const cargoHome = process.env.CARGO_HOME || (profile ? path.win32.join(profile, '.cargo') : '');
    const cargoBin = cargoHome ? path.win32.join(cargoHome, 'bin') : '';
    const executablePath = cargoBin ? path.win32.join(cargoBin, `${command}.exe`) : '';
    if (executablePath && existsSync(executablePath)) {
      const normalizedBin = path.win32.resolve(cargoBin).toLowerCase();
      const onPath = String(process.env.PATH || '').split(';').some((entry) => {
        const trimmed = entry.trim().replace(/^"(.*)"$/, '$1');
        return trimmed && path.win32.resolve(trimmed).toLowerCase() === normalizedBin;
      });
      return {
        name: command,
        ok: false,
        detail: rustToolchainHint(command, onPath ? 'failed' : 'not-on-path', cargoBin, 'win32'),
      };
    }
  }

  return { name: command, ok: false, detail: rustToolchainHint(command, 'missing', '', process.platform) };
}

function windowsMsvcCheck() {
  const fromPath = commandCheck('where', ['cl'], 'msvc-cpp-build-tools');
  if (fromPath.ok) return fromPath;

  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const vswhere = programFilesX86 ? path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe') : '';
  if (vswhere && existsSync(vswhere)) {
    const result = spawnSync(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    const installationPath = String(result.stdout || '').trim();
    if (result.status === 0 && installationPath) {
      return { name: 'msvc-cpp-build-tools', ok: true, detail: installationPath };
    }
  }

  return {
    name: 'msvc-cpp-build-tools',
    ok: false,
    detail: msvcInstallHint,
  };
}
