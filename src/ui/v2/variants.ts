import type { V2StatusTone } from './tokens';

/**
 * Component variants (#41): the one place that decides how each variant is drawn, always in
 * semantic token classes. Tailwind needs literal class names, hence the explicit maps.
 * Pages pick a variant / tone by name; they never repeat these classes.
 */

export type V2ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'attention' | 'danger';
export type V2ControlSize = 'sm' | 'md';

export const BUTTON_BASE =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-[0.45] aria-busy:cursor-progress';

export const BUTTON_SIZE: Record<V2ControlSize, string> = {
  sm: 'h-v2-control-sm rounded-v2-sm px-2.5 text-v2-meta',
  md: 'h-v2-control-md rounded-v2-md px-3 text-v2-body',
};

export const ICON_BUTTON_SIZE: Record<V2ControlSize, string> = {
  sm: 'h-v2-control-sm w-v2-control-sm rounded-v2-sm',
  md: 'h-v2-control-md w-v2-control-md rounded-v2-md',
};

export const BUTTON_VARIANT: Record<V2ButtonVariant, string> = {
  primary: 'bg-v2-primary text-v2-on-primary enabled:hover:bg-v2-primary-hover',
  secondary: 'bg-v2-surface text-v2-ink ring-1 ring-inset ring-v2-line-strong enabled:hover:bg-v2-hover',
  ghost: 'bg-transparent text-v2-ink-2 enabled:hover:bg-v2-hover enabled:hover:text-v2-ink',
  // Amber is reserved for "needs you": use for the one action that answers a decision / acceptance.
  attention: 'bg-v2-you text-v2-on-primary enabled:hover:opacity-90',
  danger: 'bg-v2-surface text-v2-block ring-1 ring-inset ring-v2-block-line enabled:hover:bg-v2-block-soft',
};

export const BUTTON_PRESSED = 'bg-v2-sunken text-v2-ink ring-1 ring-inset ring-v2-line-strong';

export type V2BadgeTone = V2StatusTone | 'neutral';
export type V2BadgeVariant = 'soft' | 'outline';

export const BADGE_BASE = 'inline-flex max-w-full items-center gap-1 whitespace-nowrap font-semibold';

export const BADGE_SIZE: Record<V2ControlSize, string> = {
  sm: 'h-5 rounded-v2-sm px-1.5 text-v2-micro',
  md: 'h-[22px] rounded-v2-pill px-2.5 text-v2-meta',
};

export const BADGE_SOFT: Record<V2BadgeTone, string> = {
  neutral: 'bg-v2-sunken text-v2-ink-2',
  run: 'bg-v2-run-soft text-v2-run',
  rework: 'bg-v2-rework-soft text-v2-rework',
  you: 'bg-v2-you-soft text-v2-you',
  block: 'bg-v2-block-soft text-v2-block',
  done: 'bg-v2-done-soft text-v2-done',
  paused: 'bg-v2-paused-soft text-v2-paused',
  unknown: 'bg-v2-unknown-soft text-v2-unknown border border-dashed border-v2-unknown-line',
};

export const BADGE_OUTLINE: Record<V2BadgeTone, string> = {
  neutral: 'text-v2-ink-2 ring-1 ring-inset ring-v2-line-strong',
  run: 'text-v2-run ring-1 ring-inset ring-v2-run-line',
  rework: 'text-v2-rework ring-1 ring-inset ring-v2-rework-line',
  you: 'text-v2-you ring-1 ring-inset ring-v2-you-line',
  block: 'text-v2-block ring-1 ring-inset ring-v2-block-line',
  done: 'text-v2-done ring-1 ring-inset ring-v2-done-line',
  paused: 'text-v2-paused ring-1 ring-inset ring-v2-paused-line',
  unknown: 'text-v2-unknown border border-dashed border-v2-unknown-line',
};

export type V2CardVariant = 'raised' | 'flat' | 'sunken';
export type V2CardPadding = 'none' | 'sm' | 'md';

export const CARD_VARIANT: Record<V2CardVariant, string> = {
  raised: 'bg-v2-surface shadow-v2-card',
  flat: 'bg-v2-surface ring-1 ring-inset ring-v2-line',
  sunken: 'bg-v2-sunken',
};

export const CARD_PADDING: Record<V2CardPadding, string> = {
  none: '',
  sm: 'p-v2-md',
  md: 'p-v2-card',
};

/** Edge emphasis for cards that carry a status (e.g. a "needs you" card). */
export const CARD_ACCENT: Record<V2StatusTone, string> = {
  run: 'ring-1 ring-inset ring-v2-run-line',
  rework: 'ring-1 ring-inset ring-v2-rework-line',
  you: 'ring-1 ring-inset ring-v2-you-line',
  block: 'ring-1 ring-inset ring-v2-block-line',
  done: 'ring-1 ring-inset ring-v2-done-line',
  paused: 'ring-1 ring-inset ring-v2-paused-line',
  unknown: 'ring-1 ring-inset ring-v2-unknown-line',
};

export const NOTICE_TONE: Record<V2BadgeTone, string> = {
  neutral: 'bg-v2-sunken text-v2-ink',
  run: 'bg-v2-run-soft text-v2-ink ring-1 ring-inset ring-v2-run-line',
  rework: 'bg-v2-rework-soft text-v2-ink ring-1 ring-inset ring-v2-rework-line',
  you: 'bg-v2-you-soft text-v2-ink ring-1 ring-inset ring-v2-you-line',
  block: 'bg-v2-block-soft text-v2-ink ring-1 ring-inset ring-v2-block-line',
  done: 'bg-v2-done-soft text-v2-ink ring-1 ring-inset ring-v2-done-line',
  paused: 'bg-v2-paused-soft text-v2-ink ring-1 ring-inset ring-v2-paused-line',
  unknown: 'bg-v2-unknown-soft text-v2-ink ring-1 ring-inset ring-v2-unknown-line',
};

export const NOTICE_TITLE_TONE: Record<V2BadgeTone, string> = {
  neutral: 'text-v2-ink',
  run: 'text-v2-run',
  rework: 'text-v2-rework',
  you: 'text-v2-you',
  block: 'text-v2-block',
  done: 'text-v2-done',
  paused: 'text-v2-paused',
  unknown: 'text-v2-unknown',
};

export const FIELD_CONTROL =
  'bg-v2-surface text-v2-ink ring-1 ring-inset ring-v2-line-strong enabled:hover:ring-v2-ink-3 disabled:cursor-not-allowed disabled:opacity-[0.45]';
