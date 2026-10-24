/** Optional action lines in a「待用户验收」entry. Old entries without them are unaffected. */
export type AcceptanceAction =
  | { kind: 'command'; value: string }
  | { kind: 'open'; value: string; url?: string }
  | { kind: 'choice'; options: string[] }
  | { kind: 'manual'; value: string };

const COMMAND = /^(?:命令|运行命令|Command)\s*[:：]\s*(.+)$/iu;
const OPEN = /^(?:打开页面|打开|Open)\s*[:：]\s*(.+)$/iu;
const CHOICE = /^(?:决定|选择|Choose)\s*[:：]\s*(.+)$/iu;
const MANUAL = /^(?:本人操作|需要你本人操作|Manual)\s*[:：]\s*(.+)$/iu;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 40;

const unwrap = (value: string): string => value.trim().replace(/^`+|`+$/gu, '').trim();

/** Returns undefined when the line is not an action line, so callers keep treating it as ordinary text. */
export function parseActionLine(line: string): AcceptanceAction | undefined {
  const command = line.match(COMMAND);
  if (command && unwrap(command[1])) return { kind: 'command', value: unwrap(command[1]) };
  const open = line.match(OPEN);
  if (open && unwrap(open[1])) {
    const value = unwrap(open[1]);
    return /^https:\/\/[^\s]+$/u.test(value) ? { kind: 'open', value, url: value } : { kind: 'open', value };
  }
  const choice = line.match(CHOICE);
  if (choice) {
    const options = choice[1].split(/\s*[/／|｜、]\s*/u).map((option) => unwrap(option)).filter(Boolean);
    if (options.length >= 2 && options.length <= MAX_OPTIONS
      && new Set(options).size === options.length && options.every((option) => option.length <= MAX_OPTION_CHARS)) {
      return { kind: 'choice', options };
    }
    return undefined;
  }
  const manual = line.match(MANUAL);
  if (manual && unwrap(manual[1])) return { kind: 'manual', value: unwrap(manual[1]) };
  return undefined;
}

/** For display only: action lines already appear as buttons. The stored text and fix tasks keep every line. */
export function stripActionLines(text: string): string {
  return text.split(/\r?\n/u)
    .filter((line) => !parseActionLine(line.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s+)/u, '')))
    .join('\n');
}
export function describeActions(actions: readonly AcceptanceAction[]): string {
  return actions.map((action) => action.kind === 'command' ? `命令：${action.value}`
    : action.kind === 'open' ? `打开：${action.value}`
    : action.kind === 'manual' ? `本人操作：${action.value}`
    : `决定：${action.options.join(' / ')}`).join('\n');
}
export const hasChoice = (actions: readonly AcceptanceAction[] | undefined): boolean =>
  Boolean(actions?.some((action) => action.kind === 'choice'));
