import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './app/query-client.js';
import { router } from './app/router.js';
import { ToastProvider } from './components/ToastProvider.js';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root was not found');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
