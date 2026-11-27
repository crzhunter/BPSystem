import type { Member } from './scouting.ts';

export type PoolKind = 'signature' | 'comfort' | 'avoid';
export function recommendationWeights(members: Member[], ban: boolean, late: boolean) {
  const team = members.some((m) => m.pool.size || m.overrides.size);
  const player = team ? (ban ? 0.62 : 0.6) : 0;
  const remaining = 1 - player;
  const matchup = (late ? 0.45 : 0.4) * remaining;
  const composition = (late ? 0.35 : 0.36) * remaining;
  const meta = (late ? 0.16 : 0.2) * remaining;
  return {
    meta,
    composition,
    matchup,
    strategy: remaining - (meta + composition + matchup),
    player,
  };
}
export function poolValue(kind: PoolKind | undefined, score: number) {
  if (kind === 'avoid') return -100;
  if (kind === 'signature') return 100;
  if (kind === 'comfort') return Math.max(72, score);
  return score;
}
