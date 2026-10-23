export type Collaboration = 'solo' | 'discussion' | 'author-review' | 'parallel';

export type EndCondition =
  | 'user-confirms'
  | 'audit-pass'
  | 'audit-pass-and-local-verify'
  | 'rounds-done'
  | 'all-subtasks-done';

export type FailPolicy = 'stop-and-ask' | 'retry-n' | 'skip' | 'escalate-to-user';
export type ParticipantEffort = 'default' | 'high' | 'max';

export interface Participant {
  resource: string;
  role: string;
  model?: string;
  effort?: ParticipantEffort;
  freshSession?: boolean;
}

export interface StageDef {
  id: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  command?: string;
  collaboration: Collaboration;
  participants: Participant[];
  note?: string;
  endCondition: EndCondition;
  onFail: FailPolicy;
  reworkLimit?: number;
  builtin: boolean;
}

export interface StageRef {
  stageId: string;
  overrides?: Partial<Pick<StageDef, 'participants' | 'endCondition' | 'onFail' | 'reworkLimit' | 'note'>>;
  next?: never;
}

export interface FlowDef {
  id: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  stages: StageRef[];
  builtin: boolean;
}

export interface FlowsFile {
  schemaVersion: 1;
  stages: StageDef[];
  flows: FlowDef[];
}

export interface FlowExport {
  schemaVersion: 1;
  kind: 'flow';
  stages: StageDef[];
  flows: FlowDef[];
}

export type ValidationIssueCode =
  | 'bad-shape'
  | 'unknown-schema-version'
  | 'empty-id'
  | 'empty-name'
  | 'invalid-builtin'
  | 'invalid-collaboration'
  | 'invalid-participants'
  | 'invalid-participant'
  | 'empty-resource'
  | 'empty-role'
  | 'invalid-effort'
  | 'invalid-fresh-session'
  | 'invalid-end-condition'
  | 'invalid-on-fail'
  | 'invalid-rework-limit'
  | 'invalid-note'
  | 'invalid-command'
  | 'invalid-description'
  | 'missing-author'
  | 'missing-audit'
  | 'same-author-audit-session'
  | 'empty-flow'
  | 'unknown-stage'
  | 'forbidden-next'
  | 'invalid-overrides'
  | 'invalid-override-field'
  | 'duplicate-id';

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: string;
  stageId?: string;
  flowId?: string;
  message: string;
}

export interface StageValidationContext {
  path?: string;
  flowId?: string;
}

export type ParseFlowsFileResult =
  | { ok: true; file: FlowsFile }
  | {
      ok: false;
      reason: 'not-json' | 'bad-shape' | 'unknown-schema-version' | 'invalid';
      issues: ValidationIssue[];
    };

export interface ImportConflict<T> {
  item: T;
  existing: T[];
  reason: 'id' | 'name' | 'id-and-name';
}

export interface ImportPlan {
  stages: {
    add: StageDef[];
    conflicts: ImportConflict<StageDef>[];
    crossTypeIdConflicts: Array<{ item: StageDef; existing: FlowDef }>;
  };
  flows: {
    add: FlowDef[];
    conflicts: ImportConflict<FlowDef>[];
    crossTypeIdConflicts: Array<{ item: FlowDef; existing: StageDef }>;
  };
}

export const FLOWS_SCHEMA_VERSION = 1 as const;

const END_CONDITIONS: readonly EndCondition[] = [
  'user-confirms',
  'audit-pass',
  'audit-pass-and-local-verify',
  'rounds-done',
  'all-subtasks-done',
];

const FAIL_POLICIES: readonly FailPolicy[] = [
  'stop-and-ask',
  'retry-n',
  'skip',
  'escalate-to-user',
];

