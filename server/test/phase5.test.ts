import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from '../src/db/schema.ts';
import { readSession } from '../src/services/draftState.ts';
import { openDb, migrate } from '../src/db/index.ts';
import { createApp } from '../src/app.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { heroSnapshot, snapshotPatch } from '../src/data/snapshot.ts';
import { itemsSnapshot } from '../src/data/itemsSnapshot.ts';
import { attributes, deriveMeta } from '../src/data/heroMeta.ts';
import { cmOrder } from '../src/data/cmOrder.ts';
import type { recommend } from '../src/services/bpEngine.ts';
import type { listHeroes } from '../src/data/catalog.ts';

async function service(t: TestContext, fetcher?: typeof fetch) {
  const db = openDb(':memory:');
  const client = new OpenDotaClient(db, {
    fetch:
      fetcher ??
      (async () => {
        throw Error('离线验收禁止访问上游');
      }),
  });
  const server = createApp(db, 0, client, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    db.close();
  });
  const request = (path: string, body?: unknown) =>
    fetch('http://127.0.0.1:' + addr.port + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const advice = async (body: unknown = {}) => {
    const response = await request('/bp/recommend', body);
    assert.equal(response.status, 200);
    return (await response.json()) as ReturnType<typeof recommend>;
  };
  return { db, request, advice };
}
test('离线首启返回完整四属性、真实肖像、原始样本、中文物品与新局默认版本', async (t) => {
  const { request } = await service(t);
  const heroes: ReturnType<typeof listHeroes> = await (await request('/heroes')).json();
  assert.equal(heroes.length, 127);
  assert.deepEqual(
    attributes.map((a) => heroes.filter((h) => h.primaryAttr === a).length),
    [36, 34, 34, 23],
  );
  for (const h of heroes) {
    const source = heroSnapshot.find((x) => x.id === h.id)!;
    assert.equal(h.primaryAttr, source.primary_attr);
    assert.equal(
      h.portraitUrl,
      'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/' +
        h.name.slice(14) +
        '.png',
    );
    assert.match(h.cnName, /[\u3400-\u9fff]/);
    assert.match(h.meta.tier, /^T[0-3]$/);
    assert.equal(h.meta.patch, '7.42');
    assert.ok(h.typicalRoles.length && h.tags.length);
    assert.equal(h.meta.counts.pro_ban, source.pro_ban);
    const wins = source['7_win'] + source['8_win'],
      games = source['7_pick'] + source['8_pick'];
    assert.equal(h.meta.highMmrWinrate, games ? Math.round((1000 * wins) / games) / 10 : null);
  }
  const items = (await (await request('/items')).json()) as (typeof itemsSnapshot)[number][];
  assert.equal(items.length, 567);
  assert.equal(new Set(items.map((i) => i.id)).size, 567);
  assert.ok(
    items.every(
      (i) =>
        /[\u3400-\u9fff]/.test(i.cnName) &&
        i.imgUrl.startsWith('https://cdn.cloudflare.steamstatic.com/'),
    ),
  );
  assert.equal(items.find((i) => i.id === 1)?.cnName, '闪烁匕首');
  assert.equal(items.find((i) => i.key === 'horn_of_battle_greater')?.cnName, '大战斗号角');
  assert.equal((await (await request('/bp/sessions', {})).json()).patch, snapshotPatch);
});
test('零选手获得双榜与双方六维诊断，禁用预览展示被拦截一方的收益', async (t) => {
  const { advice } = await service(t),
    base = await advice({ ourSide: 'dire', previewHeroId: 2 });
  assert.equal(base.weights.pick.player, 0);
  assert.equal(base.weights.ban.player, 0);
  assert.equal(base.preview?.side, 'dire');
  assert.equal(base.preview?.denied, true);
  assert.ok(base.preview!.delta.frontline > 0 && base.preview!.delta.disable > 0);
  for (const side of [base.composition.our, base.composition.enemy]) {
    assert.deepEqual(side.missingRoles, [1, 2, 3, 4, 5]);
    assert.deepEqual(Object.values(side.scores), [0, 0, 0, 0, 0, 0]);
    assert.ok(side.warnings.length);
  }
  for (const rows of [base.pickRecommendations, base.banRecommendations]) {
    assert.equal(rows.length, 10);
    assert.equal(new Set(rows.map((r) => r.heroId)).size, 10);
    for (const row of rows.slice(0, 3)) {
      assert.ok(row.score > 0 && row.score <= 100);
      assert.match(row.details.metaSummary.text, /高分局/);
      assert.ok(row.compositionFit.text && row.compositionFit.boostedDims.length);
      assert.ok(Array.isArray(row.details.matchupDetails));
      assert.ok(!Object.hasOwn(row.details, 'playerFit'));
    }
  }
  assert.ok(base.banRecommendations.every((r) => r.banCategory && r.whyBan?.includes('争夺率')));
  // 保持敌方英雄、手数及可选英雄一致，仅替换我方首选。
  const scenario = (first: number) => ({
    actions: [1, 3, 4, 5, 8, 9, 10, first, 13].map((heroId) => ({ heroId })),
  });
  const fragile = await advice(scenario(6)),
    durable = await advice(scenario(2));
  assert.equal(fragile.composition.our.scores.disable, 0);
  assert.equal(fragile.composition.our.scores.frontline, 0);
  const score = (r: typeof base) => r.pickRecommendations.find((h) => h.heroId === 38)?.score ?? 0;
  assert.ok(score(fragile) > score(durable));
  assert.ok(fragile.composition.our.warnings.some((x) => x.includes('先手')));
  assert.equal(fragile.composition.enemy.assignments[0].heroId, 13);
  assert.equal(fragile.composition.our.rangeBalance.rangedCount, 1);
  assert.equal(
    Object.values(fragile.composition.our.damageProfile).reduce((n, v) => n + v, 0),
    100,
  );
});
test('有实战记录的一方获得额外权重与选手卡片，另一方保持空阵容权重', async (t) => {
  const { db, advice } = await service(t);
  db.exec(
    "INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(888,'小林','a','a')",
  );
  const body = { radiantPlayerIds: [null, null, null, 1] };
  assert.equal((await advice(body)).weights.pick.player, 0);
  db.prepare("INSERT INTO player_pub_heroes VALUES(1,27,80,58,?,0,0,0,0,'a',80,58)").run(
    Math.floor(Date.now() / 1000),
  );
  const r = await advice(body),
    row = r.pickRecommendations.find((x) => x.heroId === 27);
  assert.ok(r.weights.pick.player > 0);
  assert.equal(r.weights.ban.player, 0);
  assert.ok(Math.abs(Object.values(r.weights.pick).reduce((n, v) => n + v, 0) - 1) < 1e-9);
  assert.equal(row?.playerFit?.playerName, '小林');
  assert.equal(row?.playerFit?.pubRecord?.games, 80);
  assert.ok(!row?.playerFit?.tournamentRecord);
});
test('常量、中文资料及分阵营样本完整后才发布快照，错误响应整批保留上次同步结果', async (t) => {
  let invalid = false;
  const urls: URL[] = [];
  const odHeroes = Object.fromEntries(heroSnapshot.map((h) => [h.id, h]));
  const vi = Object.values(itemsSnapshot).map((i) => ({
    id: i.id,
    name: 'item_' + i.key,
    name_loc: i.cnName,
    name_english_loc: i.localizedName,
  }));
  const { db, request } = await service(t, async (input) => {
    const u = new URL(String(input));
    urls.push(u);
    const bodies: Record<string, unknown> = {
      '/api/constants/patch': [{ id: 61, name: '7.42', date: '2026-11-18T21:28:07.019Z' },
        { id: 62, name: '7.43', date: '2026-11-24T00:00:00Z' }],
      '/api/constants/heroes': odHeroes,
      '/api/explorer': u.searchParams.get('sql')?.includes('AS against')
        ? { rows: [{ hero_id: 1, against: 2, games: 4, wins: 2 }] }
        : { rows: [{ hero_id: 1, radiant_pick: 4, radiant_win: 3, dire_pick: 2, dire_win: 0 }] },
      '/api/heroStats': heroSnapshot.map((h) => ({ ...h, pro_ban: 0 })),
      '/api/constants/items': Object.fromEntries(
        Object.values(itemsSnapshot).map((i) => [
          i.key,
          { id: i.id, dname: i.localizedName, img: i.imgUrl },
        ]),
      ),
      '/datafeed/herolist': {
        result: {
          data: {
            heroes: heroSnapshot.map((h) => ({
              id: h.id,
              name: h.name,
              name_loc: h.cn_name,
              primary_attr: attributes.indexOf(h.primary_attr),
            })),
          },
        },
      },
      '/datafeed/itemlist': { result: { data: { itemabilities: invalid ? [] : vi } } },
    };
    return Response.json(bodies[u.pathname]);
  });
  db.exec("INSERT INTO settings VALUES('opendota_api_key','test-key','now')");
  assert.equal((await request('/constants/sync', {})).status, 200);
  assert.equal(urls.length, 8);
  assert.ok(
    urls.filter((u) => u.hostname === 'www.dota2.com').every((u) => !u.searchParams.has('api_key')),
  );
  assert.equal((await (await request('/bp/sessions', {})).json()).patch, '7.43');
  const before = db.prepare('SELECT payload FROM hero_meta WHERE hero_id=1').get()?.payload;
  assert.equal(JSON.parse(String(before)).counts.pro_ban, 0);
  assert.equal(JSON.parse(String(before)).sideBias.radiantWinrate, 75);
  invalid = true;
  assert.equal((await request('/constants/sync', {})).status, 502);
  assert.equal(db.prepare('SELECT payload FROM hero_meta WHERE hero_id=1').get()?.payload, before);
});
test('7.42 实战顺序和历史存档各自推导禁用归属，缺少胜率样本时返回空值', () => {
  assert.deepEqual(
    cmOrder('dire')
      .slice(0, 7)
      .map((s) => s.isFirstPickTeam),
    [true, true, false, false, true, false, false],
  );
  assert.equal(cmOrder('dire', 'classic')[1].side, 'radiant');
  const counts = {
    id: 1,
    '7_win': 0,
    '7_pick': 0,
    '8_win': 0,
    '8_pick': 0,
    pro_pick: 0,
    pro_win: 0,
    pro_ban: 0,
  };
  assert.equal(deriveMeta([counts], '7.42', 'now')[0].baseWinrate, null);
});

