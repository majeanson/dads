import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { listen, report } from './oops';
import './styles/tokens.css';

listen();

createRoot(document.getElementById('root')!, {
  // A render that threw: past every boundary (a blank app), or into one (a
  // sheet that says it could not load). Both still go to the console.
  onUncaughtError: (err, info) => {
    console.error(err);
    report('web.render', err, info.componentStack ?? undefined);
  },
  onCaughtError: (err, info) => {
    console.error(err);
    report('web.boundary', err, info.componentStack ?? undefined);
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