const COLLABORATIONS: readonly Collaboration[] = ['solo', 'discussion', 'author-review', 'parallel'];
const EFFORTS: readonly ParticipantEffort[] = ['default', 'high', 'max'];
const OVERRIDE_KEYS = new Set(['participants', 'endCondition', 'onFail', 'reworkLimit', 'note']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function issue(
  code: ValidationIssueCode,
  path: string,
  stageId?: string,
  flowId?: string,
): ValidationIssue {
  return { code, path, stageId, flowId, message: code };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCollaboration(value: unknown): value is Collaboration {
  return typeof value === 'string' && COLLABORATIONS.includes(value as Collaboration);
}

function isEndCondition(value: unknown): value is EndCondition {
  return typeof value === 'string' && END_CONDITIONS.includes(value as EndCondition);
}

function isFailPolicy(value: unknown): value is FailPolicy {
  return typeof value === 'string' && FAIL_POLICIES.includes(value as FailPolicy);
}

function isParticipantShape(value: unknown): value is Participant {
  if (!isRecord(value) || typeof value.resource !== 'string' || typeof value.role !== 'string') return false;
  if (value.model !== undefined && typeof value.model !== 'string') return false;
  if (value.effort !== undefined && typeof value.effort !== 'string') return false;
  if (value.freshSession !== undefined && typeof value.freshSession !== 'boolean') return false;
  return true;
}

function isStageShape(value: unknown): value is StageDef {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.collaboration !== 'string' ||
    !Array.isArray(value.participants) ||
    !value.participants.every(isParticipantShape) ||
    typeof value.endCondition !== 'string' ||
    typeof value.onFail !== 'string' ||
    typeof value.builtin !== 'boolean'
  ) return false;
  if (value.command !== undefined && typeof value.command !== 'string') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.nameEn !== undefined && typeof value.nameEn !== 'string') return false;
  if (value.descriptionEn !== undefined && typeof value.descriptionEn !== 'string') return false;
  if (value.reworkLimit !== undefined && typeof value.reworkLimit !== 'number') return false;
  return true;
}

function isStageRefShape(value: unknown): value is StageRef {
  if (!isRecord(value) || typeof value.stageId !== 'string') return false;
  if (value.overrides === undefined) return true;
  if (!isRecord(value.overrides)) return false;
  const overrides = value.overrides;
  if (overrides.participants !== undefined &&
    (!Array.isArray(overrides.participants) || !overrides.participants.every(isParticipantShape))) return false;
  if (overrides.endCondition !== undefined && typeof overrides.endCondition !== 'string') return false;
  if (overrides.onFail !== undefined && typeof overrides.onFail !== 'string') return false;
  if (overrides.reworkLimit !== undefined && typeof overrides.reworkLimit !== 'number') return false;
  if (overrides.note !== undefined && typeof overrides.note !== 'string') return false;
  return true;
}

function isFlowShape(value: unknown): value is FlowDef {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.stages) ||
    !value.stages.every(isStageRefShape) ||
    typeof value.builtin !== 'boolean'
  ) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.nameEn !== undefined && typeof value.nameEn !== 'string') return false;
  if (value.descriptionEn !== undefined && typeof value.descriptionEn !== 'string') return false;
  return true;
}

function isFlowsShape(value: unknown): value is FlowsFile & { kind?: 'flow' } {
  if (!isRecord(value) || !Array.isArray(value.stages) || !value.stages.every(isStageShape)) return false;
  if (!Array.isArray(value.flows) || !value.flows.every(isFlowShape)) return false;
  if (value.kind !== undefined && value.kind !== 'flow') return false;
  return true;
}

function normalizeResource(resource: string): string {
  return resource.trim().toLowerCase();
}

function normalizeRole(role: string): string {
  return role.trim().toLocaleLowerCase();
}

function isAuthorRole(role: string): boolean {
  const value = normalizeRole(role);
  return value === 'author' || value === '作者';
}

function isAuditRole(role: string): boolean {
  const value = normalizeRole(role);
  return value === 'audit' || value === '审计';
}

function validateParticipants(
  participants: unknown,
  collaboration: Collaboration,
  path: string,
  stageId?: string,
  flowId?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(participants)) {
    return [issue('invalid-participants', path, stageId, flowId)];
  }

  const valid: Participant[] = [];
  participants.forEach((participant, index) => {
    const participantPath = path + '.' + index;
    if (!isParticipantShape(participant)) {
      issues.push(issue('invalid-participant', participantPath, stageId, flowId));
      return;
    }
    valid.push(participant);
    if (!isNonEmptyString(participant.resource)) {
      issues.push(issue('empty-resource', participantPath + '.resource', stageId, flowId));
    }
    if (!isNonEmptyString(participant.role)) {
      issues.push(issue('empty-role', participantPath + '.role', stageId, flowId));
    }
    if (participant.effort !== undefined && !EFFORTS.includes(participant.effort)) {
      issues.push(issue('invalid-effort', participantPath + '.effort', stageId, flowId));
    }
    if (participant.freshSession !== undefined && typeof participant.freshSession !== 'boolean') {
      issues.push(issue('invalid-fresh-session', participantPath + '.freshSession', stageId, flowId));
    }
  });

  if (!isCollaboration(collaboration)) return issues;

  if (collaboration === 'solo' && valid.length !== 1) {
    issues.push(issue('invalid-participants', path, stageId, flowId));
  } else if (collaboration === 'discussion' && valid.length < 2) {
    issues.push(issue('invalid-participants', path, stageId, flowId));
  } else if (collaboration === 'parallel' && valid.length < 2) {
    issues.push(issue('invalid-participants', path, stageId, flowId));
  } else if (collaboration === 'author-review') {
    const authors = valid.filter((participant) => isAuthorRole(participant.role));
    const auditors = valid.filter((participant) => isAuditRole(participant.role));
    if (authors.length === 0) issues.push(issue('missing-author', path, stageId, flowId));
    if (auditors.length === 0) issues.push(issue('missing-audit', path, stageId, flowId));
    // Normalize resource IDs and reject every same-resource author/audit pair unless that
    // auditor explicitly starts a fresh session. A different author must not hide self-review.
    const sameResourcePair = authors.some((author) =>
      auditors.some((auditor) =>
        normalizeResource(author.resource) === normalizeResource(auditor.resource) &&
        auditor.freshSession !== true,
      ),
    );
    if (authors.length > 0 && auditors.length > 0 && sameResourcePair) {
      issues.push(issue('same-author-audit-session', path, stageId, flowId));
    }
  }

  return issues;
}

