import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Providers } from './Providers';
import { App } from './App';
import './i18n';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
