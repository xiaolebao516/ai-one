import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n/context';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import { WorkbenchRoot } from './workbench/WorkbenchRoot';
import './styles.css';

// One window: the multi-AI chat is the workbench's first tab, not a separate UI any more.

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider language="system">
      <AppErrorBoundary>
        <WorkbenchRoot />
      </AppErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);