function validateStageBasics(
  stage: StageDef,
  path: string,
  flowId?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stageId = typeof stage.id === 'string' ? stage.id : undefined;

  if (!isNonEmptyString(stage.id)) issues.push(issue('empty-id', path + '.id', stageId, flowId));
  if (!isNonEmptyString(stage.name)) issues.push(issue('empty-name', path + '.name', stageId, flowId));
  if (typeof stage.builtin !== 'boolean') issues.push(issue('invalid-builtin', path + '.builtin', stageId, flowId));
  if (!isCollaboration(stage.collaboration)) {
    issues.push(issue('invalid-collaboration', path + '.collaboration', stageId, flowId));
  }
  issues.push(...validateParticipants(stage.participants, stage.collaboration, path + '.participants', stageId, flowId));
  if (!isEndCondition(stage.endCondition)) {
    issues.push(issue('invalid-end-condition', path + '.endCondition', stageId, flowId));
  }
  if (!isFailPolicy(stage.onFail)) issues.push(issue('invalid-on-fail', path + '.onFail', stageId, flowId));
  if (stage.reworkLimit !== undefined &&
    (!Number.isInteger(stage.reworkLimit) || stage.reworkLimit < 1 || stage.reworkLimit > 10)) {
    issues.push(issue('invalid-rework-limit', path + '.reworkLimit', stageId, flowId));
  }
  if (stage.note !== undefined && typeof stage.note !== 'string') {
    issues.push(issue('invalid-note', path + '.note', stageId, flowId));
  }
  if (stage.command !== undefined && typeof stage.command !== 'string') {
    issues.push(issue('invalid-command', path + '.command', stageId, flowId));
  }
  if (
    (stage.description !== undefined && typeof stage.description !== 'string') ||
    (stage.nameEn !== undefined && typeof stage.nameEn !== 'string') ||
    (stage.descriptionEn !== undefined && typeof stage.descriptionEn !== 'string')
  ) issues.push(issue('invalid-description', path + '.description', stageId, flowId));

  return issues;
}

export function validateStage(stage: StageDef, ctx: StageValidationContext = {}): ValidationIssue[] {
  const path = ctx.path ?? 'stage';
  if (!isRecord(stage)) return [issue('bad-shape', path, undefined, ctx.flowId)];
  return validateStageBasics(stage, path, ctx.flowId);
}

function validateOverride(
  base: StageDef,
  overrides: StageRef['overrides'],
  path: string,
  flowId: string,
): ValidationIssue[] {
  if (overrides === undefined) return [];
  if (!isRecord(overrides)) return [issue('invalid-overrides', path, base.id, flowId)];

  const issues: ValidationIssue[] = [];
  Object.keys(overrides).forEach((key) => {
    if (!OVERRIDE_KEYS.has(key)) {
      issues.push(issue('invalid-override-field', path + '.' + key, base.id, flowId));
    }
  });

  if (hasOwn(overrides, 'participants')) {
    issues.push(...validateParticipants(
      overrides.participants,
      base.collaboration,
      path + '.participants',
      base.id,
      flowId,
    ));
  }
  if (hasOwn(overrides, 'endCondition') && !isEndCondition(overrides.endCondition)) {
    issues.push(issue('invalid-end-condition', path + '.endCondition', base.id, flowId));
  }
  if (hasOwn(overrides, 'onFail') && !isFailPolicy(overrides.onFail)) {
    issues.push(issue('invalid-on-fail', path + '.onFail', base.id, flowId));
  }
  if (hasOwn(overrides, 'reworkLimit') && overrides.reworkLimit !== undefined &&
    (!Number.isInteger(overrides.reworkLimit) || (overrides.reworkLimit as number) < 1 || (overrides.reworkLimit as number) > 10)) {
    issues.push(issue('invalid-rework-limit', path + '.reworkLimit', base.id, flowId));
  }
  if (hasOwn(overrides, 'note') && typeof overrides.note !== 'string') {
    issues.push(issue('invalid-note', path + '.note', base.id, flowId));
  }

  return issues;
}

