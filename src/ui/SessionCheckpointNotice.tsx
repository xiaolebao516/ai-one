import { modeName } from '../i18n/modes';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import type { StartupSessionCheckpointNotice } from './sessionCheckpointStartup';
import { Button, Notice, V2Scope } from './v2';

// Migrated to the v2 foundation (#42): same text, conditions and handlers; colours, radius and
// button styles come from the shared tokens / variants and follow the active v2 skin and theme.
export function SessionCheckpointNotice({
  notice,
  replaying,
  onDismiss,
  onReplay,
  locale = 'en',
}: {
  notice: StartupSessionCheckpointNotice;
  replaying?: boolean;
  onDismiss: () => void;
  onReplay?: () => void;
  locale?: Locale;
}) {
  const displayMode = modeName(notice.checkpoint.mode, locale);
  return (
    <section className="mt-3" data-v2-migrated="session-checkpoint-notice">
      <V2Scope>
        <Notice
          tone="you"
          title={formatI18n(t('sessionCheckpoint.interrupted', locale), { mode: displayMode })}
          actions={
            <>
              {notice.replaySnapshot && onReplay ? (
                <Button size="sm" variant="attention" onClick={onReplay} loading={replaying}>
                  {t('sessionCheckpoint.replay', locale)}
                </Button>
              ) : null}
              <Button size="sm" onClick={onDismiss}>
                {t('sessionCheckpoint.dismiss', locale)}
              </Button>
            </>
          }
        >
          {t('sessionCheckpoint.step', locale)} {notice.checkpoint.stepIndex}
          {notice.checkpoint.pendingCheckpointNodeId ? ` · ${t('sessionCheckpoint.pending', locale)} ${notice.checkpoint.pendingCheckpointNodeId}` : ''}
        </Notice>
      </V2Scope>
    </section>
  );
}
