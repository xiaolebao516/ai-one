import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionCheckpointNotice } from '../ui/SessionCheckpointNotice';
import { SettingsUpdateRow, type SettingsUpdateRowLabels, type UpdateCheckState } from '../ui/SettingsUpdateRow';
import { TaskHudEntry } from '../ui/TaskHudEntry';
import { Button, V2Scope, v2CssVariables } from '../ui/v2';
import type { StartupSessionCheckpointNotice } from '../ui/sessionCheckpointStartup';

const LABELS: SettingsUpdateRowLabels = {
  checkForUpdates: 'Check for updates',
  checking: 'Checking…',
  upToDate: 'Up to date ({version})',
  newVersionAvailable: 'New version {version} available',
  releasesUnavailable: 'Releases unavailable',
  updateCheckFailed: 'Update check failed:',
};

function row(state: UpdateCheckState, onCheck = vi.fn()) {
  return renderToStaticMarkup(<SettingsUpdateRow state={state} onCheck={onCheck} labels={LABELS} downloadLink={<a href="#release">Download page</a>} />);
}

type AnyProps = Record<string, unknown> & { children?: ReactNode };
function findButtons(node: ReactNode): ReactElement<AnyProps>[] {
  if (!isValidElement<AnyProps>(node)) return [];
  const own = node.type === Button ? [node] : [];
  return [...own, ...Children.toArray(node.props.children).flatMap(findButtons)];
}

describe('settings update row (migrated to v2)', () => {
  it('keeps the button label, disabled state and handler of each state', () => {
    const onCheck = vi.fn();
    const tree = SettingsUpdateRow({ state: { status: 'idle' }, onCheck, labels: LABELS });
    const [button] = findButtons(tree);
    expect(button.props.children).toBe('Check for updates');
    expect(button.props.loading).toBe(false);
    (button.props.onClick as () => void)();
    expect(onCheck).toHaveBeenCalledTimes(1);

    const checking = row({ status: 'checking' });
    expect(checking).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>.*Checking…/);
  });

  it('shows each result with the same wording and a semantic tone', () => {
    expect(row({ status: 'up-to-date', version: 'v1.9.7' })).toMatch(/text-v2-done[^>]*>.*Up to date \(v1\.9\.7\)/);
    const available = row({ status: 'available', tagName: 'v2.0.0', htmlUrl: 'https://example.invalid' });
    expect(available).toContain('New version v2.0.0 available');
    expect(available).toContain('Download page');
    expect(row({ status: 'unavailable' })).toMatch(/text-v2-you[^>]*>.*Releases unavailable/);
    const failed = row({ status: 'error', message: 'offline' });
    expect(failed).toContain('Update check failed:');
    expect(failed).toContain('offline');
    for (const state of [{ status: 'idle' }, { status: 'checking' }, { status: 'unavailable' }] as UpdateCheckState[]) {
      expect(row(state)).not.toMatch(/zinc-|sky-|amber-|red-\d/);
    }
  });
});

const NOTICE: StartupSessionCheckpointNotice = {
  checkpoint: { graphId: 'debate', graphVersion: 1, mode: 'debate', questionHash: 'h', stepIndex: 2, startedAt: 's', updatedAt: 'u' },
};

describe('one token source for HUD and migrated v1 areas', () => {
  it('re-skins the HUD entry and both migrated areas together from the enclosing scope', () => {
    for (const skin of ['paper', 'mist'] as const) {
      const html = renderToStaticMarkup(
        <V2Scope skin={skin} mode="light">
          <TaskHudEntry locale="en" onOpen={() => {}} />
          <SessionCheckpointNotice notice={NOTICE} onDismiss={() => {}} locale="en" />
          <SettingsUpdateRow state={{ status: 'idle' }} onCheck={() => {}} labels={LABELS} />
        </V2Scope>,
      );
      // Outer scope + 3 nested scopes, all on the same skin and the same --v2-primary value.
      expect(html.match(new RegExp(`data-v2-skin="${skin}"`, 'g'))).toHaveLength(4);
      const primary = v2CssVariables(skin, 'light')['--v2-primary'];
      expect(html.split(`--v2-primary:${primary}`).length - 1).toBe(4);
    }
  });
});
