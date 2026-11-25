import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDb } from '../src/db/index.ts';
import { migrations } from '../src/db/schema.ts';
import { listHeroes } from '../src/data/catalog.ts';
import { patch742Id, patch742StartTime } from '../src/data/heroMeta.ts';
import { cmOrder } from '../src/data/cmOrder.ts';
import { analytics } from '../src/services/analytics.ts';
import { recommend } from '../src/services/bpEngine.ts';
import { normalizeDraft } from '../src/services/draftState.ts';
import { OpenDotaClient } from '../src/services/opendota.ts';
import { readSettings } from '../src/services/settings.ts';
import { analyzeLineups, diagnose } from '../src/services/composition.ts';
import { createApp } from '../src/app.ts';

function fixture(t: TestContext) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const heroes = listHeroes(db);
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const player = () =>
    Number(
      db
        .prepare(
          "INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES((SELECT COUNT(*)+100 FROM players),'测试选手','a','a')",
        )
        .run().lastInsertRowid,
    );
  const pool = (
    id: number,
    hero: number,
    games: number,
    wins: number,
    current: number,
    currentWins: number,
  ) =>
    db
      .prepare("INSERT INTO player_pub_heroes VALUES(?,?,?,?,?,0,0,0,0,'a',?,?)")
      .run(id, hero, games, wins, patch742StartTime - 1, current, currentWins);
  return { db, heroes, byId, player, pool };
}
// 禁英雄与两边的指定选人保持互斥，同一组分工可推进到任意验收手数。
function scenario(
  step: number,
  us = [
    [5, 5],
    [26, 4],
    [2, 3],
    [17, 2],
    [6, 1],
  ],
  them = [
    [12, 1],
    [36, 2],
    [38, 3],
    [27, 4],
    [50, 5],
  ],
) {
  const used = new Set([...us, ...them].map(([hero]) => hero));
  const bans = [
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 119, 120, 121, 123, 128,
  ].filter((id) => !used.has(id));
  const sides = { radiant: [...us], dire: [...them] };
  return cmOrder('radiant')
    .slice(0, step - 1)
    .map((s) => {
      if (s.actionType === 'ban') return { heroId: bans.shift()! };
      const [heroId, roleHint] = sides[s.side].shift()!;
      return { heroId, roleHint };
    });
}

