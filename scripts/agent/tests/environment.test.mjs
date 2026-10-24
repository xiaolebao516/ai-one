import assert from 'node:assert/strict';
import test from 'node:test';
import { commandFailureDetail, isSupportedNodeVersion, msvcInstallHint, pnpmCorepackHint, rustToolchainHint, supportedNodeRange } from '../environment.mjs';

test('Node prerequisite matches the package-manager and lint-tool intersection', () => {
  assert.equal(supportedNodeRange, '^22.13.0 || >=24.0.0');

  for (const version of ['22.13.0', 'v22.99.1', '24.0.0', '25.1.0']) {
    assert.equal(isSupportedNodeVersion(version), true, `${version} should be supported`);
  }

  for (const version of ['20.19.0', '22.12.9', '23.11.0', 'invalid']) {
    assert.equal(isSupportedNodeVersion(version), false, `${version} should be rejected`);
  }
});

test('Windows command failures are locale-independent', () => {
  const detail = commandFailureDetail('cargo', 1, 'win32');
  assert.equal(detail, 'cargo was not found or exited unsuccessfully (exit code 1)');
  assert.doesNotMatch(detail, /不是内部|无法将.*识别为|����/);
});

test('Rust diagnostics distinguish missing tools, PATH issues, and a broken toolchain', () => {
  const missing = rustToolchainHint('cargo', 'missing', '', 'win32');
  assert.ok(missing.includes('https://rustup.rs/'));
  assert.ok(missing.includes('x86_64-pc-windows-msvc'));

  const cargoBin = 'C:\\Users\\tester\\.cargo\\bin';
  const pathIssue = rustToolchainHint('cargo', 'not-on-path', cargoBin, 'win32');
  assert.ok(pathIssue.includes('PATH'));
  assert.ok(pathIssue.includes('Close and reopen PowerShell'));

  const broken = rustToolchainHint('rustc', 'failed', cargoBin, 'win32');
  assert.ok(broken.includes('rustup show'));
  assert.ok(broken.includes('rustup toolchain install'));
});

test('Corepack-only pnpm is not accepted when Tauri requires pnpm on PATH', () => {
  const detail = pnpmCorepackHint('11.0.0', 'win32');
  assert.ok(detail.includes('beforeDevCommand'));
  assert.ok(detail.includes('corepack enable'));
  assert.ok(detail.includes('pnpm --version'));
  assert.ok(detail.includes('PATH'));
  assert.ok(detail.includes('$env:USERPROFILE'));
});

test('MSVC guidance points to the official installer and required components', () => {
  assert.ok(msvcInstallHint.includes('https://visualstudio.microsoft.com/visual-cpp-build-tools/'));
  assert.ok(msvcInstallHint.includes('Desktop development with C++'));
  assert.ok(msvcInstallHint.includes('Windows 10/11 SDK'));
});
