import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { cx } from '../ui/v2';
import { filterCommands, type PaletteCommand } from './workbenchModel';

export interface CommandPaletteProps {
  title: string;
  placeholder: string;
  emptyText: string;
  commands: readonly PaletteCommand[];
  onRun: (command: PaletteCommand) => void;
  onClose: () => void;
  /** Where focus goes on close when the control that opened the palette no longer exists. */
  fallbackFocus?: RefObject<HTMLElement | null>;
}

/** Ctrl+K palette: type to filter, arrows to move, Enter to run, Esc to close. */
export function CommandPalette({ title, placeholder, emptyText, commands, onRun, onClose, fallbackFocus }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const matches = filterCommands(commands, query);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = fallbackFocus;
    inputRef.current?.focus();
    return () => {
      // A command may have navigated away from the control that opened the palette.
      if (previous && previous.isConnected && previous !== document.body) previous.focus();
      else fallback?.current?.focus();
    };
  }, [fallbackFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[current];
      if (command) onRun(command);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      // The input is the only focusable control: keep focus inside the modal dialog.
      event.preventDefault();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface shadow-v2-float"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="workbench-palette-list"
          aria-activedescendant={matches[current] ? `palette-${matches[current].id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-12 w-full border-b border-v2-line bg-transparent px-v2-md text-v2-lead text-v2-ink placeholder:text-v2-ink-3 focus:outline-none"
        />
        <ul id="workbench-palette-list" role="listbox" aria-label={title} className="max-h-[50vh] overflow-auto p-v2-xs">
          {matches.length === 0 ? <li className="px-v2-md py-v2-sm text-v2-meta text-v2-ink-3">{emptyText}</li> : null}
          {matches.map((command, index) => (
            <li
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={index === current}
              onMouseEnter={() => setActive(index)}
              onClick={() => onRun(command)}
              className={cx(
                'flex cursor-pointer items-center justify-between gap-v2-md rounded-v2-md px-v2-md py-v2-sm',
                index === current ? 'bg-v2-hover text-v2-ink' : 'text-v2-ink-2',
              )}
            >
              <span className="truncate">{command.label}</span>
              {command.hint ? <span className="shrink-0 text-v2-micro text-v2-ink-3">{command.hint}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