export function validateFlow(flow: FlowDef, stages: readonly StageDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(flow)) return [issue('bad-shape', 'flow')];

  if (!isNonEmptyString(flow.id)) issues.push(issue('empty-id', 'flow.id', undefined, flow.id));
  if (!isNonEmptyString(flow.name)) issues.push(issue('empty-name', 'flow.name', undefined, flow.id));
  if (typeof flow.builtin !== 'boolean') issues.push(issue('invalid-builtin', 'flow.builtin', undefined, flow.id));
  if (
    (flow.description !== undefined && typeof flow.description !== 'string') ||
    (flow.nameEn !== undefined && typeof flow.nameEn !== 'string') ||
    (flow.descriptionEn !== undefined && typeof flow.descriptionEn !== 'string')
  ) issues.push(issue('invalid-description', 'flow.description', undefined, flow.id));

  if (!Array.isArray(flow.stages) || flow.stages.length === 0) {
    issues.push(issue('empty-flow', 'flow.stages', undefined, flow.id));
    return issues;
  }

  flow.stages.forEach((ref, index) => {
    const path = 'flows.' + flow.id + '.stages.' + index;
    if (!isRecord(ref)) {
      issues.push(issue('bad-shape', path, undefined, flow.id));
      return;
    }
    if (hasOwn(ref, 'next')) issues.push(issue('forbidden-next', path + '.next', undefined, flow.id));
    if (typeof ref.stageId !== 'string' || ref.stageId.trim().length === 0) {
      issues.push(issue('unknown-stage', path + '.stageId', undefined, flow.id));
      return;
    }
    const base = stages.find((stage) => stage.id === ref.stageId);
    if (!base) {
      issues.push(issue('unknown-stage', path + '.stageId', ref.stageId, flow.id));
      return;
    }
    issues.push(...validateOverride(base, ref.overrides, path + '.overrides', flow.id));
  });

  return issues;
}

export function validateFile(file: FlowsFile): ValidationIssue[] {
  const value: unknown = file;
  if (!isRecord(value) || !Array.isArray(value.stages) || !Array.isArray(value.flows)) {
    return [issue('bad-shape', '$')];
  }
  if (value.schemaVersion !== FLOWS_SCHEMA_VERSION) {
    return [issue('unknown-schema-version', 'schemaVersion')];
  }

  const stages = value.stages as StageDef[];
  const flows = value.flows as FlowDef[];
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  stages.forEach((stage, index) => {
    if (!isStageShape(stage)) {
      issues.push(issue('bad-shape', 'stages.' + index));
      return;
    }
    issues.push(...validateStage(stage, { path: 'stages.' + index }));
    if (seenIds.has(stage.id)) issues.push(issue('duplicate-id', 'stages.' + index + '.id', stage.id));
    seenIds.add(stage.id);
  });

  flows.forEach((flow, index) => {
    if (!isFlowShape(flow)) {
      const raw: unknown = flow;
      issues.push(issue('bad-shape', 'flows.' + index, undefined, isRecord(raw) && typeof raw.id === 'string' ? raw.id : undefined));
      return;
    }
    issues.push(...validateFlow(flow, stages));
    if (seenIds.has(flow.id)) issues.push(issue('duplicate-id', 'flows.' + index + '.id', undefined, flow.id));
    seenIds.add(flow.id);
  });

  return issues;
}

export function parseFlowsFile(text: string): ParseFlowsFileResult {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'not-json', issues: [] };
  }

  if (!isRecord(value)) {
    return { ok: false, reason: 'bad-shape', issues: [issue('bad-shape', 'root')] };
  }
  if (value.schemaVersion !== FLOWS_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unknown-schema-version',
      issues: [issue('unknown-schema-version', 'schemaVersion')],
    };
  }
  if (!isFlowsShape(value)) {
    return { ok: false, reason: 'bad-shape', issues: [issue('bad-shape', 'root')] };
  }
  if (value.kind === 'flow' && value.flows.length !== 1) {
    return { ok: false, reason: 'bad-shape', issues: [issue('bad-shape', 'flows')] };
  }

  const file: FlowsFile = {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    stages: value.stages,
    flows: value.flows,
  };
  const issues = validateFile(file);
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };
  return { ok: true, file };
}

