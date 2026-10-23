import { useEffect } from 'react';
import type { DispatchSnapshot } from '../../dispatch/types';
import type { Locale } from '../../i18n/resolve';
import type { HudTask } from '../../ui/taskHudModel';
import { Icon, IconButton } from '../../ui/v2';
import { DiffTab } from './DiffTab';
import { DispatchTab } from './DispatchTab';
import { OriginalResponseTab } from './OriginalResponseTab';
import { TestsTab } from './TestsTab';

export type DrawerTabKey = 'dispatch' | 'response' | 'diff' | 'tests';

export interface TaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: DrawerTabKey;
  onTabChange: (tab: DrawerTabKey) => void;
  task: HudTask;
  locale: Locale;
  snapshot?: DispatchSnapshot;
}

export function TaskDrawer({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  task,
  locale,
  snapshot,
}: TaskDrawerProps) {
  const isZh = locale.startsWith('zh');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: Array<{ key: DrawerTabKey; label: string }> = [
    { key: 'dispatch', label: isZh ? '派工单' : 'Dispatch' },
    { key: 'response', label: isZh ? '原始回复' : 'Response' },
    { key: 'diff', label: 'Diff' },
    { key: 'tests', label: isZh ? '测试' : 'Tests' },
  ];

  return (
    <>
      {/* Backdrop for screens < 1320px */}
      <div
        data-testid="drawer-backdrop"
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] min-[1320px]:hidden"
        onClick={onClose}
      />

      <aside
        data-testid="task-inspector-drawer"
        aria-label={isZh ? '任务检查器抽屉' : 'Task inspector drawer'}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l border-v2-line bg-v2-panel shadow-2xl transition-transform duration-200 ease-out min-[1320px]:relative min-[1320px]:z-0 min-[1320px]:shadow-none"
      >
        <div className="flex items-center justify-between border-b border-v2-line px-v2-md py-v2-sm">
          <div className="flex items-center gap-v2-xs font-semibold text-v2-ink">
            <Icon name="search" size={16} />
            <span>{isZh ? '检查器' : 'Inspector'}</span>
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onClose}
            label={isZh ? '关闭抽屉' : 'Close drawer'}
            icon={<Icon name="close" size={16} />}
          />
        </div>

        {/* Tab switch header */}
        <nav
          aria-label={isZh ? '检查器标签' : 'Inspector tabs'}
          className="flex border-b border-v2-line bg-v2-sunken/40 px-v2-sm"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1 border-b-2 py-2 text-v2-meta font-medium transition-colors ${
                  active
                    ? 'border-v2-accent text-v2-ink'
                    : 'border-transparent text-v2-ink-3 hover:text-v2-ink'
                }`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab content area */}
        <div className="flex-1 overflow-y-auto p-v2-md">
          {activeTab === 'dispatch' && <DispatchTab task={task} locale={locale} snapshot={snapshot} />}
          {activeTab === 'response' && <OriginalResponseTab task={task} locale={locale} />}
          {activeTab === 'diff' && <DiffTab task={task} locale={locale} />}
          {activeTab === 'tests' && <TestsTab task={task} locale={locale} />}
        </div>
      </aside>
    </>
  );
}
