// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageSelection } from '../stages/flowEditor';
import { builtinFlows, builtinStages, type FlowDef, type FlowsFile, type StageDef } from '../stages/flowModel';
import { StageEditor } from '../stages/flows/StageEditor';
import { flowsText } from '../workbench/views/flowsText';

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount());
  document.body.innerHTML = '';
});

async function mountEditor(
  selection: StageSelection,
  stage: StageDef,
  selectedFlow: FlowDef | undefined,
  usageFlows: FlowDef[],
): Promise<{ container: HTMLElement; onRemoveFromFlow: ReturnType<typeof vi.fn> }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const file: FlowsFile = {
    schemaVersion: 1,
    stages: builtinStages(),
    flows: builtinFlows(),
  };
  const onRemoveFromFlow = vi.fn();

  await act(async () => root.render(
    <StageEditor
      file={file}
      locale="en"
      text={flowsText('en')}
      selection={selection}
      stage={stage}
      draft={stage}
      selectedFlow={selectedFlow}
      usageFlows={usageFlows}
      readOnly={false}
      scopePrompt={false}
      scopeCanFlow
      deleteConfirm={false}
      onChange={() => {}}
      onCopy={() => {}}
      onRemoveFromFlow={onRemoveFromFlow}
      onRequestDelete={() => {}}
      onConfirmDelete={() => {}}
      onCancelDelete={() => {}}
      onChooseScope={() => {}}
      onCancelScope={() => {}}
    />,
  ));

  return { container, onRemoveFromFlow };
}

function removeButton(container: ParentNode): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Remove from flow'));
}

describe('StageEditor built-in stage references', () => {
  it('allows removing a built-in stage from a custom flow while keeping its fields read-only', async () => {
    const fileStages = builtinStages();
    const stage = fileStages.find((item) =>
      builtinFlows().some((flow) => flow.stages.some((ref) => ref.stageId === item.id)),
    )!;
    const flow: FlowDef = {
      id: 'flow.custom',
      name: 'Custom flow',
      stages: [{ stageId: stage.id }],
      builtin: false,
    };
    const { container, onRemoveFromFlow } = await mountEditor(
      { kind: 'flow', flowId: flow.id, index: 0 },
      stage,
      flow,
      [flow],
    );

    const remove = removeButton(container);
    expect(remove).toBeDefined();
    expect(remove?.disabled).toBe(false);
    expect((container.querySelector('#flows-stage-name') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('#flows-resource-0') as HTMLInputElement).disabled).toBe(true);

    await act(async () => remove?.click());
    expect(onRemoveFromFlow).toHaveBeenCalledTimes(1);
  });

  it('does not offer removal for a built-in flow or the stage library', async () => {
    const fileStages = builtinStages();
    const stage = fileStages.find((item) =>
      builtinFlows().some((flow) => flow.stages.some((ref) => ref.stageId === item.id)),
    )!;
    const builtinFlow = builtinFlows().find((flow) => flow.stages.some((ref) => ref.stageId === stage.id))!;
    const builtinSelection: StageSelection = {
      kind: 'flow',
      flowId: builtinFlow.id,
      index: builtinFlow.stages.findIndex((ref) => ref.stageId === stage.id),
    };
    const builtinResult = await mountEditor(builtinSelection, stage, builtinFlow, [builtinFlow]);
    expect(removeButton(builtinResult.container)).toBeUndefined();
    expect((builtinResult.container.querySelector('#flows-stage-name') as HTMLInputElement).disabled).toBe(true);

    const libraryResult = await mountEditor({ kind: 'library', stageId: stage.id }, stage, undefined, [builtinFlow]);
    expect(removeButton(libraryResult.container)).toBeUndefined();
    expect((libraryResult.container.querySelector('#flows-stage-name') as HTMLInputElement).disabled).toBe(true);
  });
});