export function resolveStage(ref: StageRef, stages: readonly StageDef[]): StageDef | undefined {
  const base = stages.find((stage) => stage.id === ref.stageId);
  if (!base) return undefined;
  const overrides = ref.overrides;
  return {
    ...base,
    ...(overrides ?? {}),
    participants: (overrides?.participants ?? base.participants).map((participant) => ({ ...participant })),
  };
}

export function builtinStages(): StageDef[] {
  // Resource ids follow the existing workflow vocabulary. Reusing ChatGPT for audit is safe only
  // because the audit participant explicitly requests a fresh session; local agents are separate resources.
  return [
    {
      id: 'stage.grill',
      name: '想需求',
      nameEn: 'Explore requirements',
      description: '两位参与者独立作答、交换回复并形成讨论结论。',
      descriptionEn: 'Two participants answer independently, exchange replies, and reach a discussion summary.',
      command: 'grill',
      collaboration: 'discussion',
      participants: [
        { resource: 'chatgpt', role: '讨论者', model: 'GPT', effort: 'high' },
        { resource: 'gemini', role: '讨论者', model: 'Argon', effort: 'high' },
      ],
      endCondition: 'rounds-done',
      onFail: 'stop-and-ask',
      builtin: true,
    },
    {
      id: 'stage.plan',
      name: '定方案',
      nameEn: 'Plan',
      description: 'CC 负责方案设计，完成后交给用户确认。',
      descriptionEn: 'CC designs the plan and asks the user to confirm it.',
      command: 'plan',
      collaboration: 'solo',
      participants: [{ resource: 'claude-code', role: '设计者', model: 'Opus', effort: 'max' }],
      endCondition: 'user-confirms',
      onFail: 'stop-and-ask',
      builtin: true,
    },
    {
      id: 'stage.split',
      name: '拆任务',
      nameEn: 'Split tasks',
      description: 'CC 将方案拆成可独立执行的子任务。',
      descriptionEn: 'CC splits the plan into independently executable subtasks.',
      command: 'split',
      collaboration: 'solo',
      participants: [{ resource: 'claude-code', role: '拆解者', model: 'Opus', effort: 'high' }],
      endCondition: 'all-subtasks-done',
      onFail: 'stop-and-ask',
      builtin: true,
    },
    {
      id: 'stage.build',
      name: '执行与审计',
      nameEn: 'Implement and audit',
      description: 'GPT 执行、独立会话审计，CC 本机验证。',
      descriptionEn: 'GPT implements, an independent session audits, and CC verifies locally.',
      command: 'build',
      collaboration: 'author-review',
      participants: [
        { resource: 'chatgpt', role: '作者', model: 'GPT', effort: 'high' },
        { resource: 'chatgpt', role: '审计', model: 'GPT', effort: 'high', freshSession: true },
        { resource: 'claude-code', role: '本机验证者', model: 'Opus', effort: 'high' },
      ],
      endCondition: 'audit-pass-and-local-verify',
      onFail: 'retry-n',
      reworkLimit: 3,
      builtin: true,
    },
    {
      id: 'stage.ship',
      name: '总结交付',
      nameEn: 'Summarize and deliver',
      description: '整理交付内容、验证证据和遗留风险。',
      descriptionEn: 'Summarize deliverables, verification evidence, and remaining risks.',
      command: 'ship',
      collaboration: 'solo',
      participants: [{ resource: 'claude-code', role: '交付总结者', model: 'Opus', effort: 'high' }],
      endCondition: 'user-confirms',
      onFail: 'stop-and-ask',
      builtin: true,
    },
  ];
}

export function builtinFlows(): FlowDef[] {
  // StageRef schema v1 cannot override collaboration; the shared build stage remains author-review,
  // while this flow expresses its parallel workers through participant overrides and the note.
  return [
    {
      id: 'flow.quick',
      name: '快速开发',
      nameEn: 'Quick development',
      description: '定方案 → 执行与审计 → 总结交付。',
      descriptionEn: 'Plan, implement and audit, then summarize delivery.',
      stages: [{ stageId: 'stage.plan' }, { stageId: 'stage.build' }, { stageId: 'stage.ship' }],
      builtin: true,
    },
    {
      id: 'flow.parallel',
      name: 'CC 设计·并行开发',
      nameEn: 'CC design and parallel development',
      description: '定方案 → 拆任务 → 并行执行与独立审计 → 总结交付。',
      descriptionEn: 'Plan, split tasks, execute in parallel with independent audit, then summarize.',
      stages: [
        { stageId: 'stage.plan' },
        { stageId: 'stage.split' },
        {
          stageId: 'stage.build',
          overrides: {
            participants: [
              { resource: 'codex', role: '作者', model: 'Codex', effort: 'high' },
              { resource: 'claude-code', role: '作者', model: 'Opus', effort: 'high' },
              { resource: 'chatgpt', role: '作者', model: 'GPT', effort: 'high' },
              { resource: 'chatgpt', role: '审计', model: 'GPT', effort: 'high', freshSession: true },
              { resource: 'claude-code', role: '本机验证者', model: 'Opus', effort: 'high' },
            ],
            note: '多个执行者分别负责子任务；审计必须使用独立会话，CC 在本机验证。',
          },
        },
        { stageId: 'stage.ship' },
      ],
      builtin: true,
    },
    {
      id: 'flow.grill',
      name: '只讨论需求',
      nameEn: 'Discuss requirements only',
      description: '只运行想需求阶段，不进入开发。',
      descriptionEn: 'Run only the requirements discussion without starting development.',
      stages: [{ stageId: 'stage.grill' }],
      builtin: true,
    },
  ];
}

