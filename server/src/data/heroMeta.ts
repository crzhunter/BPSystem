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
const ladderRanks = [8, 7, 6, 5] as const;
const rankWeights = { 8: 40, 7: 28, 6: 20, 5: 12 };
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
) {
  const tiers = ladderRanks
    .map((rank) => ({
      rank,
      games: rows.reduce((n, h) => n + h[`${rank}_pick`], 0) / 10,
      weight: rankWeights[rank],
    }))
    .filter((tier) => tier.games > 0);
  // 按全英雄统计判断整档是否有样本，唯一有样本的高分档承接整组权重。
  const high = tiers.filter((tier) => tier.rank >= 7);
  if (high.length === 1) high[0].weight = rankWeights[8] + rankWeights[7];
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  const proGames = rows.reduce((n, h) => n + h.pro_pick, 0) / 10;
  const result = rows
    .map((h) => {
      let games = 0;
      let weightedWinRate = 0;
      let weightedPickRate = 0;
      for (const tier of tiers) {
        const picks = h[`${tier.rank}_pick`];
        const wins = h[`${tier.rank}_win`];
        games += picks;
        // 英雄在有比赛的档位零登场时，该档胜率回到五成。
        weightedWinRate += tier.weight * ((100 * (wins + 50)) / (picks + 100));
        weightedPickRate += tier.weight * ((100 * picks) / tier.games);
      }
      const winrate = games ? weightedWinRate / totalWeight : null;
      const popularity = totalWeight ? weightedPickRate / totalWeight : 0;
      const highGames = h['7_pick'] + h['8_pick'];
      const highMmrWinrate = highGames
        ? round((100 * (h['7_win'] + h['8_win'])) / highGames)
        : null;
      const proContestedRate = proGames
        ? round(clamp((100 * (h.pro_pick + h.pro_ban)) / proGames))
        : 0;
      const winSignal = clamp(50 + 6 * ((winrate ?? 50) - 50));
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
        games,
        baseWinrate: winrate === null ? null : round(winrate),
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
