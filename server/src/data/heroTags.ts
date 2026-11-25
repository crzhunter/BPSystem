export const tagLabels = {
  stun: '硬控',
  initiate: '先手',
  push: '推进拆塔',
  burst: '爆发',
  teamfight: '团战',
  save: '救人驱散',
  flex: '摇摆位',
  frontline: '前排',
  laneDominator: '线优',
} as const;
export type Tag = keyof typeof tagLabels;
export type HeroTraits = { typicalRoles: number[]; tags: Tag[] };

// 同组按常见程度排列位置。英雄池同步新增英雄时，仍可按 OpenDota 职责推断。
const positions: [number[], number[]][] = [
  [[1], [1, 6, 8, 10, 12, 41, 44, 48, 54, 67, 70, 89, 93, 94, 95, 109, 145]],
  [
    [1, 2],
    [11, 35, 46, 56, 72, 73, 82, 113, 114],
  ],
  [
    [1, 3],
    [4, 15, 18, 42, 63, 81, 99],
  ],
  [[1, 4], [32]],
  [[2], [13, 17, 34, 39, 59, 74, 76, 106, 126]],
  [
    [2, 1],
    [21, 25, 138],
  ],
  [
    [2, 3],
    [23, 36, 43, 47, 49, 52, 61, 80, 92, 120],
  ],
  [
    [2, 4],
    [22, 45],
  ],
  [[3], [2, 28, 29, 38, 55, 60, 69, 77, 78, 96, 104, 108, 129]],
  [
    [3, 2],
    [98, 137],
  ],
  [
    [3, 4],
    [7, 14, 16, 33, 65, 71, 97, 135],
  ],
  [
    [3, 5],
    [57, 102],
  ],
  [[4, 2, 3], [19]],
  [
    [4, 2],
    [9, 107],
  ],
  [
    [4, 3],
    [51, 62, 100],
  ],
  [
    [4, 1],
    [53, 136],
  ],
  [
    [4, 5],
    [20, 26, 27, 40, 86, 88, 101, 103, 105, 110, 119, 123, 128, 131],
  ],
  [
    [5, 4],
    [3, 5, 30, 31, 37, 50, 58, 64, 66, 68, 75, 79, 83, 84, 85, 87, 90, 91, 111, 112, 121, 155],
  ],
];
const known = new Map(positions.flatMap(([roles, ids]) => ids.map((id) => [id, roles] as const)));
// OpenDota 的 Disabler 也包含减速、缠绕与沉默；已知英雄单独标记能打断对手行动的控制。
const hardControl = new Set([
  2, 3, 7, 9, 13, 14, 16, 17, 18, 19, 20, 21, 23, 25, 26, 27, 28, 29, 30, 33, 37, 38, 41, 42, 49,
  51, 52, 64, 65, 71, 72, 74, 78, 79, 84, 86, 88, 96, 97, 100, 103, 104, 105, 107, 110, 112, 120,
  119, 121, 129, 128, 123, 135, 136, 137, 138, 131,
]);
const extra: Partial<Record<Tag, number[]>> = {
  burst: [8, 44, 145],
  save: [20, 50, 57, 66, 79, 83, 86, 90, 91, 100, 102, 111, 112, 135],
  teamfight: [
    7, 13, 16, 29, 31, 33, 37, 40, 41, 55, 64, 68, 72, 75, 78, 83, 87, 94, 97, 103, 108, 110, 112,
    120, 121, 129,
  ],
  laneDominator: [6, 15, 21, 25, 36, 39, 40, 46, 47, 58, 59, 64, 76, 80, 85, 98, 114],
  push: [27, 33, 38, 42, 43, 45, 46, 48, 49, 52, 53, 61, 64, 66, 73, 77, 80, 89, 92, 109],
};
export function heroTags(id: number, roles: string[]): HeroTraits {
  const has = (r: string) => roles.includes(r);
  const typicalRoles =
    known.get(id) ??
    (has('Support') ? [4, 5] : has('Carry') ? [1] : has('Initiator') ? [3] : [2, 4]);
  const tags = new Set<Tag>();
  if (hardControl.has(id) || (!known.has(id) && has('Disabler'))) tags.add('stun');
  if (has('Initiator')) tags.add('initiate');
  if (has('Pusher')) tags.add('push');
  if (has('Nuker')) tags.add('burst');
  if (has('Durable')) tags.add('frontline');
  if (typicalRoles.length > 1) tags.add('flex');
  for (const [tag, ids] of Object.entries(extra)) if (ids.includes(id)) tags.add(tag as Tag);
  if (!tags.size) tags.add('burst');
  return { typicalRoles, tags: [...tags] };
}
