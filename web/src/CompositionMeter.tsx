import { useState } from 'react';
import { Activity } from 'lucide-react';
import { type Advice, type Side, sideNames } from './draftModel';
import { Portrait } from './HeroPoolGrid';
const names = {
  disable: '先手硬控',
  frontline: '前排承伤',
  burst: '爆发伤害',
  sustain: '持续输出',
  push: '推进拆塔',
  teamfight: '团战反手',
};
export function CompositionMeter({
  data,
  our,
  preview: candidate,
  select,
}: {
  data: Advice;
  our: Side;
  preview: Advice['preview'];
  select: (id: number) => void;
}) {
  const [view, setView] = useState<'our' | 'enemy'>('our');
  const key = view,
    preview = candidate && (candidate.side === our) === (key === 'our') ? candidate : null,
    c = data.composition[view],
    damage = c.damageProfile;
  const risks =
    key === 'our'
      ? data.composition.our.weaknesses.map((w) => ({ ...w, heroes: w.fixHeroes }))
      : data.composition.enemy.exploitableWeaknesses.map((w) => ({
          ...w,
          heroes: w.counterHeroes,
        }));
  return (
    <section className="meter bp-box" id="composition">
      <div className="bp-section-title">
        <h2>
          <Activity />
          阵容诊断
        </h2>
        <div className="role-chips">
          {(['our', 'enemy'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={key === v}>
              {v === 'our' ? '我方补强' : '敌方破阵'}
            </button>
          ))}
        </div>
      </div>
      <div className="coverage-line">
        <span>位置覆盖</span>
        {[1, 2, 3, 4, 5].map((r) => (
          <b
            key={r}
            className={c.coveredRoles.includes(r) ? 'on' : preview?.fillsRole === r ? 'gain' : ''}
            title={r + ' 号位' + (c.coveredRoles.includes(r) ? '已覆盖' : '待补齐')}
          >
            {r}
          </b>
        ))}
        <small>{c.assignments.filter((a) => a.flexRoles.length).length} 名可摇摆</small>
      </div>
      <div className="six-bars">
        {(Object.keys(names) as (keyof typeof names)[]).map((k) => (
          <div key={k}>
            <label>
              {names[k]}
              <b>
                {c.scores[k]}
                {preview && preview.delta[k] > 0 && <em> +{preview.delta[k]}</em>}
              </b>
            </label>
            <div className="bar-base">
              <i style={{ width: c.scores[k] + '%' }} />
              <i className="gain" style={{ width: (preview?.delta[k] ?? 0) + '%' }} />
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <p className="preview-text">
          {sideNames[preview.side]}
          {preview.denied ? '若拿到此英雄' : '选入后'} · {preview.text}
        </p>
      )}
      <div className="damage-line">
        <span>预估输出</span>
        <div>
          <i style={{ width: damage.physicalPct + '%' }} />
          <i style={{ width: damage.magicPct + '%' }} />
          <i style={{ width: damage.purePct + '%' }} />
        </div>
        <small>
          物 {damage.physicalPct}% / 法 {damage.magicPct}% / 纯 {damage.purePct}%
        </small>
      </div>
      <p className="range-line">
        近战 {c.rangeBalance.meleeCount} · 远程 {c.rangeBalance.rangedCount}
      </p>
      <div className="diag-pills">
        {c.strengths.map((t) => (
          <span key={t} className="strength">
            {t}
          </span>
        ))}
      </div>
      {!c.assignments.length && (
        <p className="range-line">等待{key === 'our' ? '我方' : '敌方'}亮出首个英雄。</p>
      )}
      <div className="draft-risks">
        {risks.map((w) => (
          <article key={w.id} data-severity={w.severity}>
            <strong>{w.title}</strong>
            <p>{w.detail}</p>
            {!!w.heroes.length && <small>{key === 'our' ? '我方可补' : '我方可拿来克制'}</small>}
            <div>
              {w.heroes.map((h) => (
                <button
                  key={h.heroId}
                  title={h.reason}
                  onClick={() => select(h.heroId)}
                  aria-label={'选择' + h.cnName + '，' + h.reason}
                >
                  <Portrait hero={{ ...h, id: h.heroId }} />
                  {h.cnName}
                  <small>{h.role}号位</small>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
