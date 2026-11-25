import { useState } from 'react';
import { Activity } from 'lucide-react';
import { type Advice, type Side, sideNames } from './draftModel';
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
  preview,
}: {
  data: Advice;
  our: Side;
  preview: Advice['preview'];
}) {
  const [view, setView] = useState<'our' | 'enemy'>('our');
  const key = preview ? (preview.side === our ? 'our' : 'enemy') : view,
    c = data.composition[key],
    damage = c.damageProfile;
  return (
    <section className="meter bp-box" id="composition">
      <div className="bp-section-title">
        <h2>
          <Activity />
          阵容诊断
        </h2>
        <div className="role-chips">
          {(['our', 'enemy'] as const).map((v) => (
            <button
              key={v}
              disabled={!!preview}
              onClick={() => setView(v)}
              aria-pressed={key === v}
            >
              {v === 'our' ? '我方' : '对方'}
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
        {[...c.warnings, ...c.strengths].map((t) => (
          <span key={t} className={c.strengths.includes(t) ? 'strength' : ''}>
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}