test('v4 库原位迁移两次仍保留阵容、存档和比赛，生涯胜场不会写入版本列', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)',
  );
  for (let i = 0; i < 4; i++) {
    db.exec(migrations[i]);
    db.prepare("INSERT INTO schema_migrations VALUES(?,'old')").run(i + 1);
  }
  db.exec(`INSERT INTO heroes(id,name,localized_name,updated_at) VALUES(1,'a','a','old');
    INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(123,'队长','old','old');
    INSERT INTO teams(name,created_at,updated_at) VALUES('社区队','old','old');
    INSERT INTO team_members(team_id,player_id,slot,created_at) VALUES(1,1,4,'old');
    INSERT INTO draft_sessions(title,created_at,updated_at,radiant_team_id) VALUES('决胜局','old','old',1);
    INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,hero_id,created_at)
      VALUES(1,1,1,'ban','radiant',1,1,'old');
    INSERT INTO matches(match_id,imported_at) VALUES(777,'old');
    INSERT INTO player_pub_heroes VALUES(1,1,300,190,100,0,0,0,0,'old');
    INSERT INTO player_pub_matches(player_id,match_id,hero_id,player_slot,side,is_radiant,win,start_time)
      VALUES(1,99,1,0,'radiant',1,1,1795037287)`);
  migrate(db);
  migrate(db);
  assert.deepEqual(
    { ...db.prepare('SELECT games,wins,patch_games,patch_wins FROM player_pub_heroes').get() },
    { games: 300, wins: 190, patch_games: 0, patch_wins: 0 },
  );
  assert.equal(analytics(db, 1).heroPool[0].patch742Games, 1);
  assert.equal(db.prepare('SELECT patch FROM player_pub_matches').get()?.patch, 61);
  for (const table of [
    'players',
    'teams',
    'team_members',
    'draft_sessions',
    'draft_actions',
    'matches',
  ])
    assert.equal(db.prepare('SELECT count(*) n FROM ' + table).get()?.n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('版本边界按明确补丁优先，旧库无 patch 时按秒回退，300 场旧绝活最多三分', (t) => {
  const f = fixture(t),
    id = f.player(),
    weak = f.heroes.find((h) => h.meta.tier === 'T3' && !h.meta.proContestedRate)!;
  assert.equal(patch742Id, 61);
  assert.equal(patch742StartTime, Math.floor(Date.parse('2026-11-18T21:28:07.019Z') / 1000));
  f.pool(id, weak.id, 300, 290, 0, 0);
  const hero = weak.id === 27 ? 26 : 27;
  const put = f.db.prepare(
    "INSERT INTO player_pub_matches(player_id,match_id,hero_id,player_slot,side,is_radiant,win,start_time,patch) VALUES(1,?,?,0,'radiant',1,1,?,?)",
  );
  [
    [1, patch742StartTime - 1, null],
    [2, patch742StartTime, null],
    [3, patch742StartTime + 10, 60],
    [4, patch742StartTime - 10, 62],
  ].forEach(([m, ts, p]) => put.run(m, hero, ts, p));
  const a = analytics(f.db, id);
  const old = a.heroPool.find((h) => h.heroId === weak.id)!,
    current = a.heroPool.find((h) => h.heroId === hero)!;
  assert.equal(old.isPatch742Sample, false);
  assert.equal(old.patch742Games, 0);
  assert.ok(old.weightedScore > 0 && old.weightedScore <= 3);
  assert.deepEqual([current.patch742Games, current.patch742Wins, a.recentForm.games], [2, 2, 2]);
  assert.ok(current.isPatch742Sample && current.weightedScore > old.weightedScore);
  const slots = Array(5).fill(null);
  slots[weak.typicalRoles[0] - 1] = id;
  const r = recommend(
    f.db,
    normalizeDraft(f.db, { radiantPlayerIds: slots }),
    undefined,
    weak.typicalRoles[0] as 1,
  );
  assert.ok(!r.pickRecommendations.slice(0, 3).some((h) => h.heroId === weak.id));
});

test('同步逐补丁取完整汇总，包含未来版本，逐场投影 patch，重复拉取不重复计分', async (t) => {
  const f = fixture(t),
    id = f.player();
  f.pool(id, 1, 300, 200, 0, 0);
  f.db.prepare("INSERT INTO settings VALUES('patch_742_scope',?,'a')").run(
    JSON.stringify({
      id: 61,
      startTime: patch742StartTime,
      ids: [61, 62],
      calendar: [
        { id: 61, start: patch742StartTime },
        { id: 62, start: patch742StartTime + 200 },
      ],
      verifiedThrough: patch742StartTime + 300,
    }),
  );
  const seen: URL[] = [];
  const client = new OpenDotaClient(f.db, {
    fetch: async (input) => {
      const u = new URL(String(input));
      seen.push(u);
      const patch = u.searchParams.get('patch');
      if (u.pathname.endsWith('/heroes'))
        return Response.json([
          {
            hero_id: 1,
            games: patch === '61' ? 4 : patch === '62' ? 5 : 310,
            win: patch ? 2 : 205,
          },
        ]);
      if (u.pathname.endsWith('/matches'))
        return Response.json([
          {
            hero_id: 1,
            match_id: 701,
            player_slot: 0,
            radiant_win: true,
            start_time: patch742StartTime + 100,
            patch: 62,
          },
          {
            hero_id: 1,
            match_id: 702,
            player_slot: 0,
            radiant_win: false,
            start_time: patch742StartTime + 15,
          },
          {
            hero_id: 1,
            match_id: 703,
            player_slot: 0,
            radiant_win: false,
            start_time: patch742StartTime + 305,
          },
        ]);
      return Response.json({ profile: { personaname: '选手' } });
    },
  });
  await client.syncPlayer(id);
  await client.syncPlayer(id);
  assert.deepEqual(
    seen.filter((u) => u.searchParams.has('patch')).map((u) => u.searchParams.get('patch')),
    ['61', '62'],
  );
  assert.ok(
    seen
      .find((u) => u.pathname.endsWith('/matches'))
      ?.searchParams.getAll('project')
      .includes('patch'),
  );
  const h = analytics(f.db, id).heroPool[0];
  assert.deepEqual([h.pub.games, h.patch742Games, h.patch742Wins], [310, 9, 4]);
  assert.deepEqual(
    f.db
      .prepare('SELECT patch FROM player_pub_matches ORDER BY match_id')
      .all()
      .map((r) => r.patch),
    [62, 61, null],
  );
});

test('版本、阵容和对位占 82%，选手贡献受上限和位置约束，旧权重超界时回到安全范围', (t) => {
  const f = fixture(t),
    id = f.player(),
    other = f.player();
  f.pool(id, 7, 300, 280, 80, 60);
  f.pool(other, 7, 300, 290, 90, 70);
  const d = normalizeDraft(f.db, { radiantPlayerIds: [other, null, null, id] });
  const r = recommend(f.db, d, undefined, 4);
  const w = r.weights.pick;
  assert.equal(w.player, 0.18);
  assert.ok(Math.abs(w.meta + w.composition + w.matchup + w.strategy - 0.82) < 1e-9);
  assert.equal(r.weights.ban.player, 0);
  const hero = r.pickRecommendations.find((h) => h.heroId === 7)!;
  assert.ok(hero.playerContribution > 0 && hero.playerContribution <= 18);
  assert.deepEqual(
    hero.targetPlayers.map((p) => p.playerId),
    [id],
  );
  const vacant = normalizeDraft(f.db, {}),
    base = recommend(f.db, vacant, undefined, 4).pickRecommendations.find((h) => h.heroId === 7)!;
  assert.ok(Math.abs(hero.score - (base.score * 0.82 + hero.playerContribution)) < 0.2);
  const put = f.db.prepare("INSERT OR REPLACE INTO settings VALUES('player_pool_weight',?,'a')");
  for (const [legacy, expected] of [
    ['0.42', 0.2],
    ['0.01', 0.15],
    ['坏值', 0.18],
  ] as const) {
    put.run(legacy);
    assert.equal(readSettings(f.db).playerPoolWeight, expected);
  }
  const actions = scenario(10);
  Object.assign(actions[7], { assignedPlayerId: id, roleHint: 4 });
  const locked = recommend(f.db, normalizeDraft(f.db, { ...d, actions }), undefined, 'support');
  assert.ok(
    locked.pickRecommendations.every((h) => !h.targetPlayers.some((p) => p.playerId === id)),
  );
});

test('第 8 手先抢辅助或强摇摆，第 13–18 手回避已满双辅，末手抓剩余核心对位', (t) => {
  const f = fixture(t);
  const at = (step: number) => recommend(f.db, normalizeDraft(f.db, { actions: scenario(step) }));
  const first = at(8);
  assert.deepEqual(first.effectiveRoleMode.targetRoles, [4, 5]);
  assert.ok(first.pickRecommendations.slice(0, 3).some((h) => h.suggestedRole >= 4));
  assert.ok(
    first.pickRecommendations
      .slice(0, 3)
      .every(
        (h) =>
          h.suggestedRole >= 4 ||
          (f.byId.get(h.heroId)!.typicalRoles.includes(3) &&
            ['T0', 'T1'].includes(h.tier) &&
            f.byId.get(h.heroId)!.typicalRoles.length > 1),
      ),
  );
  assert.deepEqual(at(15).roleModes.pick.targetRoles, [3]);
  assert.ok(at(16).pickRecommendations.every((h) => h.suggestedRole <= 2));
  const last = at(23);
  assert.deepEqual(last.roleModes.pick.targetRoles, [1]);
  assert.ok(last.pickRecommendations.every((h) => h.suggestedRole === 1));
  assert.ok(
    last.weights.pick.matchup > first.weights.pick.matchup &&
      last.pickRecommendations.some((h) => h.matchupDetails.length),
  );
  // 控制其他因素，用末手可见的敌核对位样本直接验证同一候选的得分变化。
  const candidate = last.pickRecommendations[0].heroId;
  const update = f.db.prepare('INSERT OR REPLACE INTO patch_matchups VALUES(?,?,200,?)');
  const score = () => at(23).pickRecommendations.find((h) => h.heroId === candidate)?.score ?? 0;
  for (const [enemy] of [[12], [36], [38], [27]]) update.run(candidate, enemy, 0);
  const losing = score();
  for (const [enemy] of [[12], [36], [38], [27]]) update.run(candidate, enemy, 200);
  assert.ok(score() > losing);
});

test('第 19 手禁敌方最后一号位，手动核心、辅助和五种单位置覆盖自动阶段', async (t) => {
  const f = fixture(t);
  const actions = scenario(19, undefined, [
    [50, 5],
    [27, 4],
    [38, 3],
    [39, 2],
    [6, 1],
  ]);
  const d = normalizeDraft(f.db, { actions }),
    r = recommend(f.db, d);
  assert.deepEqual(r.composition.enemy.missingRoles, [1]);
  assert.deepEqual(r.effectiveRoleMode.targetRoles, [1]);
  assert.ok(
    r.banRecommendations.length >= 3 &&
      r.banRecommendations.every((h) => h.suggestedRole === 1 && h.roleGroup !== 'support'),
  );
  const server = createApp(f.db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const post = (path: string, body: unknown) =>
      fetch('http://127.0.0.1:' + address.port + '/api/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const session = await (await post('bp/sessions', { actions: scenario(8) })).json();
    for (const mode of ['core', 'support', 1, 2, 3, 4, 5] as const) {
      const res = await post('bp/recommend', { sessionId: session.id, rolePreference: mode });
      assert.equal(res.status, 200);
      const data: typeof r = await res.json();
      const slots = mode === 'core' ? [1, 2, 3] : mode === 'support' ? [4, 5] : [mode];
      assert.deepEqual(data.effectiveRoleMode.targetRoles, slots);
      for (const rows of [data.pickRecommendations, data.banRecommendations]) {
        assert.ok(rows.length >= 3);
        assert.ok(
          rows.every(
            (h) =>
              slots.includes(h.suggestedRole) &&
              f.byId.get(h.heroId)!.typicalRoles.includes(h.suggestedRole) &&
              h.roleLabel.includes('号位'),
          ),
        );
      }
    }
    assert.equal((await post('bp/recommend', { rolePreference: 0 })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});

test('己方补强与敌方破阵对应具体机制，候选剔除双方已用英雄及全部禁用', (t) => {
  const f = fixture(t);
  const line = (ids: number[]) =>
    diagnose(ids.map((id) => ({ hero: f.byId.get(id)!, role: null })));
  const cases = [
    {
      us: [44, 38, 74, 14],
      them: [36, 59, 12],
      issues: ['save', 'catch', 'melee'],
      exploits: ['regen', 'summons', 'low-control'],
    },
    {
      us: [6, 35, 44],
      them: [22, 25, 101],
      issues: ['physical', 'front', 'teamfight'],
      exploits: ['backline'],
    },
    {
      us: [22, 25, 101],
      them: [1, 94, 67],
      issues: ['magic', 'save', 'push'],
      exploits: ['tempo'],
    },
  ];
  for (const c of cases) {
    const banned = new Set([...c.us, ...c.them, 68, 7]);
    const a = analyzeLineups(
      line(c.us),
      line(c.them),
      f.heroes.filter((h) => !banned.has(h.id)),
    );
    for (const id of c.issues)
      assert.ok(
        a.our.weaknesses.some((w) => w.id === id),
        id,
      );
    for (const id of c.exploits)
      assert.ok(
        a.enemy.exploitableWeaknesses.some((w) => w.id === id),
        id,
      );
    for (const chips of [
      ...a.our.weaknesses.map((w) => w.fixHeroes),
      ...a.enemy.exploitableWeaknesses.map((w) => w.counterHeroes),
    ]) {
      assert.ok(chips.length >= 2 && chips.length <= 3);
      for (const h of chips)
        assert.ok(!banned.has(h.heroId) && h.reason && h.role && h.cnName && h.portraitUrl);
    }
  }
  const complete = recommend(f.db, normalizeDraft(f.db, { actions: scenario(24) }));
  for (const w of complete.composition.our.weaknesses)
    assert.ok(w.fixHeroes.every((h) => !scenario(24).some((a) => a.heroId === h.heroId)));
});

test('胜率守恒、分项以天辉为正，敌我视角切换对称，双边亮两人后才显示三路对线', (t) => {
  const f = fixture(t);
  function view(step: number, ourSide = 'radiant') {
    return recommend(f.db, normalizeDraft(f.db, { ourSide, actions: scenario(step) }));
  }
  assert.ok(Math.abs(view(1).bpAdvantage.radiantWinProb - 50) < 1);
  assert.deepEqual(view(13).laneForecast, []);
  for (let step = 1; step <= 25; step++) {
    const r = view(step),
      { radiantWinProb, direWinProb, ...details } = r.bpAdvantage;
    assert.ok(
      radiantWinProb >= 30 && radiantWinProb <= 70 && direWinProb >= 30 && direWinProb <= 70,
    );
    assert.ok(Math.abs(radiantWinProb + direWinProb - 100) < 0.001 && details.summary.length);
    for (const edge of [
      details.metaEdge,
      details.matchupEdge,
      details.compositionEdge,
      details.sideEdge,
    ])
      assert.ok(Number.isFinite(edge));
    assert.equal(view(step, 'dire').bpAdvantage.radiantWinProb, radiantWinProb);
  }
  const lanes = view(25).laneForecast;
  assert.deepEqual(
    lanes.map((l) => l.location),
    ['下路', '中路', '上路'],
  );
  assert.deepEqual(
    view(25, 'dire').laneForecast.map((l) => l.location),
    ['上路', '中路', '下路'],
  );
  assert.deepEqual(
    lanes.map((l) => [...l.ourHeroes].sort((a, b) => a - b)),
    [[5, 6], [17], [2, 26]],
  );
  assert.deepEqual(
    lanes.map((l) => [...l.enemyHeroes].sort((a, b) => a - b)),
    [[27, 38], [36], [12, 50]],
  );
  assert.ok(
    lanes.every(
      (l) =>
        !l.partial &&
        l.score !== null &&
        ['强优', '小优', '均势', '小劣', '劣势'].includes(l.verdict),
    ),
  );
});
