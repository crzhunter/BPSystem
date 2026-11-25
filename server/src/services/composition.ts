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
    teamfight: 34 * has('teamfight') + 15 * has('save'),
  };
  // 输出结构是基于职责的阵容估计，不能解读为比赛实际伤害。
  const physical = carry ? 73 : h.tags.includes('burst') ? 22 : 44;
  const purePct = pure.has(h.id) ? 22 : 0;
  const physicalPct = [6, 35, 44, 46, 70, 81, 89, 109].includes(h.id)
    ? 84
    : [17, 22, 25, 26, 40, 52, 64, 101, 106].includes(h.id)
      ? 16
      : physical;
  return { scores, physicalPct, magicPct: 100 - physicalPct - purePct, purePct };
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
  if (tagCounts.save) strengths.push('有救援手段，可接第一轮先手');
  if (tagCounts.scout && tagCounts.push) strengths.push('能探坡带线，便于压外塔');
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
type Answer = {
  id: string;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  accepts: (hero: Hero) => boolean;
  reason: string;
};
const has =
  (...tags: Tag[]) =>
  (h: Hero) =>
    tags.some((t) => h.tags.includes(t));
function signals(a: Diagnosis, opposing: Diagnosis, attack: boolean): Answer[] {
  const n = a.assignments.length,
    t = a.tagCounts,
    d = a.damageProfile;
  if (!n) return [];
  const result: Answer[] = [];
  function add(
    condition: boolean,
    id: string,
    title: string,
    detail: string,
    accepts: Answer['accepts'],
    reason: string,
    severity: Answer['severity'] = 'medium',
  ) {
    if (condition) result.push({ id, title, severity, detail, accepts, reason });
  }
  if (attack) {
    add(
      !t.instantDisable,
      'low-control',
      '敌方缺快速留人',
      '逼出第一轮控制后再切后排，敌方很难留住机动核。',
      has('highMobility'),
      '绕过前排切双辅，逼完技能再撤。',
    );
    add(
      t.highRegen > 0,
      'regen',
      '敌方依赖回复扛伤',
      '先压回复或破被动，再集火肉核，别把爆发分摊给前排。',
      has('antiHeal'),
      '压低肉核血线，缩短对手回满血的窗口。',
      'high',
    );
    add(
      t.illusionSummon > 0,
      'summons',
      '敌方靠幻象或召唤物铺场',
      '留一轮范围伤害清兵和分身，避免被带线牵制。',
      has('aoeClear'),
      '范围清场后再找本体。',
      'high',
    );
    add(
      t.greedyCore >= 2 || (n >= 2 && !t.push),
      'tempo',
      '敌方需要发育时间',
      '抢外塔、占野区，逼对手在关键装之前接团。',
      has('push'),
      '带队拆外塔，压缩敌核安全发育区。',
    );
    add(
      d.magicPct >= 65 || (t.glassCannon > 0 && !t.save),
      'backline',
      '敌方后排怕冲脸',
      d.magicPct >= 65
        ? '对方伤害偏法术，围绕黑皇杖强势期跳过前排。'
        : '后排缺少保护，先手切断输出和救援。',
      has('backlineDive'),
      '越过前排贴住施法位。',
    );
    add(
      t.highMobility > 0 && !opposing.tagCounts.instantDisable,
      'mobility',
      '敌方机动核难留',
      '控到第一拍再接爆发，别把关键技能交给残影或位移。',
      has('instantDisable'),
      '快速起手限制位移。',
    );
    return result;
  }
  add(
    !t.instantDisable,
    'catch',
    '缺瞬发留人',
    '先手需要前摇，容易被跳刀、相位转移和残影躲开。',
    has('instantDisable'),
    '补第一手控制，给队友接技能的时间。',
    'high',
  );
  add(
    !t.save,
    'save',
    '缺救人和驱散',
    '第一人被开后很难重整阵型，留一手救援接应先手位。',
    has('save'),
    '保住被先手的队友，拖过第一轮爆发。',
    'high',
  );
  add(
    a.scores.teamfight < 25,
    'teamfight',
    '缺范围团控',
    '狭口和肉山团难以同时限制多人。',
    has('teamfight'),
    '封住入口，给队伍第二轮技能创造空间。',
  );
  add(
    a.scores.frontline < 30,
    'front',
    '前排扛不住第一轮',
    '脆皮先露头容易直接掉人，补一个能顶在坡口的英雄。',
    has('frontline'),
    '先占坡，替后排承伤。',
    'high',
  );
  add(
    !t.scout,
    'vision',
    '缺探坡视野',
    '过河排眼要靠人脸探，肉山刷新前尤其危险。',
    has('scout'),
    '先用技能或单位看坡，再让队友进场。',
  );
  add(
    n >= 2 && d.physicalPct > 65,
    'physical',
    '物理输出过于集中',
    '绿杖、缴械和高护甲容易拖掉输出窗口。',
    (h) => tacticalProfile(h).magicPct >= 65,
    '补法术伤害，惩罚虚无和堆甲。',
  );
  add(
    n >= 2 && d.magicPct > 65,
    'magic',
    '法术输出过于集中',
    '长笛和黑皇杖会吃掉第一轮爆发。',
    (h) => tacticalProfile(h).physicalPct >= 70,
    '补持续普攻，覆盖魔免窗口。',
  );
  add(
    a.rangeBalance.meleeCount >= 3,
    'melee',
    '近战过多',
    '正面容易挤在同一块地形，被范围控制和减速拉扯。',
    (h) => h.attackType === 'Ranged',
    '拉开阵型，从第二排接输出。',
  );
  add(
    !t.push,
    'push',
    '赢团后难拆塔',
    '缺少快速拔塔点，团战收益很难变成地图控制。',
    has('push'),
    '跟兵线压塔，把击杀换成建筑。',
  );
  add(
    !t.roshan && n >= 2,
    'roshan',
    '控盾速度偏慢',
    '敌核阵亡后也可能来不及收盾上高。',
    has('roshan'),
    '补打盾效率，争取先拿不朽盾。',
  );
  add(
    t.greedyCore >= 2 || (n >= 2 && !t.laneDominator),
    'lane',
    t.greedyCore >= 2 ? '多核抢发育区' : '对线缺压制点',
    '边路需要能主动换血、离线带节奏的英雄，给吃钱的核心腾出安全线。',
    has('laneDominator'),
    '靠对线施压打开第一片安全区。',
  );
  return result;
}

