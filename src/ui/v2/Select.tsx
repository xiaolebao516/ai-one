import type { ChangeEvent } from 'react';
import { cx } from './cx';
import { FIELD_CONTROL, type V2ControlSize } from './variants';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Element id; links the visible (or visually hidden) label. */
  id: string;
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  size?: V2ControlSize;
  className?: string;
}

/** Native <select> (robust keyboard, IME and screen-reader behaviour in WebView2) in v2 styling. */
export function Select({ id, label, hideLabel = false, options, value, onChange, disabled = false, size = 'md', className }: SelectProps) {
  return (
    <span className={cx('inline-flex items-center gap-v2-sm', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-v2-meta text-v2-ink-2'}>
        {label}
      </label>
      <span className="relative inline-flex">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            if (!disabled) onChange(event.target.value);
          }}
          className={cx(
            'appearance-none pl-2.5 pr-7',
            size === 'sm' ? 'h-v2-control-sm rounded-v2-sm text-v2-meta' : 'h-v2-control-md rounded-v2-md text-v2-body',
            FIELD_CONTROL,
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-v2-ink-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </span>
    </span>
  );
}
