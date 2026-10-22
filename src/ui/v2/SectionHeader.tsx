import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SectionHeaderProps {
  title: ReactNode;
  /** Shown after the title; pass a number for item counts. */
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  id?: string;
  className?: string;
}

export function SectionHeader({ title, count, description, actions, level = 2, id, className }: SectionHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-v2-sm gap-y-1', className)}>
      <Heading id={id} className="m-0 text-v2-body font-semibold text-v2-ink">
        {title}
      </Heading>
      {count !== undefined ? <span className="text-v2-meta text-v2-ink-3">{count}</span> : null}
      <span className="flex-1" />
      {description ? <span className="text-v2-meta text-v2-ink-3">{description}</span> : null}
      {actions ? <div className="flex items-center gap-v2-sm">{actions}</div> : null}
    </div>
  );
}
