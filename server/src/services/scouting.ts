import type { DatabaseSync } from 'node:sqlite';
import { poolValue, type PoolKind } from './recommendation.ts';
import { analytics } from './analytics.ts';
import { inPatch742 } from '../data/heroMeta.ts';
import { patchScope } from './settings.ts';
import type { Slots } from './draftState.ts';
import type { Side } from '../data/cmOrder.ts';

export function scoutRoster(db: DatabaseSync, slots: Slots) {
  const player = db.prepare(
    "SELECT coalesce(nullif(alias,''),nickname) name FROM players WHERE id=?",
  );
  const members = slots.flatMap((id, i) => {
    if (id === null) return [];
    const stats = analytics(db, id);
    return [
      {
        playerId: id,
        role: i + 1,
        name: String(player.get(id)?.name),
        overrides: new Map(
          db
            .prepare('SELECT hero_id,kind FROM player_hero_overrides WHERE player_id=?')
            .all(id)
            .map((r) => [Number(r.hero_id), r.kind as PoolKind] as const),
        ),
        pool: new Map(stats.heroPool.map((h) => [h.heroId, h])),
        sides: stats.sideSplits.combined,
      },
    ];
  });
  function split(side: Side) {
    const games = members.reduce((n, m) => n + m.sides[side].games, 0);
    const wins = members.reduce((n, m) => n + m.sides[side].wins, 0);
    return { games, wins, winrate: games ? Math.round((1000 * wins) / games) / 10 : null };
  }
  return { members, radiant: split('radiant'), dire: split('dire') };
}
export function teamScouting(db: DatabaseSync, slots: Slots) {
  const { members } = scoutRoster(db, slots);
  // 只把至少三名现首发同边出战的赛事计为战队样本，每场每侧只记一次。
  const splits = db
    .prepare(
      `SELECT side,count(*) games,sum(win) wins FROM (
    SELECT mp.side, m.match_id, (m.radiant_win=mp.is_radiant) win FROM match_players mp
    JOIN matches m USING(match_id) JOIN players p USING(account_id)
    WHERE p.id IN (?,?,?,?,?) AND m.source='tournament' AND m.radiant_win IS NOT NULL
    GROUP BY m.match_id,mp.side HAVING count(DISTINCT p.id)>=3) GROUP BY side`,
    )
    .all(...slots);
  function split(side: Side) {
    const r = splits.find((s) => s.side === side),
      games = Number(r?.games ?? 0),
      wins = Number(r?.wins ?? 0);
    return { games, wins, winrate: games ? Math.round((1000 * wins) / games) / 10 : null };
  }
  const heroes = new Map<number, { heroId: number; players: string[]; score: number }>();
  const roles = slots.map((_, i) => {
    const m = members.find((member) => member.role === i + 1);
    let depth = 0;
    if (m)
      for (const id of new Set([...m.pool.keys(), ...m.overrides.keys()])) {
        const score = poolValue(m.overrides.get(id), m.pool.get(id)?.weightedScore ?? 0);
        if (score < 35) continue;
        depth++;
        const h = heroes.get(id) ?? { heroId: id, players: [], score: 0 };
        h.players.push(m.name);
        h.score = Math.max(h.score, score);
        heroes.set(id, h);
      }
    return {
      role: i + 1,
      name: m?.name ?? '',
      depth,
      diagnosis: !m
        ? '首发空缺'
        : !depth
          ? '暂无熟练英雄证据'
          : depth <= 2
            ? '英雄池集中，可优先封锁'
            : '英雄池较宽，优先拆配合',
    };
  });
  const ranked = [...heroes.values()].sort((a, b) => b.score - a.score || a.heroId - b.heroId);
  return {
    topBans: ranked.slice(0, 5),
    flexPicks: ranked.filter((h) => h.players.length > 1),
    roles,
    radiant: split('radiant'),
    dire: split('dire'),
  };
}
export type Member = ReturnType<typeof scoutRoster>['members'][number];
export function comfortCombos(db: DatabaseSync, slots: Slots) {
  const records = db
    .prepare(
      `SELECT mp.match_id,mp.side,mp.hero_id,m.patch,m.start_time,(m.radiant_win=mp.is_radiant) win
    FROM players p JOIN match_players mp ON mp.account_id=p.account_id JOIN matches m USING(match_id)
    WHERE p.id IN (?,?,?,?,?) AND m.source='tournament' AND m.radiant_win IS NOT NULL
    ORDER BY mp.match_id,mp.side,mp.hero_id`,
    )
    .all(...slots);
  const groups = new Map<string, { win: number; heroes: number[] }>();
  const scope = patchScope(db);
  for (const row of records) {
    if (!inPatch742(row.patch, Number(row.start_time), scope)) continue;
    const key = row.match_id + '/' + row.side;
    const group = groups.get(key) ?? { win: Number(row.win), heroes: [] as number[] };
    group.heroes.push(Number(row.hero_id));
    groups.set(key, group);
  }
  const combos = new Map<string, { heroIds: number[]; games: number; wins: number }>();
  function add(heroIds: number[], win: number) {
    const key = heroIds.join(',');
    const combo = combos.get(key) ?? { heroIds, games: 0, wins: 0 };
    combo.games++;
    combo.wins += win;
    combos.set(key, combo);
  }
  for (const { heroes, win } of groups.values()) {
    for (let i = 0; i < heroes.length; i++)
      for (let j = i + 1; j < heroes.length; j++) {
        add([heroes[i], heroes[j]], win);
        for (let k = j + 1; k < heroes.length; k++) add([heroes[i], heroes[j], heroes[k]], win);
      }
  }
  // 两人和三人组合分别保留前三，避免高频二人组挤掉三人组。
  const ranked = [...combos.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
  return [2, 3]
    .flatMap((size) => ranked.filter((c) => c.heroIds.length === size).slice(0, 3))
    .map((c) => ({ ...c, winrate: Math.round((1000 * c.wins) / c.games) / 10 }));
}
