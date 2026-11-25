// OpenDota /constants/patch：7.42 发布于 2026-11-18T21:28:07.019Z，比赛时间精度为秒。
export const patch742Id = 61;
export const patch742StartTime = 1795037287;
export function inPatch742(
  patch: unknown,
  startTime: number | null,
  scope: { id: number; startTime: number },
) {
  if (patch != null && /^\d+$/.test(String(patch))) return Number(patch) >= scope.id;
  const version = /^(\d+)\.(\d+)[a-z]?$/.exec(String(patch));
  if (version) return +version[1] > 7 || (+version[1] === 7 && +version[2] >= 42);
  return (startTime ?? 0) >= scope.startTime;
}
export const attributes = ['str', 'agi', 'int', 'all'] as const;
export type PrimaryAttr = (typeof attributes)[number];
export const cdn = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/';
export const statKeys = [
  '5_pick',
  '5_win',
  '6_pick',
  '6_win',
  '7_pick',
  '7_win',
  '8_pick',
  '8_win',
  'pro_pick',
  'pro_win',
  'pro_ban',
] as const;
export type Counts = Record<(typeof statKeys)[number], number>;
export type MetaBracket = 'immortal_pub' | 'community_pub';
export function isMetaBracket(value: unknown): value is MetaBracket {
  return value === 'immortal_pub' || value === 'community_pub';
}
// 这些英雄即使一时胜率很高，也需要队伍有人能接这手绝活。
export const nicheSpecialistIds = new Set([
  66, 91, 82, 80, 92, 113, 61, 65, 78, 38, 58, 107, 77, 89,
]);
export type SideSample = {
  radiant: { games: number; wins: number };
  dire: { games: number; wins: number };
};
export const round = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number) => Math.max(0, Math.min(100, n));
export function deriveMeta(
  rows: (Counts & { id: number; sideSample?: SideSample })[],
  patch: string,
  sampledAt: string,
  metaBracket: MetaBracket = 'immortal_pub',
) {
  const ranks = metaBracket === 'immortal_pub' ? ([7, 8] as const) : ([5, 6, 7] as const);
  const total = (h: Counts, stat: 'pick' | 'win') =>
    ranks.reduce<number>((n, rank) => n + h[`${rank}_${stat}`], 0);
  const pubGames = rows.reduce((n, h) => n + total(h, 'pick'), 0) / 10;
  const proGames = rows.reduce((n, h) => n + h.pro_pick, 0) / 10;
  const result = rows
    .map((h) => {
      const games = total(h, 'pick'),
        wins = total(h, 'win');
      const winrate = games ? round((100 * wins) / games) : null;
      const popularity = pubGames ? (100 * games) / pubGames : 0;
      const highGames = h['7_pick'] + h['8_pick'];
      const highMmrWinrate = highGames
        ? round((100 * (h['7_win'] + h['8_win'])) / highGames)
        : null;
      const proContestedRate = proGames
        ? round(clamp((100 * (h.pro_pick + h.pro_ban)) / proGames))
        : 0;
      // 胜率向五成收缩，避免新英雄的少量胜场压过稳定的大样本英雄。
      const winSignal = clamp(50 + 6 * ((100 * (wins + 50)) / (games + 100) - 50));
      const strength = games ? round(0.7 * winSignal + 0.3 * clamp(popularity * 5)) : 0;
      const sides = h.sideSample;
      const sideBias =
        sides && (sides.radiant.games || sides.dire.games)
          ? {
              ...sides,
              radiantWinrate: sides.radiant.games
                ? round((100 * sides.radiant.wins) / sides.radiant.games)
                : null,
              direWinrate: sides.dire.games
                ? round((100 * sides.dire.wins) / sides.dire.games)
                : null,
            }
          : null;
      return {
        id: h.id,
        patch,
        sampledAt,
        highMmrWinrate,
        metaBracket,
        games,
        baseWinrate: winrate,
        pickRate: round(popularity),
        needsSpecialist: nicheSpecialistIds.has(h.id) || popularity < 2.5,
        proContestedRate,
        proBanRate: proGames ? round((100 * h.pro_ban) / proGames) : 0,
        strength,
        sideBias,
        counts: Object.fromEntries(statKeys.map((k) => [k, h[k]])) as Counts,
      };
    })
    .sort((a, b) => b.strength - a.strength || a.id - b.id);
  return result.map((h, i) => ({
    ...h,
    tier:
      i < result.length * 0.08
        ? 'T0'
        : i < result.length * 0.3
          ? 'T1'
          : i < result.length * 0.68
            ? 'T2'
            : 'T3',
  }));
}
export type HeroMeta = ReturnType<typeof deriveMeta>[number];
