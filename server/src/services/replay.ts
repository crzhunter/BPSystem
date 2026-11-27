import type { DatabaseSync } from 'node:sqlite';
import { heroPortraitUrl, listItems } from '../data/catalog.ts';
import { heroTags } from '../data/heroTags.ts';
import { replayScope } from './replayScope.ts';
import { HttpError } from '../utils/input.ts';
import { readWardEvents, type ReplayParserAdapter } from './replayAdapter.ts';

type Side = 'radiant' | 'dire';
export type ReplayFilters = {
  matchId?: number;
  teamId?: number;
  playerId?: number;
  accountId?: number;
  playerSlot?: number;
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
    durationSec?: number;
    dewarded?: boolean | null;
    rawX: number;
    rawY: number;
    wardType: 'obs' | 'sen';
  };

export function replayPlayers(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT p.id,p.nickname,p.roles_json rolesJson,
    COUNT(DISTINCT m.match_id) parsedMatchCount FROM players p
    LEFT JOIN match_players mp ON mp.account_id=p.account_id
    LEFT JOIN matches m ON m.match_id=mp.match_id AND ${replayScope} AND m.has_parsed=1
    GROUP BY p.id ORDER BY parsedMatchCount DESC,p.nickname COLLATE NOCASE,p.id`,
    )
    .all()
    .map((p) => ({
      id: Number(p.id),
      nickname: String(p.nickname),
      roles: JSON.parse(String(p.rolesJson)) as number[],
      parsedMatchCount: Number(p.parsedMatchCount),
    }));
}

const participantName =
  "COALESCE(NULLIF(p.nickname,''),NULLIF(mp.personaname,''),CAST(mp.account_id AS TEXT),'匿名选手')";
const heroName = "COALESCE(NULLIF(h.cn_name,''),'英雄 ' || mp.hero_id)";
// 两个入口共用同一份参赛记录。只在比赛内使用槽位辨认匿名选手，避免合并不同人的样本。
function matchRows(
  db: DatabaseSync,
  column: 'p.id' | 'm.match_id',
  id: number,
  rich = false,
  limit?: number,
) {
  const items = rich ? new Map(listItems(db).map((i) => [i.id, i])) : null;
  const rows = db
    .prepare(
      `SELECT m.match_id matchId,m.tag,m.start_time startTime,m.duration,m.has_parsed hasParsed,
    mp.side,(m.radiant_win=mp.is_radiant) win,mp.hero_id heroId,${heroName} heroCnName,
    h.localized_name heroLocalizedName,h.name internalName,mp.kills,mp.deaths,mp.assists,mp.gpm,mp.xpm,
    ${rich ? 'm.source source,mp.items_json items,mp.item_neutral neutral,' : ''}
    mp.obs_log_json obs,mp.sen_log_json sen,
    mp.player_slot playerSlot,p.id playerId,mp.account_id accountId,${participantName} playerName
    FROM matches m JOIN match_players mp ON mp.match_id=m.match_id
    LEFT JOIN players p ON p.account_id=mp.account_id LEFT JOIN heroes h ON h.id=mp.hero_id
    WHERE ${replayScope} AND ${column}=?
    ORDER BY m.start_time DESC,m.match_id DESC,mp.player_slot ${limit ? 'LIMIT ' + limit : ''}`,
    )
    .iterate(id);
  return Array.from(rows, (r) => ({
    ...(items
      ? {
          source: r.source === 'pub' ? '路人' : '赛事',
          items: (JSON.parse(String(r.items)) as number[])
            .concat(Array(6).fill(0))
            .slice(0, 6)
            .map((id) => items.get(id) ?? null),
          neutralItem: items.get(Number(r.neutral)) ?? null,
        }
      : {}),
    matchId: Number(r.matchId),
    tag: String(r.tag),
    startTime: r.startTime as number | null,
    duration: r.duration as number | null,
    hasParsed: !!r.hasParsed,
    side: r.side as Side,
    win: !!r.win,
    resultKnown: r.win !== null,
    heroId: Number(r.heroId),
    heroCnName: String(r.heroCnName),
    heroLocalizedName: String(r.heroLocalizedName ?? r.heroCnName),
    heroPortraitUrl: r.internalName
      ? heroPortraitUrl(String(r.internalName))
      : 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/capsule_sm_120.jpg',
    kills: r.kills as number | null,
    deaths: r.deaths as number | null,
    assists: r.assists as number | null,
    gpm: r.gpm as number | null,
    xpm: r.xpm as number | null,
    obsCount: readWardEvents(String(r.obs)).length,
    senCount: readWardEvents(String(r.sen)).length,
    playerSlot: Number(r.playerSlot),
    playerId: r.playerId as number | null,
    accountId: r.accountId as number | null,
    playerName: String(r.playerName),
  }));
}
export function replayPlayerMatches(db: DatabaseSync, playerId: number, rich = false) {
  if (!db.prepare('SELECT 1 FROM players WHERE id=?').get(playerId))
    throw new HttpError(404, '选手不存在');
  return matchRows(db, 'p.id', playerId, rich);
}
export function recentPlayerMatches(db: DatabaseSync, playerId: number) {
  if (!db.prepare('SELECT 1 FROM players WHERE id=?').get(playerId))
    throw new HttpError(404, '选手不存在');
  const imported = matchRows(db, 'p.id', playerId, true, 30).map((r) => ({
    ...r,
    detailAvailable: true,
  }));
  const pub = db
    .prepare(
      `SELECT pm.match_id matchId,pm.hero_id heroId,h.cn_name heroCnName,pm.side,pm.win,
    pm.start_time startTime,pm.kills,pm.deaths,pm.assists,pm.gpm,pm.xpm FROM player_pub_matches pm
    JOIN heroes h ON h.id=pm.hero_id WHERE pm.player_id=? AND NOT EXISTS (
    SELECT 1 FROM matches m JOIN match_players mp USING(match_id) JOIN players p USING(account_id)
    WHERE m.match_id=pm.match_id AND p.id=pm.player_id)
    ORDER BY pm.start_time DESC LIMIT 30`,
    )
    .all(playerId)
    .map((r) => ({
      ...r,
      source: '路人',
      detailAvailable: false,
      items: [],
      neutralItem: null,
      startTime: Number(r.startTime),
    }));
  return [...imported, ...pub].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0)).slice(0, 30);
}
export function replayMatchParticipants(db: DatabaseSync, matchId: number) {
  if (!db.prepare(`SELECT 1 FROM matches m WHERE match_id=? AND ${replayScope}`).get(matchId))
    throw new HttpError(404, '比赛不存在');
  return matchRows(db, 'm.match_id', matchId, true);
}

export function normalizeCoordinates(x: number, y: number): Point {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { nx: clamp((x - 64) / 128), ny: clamp(1 - (y - 64) / 128) };
}
function participants(db: DatabaseSync, f: ReplayFilters) {
  const where = [replayScope],
    params: (string | number)[] = [];
  for (const [column, value] of [
    ['m.match_id', f.matchId],
    ['m.tag', f.tag],
    ['p.id', f.playerId],
    ['mp.account_id', f.accountId],
    ['mp.player_slot', f.playerSlot],
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
      mp.side,mp.hero_id heroId,${heroName} heroName,${participantName} playerName,
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
const zones = ['上路', '中路', '下路', '天辉野区', '夜魇野区', '河道与肉山周边'] as const;
// 以本地 512px 底图的河心、肉山坑及上下边缘水道为参照。区域是复盘分区，边缘水道归属对应野区。
const river = [
  [0.07, 0.33],
  [0.3, 0.32],
  [0.5, 0.49],
  [0.66, 0.64],
  [0.87, 0.65],
];
function nearRiver(x: number, y: number) {
  for (let i = 1; i < river.length; i++) {
    const [a, b] = river[i - 1],
      [c, d] = river[i],
      dx = c - a,
      dy = d - b;
    const t = Math.max(0, Math.min(1, ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - a - t * dx, y - b - t * dy) < 0.065) return true;
  }
  return false;
}
function zone({ nx: x, ny: y }: Point) {
  if (Math.abs(x + y - 1) <= 0.085) return 1;
  if (nearRiver(x, y)) return 5;
  if (y < 0.105 && x > 0.28 && x < 0.72) return 4;
  if (y > 0.89 && x > 0.29 && x < 0.72) return 3;
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
export async function wardHeatmap(
  db: DatabaseSync,
  adapter: ReplayParserAdapter,
  f: ReplayFilters,
) {
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
        for (const { x, y, time, durationSec, dewarded } of track[wardType]) {
          if (!inPhase(time, f.phase)) continue;
          const { nx, ny } = normalizeCoordinates(x, y);
          points.push({
            nx,
            ny,
            rawX: x,
            rawY: y,
            time,
            wardType,
            ...(durationSec === undefined ? {} : { durationSec, dewarded }),
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
  const measured = points.filter((p) => p.durationSec !== undefined);
  const dewarded = measured.filter((p) => p.dewarded === true).length;
  const enemyObserver = points.filter(
    (p) => p.wardType === 'obs' && (p.side === 'radiant' ? zone(p) === 4 : zone(p) === 3),
  ).length;
  const sentries = points.filter((p) => p.wardType === 'sen');
  const sentriesByZone = zones.map(() => 0);
  for (const p of sentries) sentriesByZone[zone(p)]++;
  const mainSentryZone = zones[sentriesByZone.indexOf(Math.max(...sentriesByZone))];
  const sentryText = sentries.length
    ? ` 真眼 ${sentries.length} 个，主要布在${mainSentryZone}，可结合后续假眼判断是否建立了持续视野。`
    : '';
  const visionDiagnosis = {
    enemyJungleObservers: enemyObserver,
    matched: measured.length,
    dewarded,
    averageDurationSec: measured.length
      ? Math.round(measured.reduce((n, p) => n + p.durationSec!, 0) / measured.length)
      : null,
    text: hotspots.length
      ? '布眼最集中在' +
        hotspots[0].zone +
        '。' +
        (dewarded
          ? '有守卫被排，下一次进区可先用真眼探路。'
          : measured.length
            ? '结合兵线检查视野是否覆盖下一次转线。'
            : '缺少移除记录，无法判断被排情况。') +
        sentryText
      : '暂无眼位样本。',
  };
  return { summary, points, hotspots, unparsedMatches, visionDiagnosis };
}

export async function farmingHeatmap(
  db: DatabaseSync,
  adapter: ReplayParserAdapter,
  f: ReplayFilters,
) {
  const grid = new Map<string, Point & { rawX: number; rawY: number; weight: number }>();
  const tacticalNames = [
    '优势路安全线',
    '劣势路施压线',
    '中路河道',
    '己方主野区',
    '三角区与远古',
    '侵略敌方野区',
  ];
  const tactical = tacticalNames.map(() => 0);
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
          ? heroTags(p.heroId, JSON.parse(p.roles ?? '[]')).typicalRoles.some(
              (r) => r >= 1 && r <= 3,
            )
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
        const cell = grid.get(key) ?? {
          ...normalizeCoordinates(x, y),
          rawX: x,
          rawY: y,
          weight: 0,
        };
        cell.weight += weight;
        totalWeight += weight;
        const z = zone(cell),
          radiant = p.side === 'radiant';
        weights[z] += weight;
        // 在每个选手自己的视角分类后再汇总，跨阵营同一坐标可能属于不同战术区域。
        const ownX = radiant ? cell.nx : 1 - cell.nx,
          ownY = radiant ? cell.ny : 1 - cell.ny;
        const region =
          z === 0
            ? radiant
              ? 1
              : 0
            : z === 2
              ? radiant
                ? 0
                : 1
              : z === 1 || z === 5
                ? 2
                : z !== (radiant ? 3 : 4)
                  ? 5
                  : ownX < 0.46 && ownY < 0.68
                    ? 4
                    : 3;
        tactical[region] += weight;
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
    tacticalZones: tacticalNames.map((zone, i) => ({
      zone,
      weight: tactical[i],
      percentage: totalWeight ? (100 * tactical[i]) / totalWeight : 0,
    })),
    farmingDiagnosis: totalWeight
      ? '活动最集中在' +
        tacticalNames[tactical.indexOf(Math.max(...tactical))] +
        '。' +
        (tactical[5] > totalWeight * 0.2
          ? '入侵频繁，推进前应先保护进出野区的视野。'
          : '转线时可结合兵线与外塔状态安排下一轮收线。')
      : '暂无位置采样。',
    cells: [...grid.values()].map((c) => ({ ...c, intensity: c.weight / peak })),
    zoneBreakdown: zones.map((name, i) => ({
      zone: name,
      weight: weights[i],
      percentage: totalWeight ? (100 * weights[i]) / totalWeight : 0,
    })),
  };
}