export function duplicateStage(stage: StageDef, existing: readonly StageDef[] = []): StageDef {
  return {
    ...stage,
    id: uniqueId(stage.id + '-copy', existing.map((item) => item.id)),
    name: stage.name + ' 副本',
    nameEn: stage.nameEn ? 'Copy of ' + stage.nameEn : undefined,
    builtin: false,
    participants: stage.participants.map((participant) => ({ ...participant })),
  };
}

export function duplicateFlow(flow: FlowDef, existing: readonly FlowDef[] = []): FlowDef {
  return {
    ...flow,
    id: uniqueId(flow.id + '-copy', existing.map((item) => item.id)),
    name: flow.name + ' 副本',
    nameEn: flow.nameEn ? 'Copy of ' + flow.nameEn : undefined,
    builtin: false,
    stages: flow.stages.map(cloneStageRef),
  };
}

export function addStageToFlow(flow: FlowDef, stageId: string, index?: number): FlowDef {
  const stages = flow.stages.map(cloneStageRef);
  const insertionIndex = index === undefined ? stages.length : Math.max(0, Math.min(index, stages.length));
  stages.splice(insertionIndex, 0, { stageId });
  return { ...flow, stages };
}

export function moveStageRef(flow: FlowDef, from: number, to: number): FlowDef {
  const length = flow.stages.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= length || to < 0 || to >= length) {
    return flow;
  }
  if (from === to) return flow;
  const stages = flow.stages.map(cloneStageRef);
  const moved = stages.splice(from, 1)[0];
  if (!moved) return flow;
  stages.splice(to, 0, moved);
  return { ...flow, stages };
}

export function removeStageRef(flow: FlowDef, index: number): FlowDef {
  if (!Number.isInteger(index) || index < 0 || index >= flow.stages.length) return flow;
  const stages = flow.stages.map(cloneStageRef);
  stages.splice(index, 1);
  return { ...flow, stages };
}

export function stageUsage(file: FlowsFile, stageId: string): string[] {
  return file.flows
    .filter((flow) => flow.stages.some((ref) => ref.stageId === stageId))
    .map((flow) => flow.name);
}

export function canDeleteStage(file: FlowsFile, stageId: string): boolean {
  const stage = file.stages.find((item) => item.id === stageId);
  return Boolean(stage && !stage.builtin && stageUsage(file, stageId).length === 0);
}

export function buildExport(file: FlowsFile, flowId: string): FlowExport | null {
  const flow = file.flows.find((item) => item.id === flowId);
  if (!flow) return null;
  const stageIds = new Set(flow.stages.map((ref) => ref.stageId));
  const stages = file.stages.filter((stage) => stageIds.has(stage.id)).map(cloneStage);
  if (flow.stages.some((ref) => !stages.some((stage) => stage.id === ref.stageId))) return null;
  return {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    kind: 'flow',
    stages,
    flows: [{ ...flow, stages: flow.stages.map(cloneStageRef) }],
  };
}

