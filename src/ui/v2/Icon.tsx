import { cx } from './cx';
import { V2_ICON_PATHS, type V2IconName } from './iconPaths';

export interface IconProps {
  name: V2IconName;
  size?: 12 | 14 | 16 | 18;
  className?: string;
}

/** Decorative icon; always pair it with text or an accessible name on the control. */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('flex-none', className)}
    >
      {V2_ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
