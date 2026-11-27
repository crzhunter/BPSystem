import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { openDb, migrate } from '../src/db/index.ts';
import { migrations } from '../src/db/schema.ts';
import { normalizeDraft } from '../src/services/draftState.ts';
import { recommend } from '../src/services/bpEngine.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { cmOrder } from '../src/data/cmOrder.ts';
import { initialRoom, setupKey } from '../../web/src/draftModel.ts';
import { extractMatchIds } from '../src/utils/matchIds.ts';

function match(id: number) {
  const second = id === 70000002;
  return {
    match_id: id,
    duration: 1800,
    start_time: id,
    radiant_win: true,
    version: 1,
    players: Array.from({ length: 10 }, (_, i) => ({
      account_id: 110 + i,
      personaname: '队员' + i,
      player_slot: i < 5 ? i : 123 + i,
      hero_id: i === 0 ? (second ? 6 : 1) : 10 + i,
      kills: 3,
      deaths: 1,
      assists: 7,
      denies: 8,
      hero_healing: 400,
      item_0: 1,
      item_neutral: 2,
      gold_per_min: 500,
      xp_per_min: 550,
      obs_log: [{ x: 110, y: 110, time: 60, ehandle: i + 10 }],
      obs_left_log: [
        { x: 110, y: 110, time: 95, ehandle: i + 10, attackername: 'npc_dota_hero_lion' },
      ],
      lane_pos: { 72: { 128: 5 } },
    })),
  };
}
async function fixture(t: TestContext) {
  const db = openDb(':memory:');
  const client = new OpenDotaClient(db, {
    fetch: async (url) =>
      Response.json(match(Number(new URL(String(url)).pathname.split('/').at(-1)))),
  });
  const server = createApp(db, 0, client, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });
  const origin = 'http://127.0.0.1:' + addr.port + '/api';
  async function req(path: string, method = 'GET', body?: unknown, status = 200) {
    const response = await fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.text();
    assert.equal(response.status, status, method + ' ' + path + ' ' + data.slice(0, 200));
    return data ? JSON.parse(data) : null;
  }
  return { db, req };
}
test('真实 v7 表升级两次，保留原行、新列默认值及复合主键覆盖', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)',
  );
  for (let i = 0; i < 7; i++) {
    db.exec(migrations[i]);
    db.prepare("INSERT INTO schema_migrations VALUES(?,'old')").run(i + 1);
  }
  db.exec("INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(55,'甲','a','a')");
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get()?.n, 8);
  assert.deepEqual(
    {
      ...db
        .prepare(
          'SELECT nickname,alias,rank_tier,leaderboard_rank,primary_role,style_tags_json FROM players',
        )
        .get(),
    },
    {
      nickname: '甲',
      alias: '',
      rank_tier: null,
      leaderboard_rank: null,
      primary_role: null,
      style_tags_json: '[]',
    },
  );
  assert.throws(() => db.exec('UPDATE players SET primary_role=6'), /CHECK/);
});
test('选手批量解析去重、档案保存、手动标签增改删及战队侦察', async (t) => {
  const { req } = await fixture(t);
  const text = [
    '110',
    '76561197960265838',
    'https://www.opendota.com/players/111',
    'https://www.dotabuff.com/players/112',
    'https://stratz.com/players/113',
  ].join('\n');
  assert.deepEqual(await req('/players/batch', 'POST', { text }, 201), {
    accountIds: [110, 111, 112, 113],
    created: 4,
    existing: 0,
  });
  assert.equal((await req('/players/batch', 'POST', { text }, 201)).created, 0);
  await req('/players/batch', 'POST', { text: '114\ninvalid' }, 400);
  assert.equal((await req('/players')).length, 4);
  const p = await req('/players/1', 'PUT', {
    alias: '队长',
    rankTier: 80,
    leaderboardRank: 120,
    primaryRole: 1,
    roles: [2],
    styleTags: ['控线'],
  });
  assert.deepEqual(
    [p.alias, p.rankTier, p.leaderboardRank, p.primaryRole, p.styleTags],
    ['队长', 80, 120, 1, ['控线']],
  );
  await req('/players/1', 'PUT', { rankTier: 76 }, 400);
  const team = await req(
    '/teams',
    'POST',
    {
      name: '青岩',
      members: [
        { playerId: 1, slot: 1 },
        { playerId: 2, slot: 2 },
      ],
    },
    201,
  );
  for (const [id, kind] of [
    [1, 'signature'],
    [2, 'comfort'],
  ])
    await req('/players/' + id + '/overrides/82', 'PUT', { kind });
  let report = await req('/teams/' + team.id + '/scouting');
  assert.equal(report.topBans[0].heroId, 82);
  assert.deepEqual(report.flexPicks[0].players, ['队长', '111']);
  assert.deepEqual(
    report.roles.map((r: { depth: number }) => r.depth),
    [1, 1, 0, 0, 0],
  );
  await req('/players/2/overrides/82', 'PUT', { kind: 'avoid', note: '暂时不练' });
  assert.deepEqual(await req('/players/2/overrides'), [
    { heroId: 82, kind: 'avoid', note: '暂时不练' },
  ]);
  report = await req('/teams/' + team.id + '/scouting');
  assert.equal(report.flexPicks.length, 0);
  await req('/players/1/overrides/82', 'DELETE', undefined, 204);
  assert.deepEqual(await req('/players/1/overrides'), []);
  await req('/players/2', 'DELETE', undefined, 204);
  assert.equal((await req('/backup/export')).player_hero_overrides.length, 0);
});
test('按尚未出英雄的首发独立切换权重，绝活解锁、避坑扣分、手动钉位排除敌方选手', async (t) => {
  const { db, req } = await fixture(t);
  await req('/players/batch', 'POST', { text: '110\n111' }, 201);
  const base = { radiantPlayerIds: [1], direPlayerIds: [2] };
  const advice = (input: Record<string, unknown> = base) =>
    recommend(db, normalizeDraft(db, input), undefined, 1);
  const free = advice();
  assert.deepEqual(free.mode, { pick: 'free', ban: 'free' });
  assert.equal(free.weights.pick.player, 0);
  assert.equal(free.weights.ban.player, 0);
  assert.ok(!free.pickRecommendations.some((h) => h.heroId === 82));
  await req('/players/1/overrides/82', 'PUT', { kind: 'signature' });
  assert.deepEqual(advice().mode, { pick: 'team', ban: 'free' });
  await req('/players/2/overrides/82', 'PUT', { kind: 'signature' });
  const team = advice();
  assert.equal(team.weights.pick.player, 0.6);
  assert.equal(team.weights.ban.player, 0.62);
  for (const weights of Object.values(team.weights))
    assert.equal(
      Object.values(weights).reduce((a, b) => a + b, 0),
      1,
    );
  for (const rows of [team.pickRecommendations, team.banRecommendations]) {
    const hero = rows.find((h) => h.heroId === 82)!;
    assert.equal(hero.playerFit?.role, 1);
    assert.ok(
      Math.abs(Object.values(hero.scoreBreakdown).reduce((a, b) => a + b, 0) - hero.score) < 0.11,
    );
  }
  const target = free.pickRecommendations[0].heroId;
  await req('/players/1/overrides/' + target, 'PUT', { kind: 'comfort' });
  const comfort = advice().pickRecommendations.find((h) => h.heroId === target)!.score;
  await req('/players/1/overrides/' + target, 'PUT', { kind: 'avoid' });
  assert.ok((advice().pickRecommendations.find((h) => h.heroId === target)?.score ?? 0) < comfort);
  const actions = cmOrder('radiant')
    .slice(0, 9)
    .map((_, i) => ({ heroId: [2, 3, 4, 5, 6, 7, 8, 9, 10][i], roleHint: i === 8 ? 1 : null }));
  const pinned = advice({ ...base, actions });
  assert.equal(pinned.weights.ban.player, 0);
  assert.equal(pinned.weights.pick.player, 0.6);
  assert.ok(pinned.banRecommendations.every((h) => !h.targetPlayers.some((p) => p.playerId === 2)));
});
test('24 手结束后仍可预选原位替换，并保留其余九个选人', async (t) => {
  const { db } = await fixture(t);
  const heroes = db
    .prepare('SELECT id FROM heroes ORDER BY id LIMIT 25')
    .all()
    .map((h) => Number(h.id));
  const order = cmOrder('radiant');
  const roles = { radiant: 0, dire: 0 };
  const actions = order.map((s, i) => ({
    heroId: heroes[i],
    roleHint: s.actionType === 'pick' ? ++roles[s.side] : null,
  }));
  const original = normalizeDraft(db, { actions });
  const slot = order.find((s) => s.side === 'dire' && s.actionType === 'pick')!;
  const substitute = heroes[24];
  const current = recommend(db, original);
  assert.equal(current.currentStep.isCompleted, true);
  assert.equal(recommend(db, original, substitute).preview, null);
  const preview = recommend(db, original, substitute, 'auto', slot.step).preview!;
  assert.equal(preview.side, 'dire');
  const changed = recommend(
    db,
    normalizeDraft(db, {
      actions: actions.map((a, i) => (i + 1 === slot.step ? { ...a, heroId: substitute } : a)),
    }),
  );
  for (const key of Object.keys(preview.delta) as (keyof typeof preview.delta)[])
    assert.equal(
      preview.delta[key],
      changed.composition.enemy.scores[key] - current.composition.enemy.scores[key],
    );
  assert.deepEqual(changed.composition.our.scores, current.composition.our.scores);
});
test('混合比赛链接、提取五人、双模式筛英雄、眼位移除与六区相对分布', async (t) => {
  const { req } = await fixture(t);
  assert.deepEqual(
    extractMatchIds(
      '决赛 20:30，https://stratz.com/matches/70000001/overview 和 70000002，重复 70000001',
    ),
    [70000001, 70000002],
  );
  await req('/players/batch', 'POST', { text: '110' }, 201);
  const imported = await req('/matches/import', 'POST', { matchIds: [70000001, 70000002] });
  assert.ok(imported.results.every((r: { imported: boolean }) => r.imported));
  const team = await req('/matches/70000001/extract-team', 'POST', { side: 'radiant' }, 201);
  const roster = (await req('/teams'))[0].roster;
  assert.equal(team.members, 5);
  assert.equal(new Set(roster.map((m: { player: { id: number } }) => m.player.id)).size, 5);
  assert.equal((await req('/players')).length, 5);
  const scout = await req('/teams/' + team.id + '/scouting');
  assert.equal(scout.radiant.games, 2);
  assert.equal(scout.radiant.winrate, 100);
  const path = '/replays/players/1/matches';
  assert.ok(!('items' in (await req(path))[0]));
  const rich = (await req(path + '?rich=1'))[0];
  assert.equal(rich.items.length, 6);
  assert.equal(rich.items[0].id, 1);
  assert.equal(rich.neutralItem.id, 2);
  assert.equal((await req('/players/1/recent-matches'))[0].items.length, 6);
  const detail = await req('/matches/70000001');
  assert.equal(detail.players.length, 10);
  assert.equal(detail.players[0].denies, 8);
  assert.equal(detail.players[0].hero_healing, 400);
  for (const [hero, id] of [
    [1, 70000001],
    [6, 70000002],
  ]) {
    const query = '?playerId=1&heroId=' + hero;
    const wards = await req('/replays/wards' + query),
      farm = await req('/replays/farming' + query);
    assert.equal(wards.summary.matchCount, 1);
    assert.equal(wards.points[0].matchId, id);
    assert.equal(wards.points[0].durationSec, 35);
    assert.equal(wards.points[0].dewarded, true);
    assert.equal(wards.visionDiagnosis.dewarded, 1);
    assert.equal(farm.summary.totalWeight, 5);
    assert.equal(farm.tacticalZones.length, 6);
    assert.equal(
      farm.tacticalZones.reduce((n: number, z: { percentage: number }) => n + z.percentage, 0),
      100,
    );
  }
  const zones = async (side: string) =>
    (await req('/replays/farming?matchId=70000001&roleScope=all&side=' + side)).tacticalZones.find(
      (z: { weight: number }) => z.weight > 0,
    ).zone;
  assert.equal(await zones('radiant'), '劣势路施压线');
  assert.equal(await zones('dire'), '优势路安全线');
});
test('逐场路人摘要可按需取得出装、计分板与复盘，保持赛事样本独立', async (t) => {
  const { db, req } = await fixture(t);
  await req('/players', 'POST', { nickname: '路人甲', accountId: 110 }, 201);
  db.exec(
    "INSERT INTO player_pub_matches(player_id,match_id,hero_id,player_slot,side,is_radiant,win,start_time) VALUES(1,80000001,1,0,'radiant',1,1,80000001)",
  );
  assert.equal((await req('/players/1/recent-matches'))[0].detailAvailable, false);
  await req('/players/1/recent-matches/80000001/replay', 'POST', {});
  const recent = await req('/players/1/recent-matches');
  assert.equal(recent.length, 1);
  assert.equal(recent[0].source, '路人');
  assert.equal(recent[0].neutralItem.id, 2);
  assert.equal((await req('/matches')).length, 0);
  assert.equal((await req('/replays/matches/80000001/scoreboard')).players.length, 10);
  assert.equal((await req('/replays/wards?playerId=1')).summary.parsedMatchCount, 1);
});
test('新环境自由阵容与五页交互契约', () => {
  const storage = new Map([['bp-setup-v4', JSON.stringify({ instant: true, radiantTeamId: 1 })]]);
  const d = initialRoom({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => {
      storage.delete(k);
    },
  });
  assert.equal(setupKey, 'bp-setup-v5');
  assert.equal(d.instant, false);
  assert.deepEqual(d.actions, []);
  assert.equal(d.radiantTeamId, null);
  assert.equal(d.direTeamId, null);
  assert.deepEqual([...d.radiantPlayerIds, ...d.direPlayerIds], Array(10).fill(null));
  const source = (name: string) =>
    readFileSync(new URL('../../web/src/' + name, import.meta.url), 'utf8');
  const app = source('App.tsx');
  assert.doesNotMatch(app, /seedDefaultTeams/);
  assert.deepEqual(
    [...app.matchAll(/id: '(draft|teams|players|matches|replays)'/g)].map((m) => m[1]),
    ['draft', 'teams', 'players', 'matches', 'replays'],
  );
  const panel = source('RecommendationPanel.tsx');
  assert.match(panel, /rows\.slice\(3\)/);
  assert.match(panel, /scoreBreakdown/);
  assert.match(panel, /matchupDetails/);
  assert.doesNotMatch(panel + source('HeroPoolGrid.tsx'), /onDoubleClick/);
  assert.doesNotMatch(source('MotionControls.tsx'), /droplet-glass/);
});
