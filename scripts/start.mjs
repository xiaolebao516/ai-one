// 双击 ai-one.cmd 运行的启动器（#188）：检查工具 → 需要时安装依赖、编译应用和额度 HUD → 建桌面快捷方式 → 打开应用。
// 编译产物只放在已被 git 忽略的 target/ 里；同一个提交只编译一次，git pull 之后才会重新编译。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEnvironmentChecks } from './agent/environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const APP_EXE = path.join(root, 'src-tauri', 'target', 'release', 'multi-ai-chat-desktop.exe');
const HUD_EXE = path.join(root, 'agent-hud', 'target', 'release', 'ai-one-hud.exe');
const STAMP = path.join(root, 'src-tauri', 'target', 'release', 'ai-one-build.json');
const SPRITES = path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');

/** What to tell the user for each missing tool. Suggestions only: nothing here installs system tools. */
const INSTALL_HINT = {
  node: 'Node.js 版本太旧：需要 22.13 以上或 24 以上。可以运行  winget install OpenJS.NodeJS.LTS',
  pnpm: 'pnpm 不可用：打开 PowerShell 运行  corepack enable  ，关掉再打开窗口后重试。',
  cargo: 'Rust 没装好：运行  winget install Rustlang.Rustup  ，装完关掉再打开窗口后重试。',
  rustc: 'Rust 没装好：运行  winget install Rustlang.Rustup  ，装完关掉再打开窗口后重试。',
  'msvc-cpp-build-tools': 'C++ 生成工具没装：运行  winget install Microsoft.VisualStudio.2022.BuildTools  ，在安装器里勾选“使用 C++ 的桌面开发”。',
  repository: '这个文件夹不是完整的 ai-one 仓库，请重新 git clone。',
};

const say = (line) => process.stdout.write(`${line}\n`);

function run(command, commandArgs, options = {}) {
  // pnpm is a .cmd shim on Windows and needs a shell; node itself must not go through one (its
  // path usually contains spaces).
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && command === 'pnpm', ...options });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} 失败（退出码 ${result.status ?? '未知'}）`);
}

function git(gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** The source this build is for: the commit plus any local edits to tracked files. */
function sourceStamp() {
  const head = git(['rev-parse', 'HEAD']);
  const edits = createHash('sha256').update(git(['diff', 'HEAD'])).digest('hex');
  return { head, edits };
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(STAMP, 'utf8'));
  } catch {
    return null;
  }
}

function needsInstall() {
  const marker = path.join(root, 'node_modules', '.modules.yaml');
  if (!existsSync(marker)) return true;
  return statSync(path.join(root, 'pnpm-lock.yaml')).mtimeMs > statSync(marker).mtimeMs;
}

function checkTools() {
  const missing = collectEnvironmentChecks().filter((check) => !check.ok);
  if (missing.length === 0) return true;
  say('');
  say('还缺这些工具，装好后再双击 ai-one.cmd：');
  for (const check of missing) say(`  - ${INSTALL_HINT[check.name] ?? `${check.name}：${check.detail}`}`);
  say('');
  say('（Windows 10/11 一般自带 WebView2；没有的话从 https://developer.microsoft.com/microsoft-edge/webview2/ 安装。）');
  return false;
}

function buildHud() {
  // The original Clawd art may not be published with this repository, so it is fetched from the
  // pinned upstream commit for this local build only. Without network, the drawn stand-in is used.
  if (!existsSync(SPRITES)) {
    const fetched = spawnSync(process.execPath, ['scripts/fetch-clawd-sprites.mjs', '--strict'], { cwd: root, stdio: 'inherit' });
    if (fetched.status !== 0) say('下载原版 Claude 小人图片失败，HUD 先用替代图。联网后删掉 agent-hud/target 再双击即可换回。');
  }
  run(process.execPath, ['scripts/fetch-clawd-sprites.mjs', existsSync(SPRITES) ? '--build-original' : '--build-clean']);
}

/** Desktop shortcut "ai-one" → this repository's ai-one.cmd (created or re-pointed, never duplicated). */
function ensureShortcut() {
  if (process.platform !== 'win32' || args.has('--no-shortcut')) return;
  const target = path.join(root, 'ai-one.cmd');
  const icon = path.join(root, 'src-tauri', 'icons', 'icon.ico');
  const script = [
    '$desktop = [Environment]::GetFolderPath("Desktop")',
    '$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop "ai-one.lnk"))',
    `if ($link.TargetPath -ne '${target}') {`,
    `  $link.TargetPath = '${target}'`,
    `  $link.WorkingDirectory = '${root}'`,
    `  $link.IconLocation = '${icon}'`,
    '  $link.WindowStyle = 7',
    '  $link.Save()',
    '  "updated"',
    '}',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  if (result.stdout.includes('updated')) say('已在桌面放好 ai-one 快捷方式，以后双击它就行。');
}

function launch() {
  if (args.has('--no-launch')) return;
  const child = spawn(APP_EXE, [], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  say('ai-one 已打开。');
}

function main() {
  if (process.platform !== 'win32') {
    say('一键启动只支持 Windows；其他系统请看 README 的“启动开发版”。');
    return 1;
  }
  const stamp = sourceStamp();
  const built = readStamp();
  const upToDate = existsSync(APP_EXE) && existsSync(HUD_EXE) && built?.head === stamp.head && built?.edits === stamp.edits;
  if (!upToDate) {
    if (!checkTools()) return 1;
    say(existsSync(APP_EXE) ? '代码有更新，重新编译（几分钟）……' : '第一次启动，正在编译（大约 5–15 分钟，之后再打开就很快）……');
    if (needsInstall()) run('pnpm', ['install', '--frozen-lockfile']);
    run('pnpm', ['tauri', 'build', '--no-bundle']);
    buildHud();
    mkdirSync(path.dirname(STAMP), { recursive: true });
    writeFileSync(STAMP, `${JSON.stringify(stamp)}\n`);
    // Tauri rewrites a few tracked files with only line-ending changes; refresh the index so
    // `git status` stays clean.
    git(['update-index', '-q', '--refresh']);
  }
  ensureShortcut();
  launch();
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  say('');
  say(`启动失败：${error instanceof Error ? error.message : String(error)}`);
  say('把上面的报错发给 Claude Code 就能查。');
  process.exitCode = 1;
}
