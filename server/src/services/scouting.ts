import type { DatabaseSync } from 'node:sqlite';
import { analytics } from './analytics.ts';
import type { Slots } from './draftState.ts';
import type { Side } from '../data/cmOrder.ts';

export function scoutRoster(db: DatabaseSync, slots: Slots) {
  const player = db.prepare('SELECT nickname FROM players WHERE id=?');
  const members = slots.flatMap((id, i) => {
    if (id === null) return [];
    const stats = analytics(db, id);
    return [
      {
        playerId: id,
        role: i + 1,
        name: String(player.get(id)?.nickname),
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
export type Member = ReturnType<typeof scoutRoster>['members'][number];
export function comfortCombos(db: DatabaseSync, slots: Slots) {
  const records = db
    .prepare(
      `SELECT mp.match_id,mp.side,mp.hero_id,(m.radiant_win=mp.is_radiant) win
    FROM players p JOIN match_players mp ON mp.account_id=p.account_id JOIN matches m USING(match_id)
    WHERE p.id IN (?,?,?,?,?) AND m.source='tournament' AND m.radiant_win IS NOT NULL
    ORDER BY mp.match_id,mp.side,mp.hero_id`,
    )
    .all(...slots);
  const groups = new Map<string, { win: number; heroes: number[] }>();
  for (const row of records) {
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
