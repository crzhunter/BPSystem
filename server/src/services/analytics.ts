import type { DatabaseSync } from 'node:sqlite';
import { patchScope, readSettings } from './settings.ts';
import { inPatch742 } from '../data/heroMeta.ts';
import { HttpError } from '../utils/input.ts';

type Side = 'radiant' | 'dire';
type Game = {
  match_id: number;
  hero_id: number;
  win: number;
  side: Side;
  start_time: number | null;
  patch: number | string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gpm: number | null;
  xpm: number | null;
  lane_role: number | null;
};
const round = (n: number) => Math.round(n * 100) / 100;
function percent(wins: number, games: number) {
  return games ? round((100 * wins) / games) : null;
}
function average(values: (number | null)[]) {
  const known = values.filter((n): n is number => n != null);
  return known.length ? round(known.reduce((a, b) => a + b, 0) / known.length) : null;
}
function kda(g: Game) {
  return g.kills == null || g.assists == null || g.deaths == null
    ? null
    : (g.kills + g.assists) / Math.max(1, g.deaths);
}
function totals(games: Game[]) {
  const wins = games.reduce((n, g) => n + g.win, 0);
  return { games: games.length, wins, winrate: percent(wins, games.length) };
}
function sides(games: Game[]) {
  const radiant = totals(games.filter((g) => g.side === 'radiant')),
    dire = totals(games.filter((g) => g.side === 'dire'));
  return {
    radiant,
    dire,
    delta:
      radiant.winrate == null || dire.winrate == null
        ? null
        : round(radiant.winrate - dire.winrate),
  };
}
function breakdown(games: Game[]) {
  const { radiant, dire } = sides(games);
  return {
    ...totals(games),
    radiantGames: radiant.games,
    radiantWins: radiant.wins,
    direGames: dire.games,
    direWins: dire.wins,
    lastPlayed: games.reduce((last, g) => Math.max(last, g.start_time ?? 0), 0) || null,
  };
}

function byHero(games: Game[]) {
  const groups = new Map<number, Game[]>();
  for (const g of games) {
    const group = groups.get(g.hero_id);
    if (group) group.push(g);
    else groups.set(g.hero_id, [g]);
  }
  return groups;
}

// 传入的两类样本都已限定版本。近期逐场包含在路人汇总内，只计算一次。
export function scoreHero(
  weight: number,
  tournament: { games: number; wins: number },
  pub: {
    games: number;
    wins: number;
    recentGames: number;
    recentWins: number;
  },
  recency: number,
) {
  const games = weight * tournament.games + pub.recentGames + 0.75 * (pub.games - pub.recentGames);
  const wins = weight * tournament.wins + pub.recentWins + 0.75 * (pub.wins - pub.recentWins);
  if (!games) return 0;
  const smoothed = (wins + 2) / (games + 4);
  const exposure = games / (games + 8);
  return round(100 * (0.55 * smoothed + 0.35 * exposure + 0.1 * recency));
}

