import type { Diagnosis, Hero } from './composition.ts';
import { check } from '../utils/input.ts';

export type RolePreference = 'auto' | 'core' | 'support' | 1 | 2 | 3 | 4 | 5;
const all = [1, 2, 3, 4, 5],
  cores = [1, 2, 3],
  supports = [4, 5];
export function parsePreference(input: unknown): RolePreference {
  if (input === undefined) return 'auto';
  check(
    input === 'auto' || input === 'core' || input === 'support' || all.some((n) => n === input),
    '倾向位置须为智能、核心、辅助或 1–5 号位',
  );
  return input as RolePreference;
}
export function rolePriority(mode: RolePreference, step: number, audit: Diagnosis, ban: boolean) {
  const { missingRoles } = audit;
  let targetRoles: number[], label: string, description: string;
  if (mode !== 'auto') {
    targetRoles = mode === 'core' ? cores : mode === 'support' ? supports : [mode];
    label = mode === 'core' ? '核心位' : mode === 'support' ? '辅助位' : mode + '号位';
    description = '指定' + label + '，优先看对位和阵容配合。';
  } else if (ban) {
    targetRoles = step <= 7 ? all : missingRoles;
    label = step <= 7 ? '首轮封锁' : '封锁敌方空位';
    description =
      step <= 7
        ? '先禁版本强势点、高价值摇摆位和对手本版绝活。'
        : '敌方还缺 ' + (missingRoles.join('/') || '—') + ' 号位，优先封锁能反制我方核心的英雄。';
  } else {
    const preferred = step <= 9 ? supports : step <= 15 ? [4, 5, 3] : cores;
    const open = preferred.filter((r) => missingRoles.includes(r));
    targetRoles = open.length ? open : missingRoles;
    label = step <= 9 ? '首轮抢辅' : step <= 15 ? '二轮补位' : '后手补核';
    description =
      step <= 9
        ? '首轮优先四、五号位与强势摇摆点，把核心对位留到后手。'
        : label +
          '，优先 ' +
          (targetRoles.join('/') || '—') +
          ' 号位。' +
          (step <= 15 ? '补齐双辅和三号位，避免重叠分工。' : '围绕已亮敌核寻找克制对位。');
  }
  return { mode, label, description, targetRoles };
}
export function candidateRoles(
  h: Hero,
  priority: ReturnType<typeof rolePriority>,
  openingPick: boolean,
  missing: number[],
) {
  const open = priority.targetRoles.filter((r) => missing.includes(r));
  const target = open.length ? open : priority.targetRoles;
  const matched = h.typicalRoles.filter((r) => target.includes(r));
  // 首轮允许强势双核摇摆，但纯一、二号位不吃摇摆优先级。
  if (
    !matched.length &&
    openingPick &&
    priority.mode === 'auto' &&
    h.typicalRoles.includes(3) &&
    h.typicalRoles.length > 1 &&
    ['T0', 'T1'].includes(h.meta.tier)
  )
    return h.typicalRoles.filter((r) => missing.includes(r));
  return matched;
}
export function roleBadge(h: Hero) {
  const core = h.typicalRoles.some((r) => r <= 3),
    support = h.typicalRoles.some((r) => r >= 4);
  const roleGroup = core && support ? 'flex' : core ? 'core' : 'support';
  const roleLabel =
    { flex: '摇摆', core: '核心', support: '辅助' }[roleGroup] +
    ' · ' +
    [...h.typicalRoles].sort().join('/') +
    '号位';
  return { roleGroup, roleLabel } as const;
}
