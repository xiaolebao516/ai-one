import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { host } from '../host';
import { modeName } from '../i18n/modes';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import { SessionCheckpointNotice } from '../ui/SessionCheckpointNotice';
import { Button } from '../ui/v2';
import {
  clearStartupSessionCheckpointNotice,
  loadStartupSessionCheckpointNotice,
  type StartupSessionCheckpointNotice,
} from '../ui/sessionCheckpointStartup';

vi.mock('../host', () => ({
  host: {
    sessionCheckpoint: {
      load: vi.fn(),
      clear: vi.fn(),
    },
    snapshot: {
      list: vi.fn(),
    },
  },
}));

interface ElementProps {
  children?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(propsOf(node).children);
  return '';
}

function findAllElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAllElements(child, predicate));
  if (!isValidElement(node)) return [];

  const matches = predicate(node) ? [node] : [];
  // #42: the notice renders through v2 <Notice>, whose buttons sit in the `actions` slot.
  return [...matches, ...findAllElements(propsOf(node).children, predicate), ...findAllElements(propsOf(node).actions, predicate)];
}

// Native <button> before the #42 migration, shared v2 <Button> after it.
function isButton(element: ReactElement): boolean {
  return element.type === 'button' || element.type === Button;
}

function firstElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  const match = findAllElements(node, predicate)[0];
  if (!match) throw new Error('Expected element was not found');
  return match;
}

function notice(): StartupSessionCheckpointNotice {
  return {
    checkpoint: {
      graphId: 'debate',
      graphVersion: 1,
      mode: 'debate',
      questionHash: 'hash-only',
      stepIndex: 2,
      startedAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
    },
    replaySnapshot: {
      id: 'snapshot-debate',
      graphId: 'debate',
      createdAt: '2026-07-06T00:02:00.000Z',
    },
  };
}

describe('SessionCheckpointNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValue(null);
    vi.mocked(host.sessionCheckpoint.clear).mockResolvedValue(undefined);
    vi.mocked(host.snapshot.list).mockResolvedValue([]);
  });

  it('loads a startup checkpoint and same-graph replay snapshot', async () => {
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValueOnce(JSON.stringify(notice().checkpoint));
    vi.mocked(host.snapshot.list).mockResolvedValueOnce([
      { id: 'snapshot-free', graphId: 'free' },
      { id: 'snapshot-debate', graphId: 'debate' },
    ]);

    await expect(loadStartupSessionCheckpointNotice()).resolves.toMatchObject({
      checkpoint: { graphId: 'debate', questionHash: 'hash-only' },
      replaySnapshot: { id: 'snapshot-debate' },
    });
  });

  it.each(['en', 'zh-TW'] as const)('renders the %s startup notice and wires Dismiss and Replay actions', (locale: Locale) => {
    const onDismiss = vi.fn();
    const onReplay = vi.fn();
    const tree = SessionCheckpointNotice({ notice: notice(), onDismiss, onReplay, locale });
    const html = renderToStaticMarkup(tree);

    expect(html).toContain(formatI18n(t('sessionCheckpoint.interrupted', locale), { mode: modeName('debate', locale) }));
    expect(html).toContain(`${t('sessionCheckpoint.step', locale)} 2`);

    propsOf(firstElement(tree, (element) => isButton(element) && textOf(element).includes(t('sessionCheckpoint.dismiss', locale)))).onClick?.();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    propsOf(firstElement(tree, (element) => isButton(element) && textOf(element).includes(t('sessionCheckpoint.replay', locale)))).onClick?.();
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('keeps the replay action guarded while replaying and hidden without a snapshot (v2 migration)', () => {
    const replaying = renderToStaticMarkup(SessionCheckpointNotice({ notice: notice(), onDismiss: vi.fn(), onReplay: vi.fn(), replaying: true, locale: 'en' }));
    expect(replaying).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>.*?Replay/);
    expect(replaying).toContain('data-v2-migrated="session-checkpoint-notice"');
    expect(replaying).toContain('data-v2-skin=');

    const withoutSnapshot = { ...notice(), replaySnapshot: undefined };
    const tree = SessionCheckpointNotice({ notice: withoutSnapshot, onDismiss: vi.fn(), onReplay: vi.fn(), locale: 'en' });
    expect(findAllElements(tree, isButton).map(textOf)).toEqual([t('sessionCheckpoint.dismiss', 'en')]);
    // No v1 palette classes remain in the migrated markup.
    expect(renderToStaticMarkup(tree)).not.toMatch(/amber-|emerald-|zinc-/);
  });

  it('clears the checkpoint when the startup notice is dismissed', async () => {
    await clearStartupSessionCheckpointNotice();

    expect(host.sessionCheckpoint.clear).toHaveBeenCalledTimes(1);
  });
});
