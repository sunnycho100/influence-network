import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Popup } from '../popup/Popup';
import '../popup/index.css';

document.documentElement.dataset.surface = 'side-panel';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Side panel root element was not found');
}

createRoot(container).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
