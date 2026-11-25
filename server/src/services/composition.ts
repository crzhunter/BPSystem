import { tagLabels, type Tag } from '../data/heroTags.ts';
import type { listHeroes } from '../data/catalog.ts';
import type { Action, Slots } from './draftState.ts';
export type Hero = ReturnType<typeof listHeroes>[number];
export const dimLabels = {
  disable: '先手硬控',
  frontline: '前排承伤',
  burst: '爆发伤害',
  sustain: '持续输出',
  push: '推进拆塔',
  teamfight: '团战反手',
};
export type Dim = keyof typeof dimLabels;
export const dims = Object.keys(dimLabels) as Dim[];
const roles = [1, 2, 3, 4, 5];
const pure = new Set([2, 34, 36, 39, 54, 57, 65, 67, 76, 78, 98, 100, 104, 113]);
export function tacticalProfile(h: Hero) {
  const has = (tag: Tag) => Number(h.tags.includes(tag));
  const carry = Number(h.typicalRoles.includes(1)),
    melee = h.attackType === 'Melee';
  const scores = {
    disable: 32 * has('stun') + 18 * has('initiate'),
    frontline: 36 * has('frontline') + 6 * Number(melee),
    burst: 32 * has('burst') + 6 * has('initiate'),
    sustain: 30 * carry + 12 * Number(h.roles.includes('Carry')),
    push: 36 * has('push') + 8 * carry,
    teamfight: 34 * has('teamfight') + 25 * has('save'),
  };
  // 输出结构是基于职责的阵容估计，不能解读为比赛实际伤害。
  const physical = carry ? 73 : h.tags.includes('burst') ? 22 : 44;
  const purePct = pure.has(h.id) ? 22 : 0;
  return { scores, physicalPct: physical, magicPct: 100 - physical - purePct, purePct };
}
export type Selection = { hero: Hero; role: number | null };
export function selection(picks: Action[], slots: Slots, heroes: Map<number, Hero>): Selection[] {
  return picks
    .map((a) => ({
      hero: heroes.get(a.heroId)!,
      role: a.roleHint ?? (a.assignedPlayerId ? slots.indexOf(a.assignedPlayerId) + 1 : null),
    }))
    .filter((x) => x.hero);
}
export function diagnose(picks: Selection[]) {
  const tagCounts = Object.fromEntries(Object.keys(tagLabels).map((k) => [k, 0])) as Record<
    Tag,
    number
  >;
  const scores = Object.fromEntries(dims.map((k) => [k, 0])) as Record<Dim, number>;
  let physical = 0,
    magic = 0,
    meleeCount = 0;
  for (const { hero } of picks) {
    const p = tacticalProfile(hero);
    for (const k of dims) scores[k] = Math.min(100, scores[k] + p.scores[k]);
    for (const t of hero.tags) tagCounts[t]++;
    physical += p.physicalPct;
    magic += p.magicPct;
    meleeCount += Number(hero.attackType === 'Melee');
  }
  // 固定分工优先。其余位置做最大匹配，覆盖数相同时优先使用常见位置。
  let bestValue = -1,
    best: (number | null)[] = [];
  const assigned = picks.map((p) => p.role),
    used = new Set(assigned.filter((r) => r !== null));
  function assign(i: number, quality: number) {
    if (i === picks.length) {
      const value = 100 * used.size + quality;
      if (value > bestValue) {
        bestValue = value;
        best = [...assigned];
      }
      return;
    }
    if (picks[i].role !== null) {
      assign(i + 1, quality);
      return;
    }
    picks[i].hero.typicalRoles.forEach((r, j) => {
      if (used.has(r)) return;
      used.add(r);
      assigned[i] = r;
      assign(i + 1, quality + 4 - j);
      used.delete(r);
    });
    assigned[i] = null;
    assign(i + 1, quality);
  }
  assign(0, 0);
  const coveredRoles = roles.filter((r) => best.includes(r)),
    missingRoles = roles.filter((r) => !best.includes(r));
  const assignments = picks.map((p, i) => ({
    heroId: p.hero.id,
    role: best[i],
    flexRoles: p.role ? [] : p.hero.typicalRoles.length > 1 ? p.hero.typicalRoles : [],
  }));
  const n = picks.length,
    physicalPct = n ? Math.round(physical / n) : 0,
    purePct = n ? Math.round(100 - (physical + magic) / n) : 0;
  const magicPct = n ? 100 - physicalPct - purePct : 0;
  const warnings: string[] = [],
    strengths: string[] = [];
  if (!tagCounts.initiate || !tagCounts.stun)
    warnings.push(
      '优先补' +
        (!tagCounts.initiate ? '先手' : '') +
        (!tagCounts.stun ? '硬控' : '') +
        '，留住敌方核心',
    );
  if (scores.frontline < 30) warnings.push('前排偏薄，补一名能先探视野的英雄');
  if (!tagCounts.push) warnings.push('推进不足，补拆塔点兑现团战优势');
  if (missingRoles.includes(1)) warnings.push('尚缺 1 号位核心');
  if (n >= 2 && Math.max(physicalPct, magicPct) > 65)
    warnings.push(
      physicalPct > magicPct ? '输出偏物理，可补法术爆发' : '输出偏魔法，可补持续物理输出',
    );
  for (const k of dims) if (scores[k] >= 50) strengths.push(dimLabels[k] + '充足');
  return {
    coveredRoles,
    missingRoles,
    assignments,
    scores,
    damageProfile: { physicalPct, magicPct, purePct },
    rangeBalance: { meleeCount, rangedCount: n - meleeCount },
    tagCounts,
    warnings,
    strengths,
  };
}
export type Diagnosis = ReturnType<typeof diagnose>;
export function fitCandidate(h: Hero, line: Selection[], before: Diagnosis, who: string) {
  const after = diagnose([...line, { hero: h, role: null }]);
  const delta = Object.fromEntries(
    dims.map((k) => [k, after.scores[k] - before.scores[k]]),
  ) as Record<Dim, number>;
  const boostedDims = dims.filter((k) => delta[k] > 0).sort((a, b) => delta[b] - delta[a]);
  const fillsRole = before.missingRoles.find((r) => after.coveredRoles.includes(r));
  const role = after.assignments.at(-1)?.role ?? h.typicalRoles[0];
  const damage = before.damageProfile,
    next = after.damageProfile;
  const balanced =
    (damage.physicalPct > 65 && next.physicalPct < damage.physicalPct - 4) ||
    (damage.magicPct > 65 && next.magicPct < damage.magicPct - 4);
  const text = [
    fillsRole ? '补齐' + who + ' ' + fillsRole + ' 号位' : '可担任 ' + role + ' 号位',
    ...boostedDims.slice(0, 2).map((k) => dimLabels[k] + ' +' + delta[k]),
    ...(balanced ? ['改善物理与魔法输出配比'] : []),
  ].join('，');
  const gap = dims.reduce(
    (sum, k) =>
      sum +
      delta[k] *
        (1 - before.scores[k] / 100) *
        (k === 'disable' || k === 'frontline' ? 1.35 : 0.75),
    0,
  );
  return {
    role,
    fit: { fillsRole, boostedDims, delta, text },
    value: Math.min(100, (fillsRole ? 22 : 0) + gap * 0.46 + (balanced ? 8 : 0)),
  };
}
