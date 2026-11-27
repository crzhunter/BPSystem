import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './responsive.css';
import './draft.css';
import './liquid.css';
createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const workers = navigator.serviceWorker;
  let controller = workers.controller;
  function onControllerChange() {
    const next = workers.controller;
    // 首次接管只记住控制器；已有控制器被替换时，刷新一次以加载新入口。
    if (controller && next && controller !== next) {
      workers.removeEventListener('controllerchange', onControllerChange);
      window.location.reload();
    }
    controller = next;
  }
  workers.addEventListener('controllerchange', onControllerChange);
  window.addEventListener('load', () => {
    workers.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error) => console.warn('离线入口注册或更新失败', error));
  });
}
