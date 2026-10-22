import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../styles.css';
import { V2Gallery } from './V2Gallery';

// Dev-only entry for /v2-gallery.html (#41). Loads the app's global stylesheet on purpose, so the
// gallery shows v2 components in the same CSS context as the real app.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <V2Gallery />
  </React.StrictMode>,
);
