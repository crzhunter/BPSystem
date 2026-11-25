import type { DatabaseSync } from 'node:sqlite';
import { cmOrder, currentStep, opposite, sideNames, type Side } from '../data/cmOrder.ts';
import { heroTags, tagLabels, type Tag, type HeroTraits } from '../data/heroTags.ts';
import { slotsFor, type Action, type Draft, type Slots } from './draftState.ts';
import { comfortCombos, scoutRoster, type Member } from './scouting.ts';

type Hero = HeroTraits & { id: number; name: string };
const roles = [1, 2, 3, 4, 5];
const functions: Tag[] = ['stun', 'initiate', 'push', 'save'];
function context(db: DatabaseSync, draft: Draft) {
  const heroes = db
    .prepare('SELECT id,cn_name,roles_json FROM heroes ORDER BY id')
    .all()
    .map((h) => ({
      id: Number(h.id),
      name: String(h.cn_name || '英雄 ' + h.id),
      ...heroTags(Number(h.id), JSON.parse(String(h.roles_json))),
    }));
  return {
    heroes,
    byId: new Map(heroes.map((h) => [h.id, h])),
    radiant: scoutRoster(db, draft.radiantPlayerIds),
    dire: scoutRoster(db, draft.direPlayerIds),
    combos: comfortCombos(db, slotsFor(draft, opposite(draft.ourSide))),
  };
}
// 同一草稿连续选人只改变动作。只保留最近一组阵容，数据写入、外部连接提交或时间窗口移动后重新统计。
const cached = new WeakMap<DatabaseSync, { key: string; value: ReturnType<typeof context> }>();
function localContext(db: DatabaseSync, draft: Draft) {
  const version = db
    .prepare('SELECT total_changes() n, data_version v FROM pragma_data_version')
    .get()!;
  const key = [
    version.n,
    version.v,
    Math.floor(Date.now() / 60000),
    draft.ourSide,
    ...draft.radiantPlayerIds,
    ...draft.direPlayerIds,
  ].join('/');
  const old = cached.get(db);
  if (old?.key === key) return old.value;
  const value = context(db, draft);
  cached.set(db, { key, value });
  return value;
}
function audit(picks: Action[], slots: Slots, heroes: Map<number, Hero>) {
  const tagCounts = Object.fromEntries(Object.keys(tagLabels).map((t) => [t, 0])) as Record<
    Tag,
    number
  >;
  const fixed = new Set<number>();
  const open: number[][] = [];
  for (const a of picks) {
    const h = heroes.get(a.heroId);
    for (const tag of h?.tags ?? []) tagCounts[tag]++;
    const role = a.roleHint ?? (a.assignedPlayerId ? slots.indexOf(a.assignedPlayerId) + 1 : 0);
    if (role) fixed.add(role);
    else open.push(h?.typicalRoles ?? []);
  }
  // 摇摆英雄只占一个位置；最多五人，枚举匹配以保留其他英雄的唯一可用位置。
  let best = [...fixed];
  function match(index: number, used: Set<number>) {
    if (used.size > best.length) best = [...used];
    if (index === open.length) return;
    for (const pos of open[index])
      if (!used.has(pos)) {
        used.add(pos);
        match(index + 1, used);
        used.delete(pos);
      }
    match(index + 1, used);
  }
  match(0, new Set(fixed));
  const coveredRoles = best.sort((a, b) => a - b),
    missingRoles = roles.filter((r) => !best.includes(r));
  const warnings = [];
  if (!tagCounts.stun || !tagCounts.initiate)
    warnings.push(
      !tagCounts.stun && !tagCounts.initiate
        ? '缺少稳定先手和硬控'
        : !tagCounts.stun
          ? '缺少稳定硬控'
          : '缺少先手开团手段',
    );
  if (!tagCounts.push) warnings.push('缺少推进拆塔能力');
  if (!tagCounts.save) warnings.push('缺少救人或驱散手段');
  for (const pos of missingRoles)
    warnings.push(pos === 1 ? '尚未选出 1 号位核心' : '仍需补齐 ' + pos + ' 号位');
  return { coveredRoles, missingRoles, tagCounts, warnings };
}
function owners(heroId: number, members: Member[], side: Side) {
  return members
    .flatMap((m) => {
      const h = m.pool.get(heroId);
      if (!h) return [];
      const { tournament: t, pub: p } = h;
      const games =
        side === 'radiant' ? t.radiantGames + p.radiantGames : t.direGames + p.direGames;
      const wins = side === 'radiant' ? t.radiantWins + p.radiantWins : t.direWins + p.direWins;
      const sideBonus = (10 * (wins - games / 2)) / (games + 4);
      return [
        {
          playerId: m.playerId,
          name: m.name,
          role: m.role,
          weightedScore: h.weightedScore,
          tournament: t,
          pub: p,
          sideBonus,
          sideGames: games,
          sideWins: wins,
        },
      ];
    })
    .sort((a, b) => b.weightedScore + b.sideBonus - a.weightedScore - a.sideBonus);
}
type Owner = ReturnType<typeof owners>[number];
const identity = ({ playerId, name, role }: Owner) => ({ playerId, name, role });
const record = ({ games, wins, winrate }: Owner['pub'] | Owner['tournament']) => ({
  games,
  wins,
  winrate,
});
function recordReason(o: Owner, who: string) {
  const t = o.tournament.games ? o.tournament : o.pub;
  return (
    who +
    o.role +
    ' 号位' +
    (o.tournament.games ? '赛事' : '路人') +
    ' ' +
    t.wins +
    ' 胜 ' +
    (t.games - t.wins) +
    ' 负'
  );
}
function proficient(o: Owner) {
  return o.weightedScore >= 45 && (o.tournament.games >= 2 || o.pub.games >= 5);
}
const bounded = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
const ranked = (a: { score: number; heroId: number }, b: { score: number; heroId: number }) =>
  b.score - a.score || a.heroId - b.heroId;

