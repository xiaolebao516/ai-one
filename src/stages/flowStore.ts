import {
  FLOWS_SCHEMA_VERSION,
  builtinFlows,
  builtinStages,
  parseFlowsFile,
  validateFile,
  type FlowsFile,
  type ValidationIssue,
} from './flowModel';
import type { LocalStoreFs } from '../host/localStore';

export type FlowStoreStatus = 'fresh' | 'ok' | 'recovered';

export interface LoadFlowsResult {
  file: FlowsFile;
  status: FlowStoreStatus;
  backup?: string;
  reason?: 'corrupt-file' | 'not-json' | 'bad-shape' | 'unknown-schema-version' | 'invalid';
  issues?: ValidationIssue[];
}

export async function loadFlows(fs: LocalStoreFs): Promise<LoadFlowsResult> {
  const read = await fs.read('flows');
  if (read.status === 'missing') {
    const file = builtinFile();
    await fs.write('flows', JSON.stringify(file, null, 2));
    return { file, status: 'fresh' };
  }

  if (read.status === 'corrupt') {
    return {
      file: builtinFile(),
      status: 'recovered',
      ...(read.backup ? { backup: read.backup } : {}),
      reason: 'corrupt-file',
    };
  }

  if (read.text === null) {
    const backup = await fs.quarantine('flows');
    return { file: builtinFile(), status: 'recovered', ...(backup ? { backup } : {}), reason: 'bad-shape' };
  }

  const parsed = parseFlowsFile(read.text);
  if (!parsed.ok) {
    const backup = await fs.quarantine('flows');
    return {
      file: builtinFile(),
      status: 'recovered',
      ...(backup ? { backup } : {}),
      reason: parsed.reason,
      ...(parsed.issues.length > 0 ? { issues: parsed.issues } : {}),
    };
  }

  const merged = mergeBuiltins(parsed.file);
  if (JSON.stringify(merged) !== JSON.stringify(parsed.file)) {
    await fs.write('flows', JSON.stringify(merged, null, 2));
  }
  return { file: merged, status: 'ok' };
}

export async function saveFlows(fs: LocalStoreFs, file: FlowsFile): Promise<ValidationIssue[]> {
  const issues = validateFile(file);
  if (issues.length > 0) return issues;
  await fs.write('flows', JSON.stringify(file, null, 2));
  return [];
}

function builtinFile(): FlowsFile {
  return {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    stages: builtinStages(),
    flows: builtinFlows(),
  };
}

function mergeBuiltins(file: FlowsFile): FlowsFile {
  const codeStages = builtinStages();
  const codeFlows = builtinFlows();
  const stageIds = new Set(codeStages.map((stage) => stage.id));
  const flowIds = new Set(codeFlows.map((flow) => flow.id));

  // Stable built-in IDs are owned by code. Stored versions with those IDs are replaced, never merged.
  const customStages = file.stages
    .filter((stage) => !stageIds.has(stage.id))
    .map((stage) => ({ ...stage, builtin: false, participants: stage.participants.map((participant) => ({ ...participant })) }));
  const customFlows = file.flows
    .filter((flow) => !flowIds.has(flow.id))
    .map((flow) => ({
      ...flow,
      builtin: false,
      stages: flow.stages.map((ref) => ({
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
      })),
    }));

  return {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    stages: [...codeStages, ...customStages],
    flows: [...codeFlows, ...customFlows],
  };
}
