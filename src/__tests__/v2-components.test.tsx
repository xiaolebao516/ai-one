import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  LoadingState,
  Notice,
  SegmentedControl,
  Select,
  StatusIndicator,
  Tabs,
  V2Scope,
  V2_STATUS_TONES,
  nextRovingId,
  resolveV2Mode,
  v2CssVariables,
  type ButtonProps,
  type IconButtonProps,
  type V2StatusTone,
} from '../ui/v2';
import { readGalleryParams, tokenDifferences, writeGalleryParams } from '../ui/v2/gallery/galleryParams';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function findAll(node: ReactNode, match: (element: ReactElement<AnyProps>) => boolean): ReactElement<AnyProps>[] {
  const found: ReactElement<AnyProps>[] = [];
  const visit = (current: ReactNode) => {
    if (!isValidElement<AnyProps>(current)) return;
    if (match(current)) found.push(current);
    Children.forEach(current.props.children, visit);
  };
  visit(node);
  return found;
}

const renderButton = (props: ButtonProps) =>
  (Button as unknown as { render: (p: ButtonProps, ref: null) => ReactElement<AnyProps> }).render(props, null);
const renderIconButton = (props: IconButtonProps) =>
  (IconButton as unknown as { render: (p: IconButtonProps, ref: null) => ReactElement<AnyProps> }).render(props, null);

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn(), currentTarget: { ownerDocument: { getElementById: vi.fn(() => null) } } };
}

