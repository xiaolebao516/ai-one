import type { Locale } from '../../i18n/resolve';
import type { FlowDef, FlowsFile, StageDef } from '../flowModel';
import { isChineseFlowsLocale } from '../../workbench/views/flowsText';

export function uniqueFlowEditorId(prefix: string, existing: readonly string[]): string {
  const occupied = new Set(existing);
  let candidate = '';
  let counter = 0;
  do {
    counter += 1;
    candidate = prefix + '-' + Date.now().toString(36) + '-' + counter.toString(36);
  } while (occupied.has(candidate));
  return candidate;
}

export function createStageDefinition(locale: Locale, file: FlowsFile): StageDef {
  const zh = isChineseFlowsLocale(locale);
  return {
    id: uniqueFlowEditorId('stage', [...file.stages.map((stage) => stage.id), ...file.flows.map((flow) => flow.id)]),
    name: zh ? '新阶段' : 'New stage',
    collaboration: 'solo',
    participants: [{ resource: 'chatgpt', role: zh ? '执行者' : 'Executor', effort: 'default' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

export function createFlowDefinition(locale: Locale, file: FlowsFile): FlowDef {
  const zh = locale.toLowerCase().startsWith('zh');
  return {
    id: uniqueFlowEditorId('flow', [...file.flows.map((flow) => flow.id), ...file.stages.map((stage) => stage.id)]),
    name: zh ? '新流程' : 'New flow',
    stages: [],
    builtin: false,
  };
}

export function replaceFlowStage(file: FlowsFile, flowId: string, index: number, stageId: string): FlowsFile {
  return {
    ...file,
    flows: file.flows.map((flow) => flow.id !== flowId ? flow : {
      ...flow,
      stages: flow.stages.map((ref, refIndex) => refIndex === index ? { stageId } : ref),
    }),
  };
}