// 补强和破阵都由我方执行。先筛能解决该问题的英雄，再用我方空位和版本表现排序。
export function analyzeLineups(our: Diagnosis, enemy: Diagnosis, pool: Hero[]) {
  const regenReasons: Record<number, string> = {
    68: '冰晶爆轰封锁回血，集火逼出斩杀线。',
    69: '末日封治疗，阎刃按最大生命值持续烧血。',
    47: '蝮蛇突袭破坏被动，先压依赖被动回复的肉核。',
    40: '恶性瘟疫按最大生命值持续削血，给队友留集火窗口。',
    92: '黄泉颤抖压攻速，佣兽跟进控制，限制靠普攻吸血的核心。',
  };
  function answers(rule: Answer) {
    const role = (h: Hero) => h.typicalRoles.find((r) => our.missingRoles.includes(r));
    // 冰魂、末日直接封治疗；破被动和按血量削血属于次选手段。
    const direct = (h: Hero) => Number(rule.id === 'regen' && [68, 69].includes(h.id));
    return pool
      .filter(rule.accepts)
      .sort(
        (a, b) =>
          Number(!!role(b)) - Number(!!role(a)) ||
          direct(b) - direct(a) ||
          b.meta.strength - a.meta.strength ||
          a.id - b.id,
      )
      .slice(0, 3)
      .map((h) => ({
        heroId: h.id,
        cnName: h.cnName,
        portraitUrl: h.portraitUrl,
        role: role(h) ?? h.typicalRoles[0],
        reason: rule.id === 'regen' ? regenReasons[h.id] : rule.reason,
      }));
  }
  const info = ({ id, severity, title, detail }: Answer) => ({ id, severity, title, detail });
  const weaknesses = signals(our, enemy, false).map((rule) => ({
    ...info(rule),
    fixHeroes: answers(rule),
  }));
  const exploitableWeaknesses = signals(enemy, our, true).map((rule) => ({
    ...info(rule),
    counterHeroes: answers(rule),
  }));
  const warnings = [...new Set([...our.warnings, ...weaknesses.map((w) => w.title)])];
  return { our: { ...our, warnings, weaknesses }, enemy: { ...enemy, exploitableWeaknesses } };
}
export function fitCandidate(
  h: Hero,
  line: Selection[],
  before: Diagnosis,
  who: string,
  preferredRole: number | null = null,
) {
  const after = diagnose([...line, { hero: h, role: preferredRole }]);
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
    value: Math.min(
      100,
      (fillsRole ? 22 : 0) +
        gap * 0.46 +
        (balanced ? 8 : 0) +
        (before.rangeBalance.meleeCount >= 2 && h.attackType === 'Ranged' ? 8 : 0) +
        (line.length && !before.tagCounts.save && h.tags.includes('save') ? 8 : 0),
    ),
  };
}
