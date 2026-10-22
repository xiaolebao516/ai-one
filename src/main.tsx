import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/context';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import { WorkbenchRoot } from './workbench/WorkbenchRoot';
import { loadUiRoot, switchUiRoot } from './workbench/workbenchStorage';
import './styles.css';

// The new workbench (Spec #79 v2) is the default UI; the classic multi-AI chat stays reachable.
const root = loadUiRoot();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider language="system">
      <AppErrorBoundary>{root === 'classic' ? <App onOpenWorkbench={() => switchUiRoot('workbench')} /> : <WorkbenchRoot />}</AppErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);
