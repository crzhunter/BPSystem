import type { DatabaseSync } from 'node:sqlite';
import { cmOrder, currentStep, opposite, sideNames, type Side } from '../data/cmOrder.ts';
import { listHeroes } from '../data/catalog.ts';
import { round, clamp } from '../data/heroMeta.ts';
import { counterNotes, synergy } from '../data/heroSynergy.ts';
import {
  diagnose,
  selection,
  fitCandidate,
  dimLabels,
  type Hero,
  type Selection,
  type Diagnosis,
} from './composition.ts';
import { slotsFor, type Action, type Draft } from './draftState.ts';
import { comfortCombos, scoutRoster, type Member } from './scouting.ts';

function context(db: DatabaseSync, draft: Draft) {
  const heroes = listHeroes(db);
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
function proficient(o: Owner) {
  return o.weightedScore >= 45 && (o.tournament.games >= 2 || o.pub.games >= 5);
}
const ranked = (a: { score: number; heroId: number }, b: { score: number; heroId: number }) =>
  b.score - a.score || a.heroId - b.heroId;

function matchupMatrix(db: DatabaseSync, picks: Action[]) {
  const matrix = new Map<string, { wins: number; games: number; source: string }>();
  if (!picks.length) return matrix;
  const ids = picks.map((a) => a.heroId),
    params = ids.map(() => '?').join(',');
  const patchRows = db
    .prepare(
      `SELECT * FROM patch_matchups WHERE hero_id IN (${params}) OR against_hero_id IN (${params})`,
    )
    .all(...ids, ...ids);
  for (const row of patchRows)
    matrix.set(row.hero_id + '/' + row.against_hero_id, {
      games: Number(row.games_played),
      wins: Number(row.wins),
      source: '本版职业赛',
    });
  const rows = db
    .prepare(
      `SELECT * FROM hero_matchups WHERE games_played>0 AND
    (hero_id IN (${params}) OR against_hero_id IN (${params}))`,
    )
    .all(...ids, ...ids);
  for (const r of rows)
    matrix.set(r.against_hero_id + '/' + r.hero_id, {
      games: Number(r.games_played),
      wins: Number(r.games_played) - Number(r.wins),
      source: '同步样本',
    });
  for (const r of rows) {
    // 仅同步已选英雄也可以从反向胜负推导候选英雄的对位。
    matrix.set(r.hero_id + '/' + r.against_hero_id, {
      wins: Number(r.wins),
      games: Number(r.games_played),
      source: '同步样本',
    });
  }
  return matrix;
}
type MatchNote = {
  vsHeroId: number;
  vsHeroName: string;
  kind: 'counter' | 'synergy';
  deltaPct: number | null;
  games?: number;
  text: string;
};
function matchup(
  h: Hero,
  allies: Selection[],
  enemies: Selection[],
  matrix: ReturnType<typeof matchupMatrix>,
) {
  const notes: MatchNote[] = [];
  let impact = 0;
  for (const { hero: e } of enemies) {
    const key = h.id + '/' + e.id,
      reverse = e.id + '/' + h.id;
    const direct = matrix.get(key),
      sample = direct ?? matrix.get(reverse);
    const tactic = counterNotes.get(key),
      threat = counterNotes.get(reverse);
    let deltaPct: number | null = null;
    if (sample) {
      const wins = direct ? sample.wins : sample.games - sample.wins;
      // 以英雄自身高分段胜率为基线，十场先验衰减小样本对排名的影响。
      deltaPct = round((100 * wins) / sample.games - (h.meta.baseWinrate ?? 50));
      impact += Math.max(-28, Math.min(28, (deltaPct * 2.5 * sample.games) / (sample.games + 10)));
    }
    if (tactic) impact += 17;
    if (threat) impact -= 17;
    const evidence = sample
      ? sample.source +
        '对阵' +
        e.cnName +
        ' ' +
        sample.games +
        ' 场，胜率较高分局基线 ' +
        (deltaPct! >= 0 ? '+' : '') +
        deltaPct +
        ' 个百分点'
      : '';
    if (sample || tactic || threat)
      notes.push({
        vsHeroId: e.id,
        vsHeroName: e.cnName,
        kind: 'counter',
        deltaPct,
        games: sample?.games,
        text: [evidence, tactic || (threat ? e.cnName + '可反制：' + threat : '')]
          .filter(Boolean)
          .join('。'),
      });
  }
  for (const { hero: a } of allies) {
    const note = synergy.get(h.id + '/' + a.id);
    if (note) {
      impact += 17;
      notes.push({
        vsHeroId: a.id,
        vsHeroName: a.cnName,
        kind: 'synergy',
        deltaPct: null,
        text: '与' + a.cnName + '配合：' + note,
      });
    }
  }
  return { notes, impact: clamp(42 + impact) };
}
const cheeseHeroes = new Set([59, 61, 80, 82, 89, 113]);
const banLabels = {
  meta_op: '版本强势',
  protect_core: '保护核心',
  deny_piece: '拆解体系',
  cheese_24th: '末手奇招',
  player_signature: '选手绝活',
};
function weights(members: Member[], lineSize: number, phase: number) {
  const dataSlots = members.filter((m) => m.pool.size > 0).length;
  let confidence = 0;
  for (const member of members)
    for (const h of member.pool.values()) {
      confidence = Math.max(confidence, Math.min(1, (3 * h.tournament.games + h.pub.games) / 15));
    }
  const player = dataSlots ? confidence * Math.min(0.42, 0.31 + 0.025 * dataSlots) : 0;
  const meta = lineSize === 0 ? 0.54 : 0.34,
    composition = lineSize === 0 ? 0.21 : 0.38,
    matchup = phase === 3 ? 0.21 : 0.17;
  return {
    meta: meta * (1 - player),
    composition: composition * (1 - player),
    matchup: matchup * (1 - player),
    strategy: (1 - meta - composition - matchup) * (1 - player),
    player,
  };
}
function candidate(
  h: Hero,
  allies: Selection[],
  enemies: Selection[],
  audit: Diagnosis,
  members: Member[],
  side: Side,
  draft: Draft,
  phase: number,
  isBan: boolean,
  matrix: ReturnType<typeof matchupMatrix>,
  w: ReturnType<typeof weights>,
) {
  const who = isBan ? '敌方' : '我方',
    fit = fitCandidate(h, allies, audit, who);
  const options = owners(h.id, members, side);
  const vacant = members.filter((m) => audit.missingRoles.includes(m.role));
  const owner =
    options.find(
      (o) =>
        isBan || (vacant.some((m) => m.playerId === o.playerId) && h.typicalRoles.includes(o.role)),
    ) ?? options.find((o) => isBan || audit.missingRoles.includes(o.role));
  const role =
    owner?.role ??
    (audit.missingRoles.includes(fit.role)
      ? fit.role
      : (audit.missingRoles.find((r) => h.typicalRoles.includes(r)) ??
        audit.missingRoles[0] ??
        fit.role));
  const m = h.meta;
  const sideSample = m.sideBias?.[side];
  const sideText = sideSample?.games
    ? '本版职业赛' + sideNames[side] + ' ' + sideSample.wins + ' 胜 / ' + sideSample.games + ' 场'
    : '';
  const metaSummary = {
    tier: m.tier,
    sideText,
    sampledAt: m.sampledAt,
    highMmrPicks: m.counts['7_pick'] + m.counts['8_pick'],
    winrate: m.highMmrWinrate,
    pickRate: m.pickRate,
    proContestedRate: m.proContestedRate,
    text:
      m.patch +
      ' 版本 ' +
      m.tier +
      ' · 高分局' +
      (m.highMmrWinrate === null ? '暂无胜率' : '胜率 ' + m.highMmrWinrate + '%') +
      ' · 职业赛 BP 率 ' +
      m.proContestedRate +
      '%',
  };
  const edge = matchup(h, allies, enemies, matrix);
  const flex = h.typicalRoles.length > 1;
  const cheese = phase === 3 && side !== draft.firstPickSide && cheeseHeroes.has(h.id);
  const strategy =
    phase === 1
      ? flex
        ? side === draft.firstPickSide
          ? 96
          : 83
        : 45
      : cheese
        ? 95
        : side === draft.firstPickSide
          ? 50
          : 62;
  const playerValue = owner ? clamp(owner.weightedScore + owner.sideBonus) : 0;
  const flexThreat = isBan && options.filter(proficient).length >= 2 ? (phase === 1 ? 12 : 6) : 0;
  const score = round(
    clamp(
      flexThreat +
        w.meta * m.strength +
        w.composition * fit.value +
        w.matchup * edge.impact +
        w.strategy *
          clamp(
            strategy +
              (sideSample
                ? (28 * (sideSample.wins - sideSample.games / 2)) / (sideSample.games + 10)
                : 0),
          ) +
        w.player * playerValue,
    ),
  );
  const danger = edge.notes.find(
    (n) =>
      n.kind === 'counter' &&
      enemies.some(e => e.hero.id === n.vsHeroId && (e.role ?? e.hero.typicalRoles[0]) <= 3) &&
      (counterNotes.has(h.id + '/' + n.vsHeroId) || ((n.deltaPct ?? 0) > 2 && (n.games ?? 0) >= 5)),
  );
  const duo = edge.notes.find((n) => n.kind === 'synergy');
  const fillsThreat = allies.length >= 2 && !!fit.fit.fillsRole && fit.value >= 75;
  const category =
    owner && proficient(owner)
      ? 'player_signature'
      : danger
        ? 'protect_core'
        : duo
          ? 'deny_piece'
          : cheese
            ? 'cheese_24th'
            : 'meta_op';
  const playerFit = owner
    ? {
        playerName: owner.name,
        role: owner.role,
        ...(owner.tournament.games ? { tournamentRecord: record(owner.tournament) } : {}),
        ...(owner.pub.games ? { pubRecord: record(owner.pub) } : {}),
        text:
          owner.name +
          ' · ' +
          owner.role +
          ' 号位 · ' +
          [
            owner.tournament.games
              ? '赛事 ' + owner.tournament.wins + ' 胜 / ' + owner.tournament.games + ' 场'
              : '',
            owner.pub.games ? '路人 ' + owner.pub.wins + ' 胜 / ' + owner.pub.games + ' 场' : '',
            owner.sideGames
              ? sideNames[side] + ' ' + owner.sideWins + ' 胜 / ' + owner.sideGames + ' 场'
              : '',
          ]
            .filter(Boolean)
            .join('，'),
      }
    : undefined;
  const motivation = {
    player_signature: '限制' + (owner?.name ?? '对手') + '的熟练英雄',
    protect_core: '为我方核心移除不利对位',
    deny_piece: '拆掉敌方已亮英雄的配合点',
    cheese_24th: '防止后选方末手拿出难以临场应对的核心',
    meta_op: '压缩对手可抢的强势英雄池',
  }[category];
  const detailReason =
    category === 'player_signature'
      ? playerFit?.text
      : category === 'deny_piece'
        ? (duo?.text ?? fit.fit.text)
        : category === 'protect_core'
          ? edge.notes.find(
              (n) =>
                n.kind === 'counter' &&
                (counterNotes.has(h.id + '/' + n.vsHeroId) || (n.deltaPct ?? 0) > 2),
            )?.text
          : undefined;
  const whyBan =
    motivation +
    '。' +
    (detailReason ? detailReason + '。' : '') +
    '职业赛 ' +
    m.counts.pro_pick +
    ' 选 ' +
    m.counts.pro_ban +
    ' 禁，争夺率 ' +
    m.proContestedRate +
    '%。';
  const details = {
    metaSummary,
    compositionFit: fit.fit,
    matchupDetails: edge.notes,
    ...(playerFit ? { playerFit } : {}),
    ...(isBan ? { banCategory: category, whyBan } : {}),
  };
  return {
    heroId: h.id,
    cnName: h.cnName,
    localizedName: h.localizedName,
    portraitUrl: h.portraitUrl,
    primaryAttr: h.primaryAttr,
    tier: m.tier,
    score,
    suggestedRole: role,
    suggestedPlayerId: owner?.playerId ?? null,
    shortTags: isBan ? [banLabels[category], m.tier] : [role + ' 号位', flex ? '可摇摆' : m.tier],
    reasons: [
      isBan ? whyBan : fit.fit.text,
      ...fit.fit.boostedDims.map((k) => dimLabels[k] + ' +' + fit.fit.delta[k]),
      ...edge.notes.map((n) => n.text),
      metaSummary.text,
    ],
    ...details,
    details,
    targetPlayers: options.map(identity),
  };
}
export function recommend(db: DatabaseSync, draft: Draft, previewHeroId?: number) {
  const data = localContext(db, draft),
    our = draft.ourSide,
    enemy = opposite(our),
    order = cmOrder(draft.firstPickSide, draft.cmOrderVersion);
  const step = currentStep(draft.firstPickSide, our, draft.actions.length, draft.cmOrderVersion);
  const picks = (side: Side) =>
    draft.actions.filter((_, i) => order[i].side === side && order[i].actionType === 'pick');
  const ours = picks(our),
    theirs = picks(enemy);
  const allies = selection(ours, slotsFor(draft, our), data.byId),
    enemies = selection(theirs, slotsFor(draft, enemy), data.byId);
  const ourAudit = diagnose(allies),
    theirAudit = diagnose(enemies);
  const available = (members: Member[], picks: Action[]) =>
    members.filter((m) => !picks.some((a) => a.assignedPlayerId === m.playerId));
  const own = available(data[our].members, ours),
    opp = available(data[enemy].members, theirs);
  const pickWeights = weights(own, allies.length, step.phase),
    banWeights = weights(opp, enemies.length, step.phase);
  const matrix = matchupMatrix(db, [...ours, ...theirs]),
    used = new Set(draft.actions.map((a) => a.heroId));
  const bans = [],
    picksRanked = [],
    topBans = [],
    flexPicks = [];
  for (const h of data.heroes) {
    if (used.has(h.id) || step.isCompleted) continue;
    if (ours.length < 5)
      picksRanked.push(
        candidate(
          h,
          allies,
          enemies,
          ourAudit,
          own,
          our,
          draft,
          step.phase,
          false,
          matrix,
          pickWeights,
        ),
      );
    if (theirs.length === 5) continue;
    const ban = candidate(
      h,
      enemies,
      allies,
      theirAudit,
      opp,
      enemy,
      draft,
      step.phase,
      true,
      matrix,
      banWeights,
    );
    bans.push(ban);
    const targets = owners(h.id, opp, enemy);
    if (targets.length) {
      const o = targets[0];
      topBans.push({
        heroId: h.id,
        score: ban.score,
        owner: identity(o),
        tournament: record(o.tournament),
        pub: record(o.pub),
      });
      const flex = targets.filter(proficient);
      if (flex.length > 1) flexPicks.push({ heroId: h.id, players: flex.map(identity) });
    }
  }
  const side = step.actionType === 'pick' ? step.side : opposite(step.side);
  const h =
    previewHeroId && !used.has(previewHeroId) && !step.isCompleted
      ? data.byId.get(previewHeroId)
      : undefined;
  const line = side === our ? allies : enemies;
  const preview =
    h && line.length < 5
      ? {
          heroId: h.id,
          side,
          denied: step.actionType === 'ban',
          ...fitCandidate(
            h,
            line,
            side === our ? ourAudit : theirAudit,
            side === our ? '我方' : '敌方',
          ).fit,
        }
      : null;
  return {
    currentStep: step,
    lineupAudit: ourAudit,
    composition: { our: ourAudit, enemy: theirAudit },
    preview,
    weights: { pick: pickWeights, ban: banWeights },
    patch: data.heroes[0]?.meta.patch,
    banRecommendations: bans.sort(ranked).slice(0, 10),
    pickRecommendations: picksRanked.sort(ranked).slice(0, 10),
    scoutingCard: {
      topBans: topBans.sort(ranked).slice(0, 5),
      flexPicks: flexPicks.sort((a, b) => b.players.length - a.players.length),
      comfortCombos: data.combos,
      sideProfile: { currentSide: enemy, radiant: data[enemy].radiant, dire: data[enemy].dire },
    },
  };
}
