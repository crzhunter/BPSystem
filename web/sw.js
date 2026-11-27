// 保留旧版共用的前缀，激活时一并清理升级前的离线缓存。
const prefix = 'bpsystem-shell-';
// 构建时注入当前版本的入口、带哈希的脚本和样式，覆盖首次安装后直接离线的情况。
const cacheName = prefix + 'v10-__BUILD_ID__';
const shell = /*__SHELL_FILES__*/ [];
const immutableAssets = new Set(shell.filter((path) => path.startsWith('/assets/')));
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
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(prefix) && key !== cacheName).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/api' || url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js'
  )
    return;
  event.respondWith(
    (async () => {
      const request = event.request;
      const page = request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
      const immutable = !page && immutableAssets.has(url.pathname);
      if (immutable) {
        const saved = await caches.match(request, { cacheName });
        if (saved) return saved;
      }

      let response;
      try {
        response = immutable ? await fetch(request) : await fetch(request, { cache: 'no-store' });
      } catch {
        // 所有前端路由共用一个离线入口；在线的 HTTP 错误仍返回给页面。
        return (await caches.match(page ? '/' : request, { cacheName })) || Response.error();
      }
      if (response.status === 200 && (!page || response.headers.get('Content-Type')?.includes('text/html'))) {
        const copy = response.clone();
        // 写入失败也应交付刚取得的网络响应。
        event.waitUntil(caches.open(cacheName).then((cache) => cache.put(page ? '/' : request, copy))
          .catch((error) => console.warn('离线缓存写入失败', error)));
      }
      return response;
    })(),
  );
});
