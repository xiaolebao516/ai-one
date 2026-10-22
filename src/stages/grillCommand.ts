export interface GrillOptions {
  team?: string;
}

export type GrillCommandResult =
  | { matched: false; reason: 'not-command'; question: ''; options: GrillOptions }
  | { matched: true; reason: 'empty-question'; question: ''; options: GrillOptions }
  | { matched: true; reason: 'invalid-option'; question: string; options: GrillOptions }
  | { matched: true; reason: 'ok'; question: string; options: GrillOptions };

// Options are accepted only before the question, so a literal "--team" inside the question text
// (for example "What does --team do?") stays part of the question.
const TEAM_HEAD = /^--team(=|\s+|$)/i;
const TEAM_VALUE = /^(?:"([^"]+)"|'([^']+)'|([^\s"']+))/;

export function parseGrillCommand(input: string): GrillCommandResult {
  const source = input.trim();
  const command = /^\/grill(?:\s+|$)([\s\S]*)$/i.exec(source);
  if (!command) return { matched: false, reason: 'not-command', question: '', options: {} };

  let body = command[1].trim();
  const options: GrillOptions = {};
  const head = TEAM_HEAD.exec(body);
  if (head) {
    const rest = body.slice(head[0].length);
    const value = TEAM_VALUE.exec(rest);
    // "--team=" must be followed directly by the value; an unclosed quote or an empty value is malformed.
    if (!value || (head[1] === '=' && /^\s/.test(rest))) {
      return { matched: true, reason: 'invalid-option', question: rest.trim(), options };
    }
    options.team = (value[1] ?? value[2] ?? value[3]).trim();
    body = rest.slice(value[0].length).trim();
  }

  if (!body) return { matched: true, reason: 'empty-question', question: '', options };
  return { matched: true, reason: 'ok', question: body, options };
}
