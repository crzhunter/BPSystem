import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { migrate, openDb } from '../src/db/index.ts';
import { createApp } from '../src/app.ts';
import { deriveMeta, nicheSpecialistIds, statKeys, type Counts } from '../src/data/heroMeta.ts';
import { heroSnapshot } from '../src/data/snapshot.ts';
import { heroAliases } from '../src/data/heroAliases.ts';
import { listHeroes } from '../src/data/catalog.ts';
import { recommend } from '../src/services/bpEngine.ts';
import { normalizeDraft, type Draft } from '../src/services/draftState.ts';

function fixture(t: TestContext) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  return db;
}
async function http(t: TestContext) {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  });
  return async (path: string, method = 'GET', body?: unknown, status = 200) => {
    const res = await fetch('http://127.0.0.1:' + address.port + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    assert.equal(res.status, status, result.error);
    return result;
  };
}

test('按分段合并原始胜负，用十人登场数还原场数；职业选禁对强度、分级没有贡献', () => {
  const zero = Object.fromEntries(statKeys.map((k) => [k, 0])) as Counts;
  const row = {
    ...zero,
    id: 1,
    '5_pick': 60,
    '5_win': 20,
    '6_pick': 30,
    '6_win': 10,
    '7_pick': 10,
    '7_win': 6,
    '8_pick': 20,
    '8_win': 9,
  };
  const other = { ...zero, id: 2, '5_pick': 2940, '6_pick': 1970, '7_pick': 990, '8_pick': 1990 };
  for (const mode of ['immortal_pub', 'community_pub'] as const) {
    const calc = (rows: (typeof row)[]) => deriveMeta(rows, '7.42', 'today', mode);
    const ranked = calc([row, other]);
    const h = ranked.find((h) => h.id === 1)!;
    assert.deepEqual(
      [h.games, h.baseWinrate, h.pickRate],
      mode === 'immortal_pub' ? [30, 50, 10] : [100, 36, 16.7],
    );
    const inflated = calc([{ ...row, pro_pick: 50000, pro_ban: 900000, pro_win: 50000 }, other]);
    assert.deepEqual(
      inflated.map((h) => [h.id, h.tier, h.strength]),
      ranked.map((h) => [h.id, h.tier, h.strength]),
    );
  }
  const threshold = (picks: number) =>
    deriveMeta(
      [
        { ...zero, id: 74, '7_pick': picks },
        { ...zero, id: 2, '7_pick': 100000 - picks },
      ],
      '7.42',
      'today',
    ).find((h) => h.id === 74)!;
  assert.equal(threshold(249).pickRate, 2.5);
  assert.equal(threshold(249).needsSpecialist, true);
  assert.equal(threshold(250).needsSpecialist, false);
  assert.equal(deriveMeta([{ ...zero, id: 111 }], '7.42', 'today')[0].baseWinrate, null);
});

test('切换榜单立即影响英雄和推荐；单次请求可覆盖分段，备份可恢复偏好', async (t) => {
  const req = await http(t);
  assert.equal((await req('/settings')).metaBracket, 'immortal_pub');
  for (const metaBracket of ['community_pub', 'immortal_pub', 'community_pub'] as const) {
    assert.equal((await req('/settings', 'PUT', { metaBracket })).metaBracket, metaBracket);
    const r: ReturnType<typeof recommend> = await req('/bp/recommend', 'POST', {});
    assert.equal(r.metaBracket, metaBracket);
    const heroes: ReturnType<typeof listHeroes> = await req('/heroes');
    assert.ok(heroes.every((h) => h.meta.metaBracket === metaBracket));
    for (const h of [...r.pickRecommendations, ...r.banRecommendations]) {
      const m = heroes.find((x) => x.id === h.heroId)!.meta;
      assert.equal(h.metaSummary.games, m.games);
      assert.equal(h.metaSummary.winrate, m.baseWinrate);
      assert.match(h.metaSummary.text, metaBracket === 'immortal_pub' ? /冠绝胜率/ : /社区赛胜率/);
    }
  }
  assert.equal(
    (await req('/bp/recommend', 'POST', { metaBracket: 'immortal_pub' })).metaBracket,
    'immortal_pub',
  );
  const backup = await req('/backup/export');
  await req('/settings', 'PUT', { metaBracket: 'immortal_pub' });
  await req('/backup/import', 'POST', backup);
  assert.equal((await req('/settings')).metaBracket, 'community_pub');
  await req('/settings', 'PUT', { metaBracket: 'pro' }, 400);
  await req('/bp/recommend', 'POST', { metaBracket: 'pro' }, 400);
});

