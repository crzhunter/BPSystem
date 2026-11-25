import type { DatabaseSync } from 'node:sqlite';
import { heroTags } from '../data/heroTags.ts';
import type { ReplayParserAdapter } from './replayAdapter.ts';

type Side = 'radiant' | 'dire';
export type ReplayFilters = {
  matchId?: number;
  teamId?: number;
  playerId?: number;
  heroId?: number;
  tag?: string;
  side: Side | 'all';
  wardType: 'obs' | 'sen' | 'both';
  phase: 'all' | 'early' | 'mid' | 'late';
  roleScope: 'cores' | 'all';
};
type Participant = {
  matchId: number;
  tag: string;
  hasParsed: number;
  slot: number;
  side: Side;
  heroId: number;
  heroName: string;
  playerName: string;
  accountId: number | null;
  roles: string | null;
  gpm: number | null;
  xpm: number | null;
  laneRole: number | null;
};
type Point = { nx: number; ny: number };
type WardPoint = Point &
  Pick<Participant, 'side' | 'matchId' | 'heroId' | 'heroName' | 'playerName' | 'accountId'> & {
    time: number;
    rawX: number;
    rawY: number;
    wardType: 'obs' | 'sen';
  };

export function normalizeCoordinates(x: number, y: number): Point {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { nx: clamp((x - 64) / 128), ny: clamp(1 - (y - 64) / 128) };
}
function participants(db: DatabaseSync, f: ReplayFilters) {
  const where = ["m.source='tournament'"],
    params: (string | number)[] = [];
  for (const [column, value] of [
    ['m.match_id', f.matchId],
    ['m.tag', f.tag],
    ['p.id', f.playerId],
    ['mp.hero_id', f.heroId],
    ['mp.side', f.side === 'all' ? undefined : f.side],
  ] as const) {
    if (value !== undefined && value !== '') {
      where.push(column + '=?');
      params.push(value);
    }
  }
  // 战队预设没有历史战队 ID；只统计当前首发与替补本人所在的实际阵营。
  if (f.teamId !== undefined) {
    where.push('EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=? AND tm.player_id=p.id)');
    params.push(f.teamId);
  }
  const rows = db
    .prepare(
      `SELECT m.match_id matchId,m.tag,m.has_parsed hasParsed,mp.player_slot slot,
      mp.side,mp.hero_id heroId,COALESCE(NULLIF(h.cn_name,''),'英雄 ' || mp.hero_id) heroName,
      COALESCE(NULLIF(p.nickname,''),NULLIF(mp.personaname,''),CAST(mp.account_id AS TEXT),'匿名选手') playerName,
      mp.account_id accountId,h.roles_json roles,mp.gpm,mp.xpm,mp.lane_role laneRole
    FROM matches m LEFT JOIN match_players mp ON mp.match_id=m.match_id
    LEFT JOIN players p ON p.account_id=mp.account_id LEFT JOIN heroes h ON h.id=mp.hero_id
    WHERE ${where.join(' AND ')} ORDER BY m.match_id DESC,mp.player_slot`,
    )
    .all(...params) as (
    Participant | (Pick<Participant, 'matchId' | 'tag' | 'hasParsed'> & { slot: null })
  )[];
  const matches = new Map<number, { tag: string; hasParsed: boolean; players: Participant[] }>();
  for (const p of rows) {
    let group = matches.get(p.matchId);
    if (!group) {
      group = { tag: p.tag, hasParsed: !!p.hasParsed, players: [] };
      matches.set(p.matchId, group);
    }
    // 早期备份可只有比赛主记录；未指定选手或阵营时，这些比赛也可以请求解析。
    if (p.slot != null) group.players.push(p);
  }
  return matches;
}
const zones = ['上路/优势路', '中路', '下路', '天辉野区', '夜魇野区', '河道与肉山周边'] as const;
// 以地图坐标近似划分互斥区域；中路优先，河道沿左上到右下的对角线。
function zone({ nx: x, ny: y }: Point) {
  if (Math.abs(x + y - 1) <= 0.085) return 1;
  if (Math.abs(x - y) <= 0.09) return 5;
  if (x < 0.16 || y < 0.16) return 0;
  if (x > 0.84 || y > 0.84) return 2;
  return y > x ? 3 : 4;
}
function inPhase(time: number, phase: ReplayFilters['phase']) {
  if (phase === 'early') return time >= 0 && time < 600;
  if (phase === 'mid') return time >= 600 && time < 1500;
  if (phase === 'late') return time >= 1500;
  return true;
}
export async function wardHeatmap(db: DatabaseSync, adapter: ReplayParserAdapter, f: ReplayFilters) {
  const matches = participants(db, f);
  const points: WardPoint[] = [],
    unparsedMatches: { matchId: number; tag: string }[] = [];
  const clusters = new Map<number, { nx: number; ny: number; count: number }>();
  const summary = {
    matchCount: matches.size,
    parsedMatchCount: 0,
    obsCount: 0,
    senCount: 0,
    radiantCount: 0,
    direCount: 0,
  };
  for (const [matchId, { players, tag, hasParsed }] of matches) {
    if (!hasParsed) {
      unparsedMatches.push({ matchId, tag });
      continue;
    }
    summary.parsedMatchCount++;
    const bySlot = new Map(players.map((p) => [p.slot, p]));
    for (const track of await adapter.parseReplay(matchId, [...bySlot.keys()], 'wards')) {
      const p = bySlot.get(track.playerSlot);
      if (!p) continue;
      for (const wardType of ['obs', 'sen'] as const) {
        if (f.wardType !== 'both' && f.wardType !== wardType) continue;
        for (const { x, y, time } of track[wardType]) {
          if (!inPhase(time, f.phase)) continue;
          const { nx, ny } = normalizeCoordinates(x, y);
          points.push({
            nx,
            ny,
            rawX: x,
            rawY: y,
            time,
            wardType,
            side: p.side,
            matchId,
            heroId: p.heroId,
            heroName: p.heroName,
            playerName: p.playerName,
            accountId: p.accountId,
          });
          summary[wardType === 'obs' ? 'obsCount' : 'senCount']++;
          summary[p.side === 'radiant' ? 'radiantCount' : 'direCount']++;
          const key = Math.min(7, Math.floor(nx * 8)) + 8 * Math.min(7, Math.floor(ny * 8));
          const cluster = clusters.get(key) ?? { nx: 0, ny: 0, count: 0 };
          cluster.nx += nx;
          cluster.ny += ny;
          cluster.count++;
          clusters.set(key, cluster);
        }
      }
    }
  }
  const hotspots = [...clusters.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => {
      const center = { nx: c.nx / c.count, ny: c.ny / c.count };
      return { ...center, count: c.count, zone: zones[zone(center)] };
    });
  return { summary, points, hotspots, unparsedMatches };
}

