import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LogWindow from './LogWindow.jsx';
import './styles.css';

// One bundle serves two window types. The main process picks which by
// appending `#logs=<appId>` when it opens a detached log window.
const target = window.kai.windowTarget();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {target.view === 'logs' ? <LogWindow appId={target.appId} /> : <App />}
  </React.StrictMode>
);
