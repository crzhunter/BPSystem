import { useState, type ReactNode } from 'react';
import { Crosshair, Trophy } from 'lucide-react';
import { type Advice } from './draftModel';
import { Portrait } from './HeroPoolGrid';
import type { RolePreference } from '../../server/src/services/rolePriority';
type Tab = 'pick' | 'ban' | 'scout';
export function RecommendationPanel({
  data,
  turn,
  select,
  lock,
  pending,
  scouting,
  preference,
  setPreference,
  planAction,
}: {
  data: Advice;
  turn: string;
  select: (id: number) => void;
  lock: (id: number) => void;
  pending: number | null;
  scouting?: ReactNode;
  preference: RolePreference;
  setPreference: (value: RolePreference) => void;
  planAction?: 'pick' | 'ban';
}) {
  const active = data.currentStep.actionType;
  const [choice, setChoice] = useState<{ turn: string; tab: Tab }>();
  const tab =
    choice?.turn === turn && (choice.tab !== 'scout' || scouting)
      ? choice.tab
      : (planAction ?? active);
  const rows = tab === 'ban' ? data.banRecommendations : data.pickRecommendations;
  const titles = { pick: '我方选人', ban: '我方禁用', scout: '对手情报' };
  return (
    <section className="rec-panel bp-box" id="recommendations">
      <div className="bp-section-title">
        <h2>
          <Crosshair />
          {data.currentStep.isCompleted
            ? '禁选结束'
            : data.currentStep.isOurTurn
              ? '本手推荐'
              : planAction
                ? '我方下一手预案'
                : '我方禁选已结束'}
        </h2>
        <small>
          {data.patch} · {data.bracketNote}
        </small>
      </div>
      <fieldset className="position-choice">
        <legend>优先位置</legend>
        {(
          [
            ['auto', 'support', 'core'],
            [1, 2, 3, 4, 5],
          ] as const
        ).map((group) => (
          <div className="role-chips" key={group[0]}>
            {group.map((value) => (
              <button
                key={value}
                aria-pressed={preference === value}
                onClick={() => setPreference(value)}
              >
                {value === 'auto'
                  ? '随手数'
                  : value === 'core'
                    ? '核心'
                    : value === 'support'
                      ? '辅助'
                      : value}
              </button>
            ))}
          </div>
        ))}
        {tab !== 'scout' && (
          <p aria-live="polite">
            {data.roleModes[tab].mode === preference
              ? data.roleModes[tab].description
              : '正在重排英雄…'}
          </p>
        )}
      </fieldset>
      <div className="rec-tabs">
        {(['pick', 'ban', ...(scouting ? ['scout'] : [])] as Tab[]).map((k) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setChoice({ turn, tab: k })}>
            {titles[k]}
          </button>
        ))}
      </div>
      {tab === 'scout' ? (
        scouting
      ) : (
        <>
          <div className="deep-cards">
            {rows.slice(0, 3).map((r, i) => (
              <article
                key={r.heroId}
                className={'decision rank-' + (i + 1) + (pending === r.heroId ? ' selected' : '')}
              >
                <div className="decision-header">
                  <button
                    className="decision-lead"
                    aria-label={'预选' + r.cnName}
                    onClick={() => select(r.heroId)}
                    onDoubleClick={() => lock(r.heroId)}
                  >
                    <div className="decision-face">
                      <Portrait hero={{ ...r, id: r.heroId }} />
                      <span>
                        #{i + 1}
                        {!i ? ' 首推' : ''}
                      </span>
                    </div>
                    <div className="decision-name">
                      <h3>{r.cnName}</h3>
                      <small>
                        {r.tier} · {r.roleLabel}
                      </small>
                    </div>
                    <b className="decision-score">
                      {r.score.toFixed(1)}
                      <small>推荐分</small>
                    </b>
                  </button>
                  <button
                    className="card-lock"
                    disabled={data.currentStep.isCompleted}
                    onClick={() => lock(r.heroId)}
                  >
                    {data.currentStep.isOurTurn ? (active === 'ban' ? '禁用' : '选用') : '录入对方'}
                  </button>
                </div>
                <div className="card-stats">
                  {r.metaSummary.text}
                  {r.shortTags[0].includes('绝活') && <b>{r.shortTags[0]}</b>}
                </div>
                <ul className="card-tips">
                  {r.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
                <details className="card-detail">
                  <summary>展开详细拆解</summary>
                  <dl>
                    <dt>天梯战绩</dt>
                    <dd
                      title={
                        r.metaSummary.sampledAt.slice(0, 10) +
                        ' · 该分段 ' +
                        r.metaSummary.games +
                        ' 次选取'
                      }
                    >
                      {r.metaSummary.text} · 选了 {r.metaSummary.games.toLocaleString()} 场
                      {r.metaSummary.sideText && <p>{r.metaSummary.sideText}</p>}
                    </dd>
                    <dt>{tab === 'ban' ? '禁用动机' : '阵容补足'}</dt>
                    <dd>
                      {tab === 'ban' ? (
                        <>
                          <b className="ban-kind">{r.shortTags[0]}</b>
                          {r.whyBan}
                        </>
                      ) : (
                        r.compositionFit.text
                      )}
                    </dd>
                    <dt>克制与协同</dt>
                    <dd>
                      {r.matchupDetails.length
                        ? r.matchupDetails.map((n) => <p key={n.kind + n.vsHeroId}>{n.text}</p>)
                        : data.composition.our.assignments.length +
                            data.composition.enemy.assignments.length
                          ? '当前对阵暂无已知配合或克制记录。'
                          : '双方尚未亮出英雄，优先参考版本强度与摇摆空间。'}
                    </dd>
                    {r.playerFit && (
                      <>
                        <dt>选手英雄池</dt>
                        <dd>{r.playerFit.text}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </article>
            ))}
          </div>
          <div className="rec-compact">
            {rows.slice(3).map((r, i) => (
              <button
                key={r.heroId}
                aria-pressed={pending === r.heroId}
                onClick={() => select(r.heroId)}
                onDoubleClick={() => lock(r.heroId)}
              >
                <small>#{i + 4}</small>
                <Portrait hero={{ ...r, id: r.heroId }} />
                <b>{r.cnName}</b>
                {r.shortTags[0].includes('绝活') && (
                  <small className="compact-signature">{r.shortTags[0]}</small>
                )}
                <span>{r.roleLabel}</span>
                <strong>{r.score.toFixed(1)}</strong>
              </button>
            ))}
          </div>
          {!rows.length && (
            <p className="blank-rec">
              <Trophy size={16} /> 本局已完成该项禁选
            </p>
          )}
        </>
      )}
    </section>
  );
}