describe('Button / IconButton', () => {
  it('is a non-submitting button that fires onClick when enabled', () => {
    const onClick = vi.fn();
    const element = renderButton({ children: 'Open', onClick });
    expect(element.props.type).toBe('button');
    (element.props.onClick as () => void)();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('never wires onClick while disabled or loading, and says why it is disabled', () => {
    const onClick = vi.fn();
    const disabled = renderButton({ children: 'Merge PR', onClick, disabled: true, disabledReason: 'Only you can merge' });
    expect(disabled.props.disabled).toBe(true);
    expect(disabled.props.onClick).toBeUndefined();
    expect(disabled.props.title).toBe('Only you can merge');
    expect(renderToStaticMarkup(<Button disabled disabledReason="Only you can merge">Merge PR</Button>)).toContain('Only you can merge');

    const loading = renderButton({ children: 'Reading', onClick, loading: true });
    expect(loading.props.disabled).toBe(true);
    expect(loading.props['aria-busy']).toBe(true);
    expect(loading.props.onClick).toBeUndefined();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives icon buttons an accessible name and toggle state', () => {
    const element = renderIconButton({ label: 'Refresh', icon: <svg />, pressed: true });
    expect(element.props['aria-label']).toBe('Refresh');
    expect(element.props['aria-pressed']).toBe(true);
    const blocked = renderIconButton({ label: 'Close', icon: <svg />, disabled: true, disabledReason: 'Demo only', onClick: vi.fn() });
    expect(blocked.props['aria-label']).toBe('Close (Demo only)');
    expect(blocked.props.onClick).toBeUndefined();
  });
});

describe('status display', () => {
  it('always renders a text label next to the shape for every tone', () => {
    for (const tone of V2_STATUS_TONES) {
      const html = renderToStaticMarkup(<StatusIndicator tone={tone} label={`label-${tone}`} />);
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain(`label-${tone}`);
    }
    expect(renderToStaticMarkup(<StatusIndicator tone="done" label="Done" hideLabel />)).toContain('class="sr-only">Done');
  });

  it('degrades unrecognised tones to unknown instead of borrowing a colour', () => {
    const bogus = 'merged' as V2StatusTone;
    expect(renderToStaticMarkup(<StatusIndicator tone={bogus} label="?" />)).toContain('data-tone="unknown"');
    const badge = renderToStaticMarkup(<Badge tone={bogus}>?</Badge>);
    expect(badge).toContain('text-v2-unknown');
    expect(badge).not.toContain('undefined');
  });

  it('distinguishes "unknown" from a calm empty state', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing here" />)).toContain('data-tone="neutral"');
    const unknown = renderToStaticMarkup(<EmptyState tone="unknown" title="Could not read" />);
    expect(unknown).toContain('data-tone="unknown"');
    expect(unknown).toContain('border-dashed');
  });

  it('announces loading politely and only escalates notices on request', () => {
    const loading = renderToStaticMarkup(<LoadingState label="Loading" />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(renderToStaticMarkup(<Notice tone="you">Demo data</Notice>)).not.toContain('role=');
    expect(renderToStaticMarkup(<Notice tone="block" live="assertive">Failed</Notice>)).toContain('role="alert"');
  });
});

describe('keyboard models', () => {
  const items = [{ id: 'a' }, { id: 'b', disabled: true }, { id: 'c' }];

  it('moves with arrows, wraps, skips disabled items and supports Home / End', () => {
    expect(nextRovingId(items, 'a', 'ArrowRight')).toBe('c');
    expect(nextRovingId(items, 'c', 'ArrowRight')).toBe('a');
    expect(nextRovingId(items, 'a', 'ArrowLeft')).toBe('c');
    expect(nextRovingId(items, 'c', 'Home')).toBe('a');
    expect(nextRovingId(items, 'a', 'End')).toBe('c');
    expect(nextRovingId(items, 'a', 'Enter')).toBeUndefined();
    expect(nextRovingId([{ id: 'only' }], 'only', 'ArrowRight')).toBeUndefined();
  });

  it('wires tabs with roving tabindex, ARIA links and arrow-key selection', () => {
    const onChange = vi.fn();
    const tree = Tabs({
      label: 'Views',
      idBase: 't',
      value: 'a',
      onChange,
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', disabled: true },
        { id: 'c', label: 'C', count: 2 },
      ],
    });
    expect(tree.props.role).toBe('tablist');
    const tabs = findAll(tree, (element) => element.props.role === 'tab');
    expect(tabs.map((tab) => [tab.props['aria-selected'], tab.props.tabIndex])).toEqual([
      [true, 0],
      [false, -1],
      [false, -1],
    ]);
    expect(tabs[0].props['aria-controls']).toBe('t-panel-a');
    expect(tabs[1].props.onClick).toBeUndefined();

    const event = keyEvent('ArrowRight');
    (tabs[0].props.onKeyDown as (e: unknown) => void)(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(event.currentTarget.ownerDocument.getElementById).toHaveBeenCalledWith('t-tab-c');

    (tabs[2].props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('exposes the segmented filter as a radio group with one tab stop', () => {
    const onChange = vi.fn();
    const tree = SegmentedControl({
      label: 'Status',
      idBase: 's',
      value: 'all',
      onChange,
      options: [
        { value: 'all', label: 'All' },
        { value: 'run', label: 'Running', count: 3 },
        { value: 'done', label: 'Done', disabled: true },
      ],
    });
    expect(tree.props.role).toBe('radiogroup');
    const radios = findAll(tree, (element) => element.props.role === 'radio');
    expect(radios.map((radio) => radio.props['aria-checked'])).toEqual([true, false, false]);
    expect(radios.filter((radio) => radio.props.tabIndex === 0)).toHaveLength(1);
    (radios[0].props.onKeyDown as (e: unknown) => void)(keyEvent('End'));
    expect(onChange).toHaveBeenLastCalledWith('run');
    expect(radios[2].props.onClick).toBeUndefined();
  });

  it('labels the select and ignores changes while disabled', () => {
    const onChange = vi.fn();
    const enabled = Select({ id: 'repo', label: 'Repository', value: 'a', onChange, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    const [label] = findAll(enabled, (element) => element.type === 'label');
    expect(label.props.htmlFor).toBe('repo');
    const [select] = findAll(enabled, (element) => element.type === 'select');
    (select.props.onChange as (e: unknown) => void)({ target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');

    const disabled = Select({ id: 'repo2', label: 'Repository', hideLabel: true, disabled: true, value: 'a', onChange, options: [{ value: 'a', label: 'A' }] });
    const [hiddenLabel] = findAll(disabled, (element) => element.type === 'label');
    expect(hiddenLabel.props.className).toBe('sr-only');
    const [disabledSelect] = findAll(disabled, (element) => element.type === 'select');
    (disabledSelect.props.onChange as (e: unknown) => void)({ target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('theme scope', () => {
  it('writes the skin tokens onto its own element and pins explicit modes', () => {
    const light = renderToStaticMarkup(<V2Scope mode="light">x</V2Scope>);
    expect(light).toContain('data-v2-skin="paper"');
    expect(light).toContain('data-v2-mode="light"');
    expect(light).toContain(`--v2-bg:${v2CssVariables('paper', 'light')['--v2-bg']}`);
    const dark = renderToStaticMarkup(
      <V2Scope skin="mist" mode="dark">
        x
      </V2Scope>,
    );
    expect(dark).toContain('data-v2-skin="mist"');
    expect(dark).toContain(`--v2-bg:${v2CssVariables('mist', 'dark')['--v2-bg']}`);
    expect(dark).toContain('color-scheme:dark');
  });

  it('follows the app theme class in auto mode', () => {
    expect(resolveV2Mode('auto', true)).toBe('dark');
    expect(resolveV2Mode('auto', false)).toBe('light');
    expect(resolveV2Mode('light', true)).toBe('light');
    // Server render has no document: auto falls back to light.
    expect(renderToStaticMarkup(<V2Scope>x</V2Scope>)).toContain('data-v2-mode="light"');
  });
});

const V2_DIR = fileURLToPath(new URL('../ui/v2/', import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('isolation and token discipline', () => {
  it('scopes every v2 stylesheet rule under .v2-scope so v1 / ai-sister styles are untouched', () => {
    const css = readFileSync(join(V2_DIR, 'v2.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutKeyframes = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '');
    const selectors = [...withoutKeyframes.matchAll(/([^{}@]+)\{/g)]
      .map((match) => match[1].trim())
      .filter((selector) => selector && !selector.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(10);
    for (const group of selectors) {
      for (const selector of group.split(',')) expect(selector.trim().startsWith('.v2-scope'), selector).toBe(true);
    }
  });

  it('keeps raw colours and v1 palette classes out of v2 components (only tokens.ts holds values)', () => {
    const sources = filesUnder(V2_DIR).filter((path) => /\.(tsx?|css)$/.test(path) && !/tokens\.ts$|contrast\.ts$/.test(path));
    expect(sources.length).toBeGreaterThan(10);
    for (const path of sources) {
      const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text, path).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      expect(text, path).not.toMatch(/\b(?:bg|text|border|ring)-(?:zinc|sky|amber|red|emerald|slate|gray|blue|green|yellow)-\d/);
    }
  });
});

describe('global stylesheet interplay', () => {
  it('keeps type classes off focusable controls that carry tabIndex (src/styles.css resets their font)', () => {
    const tabs = Tabs({ label: 'L', idBase: 'g', value: 'a', onChange: vi.fn(), items: [{ id: 'a', label: 'A', count: 1 }, { id: 'b', label: 'B' }] });
    const segments = SegmentedControl({ label: 'L', idBase: 'h', value: 'a', onChange: vi.fn(), options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 2 }] });
    const focusable = [...findAll(tabs, (element) => element.props.tabIndex !== undefined), ...findAll(segments, (element) => element.props.tabIndex !== undefined)];
    expect(focusable.length).toBe(4);
    for (const element of focusable) expect(String(element.props.className)).not.toMatch(/(?:^|\s)(?:text-v2-(?:title|heading|lead|body|meta|micro)|font-(?:semibold|bold|normal))(?:\s|$)/);
    expect(renderToStaticMarkup(tabs)).toContain('font-semibold');
  });
});

describe('gallery parameters', () => {
  it('round-trips the view options through the URL and rejects unknown skins', () => {
    const params = { skin: 'mist' as const, mode: 'dark' as const, compare: true };
    expect(readGalleryParams(writeGalleryParams(params))).toEqual(params);
    expect(readGalleryParams('?skin=neon')).toEqual({ skin: 'paper', mode: 'light', compare: false });
  });

  it('reports the schemes as a token diff', () => {
    const rows = tokenDifferences(v2CssVariables('paper', 'light'), v2CssVariables('mist', 'light'));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((row) => row.name.startsWith('--v2-'))).toBe(true);
  });
});