test('v5 原位追加天梯榜，保留旧同步记录、自定义别名、对局和修订号', (t) => {
  const db = fixture(t);
  const req = db.prepare('SELECT payload FROM hero_meta WHERE hero_id=1').get()!;
  const legacy = JSON.parse(String(req.payload));
  delete legacy.community_pub;
  for (const k of ['5_pick', '5_win', '6_pick', '6_win']) delete legacy.counts[k];
  legacy.strength = 99;
  db.prepare('UPDATE hero_meta SET payload=? WHERE hero_id=1').run(JSON.stringify(legacy));
  db.exec(`DELETE FROM schema_migrations WHERE version=6;
    UPDATE heroes SET aliases_json='["队内称呼"]' WHERE id=1;
    INSERT INTO draft_sessions(title,created_at,updated_at,revision) VALUES('决胜局','a','a',7);
    INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,hero_id,created_at)
      VALUES(1,1,1,'ban','radiant',1,1,'a')`);
  migrate(db);
  migrate(db);
  assert.deepEqual(
    JSON.parse(
      String(
        db
          .prepare(
            "SELECT json_remove(payload,'$.community_pub','$.immortal_pub') src FROM hero_meta WHERE hero_id=1",
          )
          .get()?.src,
      ),
    ),
    legacy,
  );
  for (const mode of ['immortal_pub', 'community_pub'] as const) {
    const h = listHeroes(db, mode)[0];
    assert.equal(h.meta.metaBracket, mode);
    assert.equal(h.meta.counts['6_win'], heroSnapshot[0]['6_win']);
    assert.ok(h.aliases.includes('队内称呼') && h.aliases.includes('am'));
  }
  assert.equal(db.prepare('SELECT revision FROM draft_sessions WHERE id=1').get()?.revision, 7);
  assert.equal(
    db.prepare('SELECT hero_id FROM draft_actions WHERE session_id=1').get()?.hero_id,
    1,
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

for (const heroId of [66, 91, 82, 58, 38]) {
  test('绝活只给能接这手的选手，敌我分开判断 · 英雄 ' + heroId, (t) => {
    const db = fixture(t),
      heroes = listHeroes(db);
    const hero = heroes.find((h) => h.id === heroId)!;
    const role = hero.typicalRoles[0] as 1 | 2 | 3 | 4 | 5;
    const slots = Array(5).fill(null);
    slots[role - 1] = 1;
    db.exec(
      "INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(123,'队长','a','a')",
    );
    const actions = [1, 2, 3, 4, 5, 6, 7, 17, 35].map((heroId) => ({ heroId }));
    const our = normalizeDraft(db, { radiantPlayerIds: slots, actions });
    const their = normalizeDraft(db, {
      direPlayerIds: slots,
      actions: actions.map((a) =>
        a.heroId === 35 ? { heroId: 17 } : a.heroId === 17 ? { heroId: 35 } : a,
      ),
    });
    const chips = (r: ReturnType<typeof recommend>) => [
      ...r.composition.our.weaknesses.flatMap((w) => w.fixHeroes),
      ...r.composition.enemy.exploitableWeaknesses.flatMap((w) => w.counterHeroes),
    ];
    const rec = (d: Draft) => recommend(db, d, undefined, role);
    const pool = db.prepare(
      "INSERT OR REPLACE INTO player_pub_heroes VALUES(1,?,300,250,100,0,0,0,0,'old',?,?)",
    );
    for (const [games, wins] of [
      [0, 0],
      [2, 2],
      [4, 1],
    ]) {
      pool.run(heroId, games, wins);
      assert.ok(!rec(our).pickRecommendations.some((h) => nicheSpecialistIds.has(h.heroId)));
      assert.ok(!rec(their).banRecommendations.some((h) => nicheSpecialistIds.has(h.heroId)));
      assert.ok(
        !chips(rec(our)).some((h) => heroes.find((x) => x.id === h.heroId)!.meta.needsSpecialist),
      );
    }
    pool.run(heroId, 3, 2);
    assert.ok(
      rec(our)
        .pickRecommendations.slice(0, 3)
        .some((h) => h.heroId === heroId && h.shortTags.includes('我方绝活')),
    );
    assert.ok(chips(rec(our)).some((h) => h.heroId === heroId));
    assert.ok(!rec(our).banRecommendations.some((h) => h.heroId === heroId));
    assert.ok(
      rec(their)
        .banRecommendations.slice(0, 3)
        .some((h) => h.heroId === heroId && h.shortTags.includes('敌方绝活预警')),
    );
    assert.ok(!chips(rec(their)).some((h) => h.heroId === heroId));
    const assigned = normalizeDraft(db, {
      ...our,
      actions: actions.map((a) =>
        a.heroId === 17 ? { ...a, roleHint: role, assignedPlayerId: 1 } : a,
      ),
    });
    assert.ok(!rec(assigned).pickRecommendations.some((h) => h.heroId === heroId));
    assert.ok(!chips(rec(assigned)).some((h) => h.heroId === heroId));
  });
}

test('两场本版赛事也可识别绝活；上一版赛事不能解锁', (t) => {
  const db = fixture(t);
  db.exec(`INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(111,'老陈','a','a');
    INSERT INTO matches(match_id,patch,radiant_win,imported_at) VALUES(10,'7.41',1,'a'),(11,'7.41',1,'a');
    INSERT INTO match_players(match_id,player_slot,account_id,hero_id,side,is_radiant)
    VALUES(10,0,111,66,'radiant',1),(11,0,111,66,'radiant',1)`);
  const d = normalizeDraft(db, { direPlayerIds: [null, null, null, null, 1] });
  const banned = () => recommend(db, d).banRecommendations.find((h) => h.heroId === 66);
  assert.equal(banned(), undefined);
  db.exec("UPDATE matches SET patch='7.42'");
  assert.equal(banned()?.shortTags[0], '敌方绝活预警');
  assert.equal(banned()?.playerFit?.tournamentRecord?.games, 2);
});

test('全英雄均有国服简称和英文词，重名简称保留两个命中', async (t) => {
  const req = await http(t);
  assert.equal(heroSnapshot.length, 127);
  for (const h of heroSnapshot) {
    const aliases = heroAliases.get(h.name)!.aliases;
    assert.ok(
      aliases.some((a) => /[\u3400-\u9fff]/.test(a)) && aliases.some((a) => /^[a-z]+$/.test(a)),
      h.name,
    );
  }
  const pairs = {
    小黑: 6,
    电棍: 15,
    屠夫: 14,
    小Y: 27,
    老奶奶: 128,
    松鼠: 123,
    百戏: 131,
    凯: 145,
    双头龙: 64,
    毒狗: 79,
    冰龙: 112,
    奶绿: 138,
  };
  for (const [term, id] of Object.entries(pairs))
    assert.ok(
      (await req('/heroes?q=' + encodeURIComponent(term))).some((h: { id: number }) => h.id === id),
    );
  const matches = ((await req('/heroes?q=ES')) as ReturnType<typeof listHeroes>).filter((h) =>
    h.aliases.includes('es'),
  );
  assert.deepEqual(
    matches.map((h) => h.id),
    [7, 107],
  );
});

test('按一基手号改禁选和分工，保留后续动作，冲突整笔回滚', async (t) => {
  const req = await http(t);
  const player = await req('/players', 'POST', { accountId: 123 }, 201);
  const actions = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((heroId) => ({ heroId }));
  const saved = await req('/bp/sessions', 'POST', { actions, radiantPlayerIds: [player.id] }, 201);
  const path = '/bp/sessions/' + saved.id;
  const edit = (i: number, body: object, status = 200) =>
    req(path + '/action/' + i, 'PUT', body, status);
  const first = await edit(1, { heroId: 66, revision: saved.revision });
  assert.deepEqual(first.actions.slice(1), saved.actions.slice(1));
  await edit(1, { heroId: 8 }, 400);
  await edit(1, { roleHint: 4 }, 400);
  await edit(10, { heroId: 18 }, 400);
  await edit(0, { heroId: 18 }, 400);
  await edit(1, { heroId: 18, revision: saved.revision }, 409);
  assert.deepEqual(await req(path), first);
  const picked = await edit(8, { roleHint: 1, assignedPlayerId: player.id });
  const changed = await edit(8, { heroId: 94 });
  assert.equal(changed.actions[7].assignedPlayerId, player.id);
  assert.equal(changed.actions[7].roleHint, 1);
  assert.deepEqual(changed.actions[8], picked.actions[8]);
  assert.deepEqual((await req(path)).actions, changed.actions);
});
