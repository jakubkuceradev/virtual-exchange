import { HeadlessMantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design/fonts/fonts.css';
import './global.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <HeadlessMantineProvider>
      <App />
    </HeadlessMantineProvider>
  </StrictMode>,
);
