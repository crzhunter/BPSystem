import { round } from '../data/heroMeta.ts';
import type { Side } from '../data/cmOrder.ts';
import { dims, type Diagnosis, type Selection } from './composition.ts';

type Line = { picks: Selection[]; audit: Diagnosis };
type Edge = (hero: Selection['hero'], allies: Selection[], enemies: Selection[]) => number;
const average = (values: number[], neutral = 0) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : neutral;

export function forecast(ours: Line, theirs: Line, ourSide: Side, edge: Edge) {
  const radiant = ourSide === 'radiant' ? ours : theirs,
    dire = ourSide === 'dire' ? ours : theirs;
  const meta = (l: Line) => average(l.picks.map((p) => p.hero.meta.strength - 45));
  const match = (l: Line, other: Line) =>
    average(
      l.picks.map(
        (p) =>
          edge(
            p.hero,
            l.picks.filter((a) => a !== p),
            other.picks,
          ) - 42,
      ),
    );
  const shape = (l: Line) =>
    average(dims.map((d) => l.audit.scores[d])) +
    3 * l.audit.coveredRoles.length +
    3 * Number(l.audit.tagCounts.save > 0);
  const side = (l: Line, side: Side) =>
    average(
      l.picks.map((p) => {
        const s = p.hero.meta.sideBias?.[side];
        return s ? (s.wins - s.games / 2) / (s.games + 20) : 0;
      }),
    );
  // 单位均为天辉视角的百分点。亮人少时收缩，避免首选一手就报出悬殊胜率。
  const confidence = Math.min(1, (ours.picks.length + theirs.picks.length) / 6);
  const breakdown = {
    metaEdge: round((meta(radiant) - meta(dire)) * 0.16 * confidence),
    matchupEdge: round((match(radiant, dire) - match(dire, radiant)) * 0.12 * confidence),
    compositionEdge: round((shape(radiant) - shape(dire)) * 0.1 * confidence),
    sideEdge: round(0.4 + 4 * (side(radiant, 'radiant') - side(dire, 'dire'))),
  };
  const radiantWinProb = round(
    Math.max(30, Math.min(70, 50 + Object.values(breakdown).reduce((s, n) => s + n, 0))),
  );
  const direWinProb = round(100 - radiantWinProb),
    diff = round((ourSide === 'radiant' ? radiantWinProb : direWinProb) - 50);
  const factors = {
    metaEdge: '版本强度',
    matchupEdge: '英雄对位',
    compositionEdge: '阵容配合',
    sideEdge: '阵营侧重',
  };
  const main = (Object.keys(factors) as (keyof typeof factors)[]).sort(
    (a, b) => Math.abs(breakdown[b]) - Math.abs(breakdown[a]),
  )[0];
  const summary =
    Math.abs(diff) < 1
      ? '双方 BP 接近均势'
      : '我方' +
        (diff > 0 ? (diff >= 6 ? '占优' : '小优') : diff <= -6 ? '落后' : '小劣') +
        '（' +
        (diff > 0 ? '+' : '') +
        diff.toFixed(1) +
        ' 个百分点），' +
        factors[main] +
        '影响最大';
  const bpAdvantage = { radiantWinProb, direWinProb, ...breakdown, summary };

  function lane(l: Line, roles: number[]) {
    return l.picks.filter((_, i) => roles.includes(l.audit.assignments[i].role ?? 0));
  }
  function pressure(l: Selection[], other: Selection[]) {
    const mixed = new Set(l.map((p) => p.hero.attackType)).size > 1;
    return (
      average(
        l.map(
          (p) =>
            (p.hero.tags.includes('laneDominator') ? 15 : 0) + (edge(p.hero, [], other) - 42) * 0.6,
        ),
      ) + (mixed ? 4 : 0)
    );
  }
  const laneForecast =
    ours.picks.length < 2 || theirs.picks.length < 2
      ? []
      : [
          { label: '优势路', us: [1, 5], them: [3, 4] },
          { label: '中路', us: [2], them: [2] },
          { label: '劣势路', us: [3, 4], them: [1, 5] },
        ].map(({ label, us, them }, i) => {
          const allies = lane(ours, us),
            enemies = lane(theirs, them);
          const score =
            allies.length && enemies.length
              ? round(pressure(allies, enemies) - pressure(enemies, allies))
              : null;
          const location =
            i === 1 ? '中路' : (i === 0) === (ourSide === 'radiant') ? '下路' : '上路';
          return {
            label,
            location,
            ourHeroes: allies.map((p) => p.hero.id),
            enemyHeroes: enemies.map((p) => p.hero.id),
            partial: allies.length < us.length || enemies.length < them.length,
            score,
            verdict:
              score === null
                ? '待亮人'
                : score >= 15
                  ? '强优'
                  : score >= 4
                    ? '小优'
                    : score <= -15
                      ? '劣势'
                      : score <= -4
                        ? '小劣'
                        : '均势',
          };
        });
  return { bpAdvantage, laneForecast };
}
