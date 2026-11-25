import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, root, transaction } from '../src/db/index.ts';
import { createApp } from '../src/app.ts';
import { cmOrder, opposite, type Side } from '../src/data/cmOrder.ts';
import { heroTags } from '../src/data/heroTags.ts';
import { heroSnapshot } from '../src/data/snapshot.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { recommend } from '../src/services/bpEngine.ts';
import { normalizeDraft, readSession, writeSession } from '../src/services/draftState.ts';

async function fixture(t: TestContext, fetcher?: typeof fetch) {
  const db = openDb(':memory:');
  const client = new OpenDotaClient(db, {
    fetch:
      fetcher ??
      (async () => {
        throw Error('测试未提供网络');
      }),
    retryMs: 0,
  });
  const server = createApp(db, 3001, client, false).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = 'http://127.0.0.1:' + addr.port + '/api';
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    db.close();
  });
  async function req(path: string, method = 'GET', body?: unknown, status = 200) {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = response.status === 204 ? undefined : await response.json();
    assert.equal(
      response.status,
      status,
      method + ' ' + path + ' ' + (JSON.stringify(value) ?? '').slice(0, 150),
    );
    return value;
  }
  return { db, req, base };
}
function players(db: DatabaseSync, count: number) {
  const put = db.prepare(
    "INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(?,?,'a','a')",
  );
  for (let i = 1; i <= count; i++) put.run(100 + i, '选手' + i);
}
function pubHero(db: DatabaseSync, player: number, hero: number, games: number, wins: number) {
  db.prepare("INSERT INTO player_pub_heroes VALUES(?,?,?,?,?,0,0,0,0,'a',?,?)").run(
    player,
    hero,
    games,
    wins,
    Math.floor(Date.now() / 1000),
    games, wins,
  );
}
function tournament(db: DatabaseSync, id: number, won: Side, rows: [number, number, Side][]) {
  db.prepare(
    "INSERT INTO matches(match_id,radiant_win,start_time,imported_at) VALUES(?,?,?,'a')",
  ).run(id, Number(won === 'radiant'), Math.floor(Date.now() / 1000));
  rows.forEach(([player, hero, side], i) =>
    db
      .prepare(
        'INSERT INTO match_players(match_id,player_slot,account_id,hero_id,side,is_radiant) VALUES(?,?,?,?,?,?)',
      )
      .run(
        id,
        (side === 'dire' ? 128 : 0) + i,
        100 + player,
        hero,
        side,
        Number(side === 'radiant'),
      ),
  );
}
test('CM 每一阶段的动作、双方阵营与独立先选权均符合 24 步顺序', () => {
  const expected = ['ban:FFSSFSS', 'pick:FS', 'ban:FFS', 'pick:SFFSSF', 'ban:FSFS', 'pick:FS'];
  for (const first of ['radiant', 'dire'] as const) {
    const order = cmOrder(first);
    assert.equal(order.length, 24);
    let idx = 0;
    expected.forEach((group, g) => {
      const [type, seq] = group.split(':');
      for (const letter of seq) {
        const step = order[idx++];
        assert.deepEqual(step, {
          step: idx,
          phase: 1 + Math.floor(g / 2),
          actionType: type,
          side: letter === 'F' ? first : opposite(first),
          isFirstPickTeam: letter === 'F',
        });
      }
    });
    for (const side of ['radiant', 'dire'])
      for (const [type, n] of [
        ['ban', 7],
        ['pick', 5],
      ] as const)
        assert.equal(order.filter((s) => s.side === side && s.actionType === type).length, n);
  }
});
test('127 名英雄与新增英雄均有位置和战术标签；硬控、推进和救人按英雄区分', () => {
  assert.equal(heroSnapshot.length, 127);
  for (const h of [...heroSnapshot, { id: 999, roles: ['Support', 'Disabler'] }]) {
    const traits = heroTags(h.id, h.roles);
    assert.ok(traits.typicalRoles.length && traits.tags.length);
    assert.ok(traits.typicalRoles.every((r) => Number.isInteger(r) && r >= 1 && r <= 5));
  }
  assert.deepEqual(heroTags(94, []).typicalRoles, [1]);
  assert.ok(heroTags(27, []).tags.includes('stun') && heroTags(27, []).tags.includes('push'));
  assert.ok(heroTags(111, []).tags.includes('save'));
});
test('存档 CRUD、十槽位、动作归属、并发步号、重复英雄、撤销与重置', async (t) => {
  const { db, req, base } = await fixture(t);
  players(db, 4);
  const team = await req('/teams', 'POST', { name: '天辉队' }, 201);
  const body = {
    title: '决胜局',
    notes: '对手后选',
    patch: '7.42',
    ourSide: 'radiant',
    firstPickSide: 'dire',
    radiantTeamId: team.id,
    radiantPlayerIds: [1, null, 2],
    direPlayerIds: [3, 4],
  };
  const saved = await req('/bp/sessions', 'POST', body, 201),
    path = '/bp/sessions/' + saved.id;
  assert.equal(saved.timeline.length, 24);
  assert.equal(saved.currentStep.isOurTurn, false);
  assert.deepEqual(saved.radiantPlayerIds, [1, null, 2, null, null]);
  await req('/bp/sessions', 'POST', { ...body, direPlayerIds: [1] }, 400);
  await req(path + '/action', 'POST', { heroId: 1, stepIndex: 5 }, 400);
  const raced = await Promise.all(
    [1, 1].map((heroId) =>
      fetch(base + path + '/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroId, stepIndex: 1 }),
      }),
    ),
  );
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 400]);
  await Promise.all(raced.map((r) => r.text()));
  assert.match((await req(path + '/action', 'POST', { heroId: 1 }, 400)).error, /已被禁用或选取/);
  await req(path + '/action', 'POST', { heroId: 2, assignedPlayerId: 3 }, 400);
  for (let i = 2; i <= 7; i++) await req(path + '/action', 'POST', { heroId: i });
  await req(path + '/action', 'POST', { heroId: 8, assignedPlayerId: 1 }, 400);
  const picked = await req(path + '/action', 'POST', {
    heroId: 8,
    assignedPlayerId: 4,
    roleHint: 2,
    step: 8,
  });
  assert.equal(picked.actions[7].side, 'dire');
  assert.equal(picked.timeline[7].action.assignedPlayerId, 4);
  const corrected = await req(path + '/action', 'POST', {
    heroId: 9,
    stepIndex: 2,
    revision: picked.revision,
  });
  assert.equal(corrected.actions[1].heroId, 9);
  assert.equal(corrected.actions[7].heroId, 8);
  await req(path + '/action', 'POST', { heroId: 8, stepIndex: 2 }, 400);
  await req(path, 'PUT', { revision: saved.revision, title: '过时' }, 409);
  await req(path, 'PUT', { radiantPlayerIds: [1, null, 2, 4] }, 400);
  await req(path, 'PUT', { direPlayerIds: [3] }, 400);
  const updated = await req(path, 'PUT', {
    title: '第二局',
    notes: '新备注',
    ourSide: 'dire',
    direPlayerIds: [3, 4, null, null, null],
  });
  assert.equal(updated.actions.length, 8);
  assert.equal(updated.radiantTeamId, team.id);
  assert.deepEqual(
    (await req('/bp/recommend', 'POST', { sessionId: saved.id })).currentStep,
    updated.currentStep,
  );
  assert.equal((await req(path + '/undo', 'POST')).actions.length, 7);
  const flip = await req(path, 'PUT', { firstPickSide: 'radiant' });
  assert.equal(flip.actions[0].side, 'radiant');
  assert.equal(
    db.prepare('SELECT side FROM draft_actions WHERE step_index=1').get()?.side,
    'radiant',
  );
  const reset = await req(path + '/reset', 'POST');
  assert.deepEqual(reset.actions, []);
  assert.equal(reset.currentStep.step, 1);
  await req(path + '/undo', 'POST', {}, 400);
  const second = await req('/bp/sessions', 'POST', { title: '另一局' }, 201);
  assert.equal((await req('/bp/sessions'))[0].id, second.id);
  const actions = heroSnapshot.slice(0, 24).map((h) => ({ heroId: h.id }));
  const done = await req(path, 'PUT', { actions });
  assert.equal(done.status, 'completed');
  assert.equal(done.currentStep.step, 24);
  const result = await req('/bp/recommend', 'POST', { sessionId: saved.id });
  assert.equal(result.currentStep.isCompleted, true);
  assert.deepEqual(result.pickRecommendations, []);
  await req(path + '/action', 'POST', { heroId: 26 }, 400);
  await req(path, 'PUT', { actions: [{ heroId: 1 }, { heroId: 1 }] }, 400);
  assert.equal((await req(path)).actions.length, 24);
  await req('/players/2', 'DELETE', undefined, 204);
  assert.deepEqual((await req(path)).radiantPlayerIds, [1, null, null, null, null]);
  await req(path, 'DELETE', undefined, 204);
  await req(path, 'GET', undefined, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_actions').get()?.n, 0);
});
test('情报卡保留赛事绝活，按同场同阵营统计组合，仅计入位置吻合的摇摆选手', async (t) => {
  const { db, req } = await fixture(t);
  players(db, 5);
  for (let i = 1; i <= 8; i++)
    tournament(db, i, i === 8 ? 'radiant' : 'dire', [
      [1, 94, 'dire'],
      [2, 27, 'dire'],
      [3, 26, 'dire'],
      [4, 2, 'radiant'],
    ]);
  tournament(db, 9, 'radiant', [[1, 94, 'radiant']]);
  pubHero(db, 1, 1, 14, 6);
  pubHero(db, 2, 94, 40, 27);
  pubHero(db, 3, 27, 40, 27);
  const input = {
    ourSide: 'radiant',
    firstPickSide: 'dire',
    direPlayerIds: [1, null, 4, 2, 3],
    actions: [],
  };
  const intel = await req('/bp/recommend', 'POST', input);
  const signature = intel.banRecommendations.find((h: {heroId: number}) => h.heroId === 94);
  assert.equal(signature?.banCategory, 'player_signature');
  const card = intel.scoutingCard,
    top = card.topBans.find((h: {heroId: number}) => h.heroId === 94);
  assert.equal(top.owner.playerId, 1);
  assert.equal(top.tournament.games, 9);
  assert.equal(top.tournament.wins, 8);
  assert.equal(top.pub.games, 0);
  assert.ok(top.score > 0);
  assert.deepEqual(
    card.flexPicks
      .find((f: { heroId: number }) => f.heroId === 27)
      .players.map((p: { role: number }) => p.role).sort(),
    [4, 5],
  );
  assert.ok(
    card.comfortCombos.some(
      (c: { heroIds: number[]; games: number; winrate: number }) =>
        c.heroIds.join(',') === '26,27,94' && c.games === 8 && c.winrate === 87.5,
    ),
  );
  assert.ok(card.comfortCombos.some((c: { heroIds: number[] }) => c.heroIds.length === 2));
  assert.ok(!card.comfortCombos.some((c: { heroIds: number[] }) => c.heroIds.includes(2)));
  assert.deepEqual(card.sideProfile.dire, { games: 24, wins: 21, winrate: 87.5 });
  assert.equal(card.sideProfile.radiant.games, 9);
  assert.equal(card.sideProfile.currentSide, 'dire');
  await req('/settings', 'PUT', { tournamentMatchWeight: 0 });
  const fresh = await req('/bp/recommend', 'POST', input);
  const lionScore = (r: typeof intel) => r.scoutingCard.topBans.find((h: {heroId: number}) => h.heroId === 26).score;
  assert.ok(lionScore(fresh) < lionScore(intel));
  const swapped = await req('/bp/recommend', 'POST', { ...input, ourSide: 'dire' });
  assert.deepEqual(swapped.scoutingCard.topBans, []);
});
test('反向对位提升针对已亮核心的禁选分；空矩阵保留离线评分，已用英雄排除', async (t) => {
  const { db } = await fixture(t);
  players(db, 2);
  pubHero(db, 1, 27, 80, 45);
  pubHero(db, 2, 26, 80, 45);
  const draft = normalizeDraft(db, {
    radiantPlayerIds: [null, null, null, 1],
    direPlayerIds: [null, null, null, 2],
    actions: [2, 3, 4, 5, 6, 7, 8, 94, 1].map((heroId) => ({ heroId })),
  });
  const before = recommend(db, draft);
  assert.ok(!before.lineupAudit.warnings.some((w) => w.includes('1 号位核心')));
  assert.ok(before.lineupAudit.warnings.some((w) => w.includes('先手')));
  assert.equal(before.currentStep.phase, 2);
  db.exec("INSERT INTO hero_matchups VALUES(94,26,100,15,'a'),(1,27,100,10,'a')");
  const after = recommend(db, draft);
  for (const [key, id, target] of [
    ['banRecommendations', 26, '美杜莎'],
    ['pickRecommendations', 27, '敌法师'],
  ] as const) {
    const high = after[key].find((h) => h.heroId === id)!,
      low = before[key].find((h) => h.heroId === id)!;
    assert.ok(high.score > low.score);
    assert.ok(high.reasons.some((r) => r.includes(target)));
    assert.equal(after[key].length, 10);
    assert.ok(
      after[key].every(
        (h) => h.score >= 0 && h.score <= 100 && !draft.actions.some((a) => a.heroId === h.heroId),
      ),
    );
  }
  const pick = after.pickRecommendations.find((h) => h.heroId === 27)!;
  assert.equal(pick.suggestedPlayerId, 1);
  assert.equal(pick.suggestedRole, 4);
  assert.equal(after.banRecommendations.find(h => h.heroId === 26)?.targetPlayers[0].playerId, 2);
});
test('位置和职能缺口影响同一英雄评分；已占位置不再推荐同一选手', async (t) => {
  const { db } = await fixture(t);
  players(db, 2);
  pubHero(db, 1, 27, 60, 40);
  pubHero(db, 2, 26, 40, 28);
  const base = {
    radiantPlayerIds: [null, null, null, 1, 2],
    actions: [1, 2, 3, 4, 5, 6, 7].map((heroId) => ({ heroId })),
  };
  const before = recommend(db, normalizeDraft(db, base));
  assert.deepEqual(before.lineupAudit.missingRoles, [1, 2, 3, 4, 5]);
  for (const word of ['1 号位核心', '硬控', '推进'])
    assert.ok(before.lineupAudit.warnings.some((w) => w.includes(word)));
  const pick = before.pickRecommendations.find((h) => h.heroId === 27)!;
  assert.ok(pick.reasons.some((r) => r.includes('推进拆塔')));
  const taken = recommend(
    db,
    normalizeDraft(db, {
      ...base,
      actions: [...base.actions, { heroId: 52, roleHint: 4, assignedPlayerId: 1 }],
    }),
  );
  assert.ok(
    taken.lineupAudit.coveredRoles.includes(4) &&
      taken.lineupAudit.tagCounts.stun &&
      taken.lineupAudit.tagCounts.push,
  );
  assert.ok(!taken.lineupAudit.warnings.some((w) => w.includes('推进')));
  assert.ok(
    taken.pickRecommendations.every((h) => h.suggestedRole !== 4 && h.suggestedPlayerId !== 1),
  );
  assert.ok((taken.pickRecommendations.find((h) => h.heroId === 27)?.score ?? 0) < pick.score);
});
test('关闭并重开 SQLite 文件后，独立阵容、备注与选手归属完整保留', () => {
  const directory = mkdtempSync(join(root, '.bp-session-'));
  const file = join(directory, 'draft.sqlite');
  try {
    const first = openDb(file);
    try {
      players(first, 2);
      const draft = normalizeDraft(first, {
        title: '复盘',
        notes: '夜魇先选',
        firstPickSide: 'dire',
        direPlayerIds: [null, 2],
        radiantPlayerIds: [1],
        actions: [
          ...Array.from({ length: 7 }, (_, i) => ({ heroId: i + 1 })),
          { heroId: 8, assignedPlayerId: 2, roleHint: 2 },
        ],
      });
      transaction(first, () => writeSession(first, draft));
    } finally {
      first.close();
    }
    const reopened = openDb(file);
    try {
      const d = readSession(reopened, 1);
      assert.deepEqual(d.direPlayerIds, [null, 2, null, null, null]);
      assert.equal(d.notes, '夜魇先选');
      assert.equal(d.actions[7].assignedPlayerId, 2);
      assert.equal(d.timeline[7].side, 'dire');
      assert.equal(d.currentStep.step, 9);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});
test('按需同步去重，复用 HTTP 缓存，错误批次回滚且保留已同步英雄', async (t) => {
  const calls: string[] = [];
  const { db, req } = await fixture(t, async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    return Response.json(
      path.includes('/2/')
        ? [
            { hero_id: 4, games_played: 9, wins: 8 },
            { hero_id: 5, games_played: 1, wins: 2 },
          ]
        : [{ hero_id: 2, games_played: 100, wins: 60 }],
    );
  });
  const route = '/heroes/matchups/sync';
  await req(route, 'POST', [], 400);
  const result = await req(route, 'POST', { heroIds: [1, 1, 2, 3] });
  assert.equal(result.synced, 1);
  assert.equal(result.requested, 3);
  assert.match(result.results[1].error, /格式异常/);
  assert.deepEqual(calls, ['/api/heroes/1/matchups', '/api/heroes/2/matchups']);
  await req(route, 'POST', { heroIds: [1] });
  assert.equal(calls.length, 2);
  assert.deepEqual(
    db
      .prepare('SELECT hero_id,against_hero_id,wins FROM hero_matchups')
      .all()
      .map((r) => ({ ...r })),
    [{ hero_id: 1, against_hero_id: 2, wins: 60 }],
  );
  await req(route, 'POST', { heroIds: [9999] }, 400);
  await req(route, 'POST', { heroIds: [] });
});
test('备份兼容二期空槽，三期精确往返，损坏的选手槽位不会覆盖原局', async (t) => {
  const { db, req } = await fixture(t);
  players(db, 1);
  const d = await req(
    '/bp/sessions',
    'POST',
    { radiantPlayerIds: [null, 1], actions: [{ heroId: 4 }] },
    201,
  );
  const snap = await req('/backup/export');
  await req('/backup/import', 'POST', snap);
  assert.deepEqual(await req('/bp/sessions/' + d.id), d);
  const bad = structuredClone(snap);
  bad.draft_sessions[0].radiant_players_json = '[1,1,null,null,null]';
  await req('/backup/import', 'POST', bad, 400);
  assert.deepEqual(await req('/bp/sessions/' + d.id), d);
  const duplicate = structuredClone(snap);
  duplicate.draft_actions.push({
    ...duplicate.draft_actions[0],
    id: 2,
    step_index: 2,
    side: 'dire',
    is_first_pick_team: 0,
  });
  await req('/backup/import', 'POST', duplicate, 400);
  assert.deepEqual(await req('/bp/sessions/' + d.id), d);
  snap.version = 2;
  for (const key of ['revision', 'radiant_players_json', 'dire_players_json'])
    delete snap.draft_sessions[0][key];
  await req('/backup/import', 'POST', snap);
  assert.deepEqual((await req('/bp/sessions/' + d.id)).radiantPlayerIds, Array(5).fill(null));
});
test('完整十人阵容、本地全英雄对位缓存下的推荐耗时', async (t) => {
  const { db, req } = await fixture(t);
  players(db, 10);
  const put = db.prepare("INSERT INTO hero_matchups VALUES(?,?,100,54,'a')");
  for (const h of heroSnapshot) {
    for (let id = 1; id <= 10; id++) pubHero(db, id, h.id, 50, 28);
    for (const other of heroSnapshot) if (h !== other) put.run(h.id, other.id);
  }
  const draft = normalizeDraft(db, {
    radiantPlayerIds: [1, 2, 3, 4, 5],
    direPlayerIds: [6, 7, 8, 9, 10],
    actions: heroSnapshot.slice(0, 16).map((h) => ({ heroId: h.id })),
  });
  recommend(db, draft);
  const times = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    recommend(db, draft);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  t.diagnostic(
    '25 次本地热缓存推荐，中位 ' +
      times[12].toFixed(2) +
      ' ms，P95 ' +
      times[23].toFixed(2) +
      ' ms，最大 ' +
      times[24].toFixed(2) +
      ' ms',
  );
  assert.ok(times[23] < 100);
  const roundTrips = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const response = await req('/bp/recommend', 'POST', {
      ...draft,
      actions: draft.actions.slice(0, 9 + (i % 8)),
    });
    roundTrips.push(performance.now() - start);
    assert.equal(response.banRecommendations.length, 10);
  }
  roundTrips.sort((a, b) => a - b);
  t.diagnostic(
    '15 次本机 HTTP 草稿推荐（含解析响应），中位 ' +
      roundTrips[7].toFixed(2) +
      ' ms，最大 ' +
      roundTrips[14].toFixed(2) +
      ' ms',
  );
  assert.ok(roundTrips[14] < 100);
});
