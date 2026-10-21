import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { resolveV2Mode, useDocumentDarkClass } from './themeMode';
import { V2_DEFAULT_SKIN, v2CssVariables, type V2ModePreference, type V2SkinId } from './tokens';
import './v2.css';

export interface V2ScopeProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual scheme; every skin defines the same semantic tokens. */
  skin?: V2SkinId;
  /** `auto` follows the app theme (`html.dark`); `light` / `dark` pin the scope. */
  mode?: V2ModePreference;
  children?: ReactNode;
}

/**
 * Root of every v2 surface. Writes the skin's tokens as `--v2-*` custom properties on its own
 * element, so v2 styling exists only inside the scope and two scopes can show different skins
 * side by side. Nested scopes override their parent.
 */
export function V2Scope({ skin = V2_DEFAULT_SKIN, mode = 'auto', className, style, children, ...rest }: V2ScopeProps) {
  const documentDark = useDocumentDarkClass();
  const resolved = resolveV2Mode(mode, documentDark);
  const scopeStyle = { ...v2CssVariables(skin, resolved), colorScheme: resolved, ...style } as CSSProperties;
  return (
    <div
      {...rest}
      data-v2-skin={skin}
      data-v2-mode={resolved}
      className={cx('v2-scope font-v2 text-v2-body text-v2-ink', className)}
      style={scopeStyle}
    >
      {children}
    </div>
  );
}
