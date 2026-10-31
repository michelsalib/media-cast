import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import iconPng from '../../../../build/icon.png';
import iconSvg from '../../../../build/icon.svg';
import RemoteApp from './RemoteApp';

// Added from here, not remote.html: the page lives under /r/<token>/, and in dev an
// href to build/ would not resolve through the Vite proxy. iOS ignores SVG icons and
// uses the PNG (tab and home screen).
for (const [rel, href] of [
  ['icon', iconSvg],
  ['apple-touch-icon', iconPng],
]) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RemoteApp />
  </React.StrictMode>
);
