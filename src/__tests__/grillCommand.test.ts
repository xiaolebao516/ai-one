import { describe, expect, it } from 'vitest';
import { parseGrillCommand } from '../stages/grillCommand';

describe('/grill command parser', () => {
  it('does not match ordinary text or a longer command name', () => {
    expect(parseGrillCommand('Please /grill this later')).toEqual({
      matched: false,
      reason: 'not-command',
      question: '',
      options: {},
    });
    expect(parseGrillCommand('/grilling build a plan').matched).toBe(false);
  });

  it('reports an empty question explicitly', () => {
    expect(parseGrillCommand('  /grill  ')).toEqual({
      matched: true,
      reason: 'empty-question',
      question: '',
      options: {},
    });
  });

  it('parses a question and a quoted team option', () => {
    expect(parseGrillCommand('/grill --team "GPT + Argon" Design a safe workflow')).toEqual({
      matched: true,
      reason: 'ok',
      question: 'Design a safe workflow',
      options: { team: 'GPT + Argon' },
    });
  });

  it('accepts team=value before the question', () => {
    expect(parseGrillCommand('/grill --team=first,second Decide whether to cache this')).toEqual({
      matched: true,
      reason: 'ok',
      question: 'Decide whether to cache this',
      options: { team: 'first,second' },
    });
  });

  it('keeps a literal --team inside the question text', () => {
    expect(parseGrillCommand('/grill What does --team do?')).toEqual({
      matched: true,
      reason: 'ok',
      question: 'What does --team do?',
      options: {},
    });
  });

  it('reports a missing team value rather than swallowing it silently', () => {
    expect(parseGrillCommand('/grill --team')).toEqual({
      matched: true,
      reason: 'invalid-option',
      question: '',
      options: {},
    });
  });
});
