import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

import log from 'electron-log/renderer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rendererLog = log.create({ logId: 'renderer' });
Object.assign(console, rendererLog.functions);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