test('比赛库按原始六个格子查询物品，保留空格和未收录装备', async (t) => {
  const { db, request } = await service(t);
  db.exec("INSERT INTO matches(match_id,imported_at) VALUES(876,'now')");
  const put = db.prepare(
    'INSERT INTO match_players(match_id,player_slot,hero_id,side,is_radiant,items_json) VALUES(876,?,1,?,?,?)',
  );
  for (let i = 0; i < 10; i++)
    put.run(
      i < 5 ? i : 128 + i - 5,
      i < 5 ? 'radiant' : 'dire',
      Number(i < 5),
      '[1,0,1951,0,99999,0]',
    );
  const r = await request('/matches/876');
  assert.equal(r.status, 200);
  const match = await r.json();
  assert.equal(match.players.length, 10);
  for (const p of match.players) {
    assert.deepEqual(
      p.items.map((i: { cnName: string } | null) => i?.cnName ?? null),
      ['闪烁匕首', null, '大战斗号角', null, '未收录物品', null],
    );
    assert.equal(p.items[0].imgUrl, itemsSnapshot[1].imgUrl);
  }
});
test('带进度的旧库升级后保留禁用阵营；新建对局使用实战顺序', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)',
    );
    for (let i = 0; i < 3; i++) {
      db.exec(migrations[i]);
      db.prepare("INSERT INTO schema_migrations VALUES(?,'old')").run(i + 1);
    }
    db.exec(
      "INSERT INTO heroes(id,name,localized_name,updated_at) VALUES(1,'a','a','old'),(2,'b','b','old'); INSERT INTO draft_sessions(created_at,updated_at) VALUES('old','old')",
    );
    const put = db.prepare(
      "INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,hero_id,created_at) VALUES(1,?,1,'ban',?,?,?,'old')",
    );
    put.run(1, 'radiant', 1, 1);
    put.run(2, 'dire', 0, 2);
    migrate(db);
    const old = readSession(db, 1);
    assert.equal(old.cmOrderVersion, 'classic');
    assert.equal(old.actions[1].side, 'dire');
    assert.equal(cmOrder('radiant')[1].side, 'radiant');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.close();
  }
});
