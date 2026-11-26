import {createRoot} from 'react-dom/client';
import '@fontsource/acme/400.css';
import '@fontsource/alatsi/400.css';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
