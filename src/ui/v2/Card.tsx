import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import type { V2StatusTone } from './tokens';
import { CARD_ACCENT, CARD_PADDING, CARD_VARIANT, type V2CardPadding, type V2CardVariant } from './variants';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li';
  variant?: V2CardVariant;
  padding?: V2CardPadding;
  /** Status edge for cards that carry one, e.g. `you` for a "needs you" card. */
  accent?: V2StatusTone;
  children?: ReactNode;
}

/** Surface container. Static; put real buttons/links inside it rather than making the card clickable. */
export function Card({ as: Tag = 'div', variant = 'raised', padding = 'md', accent, className, children, ...rest }: CardProps) {
  return (
    <Tag {...rest} className={cx('rounded-v2-lg', CARD_VARIANT[variant], accent ? CARD_ACCENT[accent] : undefined, CARD_PADDING[padding], className)}>
      {children}
    </Tag>
  );
}
