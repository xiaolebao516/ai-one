import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';
import { focusElementById, nextRovingId, segmentDomId } from './roving';

export interface SegmentOption {
  value: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** Accessible name of the group. */
  label: string;
  /** Prefix for option element ids; must be unique on the page. */
  idBase: string;
  options: readonly SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Single-choice filter (radio group semantics): one tab stop, arrow keys move the selection. */
export function SegmentedControl({ label, idBase, options, value, onChange, className }: SegmentedControlProps) {
  const items = options.map((option) => ({ id: option.value, disabled: option.disabled }));
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextRovingId(items, value, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    focusElementById(event.currentTarget.ownerDocument, segmentDomId(idBase, next));
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex max-w-full flex-wrap gap-0.5 rounded-v2-md bg-v2-sunken p-0.5', className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            id={segmentDomId(idBase, option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            onClick={option.disabled ? undefined : () => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className={cx(
              'inline-flex h-v2-control-sm items-center gap-1.5 whitespace-nowrap rounded-v2-sm px-2.5 text-v2-meta transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-[0.45]',
              checked ? 'bg-v2-surface font-semibold text-v2-ink shadow-v2-card' : 'text-v2-ink-2 enabled:hover:text-v2-ink',
            )}
          >
            <span>{option.label}</span>
            {option.count !== undefined ? <span className="font-normal text-v2-ink-3">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