export function planImport(current: FlowsFile, incoming: FlowsFile | FlowExport): ImportPlan {
  const stagePlan = planItems(current.stages, incoming.stages);
  const flowPlan = planItems(current.flows, incoming.flows);
  const stageCrossTypeIdConflicts = incoming.stages.flatMap((item) =>
    current.flows.filter((flow) => flow.id === item.id).map((existing) => ({ item, existing })),
  );
  const flowCrossTypeIdConflicts = incoming.flows.flatMap((item) =>
    current.stages.filter((stage) => stage.id === item.id).map((existing) => ({ item, existing })),
  );
  const stageCrossTypeIds = new Set(stageCrossTypeIdConflicts.map((conflict) => conflict.item.id));
  const flowCrossTypeIds = new Set(flowCrossTypeIdConflicts.map((conflict) => conflict.item.id));
  return {
    stages: {
      add: stagePlan.add.filter((item) => !stageCrossTypeIds.has(item.id)),
      conflicts: stagePlan.conflicts,
      crossTypeIdConflicts: stageCrossTypeIdConflicts,
    },
    flows: {
      add: flowPlan.add.filter((item) => !flowCrossTypeIds.has(item.id)),
      conflicts: flowPlan.conflicts,
      crossTypeIdConflicts: flowCrossTypeIdConflicts,
    },
  };
}

function planItems<T extends { id: string; name: string }>(
  current: readonly T[],
  incoming: readonly T[],
): { add: T[]; conflicts: ImportConflict<T>[] } {
  const add: T[] = [];
  const conflicts: ImportConflict<T>[] = [];
  incoming.forEach((item) => {
    const existing = current.filter((candidate) =>
      candidate.id === item.id || normalizeName(candidate.name) === normalizeName(item.name),
    );
    if (existing.length === 0) {
      add.push(item);
      return;
    }
    const hasId = existing.some((candidate) => candidate.id === item.id);
    const hasName = existing.some((candidate) => normalizeName(candidate.name) === normalizeName(item.name));
    conflicts.push({
      item,
      existing: [...existing],
      reason: hasId && hasName ? 'id-and-name' : hasId ? 'id' : 'name',
    });
  });
  return { add, conflicts };
}

