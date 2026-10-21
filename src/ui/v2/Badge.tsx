import type { ReactNode } from 'react';
import { cx } from './cx';
import { toV2StatusTone, type V2StatusTone } from './tokens';
import { BADGE_BASE, BADGE_OUTLINE, BADGE_SIZE, BADGE_SOFT, type V2BadgeTone, type V2BadgeVariant, type V2ControlSize } from './variants';

export interface BadgeProps {
  tone?: V2BadgeTone;
  variant?: V2BadgeVariant;
  size?: V2ControlSize;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** Short label: evidence kind, CI result, counts. Text is required, so tone is never the only signal. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'sm', icon, title, className, children }: BadgeProps) {
  const safeTone: V2BadgeTone = tone === 'neutral' ? 'neutral' : toV2StatusTone(tone);
  return (
    <span title={title} className={cx(BADGE_BASE, BADGE_SIZE[size], variant === 'outline' ? BADGE_OUTLINE[safeTone] : BADGE_SOFT[safeTone], className)}>
      {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface StatusIndicatorProps {
  /** Unrecognised values render as `unknown`. */
  tone: V2StatusTone;
  /** Always required. Use `hideLabel` to keep it for assistive tech only. */
  label: string;
  /** `pill` adds the tone's soft background. */
  variant?: 'inline' | 'pill';
  hideLabel?: boolean;
  className?: string;
}

/** Colour + shape + text. Shapes follow the design: pulse, ring, diamond, square, pause, check, dashed. */
export function StatusIndicator({ tone, label, variant = 'inline', hideLabel = false, className }: StatusIndicatorProps) {
  const safeTone = toV2StatusTone(tone);
  const pill = variant === 'pill';
  return (
    <span
      data-tone={safeTone}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap',
        pill ? cx(BADGE_SIZE.md, BADGE_SOFT[safeTone], 'pl-1.5 font-semibold') : 'text-v2-meta text-v2-ink-2',
        className,
      )}
    >
      <span className="v2-glyph" data-tone={safeTone} aria-hidden="true" />
      {hideLabel ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  );
}
