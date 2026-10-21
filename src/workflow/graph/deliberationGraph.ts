import type { GraphEdge, StepNode, WorkflowGraph } from './types';
import { DELIBERATION_MAX_ROUNDS } from './deliberationAudit';

function stepId(round: number, role: 'first' | 'second'): string {
  return 'round' + round + '_' + role;
}
function auditId(round: number): string {
  return 'audit' + round;
}
function roundNode(round: number, role: 'first' | 'second'): StepNode {
  return {
    kind: 'step',
    provider: { type: 'role', role },
    role: 'D' + round,
    label: { builder: 'deliberation.label', args: [{ kind: 'literal', value: round }] },
    status: { builder: 'deliberation.status', args: [{ kind: 'literal', value: round }] },
    prompt: {
      builder: 'deliberation.reply',
      args: [
        { kind: 'literal', value: round },
        { kind: 'history', name: 'deliberation' },
        round === 1 ? { kind: 'literal', value: '' } : { kind: 'output', node: auditId(round - 1) },
      ],
    },
    output: stepId(round, role) + 'Response',
    policy: 'serialRunStep',
    appendHistory: {
      history: 'deliberation',
      value: { round: { kind: 'literal', value: round }, text: { kind: 'selfOutput' } },
    },
  };
}
function auditorNode(round: number): StepNode {
  return {
    kind: 'step',
    provider: { type: 'role', role: 'auditor' },
    role: 'A' + round,
    label: 'Independent audit, round ' + round,
    status: 'Independent audit, round ' + round,
    prompt: {
      builder: 'deliberation.audit',
      args: [
        { kind: 'literal', value: round },
        { kind: 'input', name: 'question' },
        { kind: 'history', name: 'deliberation' },
      ],
    },
    output: auditId(round) + 'Response',
    policy: 'serialRunStep',
  };
}
function makeNodes(): WorkflowGraph['nodes'] {
  const nodes: WorkflowGraph['nodes'] = {
    first: {
      kind: 'step',
      provider: { type: 'role', role: 'first' },
      role: 'D0',
      label: { builder: 'label.consult.first' },
      status: { builder: 'status.consult.initial', args: [
        { kind: 'providerName', provider: { type: 'role', role: 'first' } },
        { kind: 'providerName', provider: { type: 'role', role: 'second' } },
      ] },
      prompt: { builder: 'deliberation.initial', args: [{ kind: 'input', name: 'question' }] },
      output: 'firstResponse',
      policy: 'serialRunStep',
      parallelGroup: 'initial',
      appendHistory: { history: 'deliberation', value: { text: { kind: 'selfOutput' } } },
    },
    second: {
      kind: 'step',
      provider: { type: 'role', role: 'second' },
      role: 'D0',
      label: { builder: 'label.consult.second' },
      status: { builder: 'status.consult.initial', args: [
        { kind: 'providerName', provider: { type: 'role', role: 'first' } },
        { kind: 'providerName', provider: { type: 'role', role: 'second' } },
      ] },
      prompt: { builder: 'deliberation.initial', args: [{ kind: 'input', name: 'question' }] },
      output: 'secondResponse',
      policy: 'serialRunStep',
      parallelGroup: 'initial',
      appendHistory: { history: 'deliberation', value: { text: { kind: 'selfOutput' } } },
    },
  };
  for (let round = 1; round <= DELIBERATION_MAX_ROUNDS; round += 1) {
    nodes[stepId(round, 'first')] = roundNode(round, 'first');
    nodes[stepId(round, 'second')] = roundNode(round, 'second');
    nodes[auditId(round)] = auditorNode(round);
  }
  return nodes;
}
function makeEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [{ from: ['first', 'second'], to: stepId(1, 'first') }];
  for (let round = 1; round <= DELIBERATION_MAX_ROUNDS; round += 1) {
    edges.push({ from: stepId(round, 'first'), to: stepId(round, 'second') });
    edges.push({ from: stepId(round, 'second'), to: auditId(round) });
    if (round < DELIBERATION_MAX_ROUNDS) {
      edges.push({
        from: auditId(round),
        to: stepId(round + 1, 'first'),
        when: { type: 'deliberationAuditContinue', ref: { kind: 'output', node: auditId(round) } },
      });
    }
  }
  return edges;
}
export const deliberationGraph: WorkflowGraph = {
  schemaVersion: 1,
  id: 'deliberation',
  version: 2,
  mode: 'consult',
  start: 'first',
  roles: {
    first: { defaultProvider: 'chatgpt', uiLabel: 'First' },
    second: { defaultProvider: 'gemini', uiLabel: 'Second' },
    auditor: { defaultProvider: 'claude', uiLabel: 'Independent auditor' },
  },
  preflight: {
    kind: 'serial',
    requiredRoles: ['first', 'second', 'auditor'],
    aliasRules: [{ roles: ['first', 'second', 'auditor'], unique: true, reason: 'seat' }],
  },
  nodes: makeNodes(),
  edges: makeEdges(),
  onComplete: {
    status: '',
    report: {
      kind: 'deliberation',
      rounds: Array.from({ length: DELIBERATION_MAX_ROUNDS }, (_, index) => ({
        round: index + 1,
        first: stepId(index + 1, 'first'),
        second: stepId(index + 1, 'second'),
        auditor: auditId(index + 1),
      })),
    },
  },
};