function matchupMatrix(db: DatabaseSync, picks: Action[]) {
  const matrix = new Map<string, number>();
  if (!picks.length) return matrix;
  const ids = picks.map((a) => a.heroId),
    params = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM hero_matchups WHERE games_played>0 AND
    (hero_id IN (${params}) OR against_hero_id IN (${params}))`,
    )
    .all(...ids, ...ids);
  for (const r of rows) {
    // 十场均势先验。仅同步已选英雄也可以从反向胜负推导候选英雄的对位。
    matrix.set(
      r.hero_id + '/' + r.against_hero_id,
      (Number(r.wins) - Number(r.games_played) / 2) / (Number(r.games_played) + 10),
    );
  }
  return matrix;
}
export function recommend(db: DatabaseSync, draft: Draft) {
  const data = localContext(db, draft),
    our = draft.ourSide,
    enemy = opposite(our);
  const order = cmOrder(draft.firstPickSide),
    step = currentStep(draft.firstPickSide, our, draft.actions.length);
  const picks = (side: Side) =>
    draft.actions.filter((_, i) => order[i].side === side && order[i].actionType === 'pick');
  const ours = picks(our),
    theirs = picks(enemy);
  const lineupAudit = audit(ours, slotsFor(draft, our), data.byId);
  const { missingRoles, tagCounts } = lineupAudit;
  const matrix = matchupMatrix(db, [...ours, ...theirs]);
  const used = new Set(draft.actions.map((a) => a.heroId));
  const free = data[our].members.filter(
    (m) => !ours.some((a) => a.assignedPlayerId === m.playerId),
  );
  const displaced = free.filter((m) =>
    ours.some((a) => a.assignedPlayerId && a.roleHint === m.role),
  );
  function counter(heroId: number, opponents: Action[], targetCores: boolean) {
    let best = 0,
      target = '',
      total = 0;
    for (const a of opponents) {
      const edge =
        matrix.get(heroId + '/' + a.heroId) ?? -(matrix.get(a.heroId + '/' + heroId) ?? 0);
      const h = data.byId.get(a.heroId);
      const pos =
        a.roleHint ??
        (a.assignedPlayerId
          ? slotsFor(draft, our).indexOf(a.assignedPlayerId) + 1
          : h?.typicalRoles[0]);
      const value = edge * (targetCores && pos && pos <= 3 ? 1.3 : 1);
      total += value;
      if (value > best) {
        best = value;
        target = h?.name ?? '';
      }
    }
    return { strength: (total / Math.max(1, opponents.length) + best) / 2, target };
  }
  const bans = [],
    picksRanked = [],
    flexPicks = [];
  for (const h of data.heroes) {
    if (used.has(h.id)) continue;
    const targets = owners(h.id, data[enemy].members, enemy),
      owner = targets[0];
    const flex = targets.filter(proficient),
      early = step.phase === 1;
    const danger = counter(h.id, ours, !early),
      edge = counter(h.id, theirs, false);
    const banReasons: string[] = [];
    let banScore = (owner?.weightedScore ?? 0) * 0.74 + (owner?.sideBonus ?? 0);
    if (owner) {
      banReasons.push(recordReason(owner, '敌方'));
      if (owner.sideBonus > 0)
        banReasons.push(
          '敌方' + sideNames[enemy] + ' ' + owner.sideWins + ' 胜 / ' + owner.sideGames + ' 场',
        );
      if (early && owner.weightedScore >= 70) {
        banScore += enemy === draft.firstPickSide ? 10 : 7;
        banReasons.push('首轮优先限制招牌英雄');
      }
    }
    if (flex.length >= 2) {
      banScore += early ? (enemy === draft.firstPickSide ? 11 : 9) : 5;
      banReasons.push('可在 ' + flex.map((o) => o.role).join(' / ') + ' 号位摇摆');
      flexPicks.push({ heroId: h.id, players: flex });
    }
    banScore += danger.strength * (early ? 22 : 60);
    if (danger.target) banReasons.push('克制我方' + danger.target);
    if (!banReasons.length) banReasons.push('暂无对手使用记录');
    bans.push({
      heroId: h.id,
      score: bounded(banScore),
      targetPlayers: targets,
      reasons: banReasons,
    });

    const fitted = owners(h.id, free, our);
    // 同一英雄由未占位选手竞争，位置契合与个人样本一起决定建议归属。
    const options = (missingRoles.length ? missingRoles : roles)
      .map((role) => {
        const original = free.find((m) => m.role === role);
        // 已知选手跨位置出场时，原位置上的队友可以接手空位。
        const fit = original
          ? fitted.find((o) => o.playerId === original.playerId)
          : fitted.find((o) => displaced.some((m) => m.playerId === o.playerId));
        const member =
          original ?? displaced.find((m) => m.playerId === fit?.playerId) ?? displaced[0];
        const natural = h.typicalRoles.includes(role);
        return {
          role,
          member,
          fit,
          value:
            (fit?.weightedScore ?? 0) * 0.53 +
            (fit?.sideBonus ?? 0) +
            (natural && missingRoles.includes(role) ? 12 : 0) +
            (role === h.typicalRoles[0] ? 2 : 0),
        };
      })
      .sort((a, b) => b.value - a.value || Number(!!b.member) - Number(!!a.member));
    const option = options[0],
      pickReasons: string[] = [];
    if (option.fit) {
      pickReasons.push(recordReason(option.fit, '我方'));
      if (option.fit.sideBonus > 0) pickReasons.push('我方' + sideNames[our] + '有胜率优势');
    }
    if (h.typicalRoles.includes(option.role) && missingRoles.includes(option.role))
      pickReasons.push('补齐 ' + option.role + ' 号位');
    const gaps = functions.filter((t) => !tagCounts[t] && h.tags.includes(t));
    if (gaps.length) pickReasons.push('补充' + gaps.map((t) => tagLabels[t]).join('、'));
    let score = option.value + Math.min(14, gaps.length * 5);
    if (tagCounts.initiate && h.tags.includes('teamfight') && !tagCounts.teamfight) {
      score += 5;
      pickReasons.push('可衔接我方先手打团');
    } else if (tagCounts.frontline && h.tags.includes('save') && !tagCounts.save) {
      score += 5;
      pickReasons.push('可保护我方前排');
    }
    if (
      early &&
      (h.tags.includes('flex') || h.tags.includes('frontline') || h.tags.includes('laneDominator'))
    ) {
      score += our === draft.firstPickSide ? 8 : 5;
      pickReasons.push(h.tags.includes('flex') ? '前期可摇摆，保留分路选择' : '前期出场能稳住阵线');
    }
    if (edge.target) pickReasons.push('克制敌方' + edge.target);
    score +=
      edge.strength * (early ? 24 : step.phase === 3 && our !== draft.firstPickSide ? 68 : 56);
    if (!pickReasons.length) pickReasons.push('当前可选英雄');
    picksRanked.push({
      heroId: h.id,
      score: bounded(score),
      suggestedRole: option.role,
      suggestedPlayerId: option.member?.playerId ?? null,
      reasons: pickReasons,
    });
  }
  bans.sort(ranked);
  picksRanked.sort(ranked);
  return {
    currentStep: step,
    lineupAudit,
    banRecommendations: step.isCompleted
      ? []
      : bans.slice(0, 10).map((b) => ({ ...b, targetPlayers: b.targetPlayers.map(identity) })),
    pickRecommendations: step.isCompleted || ours.length === 5 ? [] : picksRanked.slice(0, 10),
    scoutingCard: {
      topBans: bans
        .filter((b) => b.targetPlayers.length)
        .slice(0, 5)
        .map((b) => ({
          heroId: b.heroId,
          score: b.score,
          owner: identity(b.targetPlayers[0]),
          tournament: record(b.targetPlayers[0].tournament),
          pub: record(b.targetPlayers[0].pub),
        })),
      flexPicks: flexPicks
        .sort(
          (a, b) =>
            b.players.length - a.players.length ||
            b.players[0].weightedScore - a.players[0].weightedScore,
        )
        .map((f) => ({ heroId: f.heroId, players: f.players.map(identity) })),
      comfortCombos: data.combos,
      sideProfile: { currentSide: enemy, radiant: data[enemy].radiant, dire: data[enemy].dire },
    },
  };
}
