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
async function http(t: TestContext, db = openDb(':memory:')) {
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

const zero = Object.fromEntries(statKeys.map((key) => [key, 0])) as Counts;

function ladder(ranks: number[], overrides: Partial<Counts> = {}) {
  const hero = { ...zero, id: 1, ...overrides };
  const others = Array.from({ length: 10 }, (_, i) => ({ ...zero, id: 200 + i }));
  // 四档各自的登场率为 30%、20%、10%、20%，加先验后的胜率为 40%、50%、55%、45%。
  for (const [rank, total, picks, wins] of [
    [5, 25000, 750, 290], [6, 15000, 300, 150], [7, 10000, 100, 60], [8, 20000, 400, 175],
  ] as const) {
    if (!ranks.includes(rank)) continue;
    hero[`${rank}_pick`] = overrides[`${rank}_pick`] ?? picks;
    hero[`${rank}_win`] = overrides[`${rank}_win`] ?? wins;
    for (const other of others) {
      other[`${rank}_pick`] = (total - hero[`${rank}_pick`]) / others.length;
      other[`${rank}_win`] = Math.floor(other[`${rank}_pick`] / 2);
    }
  }
  return deriveMeta([hero, ...others], '7.42', 'today');
}

test('四档先各算登场率和平滑胜率，再按冠绝40、超凡28、万古20、传奇12合成', () => {
  const ranked = ladder([5, 6, 7, 8]);
  const hero = ranked.find((h) => h.id === 1)!;
  assert.deepEqual([hero.games, hero.pickRate, hero.baseWinrate, hero.strength], [1550, 18.4, 48.2, 55]);
  const inflated = ladder([5, 6, 7, 8], { pro_pick: 50000, pro_ban: 900000, pro_win: 50000 });
  assert.deepEqual(
    inflated.map((h) => [h.id, h.tier, h.strength]),
    ranked.map((h) => [h.id, h.tier, h.strength]),
  );
  assert.equal(inflated.find((h) => h.id === 1)!.counts.pro_ban, 900000);
});

test('传奇场次达超凡的 2.5 倍，冠绝空档时超凡仍占 68%；其他空档按有效权重折算', () => {
  const stats = (ranks: number[], overrides?: Partial<Counts>) => {
    const h = ladder(ranks, overrides).find((h) => h.id === 1)!;
    return [h.pickRate, h.baseWinrate, h.strength];
  };
  assert.deepEqual(stats([5, 6, 7]), [14.4, 52.2, 65.8]);
  assert.deepEqual(stats([5, 6, 8]).slice(0, 2), [21.2, 45.4]);
  assert.deepEqual(stats([5, 7]).slice(0, 2), [13, 52.8]);
  assert.deepEqual(stats([5, 6]).slice(0, 2), [23.8, 46.3]);
  assert.deepEqual(stats([7]).slice(0, 2), [10, 55]);
  assert.deepEqual(stats([]), [0, null, 0]);
  // 整档有比赛但该英雄无人选，仍保留该档份额：0% 登场，先验胜率 50%。
  assert.deepEqual(stats([5, 6, 7, 8], { '8_pick': 0, '8_win': 0 }).slice(0, 2), [10.4, 50.2]);
});

test('绝活门槛使用四档综合的未取整登场率，恰好 2.5% 可正常推荐', () => {
  const threshold = (picks: number) => deriveMeta([
    { ...zero, id: 74, '7_pick': 250, '5_pick': picks },
    { ...zero, id: 2, '7_pick': 99750, '5_pick': 100000 - picks },
  ], '7.42', 'today').find((h) => h.id === 74)!;
  assert.equal(threshold(249).pickRate, 2.5);
  assert.equal(threshold(249).needsSpecialist, true);
  assert.equal(threshold(250).needsSpecialist, false);
});

test('旧库偏好、英雄查询、推荐和设置兼容两个旧字段，始终得到同一综合榜', async (t) => {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO settings VALUES ('metaProfile','pro','old'),('metaBracket','community_pub','old')`);
  const req = await http(t, db);
  const heroes: ReturnType<typeof listHeroes> = await req('/heroes');
  const baseline: ReturnType<typeof recommend> = await req('/bp/recommend', 'POST', {});
  const settings = await req('/settings');
  const saved = await req('/bp/sessions', 'POST', {}, 201);
  for (const key of ['metaBracket', 'metaProfile']) {
    assert.ok(!Object.hasOwn(settings, key));
    for (const value of ['community_pub', 'immortal_pub', 'unknown']) {
      assert.deepEqual(await req('/heroes?' + key + '=' + value), heroes);
      assert.deepEqual(await req('/bp/recommend', 'POST', { [key]: value }), baseline);
      assert.deepEqual(await req('/settings', 'PUT', { [key]: value }), settings);
    }
    assert.deepEqual(await req('/bp/recommend', 'POST', { sessionId: saved.id, [key]: null }), baseline);
  }
  for (const h of [...baseline.pickRecommendations, ...baseline.banRecommendations]) {
    const m = heroes.find((x) => x.id === h.heroId)!.meta;
    assert.deepEqual([h.metaSummary.games, h.metaSummary.winrate, h.metaSummary.pickRate],
      [m.games, m.baseWinrate, m.pickRate]);
    assert.equal(h.metaSummary.text, `综合胜率 ${m.baseWinrate}% · 登场 ${m.pickRate}%`);
  }
  assert.equal((await req('/settings', 'PUT', { metaProfile: 'old', pubRecentDays: 42 })).pubRecentDays, 42);
});

test('旧备份的分段字段被忽略，有效设置照常恢复，其他无效设置仍整笔回滚', async (t) => {
  const req = await http(t);
  const baseline = await req('/bp/recommend', 'POST', {});
  await req('/settings', 'PUT', { pubRecentDays: 42 });
  const backup = await req('/backup/export');
  const count = backup.settings.length;
  for (const key of ['metaProfile', 'metaBracket']) {
    backup[key] = 'old';
    backup.settings.push({ key, value: 'obsolete', updated_at: 'old' });
  }
  await req('/settings', 'PUT', { pubRecentDays: 15 });
  assert.equal((await req('/backup/import', 'POST', backup)).counts.settings, count);
  assert.equal((await req('/settings')).pubRecentDays, 42);
  assert.equal((await req('/backup/export')).settings.length, count);
  assert.deepEqual(await req('/bp/recommend', 'POST', {}), baseline);
  backup.settings.push({ key: 'unrelated', value: 'oops', updated_at: 'old' });
  await req('/backup/import', 'POST', backup, 400);
  assert.equal((await req('/settings')).pubRecentDays, 42);
});

for (const version of [5, 6]) {
  test(`v${version} 升级保留旧快照、别名、存档和修订号，综合榜可离线使用`, (t) => {
    const db = fixture(t);
    const expected = listHeroes(db)[0].meta;
    // 模拟 v5 只有高分计数，v6 将完整四档追加在旧快照下。
    db.exec(`UPDATE hero_meta SET payload=json_extract(payload,'$.ladder');
      UPDATE hero_meta SET payload=json_set(payload,'$.sampledAt','2026-11-25T07:00:00.000Z',
        '$.strength',99${version === 6 ? ",'$.community_pub',json_set(payload,'$.counts.6_win',9)" : ''});
      UPDATE hero_meta SET payload=json_remove(payload,'$.counts.5_pick','$.counts.5_win','$.counts.6_pick','$.counts.6_win');
      DELETE FROM schema_migrations WHERE version>${version};
      UPDATE heroes SET aliases_json='["队内称呼"]' WHERE id=1;
      INSERT INTO draft_sessions(title,created_at,updated_at,revision) VALUES('决胜局','a','a',7);
      INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,hero_id,created_at)
        VALUES(1,1,1,'ban','radiant',1,1,'a')`);
    const before = db.prepare('SELECT payload FROM hero_meta WHERE hero_id=1').get()!.payload;
    migrate(db);
    migrate(db);
    const old = db.prepare("SELECT json_remove(payload,'$.ladder') payload FROM hero_meta WHERE hero_id=1").get();
    assert.equal(old?.payload, before);
    const h = listHeroes(db)[0];
    assert.equal(h.meta.sampledAt, expected.sampledAt);
    assert.equal(h.meta.counts['6_win'], version === 6 ? 9 : expected.counts['6_win']);
    assert.equal(h.meta.pickRate, expected.pickRate);
    if (version === 5) assert.deepEqual(h.meta, expected);
    else assert.ok(h.meta.baseWinrate! < expected.baseWinrate!);
    assert.ok(h.aliases.includes('队内称呼') && h.aliases.includes('am'));
    assert.equal(db.prepare('SELECT revision FROM draft_sessions WHERE id=1').get()?.revision, 7);
    assert.equal(db.prepare('SELECT hero_id FROM draft_actions WHERE session_id=1').get()?.hero_id, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}

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

test('名单外的美杜莎因综合登场不足 2.5% 受限，本版英雄池按阵营解锁选人与禁用', (t) => {
  const db = fixture(t);
  const medusa = listHeroes(db).find((h) => h.id === 94)!;
  assert.ok(!nicheSpecialistIds.has(medusa.id));
  assert.equal(medusa.meta.pickRate, 2.3);
  assert.ok(medusa.meta.needsSpecialist);
  db.exec("INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(123,'一号位','a','a')");
  const own = normalizeDraft(db, { radiantPlayerIds: [1] });
  const enemy = normalizeDraft(db, { direPlayerIds: [1] });
  const pick = () => recommend(db, own, undefined, 1).pickRecommendations.find((h) => h.heroId === 94);
  const ban = () => recommend(db, enemy, undefined, 1).banRecommendations.find((h) => h.heroId === 94);
  const pool = db.prepare("INSERT OR REPLACE INTO player_pub_heroes VALUES(1,94,300,250,100,0,0,0,0,'old',?,?)");
  pool.run(0, 0);
  assert.equal(pick(), undefined);
  assert.equal(ban(), undefined);
  pool.run(3, 2);
  assert.ok(pick()?.shortTags.includes('我方绝活'));
  assert.ok(ban()?.shortTags.includes('敌方绝活预警'));
});

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
