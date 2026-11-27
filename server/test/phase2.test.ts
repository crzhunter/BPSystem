import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import type { NetworkInterfaceInfo } from 'node:os';
import { migrate, openDb } from '../src/db/index.ts';
import { migrations } from '../src/db/schema.ts';
import { createApp } from '../src/app.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { scoreHero } from '../src/services/analytics.ts';
import { readSettings } from '../src/services/settings.ts';
import { lanUrls } from '../src/routes/system.ts';

const now = Math.floor(Date.now() / 1000);
function tournament(id: number) {
  return {
    match_id: id,
    start_time: now,
    duration: 1800,
    radiant_win: false,
    patch: 61,
    radiant_team: { name: '甲队' },
    dire_team: { name: '乙队' },
    picks_bans: [
      { order: 2, is_pick: true, team: 0, hero_id: 1 },
      { order: 0, is_pick: false, team: 0, hero_id: 22 },
      { order: 1, is_pick: true, team: 1, hero_id: 6 },
    ],
    players: Array.from({ length: 10 }, (_, i) => ({
      player_slot: i < 5 ? i : 128 + i - 5,
      hero_id: i + 1,
      account_id: i === 9 ? null : 101 + i,
      personaname: '参赛者' + i,
      kills: 4,
      deaths: 0,
      assists: 8,
      gold_per_min: 450,
      xp_per_min: 615,
      lane: 1,
      lane_role: 1,
      hero_damage: 20000,
      tower_damage: 1540,
      last_hits: 100,
      item_0: 17,
      item_5: 50,
      obs_log: i === 0 ? [{ time: 15 }] : [],
      sen_log: i === 1 ? [{ time: 20 }, { time: 31 }] : [],
      lane_pos: { 8: { 12: 4 } },
    })),
  };
}
const pub = (id: number, slot: number, win: boolean, start = now, hero = 1) => ({
  match_id: id,
  hero_id: hero,
  player_slot: slot,
  radiant_win: win,
  start_time: start,
  duration: 1500,
  kills: 4,
  deaths: 2,
  assists: 6,
  gold_per_min: 400,
  xp_per_min: 500,
  lane: 1,
  lane_role: 1,
  game_mode: 22,
  lobby_type: 7,
  party_size: 1,
});
async function fixture(t: TestContext, respond: (url: URL) => unknown = () => ({})) {
  const db = openDb(':memory:');
  const calls: URL[] = [];
  const client = new OpenDotaClient(db, {
    retryMs: 0,
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const v = respond(url);
      return v instanceof Response ? v : Response.json(v);
    },
  });
  const server = createApp(db, 3001, client, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = 'http://127.0.0.1:' + addr.port + '/api';
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });
  async function req(path: string, method = 'GET', body?: unknown, status = 200) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = res.status === 204 ? undefined : await res.json();
    assert.equal(res.status, status, method + ' ' + path + ' ' + (res.ok ? '' : JSON.stringify(data)));
    return data;
  }
  return { db, calls, req, player: (accountId = 101) => req('/players', 'POST', { accountId }, 201) };
}

