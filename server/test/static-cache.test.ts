import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb, root } from '../src/db/index.ts';

test('生产模式下入口和 SW 禁止 HTTP 缓存，只有带哈希的静态资源长期缓存', async (t) => {
  const dist = mkdtempSync(join(root, '.bp-static-'));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  mkdirSync(join(dist, 'assets'));
  const files = {
    'index.html': '<title>新入口</title>',
    'sw.js': '// worker',
    'assets/index-Ab9_dE-2.js': 'export default 1',
    'assets/settings.json': '{}',
    'manifest.webmanifest': '{"name":"BPSystem"}',
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dist, path), body);

  const db = openDb(':memory:');
  t.after(() => db.close());
  const server = createApp(db, 0, undefined, true, undefined, dist).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((done, reject) => server.close((e) => e ? reject(e) : done())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;

  const noStore = 'no-store, no-cache, must-revalidate';
  for (const [path, policy, body] of [
    ['/', noStore, files['index.html']],
    ['/index.html', noStore, files['index.html']],
    ['/draft/42', noStore, files['index.html']],
    ['/sw.js', noStore, files['sw.js']],
    ['/assets/index-Ab9_dE-2.js', 'public, max-age=31536000, immutable', files['assets/index-Ab9_dE-2.js']],
    ['/assets/settings.json', 'no-cache', files['assets/settings.json']],
    ['/manifest.webmanifest', 'no-cache', files['manifest.webmanifest']],
  ]) {
    const res: Response = await fetch(origin + path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('Cache-Control'), policy, path);
    assert.equal(await res.text(), body, path);
  }
});
