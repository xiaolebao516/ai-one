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
const TEAM_OPTION = /^--team(?:\s*=\s*|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/i;
const MALFORMED_TEAM_OPTION = /^--team(?:\s|=|$)/i;

export function parseGrillCommand(input: string): GrillCommandResult {
  const source = input.trim();
  const command = /^\/grill(?:\s+|$)([\s\S]*)$/i.exec(source);
  if (!command) return { matched: false, reason: 'not-command', question: '', options: {} };

  let body = command[1].trim();
  const options: GrillOptions = {};
  const team = TEAM_OPTION.exec(body);
  if (team) {
    options.team = (team[1] ?? team[2] ?? team[3] ?? '').trim();
    body = body.slice(team[0].length).trim();
    if (!options.team) {
      return { matched: true, reason: 'invalid-option', question: body, options };
    }
  } else if (MALFORMED_TEAM_OPTION.test(body)) {
    body = body.replace(MALFORMED_TEAM_OPTION, ' ').trim();
    return { matched: true, reason: 'invalid-option', question: body, options };
  }

  if (!body) return { matched: true, reason: 'empty-question', question: '', options };
  return { matched: true, reason: 'ok', question: body, options };
}
