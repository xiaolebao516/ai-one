import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskHud } from '../ui/TaskHud';
import { TaskHudEntry, type TaskHudEntryProps } from '../ui/TaskHudEntry';
import type { HudState } from '../ui/taskHudModel';

function hud(initialState?: Partial<HudState>, locale: 'en' | 'zh-TW' = 'en') {
  return renderToStaticMarkup(<TaskHud locale={locale} onClose={() => {}} initialState={initialState} />);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
}

describe('Task HUD overview', () => {
  it('opens as a labelled modal view with a way back to the chat', () => {
    const html = hud();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="task-hud-title"');
    expect(visibleText(html)).toContain('Back to chat');
  });

  it('says plainly that it shows demo data and no live agent state', () => {
    const text = visibleText(hud());
    expect(text).toContain('Demo data · not connected to GitHub');
    expect(text).toContain('not from GitHub');
    expect(text).toContain('Agents, quota and live progress');
    expect(text).toContain('does not monitor');
  });

  it('leads with the one-line state, the counters and the "needs you" cards in priority order', () => {
    const text = visibleText(hud());
    expect(text).toContain('4 tasks moving, 3 waiting for you');
    const decide = text.indexOf('Hand off over-long sessions');
    const blocked = text.indexOf('Merge strategy for offline edit conflicts');
    const accept = text.indexOf('Always produce a final report');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(blocked);
    expect(blocked).toBeLessThan(accept);
  });

  it('renders no links and no actions that would pretend to change GitHub', () => {
    const html = hud();
    expect(html).not.toContain('href=');
    expect(visibleText(html)).not.toMatch(/Merge PR|Merged successfully|Resume dispatch/);
  });

  it('localises to Traditional Chinese', () => {
    const text = visibleText(hud(undefined, 'zh-TW'));
    expect(text).toContain('演示数据 · 尚未连接 GitHub');
    expect(text).toContain('4 个任务在推进，3 件事等你');
    expect(text).toContain('返回聊天');
  });

  it('shows an empty state for the empty demo scenario instead of a calm zero', () => {
    const text = visibleText(hud({ scenario: 'empty' }));
    expect(text).toContain('No tasks in this view');
    expect(text).toContain('not a GitHub result');
    expect(text).not.toContain('Needs you 3');
  });
});

describe('Task HUD list', () => {
  it('filters by status group with counts', () => {
    const html = hud({ view: 'list', status: 'needsYou' });
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Needs you/);
    const text = visibleText(html);
    expect(text).toContain('3 tasks');
    expect(text).toContain('Merge strategy for offline edit conflicts');
    expect(text).not.toContain('Split the config loader');
  });

  it('filters by repository', () => {
    const text = visibleText(hud({ view: 'list', repo: 'demo/home-lab' }));
    expect(text).toContain('3 tasks');
    expect(text).toContain('Make the backup script testable');
    expect(text).not.toContain('Export the sync log as CSV');
  });

  it('offers a way out when no task matches', () => {
    const text = visibleText(hud({ view: 'list', repo: 'demo/home-lab', status: 'needsYou' }));
    expect(text).toContain('No task matches these filters');
    expect(text).toContain('Clear filters');
  });
});

describe('Task HUD detail', () => {
  it('shows the full HEAD, CI bound to it, a stale review and evidence provenance', () => {
    const html = hud({ view: 'detail', selectedId: 'orbit-42' });
    const text = visibleText(html);
    expect(text).toContain('a1c93e1f0e2d4c6b8a0f2e4d6c8b0a2f4e6d8c92');
    expect(text).toContain('CI running');
    expect(text).toContain('on a1c93e1');
    expect(text).toContain('REVISE');
    expect(text).toContain('needs a new review');
    expect(text).toContain('Simulated read-back (example)');
    expect(text).toContain('Executor claim · not evidence');
    expect(text).toContain('Not verified');
    expect(html).toContain('<details');
    expect(text).toContain('Raw evidence');
    expect(text).toContain('Source: demo data (mock), not a GitHub read-back');
  });

  it('degrades missing HEAD and mismatched checks to unknown', () => {
    const missingHead = visibleText(hud({ view: 'detail', selectedId: 'home-8' }));
    expect(missingHead).toContain('HEAD not read');
    expect(missingHead).toContain('CI unknown');
    expect(missingHead).toContain('HEAD missing, so no check can be bound to it');
    expect(missingHead).toContain('Missing data');
    const mismatch = visibleText(hud({ view: 'detail', selectedId: 'home-7' }));
    expect(mismatch).toContain('CI unknown');
    expect(mismatch).toContain('the checks belong to an older HEAD');
    // The only "passed" left is the evidence line that says which HEAD it was for.
    expect(mismatch.match(/CI passed/g)).toEqual(['CI passed']);
    expect(mismatch).toContain('CI passed, but for the older d00d1e2');
  });

  it('explains "needs you" items without offering fake actions', () => {
    const text = visibleText(hud({ view: 'detail', backTo: 'list', selectedId: 'orbit-39' }));
    expect(text).toContain('Awaiting your acceptance');
    expect(text).toContain('Read-only');
    expect(text).toContain('Back to tasks');
    expect(text).toContain('PASS');
    expect(text).toContain('CI passed');
  });

  it('handles a task that is no longer in the data', () => {
    expect(visibleText(hud({ view: 'detail', selectedId: 'gone' }))).toContain('This task is not in the current data set.');
  });
});

describe('Task HUD entry', () => {
  const renderEntry = (props: TaskHudEntryProps) =>
    (TaskHudEntry as unknown as { render: (p: TaskHudEntryProps, ref: null) => ReactElement }).render(props, null);

  it('summarises the demo counts in its accessible name and opens the HUD', () => {
    const html = renderToStaticMarkup(<TaskHudEntry locale="en" onOpen={() => {}} />);
    expect(html).toContain('aria-label="Open the task HUD (demo data): 4 in progress, 3 need you, 4 failed or unknown"');
    expect(visibleText(html)).toContain('Demo');
    const onOpen = vi.fn();
    const scope = renderEntry({ locale: 'en', onOpen });
    const button = (scope.props as { children: ReactElement<{ onClick: () => void }> }).children;
    button.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('App integration stays minimal', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  it('keeps the chat mounted and guards native webviews while the HUD is open', () => {
    expect(app).toContain('const viewGuardOpen = overlayGuardOpen || taskHudOpen;');
    expect(app).toContain('useOverlayGuard(viewGuardOpen, loadedModalProviders);');
    expect(app).toContain('{...(taskHudOpen ? TASK_HUD_HIDDEN_CHAT : undefined)}');
    expect(app).toContain("{taskHudOpen ? <TaskHud locale={locale} onClose={() => setTaskHudOpen(false)} /> : null}");
  });
});
