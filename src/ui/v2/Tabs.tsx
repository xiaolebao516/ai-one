import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';
import { focusElementById, nextRovingId, tabDomId, tabPanelDomId } from './roving';

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab / panel element ids; must be unique on the page. */
  idBase: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Controlled tab list: arrow keys / Home / End move selection and focus (automatic activation). */
export function Tabs({ label, idBase, items, value, onChange, className }: TabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextRovingId(items, value, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    focusElementById(event.currentTarget.ownerDocument, tabDomId(idBase, next));
  };

  return (
    <div role="tablist" aria-label={label} className={cx('flex items-end gap-v2-lg border-b border-v2-line', className)}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={tabDomId(idBase, item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelDomId(idBase, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={item.disabled ? undefined : () => onChange(item.id)}
            onKeyDown={handleKeyDown}
            className={cx(
              '-mb-px inline-flex h-v2-control-lg items-center gap-1.5 border-b-2 px-0.5 text-v2-body transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-[0.45]',
              selected ? 'border-v2-primary font-semibold text-v2-ink' : 'border-transparent text-v2-ink-2 enabled:hover:text-v2-ink',
            )}
          >
            <span>{item.label}</span>
            {item.count !== undefined ? <span className="text-v2-meta font-normal text-v2-ink-3">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  id: string;
  active: boolean;
  className?: string;
  children?: ReactNode;
}

export function TabPanel({ idBase, id, active, className, children }: TabPanelProps) {
  return (
    <div role="tabpanel" id={tabPanelDomId(idBase, id)} aria-labelledby={tabDomId(idBase, id)} hidden={!active} tabIndex={0} className={className}>
      {active ? children : null}
    </div>
  );
}
