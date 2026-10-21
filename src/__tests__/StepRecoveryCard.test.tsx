import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StepTimeoutDialog } from '../ui/StepTimeoutDialog';
import { t } from '../i18n/t';

describe('inline step recovery', () => {
  it('shows retry/cancel without a blocking dialog or Skip for deliberation', () => {
    const html = renderToStaticMarkup(<StepTimeoutDialog
      event={{ provider: 'gemini', remainingMs: 0, timedOut: true, failureKind: 'provider-error', skipAllowed: false, requestId: 3 }}
      locale="en"
      onClose={vi.fn()}
    />);
    expect(html).toContain('ai-sister-step-recovery');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain(t('stepTimeout.recoveryState', 'en'));
    expect(html).toContain(t('stepTimeout.retry', 'en'));
    expect(html).toContain(t('stepTimeout.cancel', 'en'));
    expect(html).not.toContain(t('stepTimeout.skip', 'en'));
    expect(html).toContain('GitHub');
  });

  it('retains Skip for other presets and translates the paused state', () => {
    for (const locale of ['en', 'zh-TW', 'ja', 'de'] as const) {
      const html = renderToStaticMarkup(<StepTimeoutDialog
        event={{ provider: 'chatgpt', remainingMs: 0, timedOut: true, failureKind: 'timeout', skipAllowed: true }}
        locale={locale}
        onClose={vi.fn()}
      />);
      expect(html).toContain(t('stepTimeout.recoveryState', locale));
      expect(html).toContain(t('stepTimeout.skip', locale));
      expect(html).toContain(t('stepTimeout.retry', locale));
    }
  });

  it('keeps the existing countdown before a step fails', () => {
    const html = renderToStaticMarkup(<StepTimeoutDialog
      event={{ provider: 'gemini', remainingMs: 15000, timedOut: false }}
      locale="en"
      onClose={vi.fn()}
    />);
    expect(html).toContain('Waiting on gemini');
    expect(html).not.toContain('ai-sister-step-recovery');
  });
});
