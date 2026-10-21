import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /**
   * `neutral`: genuinely nothing here. `unknown`: the data could not be read; the dashed outline
   * keeps "unknown" from looking like a calm empty list.
   */
  tone?: 'neutral' | 'unknown';
  className?: string;
}

export function EmptyState({ title, description, action, tone = 'neutral', className }: EmptyStateProps) {
  return (
    <div
      data-tone={tone}
      className={cx(
        'flex flex-col items-center gap-v2-sm rounded-v2-lg px-v2-xl py-v2-xl text-center',
        tone === 'unknown' ? 'border border-dashed border-v2-unknown-line' : 'bg-v2-sunken',
        className,
      )}
    >
      {tone === 'unknown' ? <span className="v2-glyph" data-tone="unknown" aria-hidden="true" /> : null}
      <div className="text-v2-body font-semibold text-v2-ink">{title}</div>
      {description ? <div className="max-w-md text-v2-meta text-v2-ink-2">{description}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-v2-sm">{action}</div> : null}
    </div>
  );
}

export interface LoadingStateProps {
  label: string;
  className?: string;
}

/** Announces politely; the spinner stops under prefers-reduced-motion. */
export function LoadingState({ label, className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cx('flex items-center gap-v2-sm text-v2-meta text-v2-ink-2', className)}>
      <span className="v2-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch', 'bg-v2-line', className)}
    />
  );
}
