import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './responsive.css';
import './draft.css';
createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('离线入口注册失败', e));
  });
}
