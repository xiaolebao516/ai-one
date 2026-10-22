import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import {
  BUTTON_BASE,
  BUTTON_PRESSED,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ICON_BUTTON_SIZE,
  type V2ButtonVariant,
  type V2ControlSize,
} from './variants';

interface SharedButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: V2ButtonVariant;
  size?: V2ControlSize;
  /** Busy: blocks clicks and announces aria-busy; the label stays visible. */
  loading?: boolean;
  /** Why the control is disabled. Shown as a tooltip and read with the button name. */
  disabledReason?: string;
}

export interface ButtonProps extends SharedButtonProps {
  icon?: ReactNode;
  children: ReactNode;
}

/** Text button. Disabled / loading buttons render natively disabled and never fire onClick. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, disabled, disabledReason, icon, className, children, onClick, type, title, ...rest },
  ref,
) {
  const inactive = Boolean(disabled) || loading;
  const reason = disabled && disabledReason ? disabledReason : undefined;
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? 'button'}
      disabled={inactive}
      aria-busy={loading || undefined}
      title={reason ?? title}
      onClick={inactive ? undefined : onClick}
      className={cx(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)}
    >
      {loading ? <span className="v2-spinner" aria-hidden="true" /> : icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
      <span>{children}</span>
      {reason ? <span className="sr-only"> ({reason})</span> : null}
    </button>
  );
});

export interface IconButtonProps extends SharedButtonProps {
  /** Required accessible name; also the tooltip. */
  label: string;
  icon: ReactNode;
  /** Toggle state; renders aria-pressed. */
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', loading = false, disabled, disabledReason, label, icon, pressed, className, onClick, type, ...rest },
  ref,
) {
  const inactive = Boolean(disabled) || loading;
  const reason = disabled && disabledReason ? disabledReason : undefined;
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? 'button'}
      disabled={inactive}
      aria-busy={loading || undefined}
      aria-label={reason ? `${label} (${reason})` : label}
      aria-pressed={pressed}
      title={reason ?? label}
      onClick={inactive ? undefined : onClick}
      className={cx(BUTTON_BASE, ICON_BUTTON_SIZE[size], pressed ? BUTTON_PRESSED : BUTTON_VARIANT[variant], 'px-0', className)}
    >
      {loading ? <span className="v2-spinner" aria-hidden="true" /> : <span aria-hidden="true" className="inline-flex">{icon}</span>}
    </button>
  );
});
