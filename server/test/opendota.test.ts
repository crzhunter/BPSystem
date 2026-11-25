import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
test('同步附加密钥，合并并发请求，复用 SQLite 缓存并在到期后重新请求', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  db.exec("INSERT INTO settings VALUES('opendota_api_key','local-private-key','now')");
  const urls: URL[] = [];
  const fake: typeof fetch = async (url) => {
    urls.push(new URL(String(url)));
    return Response.json([{ id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' }]);
  };
  const client = new OpenDotaClient(db, { fetch: fake });
  await Promise.all([client.syncHeroes(), client.syncHeroes()]);
  await new OpenDotaClient(db, { fetch: fake }).syncHeroes();
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/api/heroStats');
  assert.equal(urls[0].searchParams.get('api_key'), 'local-private-key');
  assert.equal(db.prepare('SELECT cache_key FROM api_cache').get()?.cache_key, '/heroStats');
  const h = db.prepare('SELECT * FROM heroes WHERE id=1').get()!;
  assert.equal(h.cn_name, '敌法师');
  assert.ok(JSON.parse(String(h.aliases_json)).includes('am'));
  db.exec("UPDATE api_cache SET expires_at='2000-01-01'");
  await client.syncHeroes();
  assert.equal(urls.length, 2);
});
test('环境密钥、匿名请求和 429/5xx 重试', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const old = process.env.OPENDOTA_API_KEY;
  t.after(() => {
    if (old === undefined) delete process.env.OPENDOTA_API_KEY;
    else process.env.OPENDOTA_API_KEY = old;
  });
  delete process.env.OPENDOTA_API_KEY;
  let calls = 0;
  const keys: (string | null)[] = [];
  const client = new OpenDotaClient(db, {
    retryMs: 0,
    fetch: async (url) => {
      keys.push(new URL(String(url)).searchParams.get('api_key'));
      calls++;
      return calls === 1
        ? new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
        : calls === 2
          ? new Response(null, { status: 503 })
          : Response.json([]);
    },
  });
  await client.get('/heroes');
  assert.deepEqual(keys, [null, null, null]);
  process.env.OPENDOTA_API_KEY = 'env-test';
  await client.get('/new');
  assert.equal(keys.at(-1), 'env-test');
});
test('滑动窗口限流并拦截无效英雄响应', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const times: number[] = [];
  const client = new OpenDotaClient(db, {
    freeLimit: 1,
    keyedLimit: 1,
    windowMs: 35,
    fetch: async () => {
      times.push(Date.now());
      return Response.json({ invalid: true });
    },
  });
  await Promise.all([client.get('/one'), client.get('/two')]);
  assert.ok(times[1] - times[0] >= 30);
  await assert.rejects(client.syncHeroes(), /格式异常/);
  assert.equal(db.prepare("SELECT 1 FROM api_cache WHERE cache_key='/heroStats'").get(), undefined);
});
