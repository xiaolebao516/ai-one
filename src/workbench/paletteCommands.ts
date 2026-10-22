import type { Locale } from '../i18n/resolve';
import { pickText, type HudTask } from '../ui/taskHudModel';
import { NAV_VIEWS, type NavView, type PaletteCommand } from './workbenchModel';
import type { WorkbenchText, WorkbenchTextKey } from './workbenchText';

export const NAV_KEY: Record<NavView, WorkbenchTextKey> = {
  home: 'navHome',
  tasks: 'navTasks',
  chat: 'navChat',
  flows: 'navFlows',
  resources: 'navResources',
};

export function paletteCommands(text: WorkbenchText, tasks: readonly HudTask[], locale: Locale): PaletteCommand[] {
  const views: PaletteCommand[] = NAV_VIEWS.map((view, index) => ({
    id: `go-${view}`,
    label: text.t('paletteGo', { name: text.t(NAV_KEY[view]) }),
    hint: `Ctrl ${index + 1}`,
    keywords: view,
    action: { kind: 'go', route: { view } },
  }));
  const taskCommands: PaletteCommand[] = tasks.map((task) => ({
    id: `task-${task.id}`,
    label: pickText(task.title, locale),
    hint: `${text.t('paletteTask')} · ${task.repo}${task.issue ? ` #${task.issue}` : ''}`,
    keywords: `${task.repo} ${task.issue ?? ''}`,
    action: { kind: 'go', route: { view: 'task', taskId: task.id } },
  }));
  return [
    ...views,
    { id: 'source-demo', label: text.t('paletteSourceDemo'), keywords: 'demo mock', action: { kind: 'source', source: 'demo' } },
    { id: 'source-github', label: text.t('paletteSourceGithub'), keywords: 'github', action: { kind: 'source', source: 'github' } },
    { id: 'refresh', label: text.t('paletteRefresh'), keywords: 'refresh reload', action: { kind: 'refresh' } },
    { id: 'theme', label: text.t('paletteTheme'), keywords: 'theme dark light', action: { kind: 'theme' } },
    { id: 'classic', label: text.t('paletteClassic'), keywords: 'classic chat legacy', action: { kind: 'classic' } },
    ...taskCommands,
  ];
}