export async function farmingHeatmap(db: DatabaseSync, adapter: ReplayParserAdapter, f: ReplayFilters) {
  const grid = new Map<string, Point & { rawX: number; rawY: number; weight: number }>();
  const weights = zones.map(() => 0);
  let totalWeight = 0,
    peak = 0,
    matchCount = 0,
    samplePlayers = 0,
    gold = 0,
    xp = 0,
    goldN = 0,
    xpN = 0;
  for (const [matchId, { players, hasParsed }] of participants(db, f)) {
    if (!hasParsed) continue;
    const selected = players.filter(
      (p) =>
        f.roleScope === 'all' ||
        (p.laneRole == null
          ? heroTags(p.heroId, JSON.parse(p.roles ?? '[]')).typicalRoles.some((r) => r >= 1 && r <= 3)
          : p.laneRole >= 1 && p.laneRole <= 3),
    );
    const bySlot = new Map(selected.map((p) => [p.slot, p]));
    let contributed = false;
    for (const track of await adapter.parseReplay(matchId, [...bySlot.keys()], 'farming')) {
      const p = bySlot.get(track.playerSlot);
      if (!p || !track.positions.length) continue;
      contributed = true;
      samplePlayers++;
      if (p.gpm !== null) {
        gold += p.gpm;
        goldN++;
      }
      if (p.xpm !== null) {
        xp += p.xpm;
        xpN++;
      }
      for (const { x, y, weight } of track.positions) {
        const key = x + ',' + y;
        const cell = grid.get(key) ?? { ...normalizeCoordinates(x, y), rawX: x, rawY: y, weight: 0 };
        cell.weight += weight;
        totalWeight += weight;
        weights[zone(cell)] += weight;
        peak = Math.max(peak, cell.weight);
        grid.set(key, cell);
      }
    }
    if (contributed) matchCount++;
  }
  return {
    summary: {
      matchCount,
      samplePlayers,
      avgGpm: goldN ? gold / goldN : null,
      avgXpm: xpN ? xp / xpN : null,
      totalWeight,
    },
    cells: [...grid.values()].map((c) => ({ ...c, intensity: c.weight / peak })),
    zoneBreakdown: zones.map((name, i) => ({
      zone: name,
      weight: weights[i],
      percentage: totalWeight ? (100 * weights[i]) / totalWeight : 0,
    })),
  };
}
