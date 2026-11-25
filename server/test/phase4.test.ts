import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb } from '../src/db/index.ts';
import { createApp } from '../src/app.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { normalizeCoordinates, wardHeatmap, farmingHeatmap } from '../src/services/replay.ts';
import type { ReplayParserAdapter } from '../src/services/replayAdapter.ts';

type Wards = Awaited<ReturnType<typeof wardHeatmap>>;
type Farming = Awaited<ReturnType<typeof farmingHeatmap>>;
const ward = (x: number, y: number, time: number) => ({ x, y, time });
function match(id: number, parsed = true) {
  const players = Array.from({ length: 10 }, (_, i): Record<string, unknown> => ({
    player_slot: i < 5 ? i : 128 + i - 5,
    hero_id: i + 10,
    account_id: 1000 + i,
    lane_role: 4,
    personaname: '参赛者' + i,
    gold_per_min: 800,
    xp_per_min: 900,
  }));
  // 两局交换阵营；替补和主力都会计入战队样本，对手不会。
  const lead = players[id === 102 ? 5 : 0],
    sub = players[id === 102 ? 6 : 1],
    enemy = players[id === 102 ? 0 : 5];
  Object.assign(lead, {
    account_id: 110,
    hero_id: 1,
    lane_role: id === 102 ? null : 1,
    gold_per_min: id === 102 ? 700 : 500,
    xp_per_min: id === 102 ? 0 : 600,
  });
  Object.assign(sub, { account_id: 220, hero_id: 5, lane_role: null });
  Object.assign(enemy, { account_id: null, hero_id: 6, lane_role: 4, personaname: null });
  if (parsed) {
    Object.assign(lead, {
      obs_log: [
        ward(64, 64, -5),
        ward(120, 110, 0),
        ward(120, 110, 599),
        ward(192, 192, 1500),
        { x: null, y: 110, time: 10 },
        { x: '', y: 99, time: 1 },
      ],
      sen_log: [ward(120, 110, 600)],
      lane_pos: { 120: { 110: 5 }, '140': { '144': 2, '146': 0 }, bad: { 20: 99 } },
    });
    Object.assign(sub, { obs_log: [ward(165, 146, 1499)], lane_pos: { '120': { '110': 3 } } });
    Object.assign(enemy, { sen_log: [ward(94, 97, 600)], lane_pos: { 125: { 150: 4 } } });
  }
  return { match_id: id, radiant_win: true, duration: 1950, players };
}
async function fixture(
  t: TestContext,
  respond: (u: URL, method: string) => unknown,
  adapter?: ReplayParserAdapter,
) {
  const db = openDb(':memory:');
  const calls: { path: string; method: string; key: string | null }[] = [];
  const client = new OpenDotaClient(db, {
    retryMs: 0,
    keyedLimit: 1000,
    fetch: async (input, init) => {
      const u = new URL(String(input)),
        method = init?.method ?? 'GET';
      calls.push({ path: u.pathname, method, key: u.searchParams.get('api_key') });
      const response = await respond(u, method);
      return response instanceof Response ? response : Response.json(response);
    },
  });
  const server = createApp(db, 3001, client, false, adapter).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = 'http://127.0.0.1:' + addr.port + '/api';
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });
  async function request<T>(path: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, status, method + ' ' + path);
    return res.json() as Promise<T>;
  }
  return { db, calls, request };
}
async function seeded(t: TestContext) {
  const f = await fixture(t, (u) => {
    const id = Number(u.pathname.split('/').at(-1));
    return match(id, id !== 103);
  });
  await f.request('/players', 'POST', { accountId: 110, nickname: '主力' }, 201);
  await f.request('/players', 'POST', { accountId: 220, nickname: '替补' }, 201);
  await f.request(
    '/teams',
    'POST',
    {
      name: '甲队',
      members: [
        { playerId: 1, slot: 1 },
        { playerId: 2, slot: 6 },
      ],
    },
    201,
  );
  await f.request('/matches/import', 'POST', { matchIds: [101, 103], tag: '春季' });
  await f.request('/matches/import', 'POST', { matchIds: [102], tag: '秋季' });
  return f;
}
test('地图网格方向、中心点与边界钳制', () => {
  assert.deepEqual(normalizeCoordinates(64, 64), { nx: 0, ny: 1 });
  assert.deepEqual(normalizeCoordinates(192, 192), { nx: 1, ny: 0 });
  assert.deepEqual(normalizeCoordinates(128, 128), { nx: 0.5, ny: 0.5 });
  assert.deepEqual(normalizeCoordinates(18, 249), { nx: 0, ny: 0 });
});
test('眼位按类型、时间边界、阵营和赛事精确筛选，保留赛前负时间', async (t) => {
  const { request } = await seeded(t);
  const get = (q: string) => request<Wards>('/replays/wards?matchId=101&' + q);
  const all = await get('');
  assert.deepEqual(all.summary, {
    matchCount: 1,
    parsedMatchCount: 1,
    obsCount: 5,
    senCount: 2,
    radiantCount: 6,
    direCount: 1,
  });
  assert.deepEqual(all.points[0], {
    nx: 0,
    ny: 1,
    rawX: 64,
    rawY: 64,
    time: -5,
    wardType: 'obs',
    side: 'radiant',
    matchId: 101,
    heroId: 1,
    heroName: '敌法师',
    playerName: '主力',
    accountId: 110,
  });
  assert.equal(all.hotspots[0].count, 3);
  assert.deepEqual([all.hotspots[0].nx, all.hotspots[0].ny], [56 / 128, 82 / 128]);
  assert.deepEqual(
    (await get('phase=early')).points.map((p) => p.time),
    [0, 599],
  );
  assert.deepEqual(
    (await get('phase=mid')).points.map((p) => p.time).sort((a, b) => a - b),
    [600, 600, 1499],
  );
  assert.deepEqual(
    (await get('phase=late')).points.map((p) => p.time),
    [1500],
  );
  assert.equal((await get('wardType=obs')).summary.senCount, 0);
  assert.equal((await get('wardType=sen')).summary.obsCount, 0);
  const dire = await get('side=dire&wardType=sen');
  assert.equal(dire.points.length, 1);
  assert.equal(dire.points[0].playerName, '匿名选手');
  assert.equal((await get('side=radiant&wardType=sen&phase=late')).points.length, 0);
  assert.equal((await get('tag=秋季')).summary.matchCount, 0);
  await request('/replays/wards?side=unknown', 'GET', undefined, 400);
});
test('战队按首发与替补、选手按本地编号跨场聚合；未解析清单随阵营和标签更新', async (t) => {
  const { request } = await seeded(t);
  const teams = await request<Wards>('/replays/wards?teamId=1');
  assert.deepEqual(teams.summary, {
    matchCount: 3,
    parsedMatchCount: 2,
    obsCount: 10,
    senCount: 2,
    radiantCount: 6,
    direCount: 6,
  });
  assert.deepEqual(teams.unparsedMatches, [{ matchId: 103, tag: '春季' }]);
  const dire = await request<Wards>('/replays/wards?teamId=1&playerId=1&side=dire');
  assert.equal(dire.summary.matchCount, 1);
  assert.equal(dire.points.length, 5);
  assert.ok(dire.points.every((p) => p.matchId === 102 && p.accountId === 110));
  assert.deepEqual(dire.unparsedMatches, []);
  const player = await request<Wards>('/replays/wards?playerId=1&tag=春季');
  assert.equal(player.summary.matchCount, 2);
  assert.equal(player.points.length, 5);
  assert.equal((await request<Wards>('/replays/wards?playerId=110')).summary.matchCount, 0);
});
test('核心位置优先按分路，缺失时回退英雄职责；仅有坐标样本的人次计入经济经验', async (t) => {
  const { request, db } = await seeded(t);
  const core = await request<Farming>('/replays/farming');
  assert.deepEqual(core.summary, {
    matchCount: 2,
    samplePlayers: 2,
    avgGpm: 600,
    avgXpm: 300,
    totalWeight: 14,
  });
  assert.deepEqual(
    core.cells.map((c) => [c.rawX, c.rawY, c.weight, c.intensity]),
    [
      [120, 110, 10, 1],
      [140, 144, 4, 0.4],
    ],
  );
  assert.deepEqual([core.cells[0].nx, core.cells[0].ny], [56 / 128, 82 / 128]);
  assert.equal(core.zoneBreakdown.length, 6);
  assert.ok(Math.abs(core.zoneBreakdown.reduce((n, c) => n + c.percentage, 0) - 100) < 1e-8);
  assert.equal(core.zoneBreakdown.find((z) => z.zone === '河道与肉山周边')?.weight, 0);
  assert.equal(
    core.zoneBreakdown.reduce((n, c) => n + c.weight, 0),
    14,
  );
  const all = await request<Farming>('/replays/farming?roleScope=all');
  assert.equal(all.summary.samplePlayers, 6);
  assert.equal(all.summary.totalWeight, 28);
  assert.equal(all.cells.find((c) => c.rawX === 120)?.weight, 16);
  const sub = await request<Farming>(
    '/replays/farming?teamId=1&playerId=2&roleScope=all&heroId=5&tag=秋季&side=dire',
  );
  assert.equal(sub.summary.totalWeight, 3);
  assert.deepEqual((await request<Farming>('/replays/farming?heroId=5')).summary, {
    matchCount: 0,
    samplePlayers: 0,
    avgGpm: null,
    avgXpm: null,
    totalWeight: 0,
  });
  db.prepare(
    'UPDATE match_players SET lane_role=3,gpm=NULL WHERE account_id=220 AND match_id=101',
  ).run();
  const changed = await request<Farming>('/replays/farming?matchId=101');
  assert.equal(changed.summary.samplePlayers, 2);
  assert.equal(changed.summary.avgGpm, 500);
  assert.equal(changed.summary.avgXpm, 750);
  await request('/replays/farming?matchId=0', 'GET', undefined, 400);
});
test('真实 HTTP 入口提交、查询任务、绕过旧缓存并原子回填十人数据', async (t) => {
  let polls = 0,
    reads = 0;
  const { db, request, calls } = await fixture(t, (u, method) => {
    if (u.pathname === '/api/request/101' && method === 'POST') return { job: { jobId: 701 } };
    if (u.pathname === '/api/request/701')
      return ++polls === 1 ? { state: 'active', data: { match_id: 101 } } : null;
    if (u.pathname === '/api/matches/101') return match(101, ++reads > 1);
    throw new Error('意外的上游请求');
  });
  db.exec("INSERT INTO settings VALUES('opendota_api_key','fixture-key','now')");
  await request('/matches/import', 'POST', { matchIds: [101], tag: '决赛' });
  assert.equal(db.prepare('SELECT has_parsed FROM matches').get()?.has_parsed, 0);
  const base = '/matches/101',
    status = base + '/parse-status?jobId=701';
  assert.deepEqual(await request(base + '/request-parse', 'POST'), {
    matchId: 101,
    jobId: 701,
    status: 'queued',
  });
  assert.deepEqual(await request(status), {
    matchId: 101,
    status: 'pending',
    hasParsed: false,
    wardCount: 0,
  });
  assert.deepEqual(await request(status), {
    matchId: 101,
    status: 'completed',
    hasParsed: true,
    wardCount: 9,
  });
  assert.deepEqual(
    { ...db.prepare('SELECT has_parsed,tag FROM matches').get() },
    { has_parsed: 1, tag: '决赛' },
  );
  const row = db.prepare('SELECT * FROM match_players WHERE match_id=101 AND player_slot=0').get()!;
  assert.equal(JSON.parse(String(row.obs_log_json))[1].time, 0);
  assert.equal(JSON.parse(String(row.sen_log_json))[0].time, 600);
  assert.equal(JSON.parse(String(row.lane_pos_json))['120']['110'], 5);
  assert.deepEqual(await request(base + '/request-parse', 'POST'), {
    matchId: 101,
    jobId: null,
    status: 'already_parsed',
  });
  await request(status);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.key === 'fixture-key'));
  assert.equal(reads, 2);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM api_cache WHERE cache_key LIKE '/request/%'").get()?.n,
    0,
  );
  assert.equal((await request<Wards>('/replays/wards?matchId=101')).points.length, 7);
});
test('六个战术区域互斥，按原始网格权重计算百分比', async (t) => {
  const { request, db } = await seeded(t);
  const positions = {
    72: { 120: 1 },
    128: { 128: 2, 76: 3, 100: 5 },
    158: { 145: 4 },
    100: { 156: 6 },
  };
  db.prepare('UPDATE match_players SET lane_pos_json=? WHERE account_id=110 AND match_id=101').run(
    JSON.stringify(positions),
  );
  const data = await request<Farming>('/replays/farming?matchId=101&playerId=1');
  assert.deepEqual(
    data.zoneBreakdown.map((z) => z.weight),
    [1, 2, 3, 5, 4, 6],
  );
  data.zoneBreakdown.forEach((z) => assert.ok(Math.abs(z.percentage - (100 * z.weight) / 21) < 1e-9));
});
test('显式完成与失败、出队后无遥测、任务比赛不匹配和无效输入', async (t) => {
  let status: unknown = { status: 'failed' },
    parsed = false;
  const { request, db } = await fixture(t, (u) =>
    u.pathname.startsWith('/api/request/') ? status : match(101, parsed),
  );
  await request('/matches/import', 'POST', { matchIds: [101] });
  const poll = () =>
    request<{ status: string; hasParsed: boolean }>('/matches/101/parse-status?jobId=7');
  assert.equal((await poll()).status, 'failed');
  status = { status: 'active', data: { match_id: 102 } };
  await request('/matches/101/parse-status?jobId=7', 'GET', undefined, 400);
  status = null;
  assert.equal((await poll()).status, 'failed');
  assert.equal(db.prepare('SELECT has_parsed FROM matches').get()?.has_parsed, 0);
  status = { status: 'completed' };
  parsed = true;
  assert.equal((await poll()).hasParsed, true);
  await request('/matches/101/parse-status', 'GET', undefined, 400);
  await request('/matches/999/request-parse', 'POST', undefined, 404);
});
test('录像插件可通过同一接口异步提供原始坐标', async (t) => {
  const adapter: ReplayParserAdapter = {
    async parseReplay(id, slots, layer) {
      assert.equal(id, 101);
      assert.ok(slots.includes(0));
      assert.equal(layer, 'wards');
      return [{ playerSlot: 0, obs: [ward(128, 128, 90)], sen: [], positions: [] }];
    },
  };
  const { request } = await fixture(t, () => match(101), adapter);
  await request('/matches/import', 'POST', { matchIds: [101] });
  const data = await request<Wards>('/replays/wards');
  assert.deepEqual(
    data.points.map((p) => [p.nx, p.ny, p.time]),
    [[0.5, 0.5, 90]],
  );
});
test('旧备份中仅有比赛主记录时可请求解析；刷新过程中删除比赛不会重新创建', async (t) => {
  let fetching!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    fetching = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { request, db } = await fixture(t, async (u) => {
    if (u.pathname.includes('/request/')) return null;
    fetching();
    await resume;
    return match(101);
  });
  db.exec("INSERT INTO matches(match_id,tag,imported_at) VALUES(101,'早期赛事','now')");
  const wards = await request<Wards>('/replays/wards?tag=早期赛事');
  assert.deepEqual(wards.unparsedMatches, [{ matchId: 101, tag: '早期赛事' }]);
  assert.equal(wards.summary.matchCount, 1);
  assert.equal((await request<Wards>('/replays/wards?side=dire')).summary.matchCount, 0);
  const poll = request('/matches/101/parse-status?jobId=7', 'GET', undefined, 404);
  await started;
  db.prepare('DELETE FROM matches WHERE match_id=?').run(101);
  release();
  await poll;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matches').get()?.n, 0);
});