export function analytics(db: DatabaseSync, id: number, now = Date.now() / 1000) {
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(id);
  if (!player) throw new HttpError(404, '选手不存在');
  const settings = readSettings(db),
    window = settings.pubRecentDays * 86400;
  const tournament = db
    .prepare(
      `SELECT mp.match_id,mp.hero_id,mp.side,mp.kills,mp.deaths,mp.assists,
    mp.gpm,mp.xpm,mp.lane_role,m.start_time,m.patch,(mp.is_radiant=m.radiant_win) AS win
    FROM match_players mp JOIN matches m USING(match_id)
    WHERE m.source='tournament' AND m.radiant_win IS NOT NULL AND mp.account_id=?`,
    )
    .all(player.account_id) as unknown as Game[];
  const history = db
    .prepare(
      'SELECT * FROM player_pub_matches WHERE player_id=? ORDER BY start_time DESC,match_id DESC',
    )
    .all(id) as unknown as Game[];
  const imported = new Set(tournament.map((g) => g.match_id));
  const pub = history.filter((g) => !imported.has(g.match_id));
  const overlap = history.filter((g) => imported.has(g.match_id));
  const scope = patchScope(db);
  const inScope = (g: Game) => inPatch742(g.patch, g.start_time, scope);
  const currentPub = pub.filter(inScope),
    currentTournament = tournament.filter(inScope);
  const combined = [...currentTournament, ...currentPub],
    recent = currentPub.slice(0, 20);
  let streak = 0;
  for (const g of currentPub) {
    if (g.win !== recent[0].win) break;
    streak++;
  }
  const heroes = new Map(
    db
      .prepare('SELECT id,cn_name,roles_json FROM heroes')
      .all()
      .map((h) => [
        Number(h.id),
        { name: h.cn_name, roles: JSON.parse(String(h.roles_json)) as string[] },
      ]),
  );
  const tournamentsByHero = byHero(tournament),
    pubsByHero = byHero(pub),
    overlapsByHero = byHero(overlap);
  const lifetime = new Map(
    db
      .prepare('SELECT * FROM player_pub_heroes WHERE player_id=? AND (games>0 OR patch_games>0)')
      .all(id)
      .map((h) => [Number(h.hero_id), h]),
  );
  const ids = new Set([...lifetime.keys(), ...tournamentsByHero.keys(), ...pubsByHero.keys()]);
  const heroPool = [...ids]
    .map((heroId) => {
      const tg = tournamentsByHero.get(heroId) ?? [],
        pg = pubsByHero.get(heroId) ?? [];
      const tour = { ...breakdown(tg), avgKda: average(tg.map(kda)) },
        samples = breakdown(pg);
      const all = lifetime.get(heroId),
        duplicates = totals(overlapsByHero.get(heroId) ?? []);
      // 生涯快照可能早于逐场记录。胜、负分别取已知下限，既不会累加同场，也不会出现胜场大于场次。
      const wins = Math.max(samples.wins, Number(all?.wins ?? 0) - duplicates.wins);
      const losses = Math.max(
        samples.games - samples.wins,
        Number(all?.games ?? 0) - Number(all?.wins ?? 0) - duplicates.games + duplicates.wins,
      );
      const games = wins + losses,
        active = totals(pg.filter((g) => (g.start_time ?? 0) >= now - window));
      const lastPlayed = Math.max(samples.lastPlayed ?? 0, Number(all?.last_played ?? 0)) || null;
      const pubs = {
        ...samples,
        games,
        wins,
        winrate: percent(wins, games),
        lastPlayed,
        recentGames: active.games,
        recentWins: active.wins,
      };
      const patchTournament = breakdown(tg.filter(inScope));
      const current = pg.filter(inScope),
        recentPatch = totals(current.filter((g) => (g.start_time ?? 0) >= now - window));
      const sample = breakdown(current),
        dup = totals((overlapsByHero.get(heroId) ?? []).filter(inScope));
      const patchWins = Math.max(sample.wins, Number(all?.patch_wins ?? 0) - dup.wins);
      const patchLosses = Math.max(
        sample.games - sample.wins,
        Number(all?.patch_games ?? 0) - Number(all?.patch_wins ?? 0) - dup.games + dup.wins,
      );
      const patchPub = {
        ...sample,
        games: patchWins + patchLosses,
        wins: patchWins,
        winrate: percent(patchWins, patchWins + patchLosses),
        recentGames: recentPatch.games,
        recentWins: recentPatch.wins,
      };
      const patch742Games = patchPub.games + patchTournament.games,
        patch742Wins = patchWins + patchTournament.wins;
      const last = Math.max(
        sample.lastPlayed ?? 0,
        settings.tournamentMatchWeight ? (patchTournament.lastPlayed ?? 0) : 0,
      );
      const recency = Math.min(1, Math.max(0, 1 - (now - last) / window));
      // 生涯总量不能证明当前版本熟练度。旧记录最多折算三场，仅在不足五场时提供至多三分。
      const legacyGames =
        Math.max(0, games - patchPub.games) +
        (settings.tournamentMatchWeight ? tour.games - patchTournament.games : 0);
      const legacyReference = Math.min(3, legacyGames * 0.15) * Math.max(0, 1 - patch742Games / 5);
      const score = round(
        scoreHero(settings.tournamentMatchWeight, patchTournament, patchPub, recency) +
          legacyReference,
      );
      return {
        heroId,
        name: String(heroes.get(heroId)?.name || '英雄 ' + heroId),
        tournament: tour,
        pub: pubs,
        patchPub,
        patchTournament,
        patch742Games,
        patch742Wins,
        isPatch742Sample: patch742Games > 0,
        weightedScore: score,
        threatScore: score,
        grade: score >= 70 ? 'S' : score >= 50 ? 'A' : 'B',
        source: tour.games && games ? '赛事和天梯' : tour.games ? '比赛局' : '路人局',
      };
    })
    .filter((h) => h.tournament.games || h.pub.games || h.patch742Games)
    .sort((a, b) => b.weightedScore - a.weightedScore || a.heroId - b.heroId);

  const roleCounts = [0, 0, 0, 0, 0];
  for (const g of combined) {
    const roles = heroes.get(g.hero_id)?.roles ?? [];
    const support = roles.includes('Support') && !roles.includes('Carry');
    // lane_role 已按本方视角标注优势/中/劣势路；缺少分路线索时保留未知。
    let role = 0;
    if (g.lane_role === 1) role = support ? 5 : 1;
    if (g.lane_role === 2) role = 2;
    if (g.lane_role === 3) role = support ? 4 : 3;
    if (role) roleCounts[role - 1]++;
  }
  const known = roleCounts.reduce((a, b) => a + b, 0);
  return {
    playerId: id,
    isProfilePrivate: !!player.is_profile_private,
    lastSyncedAt: player.last_synced_at,
    privacyHint: player.is_profile_private
      ? '该账号未公开路人战绩，建议通过历史比赛 ID 导入补全数据'
      : null,
    recentForm: {
      ...totals(recent),
      streak: { count: streak, type: streak ? (recent[0].win ? '连胜' : '连败') : null },
      avgKda: average(recent.map(kda)),
      avgGpm: average(recent.map((g) => g.gpm)),
      avgXpm: average(recent.map((g) => g.xpm)),
    },
    roleDistribution: roleCounts.map((games, i) => ({
      role: i + 1,
      games,
      percent: percent(games, known),
    })),
    sideSplits: {
      pub: sides(currentPub),
      tournament: sides(currentTournament),
      combined: sides(combined),
    },
    heroPool,
  };
}
