// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StageDef } from '../stages/flowModel';
import { FLOW_STAGE_DRAG_MIME, FlowStageCard } from '../stages/flows/FlowStageCard';
import { flowsText } from '../workbench/views/flowsText';

const SOURCE = 'flow-a:stage-a|stage-b|stage-c';

const stages: StageDef[] = ['stage-a', 'stage-b', 'stage-c'].map((id) => ({
  id,
  name: id,
  collaboration: 'solo',
  participants: [{ resource: 'codex', role: 'worker' }],
  endCondition: 'user-confirms',
  onFail: 'stop-and-ask',
  builtin: false,
}));

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const { root } of mounted.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function mount(onMove: (from: number, to: number) => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(
    <div>
      {stages.map((stage, index) => (
        <FlowStageCard
          key={stage.id}
          stage={stage}
          index={index}
          stageCount={stages.length}
          dragSource={SOURCE}
          locale="en"
          text={flowsText('en')}
          selected={false}
          invalid={false}
          readOnly={false}
          onSelect={() => {}}
          onMove={onMove}
        />
      ))}
    </div>,
  ));
  return container;
}

function dataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const values = new Map(Object.entries(initial));
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() { return [...values.keys()]; },
    setData(type: string, value: string) { values.set(type, value); },
    getData(type: string) { return values.get(type) ?? ''; },
    clearData(type?: string) {
      if (type) values.delete(type);
      else values.clear();
    },
  } as unknown as DataTransfer;
}

async function dragEvent(target: Element, type: string, transfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  await act(async () => { target.dispatchEvent(event); });
}

describe('FlowStageCard drag source validation', () => {
  it('moves only a valid in-list payload and rejects empty, external, malformed and out-of-range payloads', async () => {
    const onMove = vi.fn();
    const container = await mount(onMove);
    const cards = [...container.querySelectorAll('[data-testid="flow-stage-card"]')];
    const handles = [...container.querySelectorAll('button[draggable="true"]')];
    const transfer = dataTransfer();

    await dragEvent(handles[0], 'dragstart', transfer);
    expect(transfer.getData(FLOW_STAGE_DRAG_MIME)).toBe(JSON.stringify({ source: SOURCE, index: 0 }));
    await dragEvent(cards[2], 'drop', transfer);
    expect(onMove).toHaveBeenCalledWith(0, 2);

    onMove.mockClear();
    const invalidTransfers = [
      dataTransfer(),
      dataTransfer({ 'text/plain': '0' }),
      dataTransfer({ [FLOW_STAGE_DRAG_MIME]: 'not-json' }),
      dataTransfer({ [FLOW_STAGE_DRAG_MIME]: JSON.stringify({ source: 'another-flow', index: 0 }) }),
      dataTransfer({ [FLOW_STAGE_DRAG_MIME]: JSON.stringify({ source: SOURCE, index: 3 }) }),
      dataTransfer({ [FLOW_STAGE_DRAG_MIME]: JSON.stringify({ source: SOURCE, index: -1 }) }),
      dataTransfer({ [FLOW_STAGE_DRAG_MIME]: JSON.stringify({ source: SOURCE, index: '0' }) }),
    ];
    for (const invalid of invalidTransfers) await dragEvent(cards[2], 'drop', invalid);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keeps Alt+Up and Alt+Down keyboard sorting independent of drag payloads', async () => {
    const onMove = vi.fn();
    const container = await mount(onMove);
    const handles = [...container.querySelectorAll('button[draggable="true"]')];
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true });
    await act(async () => { handles[2].dispatchEvent(up); });
    expect(onMove).toHaveBeenCalledWith(2, 1);

    onMove.mockClear();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true });
    await act(async () => { handles[0].dispatchEvent(down); });
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });
});