test('v1 原位升级保留既有阵容、比赛和自定义权重；新库采用 4 倍和 60 天', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migrations[0]);
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES(1,'before');
      INSERT INTO settings VALUES('tournament_match_weight','0','before');
      INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(123,'原队长','a','a');
      INSERT INTO teams(name,created_at,updated_at) VALUES('原队','a','a');
      INSERT INTO team_members(team_id,player_id,slot,created_at) VALUES(1,1,2,'a');
      INSERT INTO matches(match_id,imported_at) VALUES(99,'a');
      INSERT INTO match_players(match_id,player_slot,hero_id,side,is_radiant) VALUES(99,128,1,'dire',0)`);
    migrate(db);
    migrate(db);
    assert.equal(readSettings(db).tournamentMatchWeight, 0);
    assert.equal(readSettings(db).pubRecentDays, 60);
    assert.equal(db.prepare('SELECT slot FROM team_members').get()?.slot, 2);
    assert.equal(db.prepare('SELECT account_id FROM players').get()?.account_id, 123);
    assert.equal(
      db.prepare('SELECT hero_damage FROM match_players WHERE match_id=99').get()?.hero_damage,
      null,
    );
    assert.deepEqual(
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => r.version),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    db.exec('DELETE FROM settings');
    assert.equal(readSettings(db).tournamentMatchWeight, 4);
  } finally {
    db.close();
  }
});

test('融合公式按赛事权重、近期与生涯分层计分，平滑单场样本', () => {
  const empty = { games: 0, wins: 0, recentGames: 0, recentWins: 0 };
  const tour = { games: 1, wins: 1 },
    recent = { games: 1, wins: 1, recentGames: 1, recentWins: 1 };
  const one = scoreHero(4, { games: 0, wins: 0 }, recent, 1);
  assert.equal(one, 46.89);
  assert.ok(scoreHero(4, tour, empty, 1) > one);
  assert.equal(scoreHero(1, tour, empty, 1), one);
  assert.equal(scoreHero(0, tour, empty, 1), 0);
  assert.ok(
    scoreHero(4, { games: 0, wins: 0 }, { games: 12, wins: 10, recentGames: 12, recentWins: 10 }, 1) >
      one,
  );
  assert.ok(scoreHero(4, tour, empty, 1) > scoreHero(4, tour, empty, 0));
});

test('混合 ID 与链接导入、十人双阵营、录像、重导更新、动态关联和级联删除', async (t) => {
  const f = await fixture(t, (url) => {
    const id = Number(url.pathname.split('/').at(-1));
    const m = tournament(id);
    if (id === 888) m.players.pop();
    if (id === 999)
      m.players.forEach((p) => {
        Object.assign(p, { obs_log: null, sen_log: null, lane_pos: null });
      });
    return m;
  });
  await f.player();
  const ids =
    '777, https://www.opendota.com/matches/777/overview\nhttps://www.dotabuff.com/matches/999 888';
  const r = await f.req('/matches/import', 'POST', { matchIds: [ids, 777, '无效链接'], tag: '春季杯' });
  assert.equal(r.results.length, 4);
  assert.match(r.results[3].error, /链接无效/);
  assert.deepEqual(r.results[0], {
    matchId: 777,
    imported: true,
    updated: false,
    hasParsed: true,
    linkedPlayersCount: 1,
  });
  assert.equal(r.results[1].hasParsed, false);
  assert.ok(r.results[2].error);
  assert.deepEqual(
    (await f.req('/matches?tag=' + encodeURIComponent('春季杯') + '&q=777')).map(
      (m: { matchId: number }) => m.matchId,
    ),
    [777],
  );
  const d = await f.req('/matches/777');
  assert.equal(d.players.length, 10);
  assert.equal(d.teamsCount, 2);
  assert.equal(d.direName, '乙队');
  assert.equal(d.radiantWin, 0);
  assert.equal(d.picksBans[0].isFirstPickTeam, 0);
  assert.deepEqual(
    d.picksBans.map((a: { orderIndex: number }) => a.orderIndex),
    [0, 1, 2],
  );
  assert.equal(d.players[0].linkedPlayerId, 1);
  assert.equal(d.players[0].pick_order, 2);
  assert.equal(d.players[0].draft_order, 2);
  assert.equal(d.players[5].side, 'dire');
  assert.equal(d.players[5].is_radiant, 0);
  assert.equal(d.players[4].is_radiant, 1);
  assert.equal(d.players[9].account_id, null);
  assert.equal(d.players[0].hero_damage, 20000);
  assert.deepEqual(JSON.parse(d.players[0].lane_pos_json), { 8: { 12: 4 } });
  assert.deepEqual(JSON.parse(d.players[0].items_json), [17, 0, 0, 0, 0, 50]);
  assert.deepEqual(d.telemetry, { obsCount: 1, senCount: 2, hasParsed: true });
  await f.player(102);
  assert.equal((await f.req('/matches/777')).linkedPlayersCount, 2);
  const again = await f.req('/matches/import', 'POST', { matchIds: [777] });
  assert.equal(again.results[0].updated, true);
  assert.equal((await f.req('/matches/777')).tag, '春季杯');
  assert.equal(f.calls.filter((c) => c.pathname.endsWith('/777')).length, 1);
  await f.req('/matches/777', 'DELETE', undefined, 204);
  await f.req('/matches/777', 'GET', undefined, 404);
  for (const table of ['match_players', 'match_picks_bans'])
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM ' + table + ' WHERE match_id=777').get()?.n, 0);
});

test('同步、去重、多来源阵营胜率和加权池，修改设置立即生效', async (t) => {
  const f = await fixture(t, (url) => {
    if (url.pathname.startsWith('/api/matches/')) return tournament(900);
    if (url.pathname.endsWith('/heroes'))
      return [{ hero_id: '1', games: 20, win: 11, last_played: now, with_games: 2, with_win: 1 }];
    if (url.pathname.endsWith('/matches'))
      return [
        pub(901, 0, true),
        pub(902, 128, false, now - 10),
        { ...pub(903, 128, true, now - 80 * 86400), patch: 60 },
        pub(900, 0, false),
        pub(899, 0, false, now - 30, 3),
      ];
    return { profile: { personaname: '公开昵称', avatarfull: 'avatar' } };
  });
  await f.player();
  const sync = await f.req('/players/1/sync', 'POST');
  assert.equal(sync.player.steamName, '公开昵称');
  assert.equal(sync.player.avatarUrl, 'avatar');
  assert.equal(sync.analytics.isProfilePrivate, false);
  assert.equal(f.calls[2].searchParams.get('limit'), '50');
  assert.ok(f.calls[2].searchParams.getAll('project').includes('hero_id'));
  await f.req('/matches/import', 'POST', { matchIds: [900] });
  const a = await f.req('/players/1/analytics');
  assert.deepEqual(a.sideSplits.pub, {
    radiant: { games: 2, wins: 1, winrate: 50 },
    dire: { games: 1, wins: 1, winrate: 100 },
    delta: -50,
  });
  assert.deepEqual(a.sideSplits.tournament.radiant, { games: 1, wins: 0, winrate: 0 });
  assert.equal(a.sideSplits.combined.radiant.winrate, 33.33);
  assert.equal(a.sideSplits.combined.delta, -66.67);
  assert.equal(a.recentForm.games, 3);
  assert.equal(a.recentForm.avgKda, 5);
  assert.equal(a.recentForm.avgGpm, 400);
  assert.equal(a.recentForm.avgXpm, 500);
  assert.deepEqual(a.recentForm.streak, { count: 2, type: '连胜' });
  assert.equal(a.roleDistribution[0].games, 3);
  const hero = a.heroPool.find((h: { heroId: number }) => h.heroId === 1);
  assert.equal(hero.source, '赛事和天梯');
  assert.equal(hero.pub.games, 19);
  assert.equal(hero.pub.wins, 11);
  assert.equal(hero.pub.recentGames, 2);
  assert.equal(hero.tournament.avgKda, 12);
  assert.equal(a.heroPool.find((h: { heroId: number }) => h.heroId === 3).source, '路人局');
  await f.req('/settings', 'PUT', { pubRecentDays: 120, tournamentMatchWeight: 0 });
  const revised = (await f.req('/players/1/analytics')).heroPool.find(
    (h: { heroId: number }) => h.heroId === 1,
  );
  assert.equal(revised.pub.recentGames, 3);
  assert.notEqual(revised.weightedScore, hero.weightedScore);
  await f.req('/players/1', 'PUT', { accountId: 102 });
  const rebound = await f.req('/players/1/analytics');
  assert.equal(rebound.recentForm.games, 0);
  assert.equal(rebound.heroPool[0].source, '比赛局');
  assert.equal(rebound.lastSyncedAt, null);
});

test('全队逐人同步，隐藏资料、空战绩、接口回退和局部失败互不混淆', async (t) => {
  const f = await fixture(t, (url) => {
    if (url.pathname.includes('/103')) return new Response(null, { status: 500 });
    if (url.pathname.endsWith('/heroes')) return [];
    if (url.pathname.endsWith('/matches')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('/recentMatches'))
      return url.pathname.includes('/101') ? [pub(70, 128, false)] : [];
    return url.pathname.includes('/101') ? {} : { profile: { personaname: '未公开记录' } };
  });
  for (const account of [101, 102, 103]) await f.player(account);
  await f.req(
    '/teams',
    'POST',
    { name: '校队', members: [1, 2, 3].map((i) => ({ slot: i, playerId: i })) },
    201,
  );
  const { results } = await f.req('/teams/1/sync', 'POST');
  assert.deepEqual(
    results.map((r: { success: boolean }) => r.success),
    [true, true, false],
  );
  assert.deepEqual(
    results.slice(0, 2).map((r: { isProfilePrivate: boolean }) => r.isProfilePrivate),
    [true, true],
  );
  const a = await f.req('/players/1/analytics');
  assert.match(a.privacyHint, /历史比赛 ID/);
  assert.equal(a.sideSplits.pub.dire.wins, 1);
  assert.equal((await f.req('/players/3/analytics')).lastSyncedAt, null);
  const ids = f.calls.map((u) => u.pathname.split('/')[3]);
  assert.deepEqual(ids, [...ids].sort());
});

test('最近状态仅取最新 20 场，连胜统计以最近一场开始，空侧不伪造 0% 胜率', async (t) => {
  const f = await fixture(t, (u) =>
    u.pathname.endsWith('/matches')
      ? Array.from({ length: 25 }, (_, i) => pub(100 + i, 0, i >= 5, now - i))
      : u.pathname.endsWith('/heroes')
        ? []
        : { profile: { personaname: '新人' } },
  );
  await f.player();
  const a = (await f.req('/players/1/sync', 'POST')).analytics;
  assert.equal(a.recentForm.games, 20);
  assert.equal(a.recentForm.winrate, 75);
  assert.deepEqual(a.recentForm.streak, { type: '连败', count: 5 });
  assert.equal(a.sideSplits.combined.dire.winrate, null);
  assert.equal(a.sideSplits.combined.delta, null);
});

test('失败的重新同步保留上次资料；同步成功但资料转为隐藏时仍可查看历史样本', async (t) => {
  let state = 'public';
  const f = await fixture(t, (u) => {
    if (u.pathname.endsWith('/heroes'))
      return state === 'hidden' ? [] : [{ hero_id: 1, games: 5, win: 3 }];
    if (u.pathname.endsWith('/matches'))
      return state === 'hidden' ? [] : [pub(state === 'broken' ? -1 : 800, 0, true)];
    return state === 'hidden' ? {} : { profile: { personaname: state } };
  });
  await f.player();
  const first = await f.req('/players/1/sync', 'POST');
  state = 'broken';
  f.db.exec('DELETE FROM api_cache');
  await f.req('/players/1/sync', 'POST', undefined, 502);
  assert.equal((await f.req('/players'))[0].steamName, 'public');
  assert.equal((await f.req('/players/1/analytics')).lastSyncedAt, first.analytics.lastSyncedAt);
  state = 'hidden';
  f.db.exec('DELETE FROM api_cache');
  const hidden = await f.req('/players/1/sync', 'POST');
  assert.equal(hidden.analytics.isProfilePrivate, true);
  assert.equal(hidden.analytics.heroPool[0].pub.games, 5);
  assert.equal(hidden.analytics.recentForm.games, 1);
});

test('导入中途遇到损坏的参赛者数据，保留原比赛标签、十名参赛者和禁选记录', async (t) => {
  let broken = false;
  const f = await fixture(t, () => {
    const game = tournament(990);
    if (broken) game.players[9].kills = -1;
    return game;
  });
  await f.req('/matches/import', 'POST', { matchIds: [990], tag: '原标签' });
  const before = await f.req('/matches/990');
  broken = true;
  f.db.exec('DELETE FROM api_cache');
  const update = await f.req('/matches/import', 'POST', { matchIds: [990], tag: '无效更新' });
  assert.ok(update.results[0].error);
  assert.deepEqual(await f.req('/matches/990'), before);
});

test('JSON 全量往返，密钥留在本机，错误外键与无效 JSON 数据整笔回滚', async (t) => {
  const f = await fixture(t, (u) =>
    u.pathname.startsWith('/api/matches/')
      ? tournament(789)
      : u.pathname.endsWith('/heroes')
        ? [{ hero_id: 1, games: 4, win: 2 }]
        : u.pathname.endsWith('/matches')
          ? [pub(999, 0, true)]
          : { profile: { personaname: '公开昵称' } },
  );
  await f.player();
  await f.req('/players/1/sync', 'POST');
  await f.req('/teams', 'POST', { name: '杯赛战队', members: [{ slot: 1, playerId: 1 }] }, 201);
  await f.req('/matches/import', 'POST', { matchIds: [789] });
  await f.req('/settings', 'PUT', { opendotaApiKey: 'local-test-secret', pubRecentDays: 37 });
  const snap = await f.req('/backup/export');
  assert.equal(snap.version, 5);
  assert.ok(!JSON.stringify(snap).includes('local-test-secret'));
  assert.equal(snap.match_players.length, 10);
  assert.equal(snap.player_pub_heroes.length, 1);
  const dest = await fixture(t);
  await dest.req('/settings', 'PUT', { opendotaApiKey: 'destination-key' });
  const { counts } = await dest.req('/backup/import', 'POST', snap);
  assert.equal(counts.match_players, 10);
  assert.equal(counts.team_members, 1);
  const { exportedAt, ...restored } = await dest.req('/backup/export');
  const { exportedAt: before, ...expected } = snap;
  assert.deepEqual(restored, expected);
  assert.equal((await dest.req('/settings')).maskedPreview, '••••-key');
  const v4=structuredClone(snap);v4.version=4;delete v4.player_hero_overrides;
  for(const p of v4.players) for(const col of ['alias','rank_tier','primary_role','leaderboard_rank','style_tags_json']) delete p[col];
  for(const p of v4.match_players) for(const col of ['denies','hero_healing','item_neutral','obs_left_log_json','sen_left_log_json']) delete p[col];
  await dest.req('/backup/import','POST',v4);
  const upgraded=await dest.req('/backup/export');
  assert.deepEqual(upgraded.player_hero_overrides,[]);assert.deepEqual(upgraded.players,snap.players);
  assert.deepEqual(upgraded.player_pub_heroes,snap.player_pub_heroes);
  assert.deepEqual(upgraded.match_players,snap.match_players);
  for (const mutate of [
    (s: typeof snap) => (s.player_pub_matches[0].player_id = 9999),
    (s: typeof snap) => (s.players[0].roles_json = '{}'),
    (s: typeof snap) => (s.settings[0].key = 'opendota_api_key'),
  ]) {
    const bad = structuredClone(snap);
    bad.teams[0].name = '不可写入';
    mutate(bad);
    await dest.req('/backup/import', 'POST', bad, 400);
    assert.equal((await dest.req('/teams'))[0].name, '杯赛战队');
    assert.deepEqual((await dest.req('/backup/export')).match_players, expected.match_players);
  }
});

test('局域网地址筛除链路本地、TUN、回环和 IPv6，优先 RFC1918 且去重', () => {
  const ips = [
    '203.0.113.9',
    '169.254.20.1',
    '198.18.0.1',
    '198.19.255.7',
    '192.168.1.8',
    '10.1.0.1',
    '172.31.2.3',
    '172.32.1.1',
    '192.168.1.8',
    '127.0.0.1',
    '::1',
  ];
  const infos = ips.map(
    (address) =>
      ({
        address,
        family: address.includes(':') ? 'IPv6' : 'IPv4',
        internal: address === '127.0.0.1',
      }) as NetworkInterfaceInfo,
  );
  assert.deepEqual(
    lanUrls({ test: infos }, 5173),
    [ips[4], ips[5], ips[6], ips[0], ips[7]].map((a) => 'http://' + a + ':5173'),
  );
});
