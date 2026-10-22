import type { ReactNode } from 'react';
import { cx } from './cx';
import { toV2StatusTone } from './tokens';
import { NOTICE_TITLE_TONE, NOTICE_TONE, type V2BadgeTone } from './variants';

export interface NoticeProps {
  tone?: V2BadgeTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /**
   * Live-region behaviour. `off` (default) for notices present on first render; `polite` for
   * messages that appear later; `assertive` only for failures that need immediate attention.
   */
  live?: 'off' | 'polite' | 'assertive';
  className?: string;
}

/** Inline status message (never a modal). The glyph repeats the tone's shape next to the text. */
export function Notice({ tone = 'neutral', title, children, actions, live = 'off', className }: NoticeProps) {
  const safeTone: V2BadgeTone = tone === 'neutral' ? 'neutral' : toV2StatusTone(tone);
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div role={role} className={cx('flex items-start gap-v2-sm rounded-v2-md px-v2-md py-2.5 text-v2-body', NOTICE_TONE[safeTone], className)}>
      {safeTone !== 'neutral' ? <span className="v2-glyph mt-px" data-tone={safeTone} aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1">
        {title ? <div className={cx('font-semibold', NOTICE_TITLE_TONE[safeTone])}>{title}</div> : null}
        {children ? <div className={title ? 'mt-0.5 text-v2-ink-2' : undefined}>{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-v2-sm">{actions}</div> : null}
    </div>
  );
}
