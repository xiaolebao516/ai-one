import type { ReactNode } from 'react';
import { Badge, Button, V2Scope } from './v2';

export type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'available'; tagName: string; htmlUrl: string }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export interface SettingsUpdateRowLabels {
  checkForUpdates: string;
  checking: string;
  /** Contains `{version}`. */
  upToDate: string;
  /** Contains `{version}`. */
  newVersionAvailable: string;
  releasesUnavailable: string;
  updateCheckFailed: string;
}

/**
 * "Check for updates" row of the settings dialog, migrated to the v2 foundation (#42). The update
 * logic (request, abort, state transitions) stays in SettingsModal; this only renders its state
 * with shared components, under the same conditions and wording as before.
 */
export function SettingsUpdateRow({
  state,
  onCheck,
  labels,
  downloadLink,
}: {
  state: UpdateCheckState;
  onCheck: () => void;
  labels: SettingsUpdateRowLabels;
  /** Rendered after the "new version" label when a release is available. */
  downloadLink?: ReactNode;
}) {
  const checking = state.status === 'checking';
  return (
    <V2Scope className="flex flex-wrap items-center gap-3" data-v2-migrated="settings-update-row">
      <Button size="sm" onClick={onCheck} loading={checking}>
        {checking ? labels.checking : labels.checkForUpdates}
      </Button>
      {state.status === 'up-to-date' ? <Badge tone="done">{labels.upToDate.replace('{version}', state.version)}</Badge> : null}
      {state.status === 'available' ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-v2-meta">
          <Badge tone="run">{labels.newVersionAvailable.replace('{version}', state.tagName)}</Badge>
          {'->'} {downloadLink}
        </span>
      ) : null}
      {state.status === 'unavailable' ? <Badge tone="you">{labels.releasesUnavailable}</Badge> : null}
      {state.status === 'error' ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-v2-meta text-v2-ink-2">
          <Badge tone="block">{labels.updateCheckFailed}</Badge>
          <span>{state.message}</span>
        </span>
      ) : null}
    </V2Scope>
  );
}
