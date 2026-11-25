// 安装后的离线入口保留上次成功加载的界面。API 始终从服务端读取。
const prefix = 'bpsystem-shell-';
// 构建时注入当前版本的入口、带哈希的脚本和样式，覆盖首次安装后直接离线的情况。
const cacheName = prefix + '__BUILD_ID__';
const shell = /*__SHELL_FILES__*/ [];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(shell.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith(prefix) && k !== cacheName).map((k) => caches.delete(k)),
          ),
        ),
    ]),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const saved = await cache.match(event.request);
      if (saved && event.request.mode !== 'navigate') return saved;
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const page =
            event.request.mode === 'navigate' &&
            response.headers.get('Content-Type')?.includes('text/html');
          await cache.put(page ? '/' : event.request, response.clone());
        }
        return response;
      } catch {
        return (
          saved || (event.request.mode === 'navigate' && (await cache.match('/'))) || Response.error()
        );
      }
    })(),
  );
});
