import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb } from '../src/db/index.ts';
import { createApp } from '../src/app.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
async function fixture(t: TestContext) {
  const db = openDb(':memory:');
  const client = new OpenDotaClient(db, {
    fetch: async () =>
      Response.json([{ id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' }]),
  });
  const server = createApp(db, 3001, client, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    db.close();
  });
  return async (path: string, method = 'GET', body?: unknown, status = 200) => {
    const res = await fetch('http://127.0.0.1:' + addr.port + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = res.status === 204 ? undefined : await res.json();
    assert.equal(res.status, status, method + ' ' + path + ' ' + JSON.stringify(json));
    return json;
  };
}
test('健康状态、网络信息、设置脱敏与原子更新', async (t) => {
  const req = await fixture(t);
  const health = await req('/health');
  assert.equal(health.ok, true);
  assert.equal(health.db, 'ok');
  assert.ok(Date.parse(health.timestamp) && health.heroCount > 0);
  const net = await req('/system/network');
  assert.ok(net.hostname);
  assert.ok(Array.isArray(net.lanUrls));
  assert.equal((await req('/settings')).pubRecentDays, 30);
  const settings = await req('/settings', 'PUT', {
    opendotaApiKey: 'secret-1234',
    tournamentMatchWeight: 0,
    pubRecentDays: 14,
  });
  assert.equal(settings.hasOpenDotaApiKey, true);
  assert.match(settings.maskedPreview, /1234$/);
  assert.ok(!JSON.stringify(settings).includes('secret'));
  await req('/settings', 'PUT', { tournamentMatchWeight: 5, pubRecentDays: 0 }, 400);
  assert.equal((await req('/settings')).tournamentMatchWeight, 0);
  await req('/settings', 'PUT', { opendotaApiKey: '' });
  assert.ok(!JSON.stringify(await req('/settings')).includes('secret-1234'));
  await req('/missing', 'GET', undefined, 404);
});
test('按别名、中文与英文搜索，同步使用上游结果', async (t) => {
  const req = await fixture(t);
  for (const q of ['am', '敌法', 'ANTI-MAGE'])
    assert.ok((await req('/heroes?q=' + encodeURIComponent(q))).some((h: { id: number }) => h.id === 1));
  assert.equal((await req('/heroes/sync', 'POST')).synced, 1);
});
test('选手与战队完整 CRUD、五人导入、替补、失败回滚和删除级联', async (t) => {
  const req = await fixture(t);
  const ids: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const p = await req(
      '/players',
      'POST',
      {
        accountInput: String(76561197960265728n + BigInt(i)),
        nickname: '选手' + i,
        roles: [1, 5],
        notes: '原备注',
      },
      201,
    );
    ids.push(p.id);
    assert.equal(p.accountId, i);
  }
  await req('/players', 'POST', { accountId: 1, nickname: '同账号' }, 409);
  await req('/players', 'POST', { accountInput: 'abc', nickname: '无效' }, 400);
  const p = await req('/players/' + ids[0], 'PUT', { nickname: '队长', roles: [2], notes: '' });
  assert.deepEqual(p.roles, [2]);
  assert.equal(p.accountId, 1);
  assert.equal(p.notes, '');
  await req('/players/' + ids[1], 'PUT', { accountId: 1 }, 409);
  assert.equal((await req('/players')).length, 6);
  const team = await req(
    '/teams',
    'POST',
    { name: '训练队', tag: 'A', color: '#112233', notes: '预设' },
    201,
  );
  assert.equal(team.roster.length, 5);
  assert.ok(team.roster.every((m: { player: unknown }) => m.player === null));
  const path = '/teams/' + team.id;
  const members = ids.map((playerId, i) => ({ slot: i + 1, playerId }));
  const set = await req(path + '/roster', 'PUT', { members });
  assert.deepEqual(
    set.roster.map((m: { player: { id: number } }) => m.player.id),
    ids.slice(0, 5),
  );
  assert.equal(set.subs[0].slot, 6);
  await req(path + '/roster', 'PUT', { members: [members[0], { slot: 2, playerId: ids[0] }] }, 400);
  await req(path + '/roster', 'PUT', { members: [members[0], { slot: 1, playerId: ids[1] }] }, 400);
  await req(path, 'PUT', { name: '不应保存', members: [{ slot: 1, playerId: 99999 }] }, 400);
  let current = (await req('/teams'))[0];
  assert.equal(current.name, '训练队');
  assert.deepEqual(current.roster, set.roster);
  current = await req(path, 'PUT', { name: '战队新名' });
  assert.equal(current.tag, 'A');
  await req('/players/' + ids[0], 'DELETE', undefined, 204);
  current = (await req('/teams'))[0];
  assert.equal(current.roster[0].player, null);
  await req(path + '/roster', 'PUT', { members: [] });
  assert.equal((await req('/teams'))[0].subs.length, 0);
  await req(path, 'DELETE', undefined, 204);
  assert.deepEqual(await req('/teams'), []);
  assert.equal((await req('/players')).length, 5);
  await req(path, 'DELETE', undefined, 404);
});
