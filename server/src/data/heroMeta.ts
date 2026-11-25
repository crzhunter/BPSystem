export const attributes = ['str', 'agi', 'int', 'all'] as const;
export type PrimaryAttr = (typeof attributes)[number];
export const cdn = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/';
export const statKeys = [
  '7_pick',
  '7_win',
  '8_pick',
  '8_win',
  'pro_pick',
  'pro_win',
  'pro_ban',
] as const;
export type Counts = Record<(typeof statKeys)[number], number>;
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
  const pubGames = rows.reduce((n, h) => n + h['7_pick'] + h['8_pick'], 0) / 10;
  const proGames = rows.reduce((n, h) => n + h.pro_pick, 0) / 10;
  const result = rows
    .map((h) => {
      const games = h['7_pick'] + h['8_pick'],
        wins = h['7_win'] + h['8_win'];
      const highMmrWinrate = games ? round((100 * wins) / games) : null;
      const pickRate = pubGames ? round((100 * games) / pubGames) : 0;
      const proContestedRate = proGames
        ? round(clamp((100 * (h.pro_pick + h.pro_ban)) / proGames))
        : 0;
      // 胜率向五成收缩，避免新英雄的少量胜场压过稳定的大样本英雄。
      const winSignal = clamp(50 + 6 * ((100 * (wins + 50)) / (games + 100) - 50));
      const strength = round(
        0.48 * winSignal + 0.37 * proContestedRate + 0.15 * clamp(pickRate * 5),
      );
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
        baseWinrate: highMmrWinrate,
        pickRate,
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