export function applyImport(
  current: FlowsFile,
  incoming: FlowsFile | FlowExport,
  resolution: 'keep-both' | 'overwrite',
): FlowsFile {
  const stages = current.stages.map(cloneStage);
  const flows = current.flows.map((flow) => ({ ...flow, stages: flow.stages.map(cloneStageRef) }));
  const stageIdMap = new Map<string, string>();
  const occupiedStageIds = new Set(stages.map((stage) => stage.id));
  const occupiedFlowIds = new Set(flows.map((flow) => flow.id));

  incoming.stages.forEach((source) => {
    const item = cloneStage(source);
    const idMatch = stages.find((stage) => stage.id === item.id);
    const conflicts = stages.filter((stage) =>
      stage.id === item.id || normalizeName(stage.name) === normalizeName(item.name),
    );
    const crossTypeIdMatch = flows.find((flow) => flow.id === item.id);
    if (crossTypeIdMatch) {
      // A stage cannot overwrite a flow with the same ID; preserve both with a new stage ID.
      const newId = uniqueId(item.id + '-import', [...occupiedStageIds, ...occupiedFlowIds]);
      stages.push({ ...item, id: newId, name: uniqueName(item.name, stages), builtin: false });
      occupiedStageIds.add(newId);
      stageIdMap.set(item.id, newId);
      return;
    }

    if (resolution === 'overwrite') {
      if (item.builtin && idMatch?.builtin) {
        stageIdMap.set(item.id, idMatch.id);
        return;
      }
      if (idMatch) {
        if (idMatch.builtin || item.builtin) {
          stageIdMap.set(item.id, idMatch.id);
          return;
        }
        const index = stages.findIndex((stage) => stage.id === idMatch.id);
        stages[index] = { ...item, builtin: false };
        stageIdMap.set(item.id, item.id);
        return;
      }
      if (conflicts.length > 0) {
        const sameNameCustom = conflicts.find((candidate) =>
          !candidate.builtin && normalizeName(candidate.name) === normalizeName(item.name),
        );
        if (sameNameCustom) {
          if (!item.builtin) {
            const index = stages.findIndex((stage) => stage.id === sameNameCustom.id);
            stages[index] = { ...item, id: sameNameCustom.id, builtin: false };
          }
          // Prefer the custom name match, but never overwrite a local custom stage with an imported built-in.
          stageIdMap.set(item.id, sameNameCustom.id);
          return;
        }

        const sameNameBuiltin = conflicts.find((candidate) =>
          candidate.builtin && normalizeName(candidate.name) === normalizeName(item.name),
        );
        if (sameNameBuiltin) {
          // A different-ID built-in is code-owned. Keep the imported definition as an editable copy
          // instead of silently redirecting its flow reference to the local built-in.
          const newId = uniqueId(item.id + '-import', [...occupiedStageIds, ...occupiedFlowIds]);
          const newName = uniqueName(item.name, stages);
          stages.push({ ...item, id: newId, name: newName, builtin: false });
          occupiedStageIds.add(newId);
          stageIdMap.set(item.id, newId);
          return;
        }

        stageIdMap.set(item.id, conflicts[0].id);
        return;
      }
      stages.push({ ...item, builtin: false });
      occupiedStageIds.add(item.id);
      stageIdMap.set(item.id, item.id);
      return;
    }

    if (item.builtin && idMatch?.builtin) {
      // Built-ins are code-owned. An incoming built-in with the same ID is skipped, never applied over local code.
      stageIdMap.set(item.id, idMatch.id);
      return;
    }
    if (conflicts.length > 0) {
      const newId = uniqueId(item.id + '-import', [...occupiedStageIds, ...occupiedFlowIds]);
      const newName = uniqueName(item.name, stages);
      stages.push({ ...item, id: newId, name: newName, builtin: false });
      occupiedStageIds.add(newId);
      stageIdMap.set(item.id, newId);
      return;
    }
    stages.push({ ...item, builtin: false });
    occupiedStageIds.add(item.id);
    stageIdMap.set(item.id, item.id);
  });

  incoming.flows.forEach((source) => {
    const item: FlowDef = {
      ...source,
      stages: source.stages.map((ref) => ({
        ...cloneStageRef(ref),
        stageId: stageIdMap.get(ref.stageId) ?? ref.stageId,
      })),
    };
    const idMatch = flows.find((flow) => flow.id === item.id);
    const conflicts = flows.filter((flow) =>
      flow.id === item.id || normalizeName(flow.name) === normalizeName(item.name),
    );
    const crossTypeIdMatch = stages.find((stage) => stage.id === item.id);
    if (crossTypeIdMatch) {
      // A flow cannot overwrite a stage with the same ID; preserve both with a new flow ID.
      const newId = uniqueId(item.id + '-import', [...occupiedStageIds, ...occupiedFlowIds]);
      flows.push({ ...item, id: newId, name: uniqueName(item.name, flows), builtin: false });
      occupiedFlowIds.add(newId);
      return;
    }

    if (resolution === 'overwrite') {
      if (item.builtin && idMatch?.builtin) return;
      if (idMatch) {
        if (idMatch.builtin || item.builtin) return;
        const index = flows.findIndex((flow) => flow.id === idMatch.id);
        flows[index] = { ...item, builtin: false };
        return;
      }
      if (conflicts.length > 0) {
        const sameName = conflicts.find((candidate) => normalizeName(candidate.name) === normalizeName(item.name));
        const replaceByName = Boolean(sameName && !sameName.builtin && !item.builtin);
        if (replaceByName && sameName) {
          const index = flows.findIndex((flow) => flow.id === sameName.id);
          flows[index] = { ...item, id: sameName.id, builtin: false };
        }
        // Built-ins remain code-owned; a custom same-name conflict is replaced only after explicit overwrite.
        return;
      }
      flows.push({ ...item, builtin: false });
      occupiedFlowIds.add(item.id);
      return;
    }

    if (item.builtin && idMatch?.builtin) {
      // See the stage import policy above: colliding built-ins are skipped, not duplicated or overwritten.
      return;
    }
    if (conflicts.length > 0) {
      const newId = uniqueId(item.id + '-import', [...occupiedStageIds, ...occupiedFlowIds]);
      flows.push({ ...item, id: newId, name: uniqueName(item.name, flows), builtin: false });
      occupiedFlowIds.add(newId);
      return;
    }
    flows.push({ ...item, builtin: false });
    occupiedFlowIds.add(item.id);
  });

  return { schemaVersion: FLOWS_SCHEMA_VERSION, stages, flows };
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function uniqueName<T extends { name: string }>(name: string, existing: readonly T[]): string {
  let suffix = 2;
  let candidate = name + ' (' + suffix + ')';
  const names = new Set(existing.map((item) => normalizeName(item.name)));
  while (names.has(normalizeName(candidate))) {
    suffix += 1;
    candidate = name + ' (' + suffix + ')';
  }
  return candidate;
}

function uniqueId(base: string, existingIds: readonly string[]): string {
  const ids = new Set(existingIds);
  if (!ids.has(base)) return base;
  let suffix = 2;
  let candidate = base + '-' + suffix;
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = base + '-' + suffix;
  }
  return candidate;
}

function cloneStage(stage: StageDef): StageDef {
  return { ...stage, participants: stage.participants.map((participant) => ({ ...participant })) };
}

function cloneStageRef(ref: StageRef): StageRef {
  return {
    ...ref,
    ...(ref.overrides
      ? {
          overrides: {
            ...ref.overrides,
            ...(ref.overrides.participants
              ? { participants: ref.overrides.participants.map((participant) => ({ ...participant })) }
              : {}),
          },
        }
      : {}),
  };
}
