import { motion } from 'framer-motion';
import { SegmentedControl, Reveal, spring } from './MotionControls';
import { useState, type CSSProperties, type ReactNode } from 'react';
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
  actionText,
  actionType,
  canLock,
}: {
  data: Advice;
  turn: string;
  select: (id: number) => void;
  lock: (id: number) => void;
  pending: number | null;
  scouting?: ReactNode;
  preference: RolePreference;
  setPreference: (value: RolePreference) => void;
  actionText: string;
  actionType: 'pick' | 'ban';
  canLock: boolean;
  planAction?: 'pick' | 'ban';
}) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const active = data.currentStep.actionType;
  const [choice, setChoice] = useState<{ turn: string; tab: Tab }>();
  const tab =
    choice?.turn === turn && (choice.tab !== 'scout' || scouting)
      ? choice.tab
      : (planAction ?? active);
  const rows = tab === 'ban' ? data.banRecommendations : data.pickRecommendations;
  const titles = { pick: '我方选人', ban: '我方禁用', scout: '对手情报' };
  function toggle(id: number) {
    select(id);
    setExpanded((ids) => (ids.includes(id) ? ids.filter((n) => n !== id) : [...ids, id]));
  }
  function confirm(id: number) {
    return (
      <button
        type="button"
        className={'card-lock satin-btn ' + actionType}
        disabled={!canLock}
        onClick={() => lock(id)}
      >
        {actionText}
      </button>
    );
  }
  function detail(r: (typeof rows)[number]) {
    return (
      <Reveal open={expanded.includes(r.heroId)}>
        <dl>
          <dt>天梯战绩</dt>
          <dd>
            {r.metaSummary.text} · 采样 {r.metaSummary.games.toLocaleString()} 场{' '}
            {r.metaSummary.sideText}
          </dd>
          <dt>推荐理由</dt>
          <dd>
            {r.tips.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </dd>
          <dt>分项贡献</dt>
          <dd className="score-parts">
            {(
              [
                ['meta', '版本'],
                ['composition', '阵容'],
                ['matchup', '对位'],
                ['strategy', '轮次'],
                ['player', '选手'],
              ] as const
            ).map(([k, label]) => (
              <span key={k}>
                {label} {r.scoreBreakdown[k].toFixed(1)}
              </span>
            ))}
          </dd>
          <dt>{tab === 'ban' ? '禁用动机' : '阵容补足'}</dt>
          <dd>{tab === 'ban' ? r.whyBan : r.compositionFit.text}</dd>
          <dt>克制与协同</dt>
          <dd>
            {r.matchupDetails.length
              ? r.matchupDetails.map((n) => <p key={n.kind + n.vsHeroId}>{n.text}</p>)
              : '当前盘面暂无已知克制或配合记录。'}
          </dd>
          <dt>选手英雄池</dt>
          <dd>{r.playerFit?.text ?? '暂无对应位置的选手样本。'}</dd>
        </dl>
        {confirm(r.heroId)}
      </Reveal>
    );
  }
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
          {data.patch} ·{' '}
          {tab === 'scout' ? '对手侦察' : data.mode[tab] === 'team' ? '战队模式' : '自由模式'}
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
          <SegmentedControl<RolePreference>
            key={group[0]}
            label="优先位置"
            value={preference}
            onChange={setPreference}
            options={group.map((value) => ({
              value,
              label:
                value === 'auto'
                  ? '随手数'
                  : value === 'core'
                    ? '核心'
                    : value === 'support'
                      ? '辅助'
                      : value,
            }))}
          />
        ))}
        {tab !== 'scout' && (
          <p aria-live="polite">
            {data.roleModes[tab].mode === preference
              ? data.roleModes[tab].description
              : '正在重排英雄…'}
          </p>
        )}
      </fieldset>
      <SegmentedControl<Tab>
        className="rec-tabs"
        label="推荐类型"
        value={tab}
        onChange={(tab) => setChoice({ turn, tab })}
        options={(['pick', 'ban', ...(scouting ? ['scout'] : [])] as Tab[]).map((value) => ({
          value,
          label: titles[value],
        }))}
      />
      {tab === 'scout' ? (
        scouting
      ) : (
        <>
          <div className="deep-cards">
            {rows.slice(0, 3).map((r, i) => (
              <motion.article
                layout="position"
                layoutId={'recommend-' + r.heroId}
                style={{ '--hero-art': `url("/portraits/${r.heroId}.webp")` } as CSSProperties}
                transition={spring}

                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button,.card-detail')) select(r.heroId);
                }}
                key={r.heroId}
                className={'decision rank-' + (i + 1) + (pending === r.heroId ? ' selected' : '')}
              >
                <div className="decision-header">
                  <button
                    className="decision-lead"
                    aria-label={'预选' + r.cnName}
                    onClick={() => select(r.heroId)}
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
                  {confirm(r.heroId)}
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
                <div className="card-detail">
                  <button
                    aria-expanded={expanded.includes(r.heroId)}
                    onClick={() => toggle(r.heroId)}
                  >
                    {expanded.includes(r.heroId) ? '收起拆解' : '展开详细拆解'}
                  </button>
                  {detail(r)}
                </div>
              </motion.article>
            ))}
          </div>
          <div className="rec-compact">
            {rows.slice(3).map((r, i) => (
              <article
                key={r.heroId}
                className={'decision compact-row' + (pending === r.heroId ? ' selected' : '')}
              >
                <div
                  className="compact-head"
                  onClick={(e) => {
                    if (!(e.target as Element).closest('button')) toggle(r.heroId);
                  }}
                >
                  <button
                    className="compact-summary"
                    aria-expanded={expanded.includes(r.heroId)}
                    onClick={() => toggle(r.heroId)}
                  >
                    <small>#{i + 4}</small>
                    <Portrait hero={{ ...r, id: r.heroId }} />
                    <b>{r.cnName}</b>
                    <span>{r.roleLabel}</span>
                    <strong>{r.score.toFixed(1)}</strong>
                  </button>
                  {confirm(r.heroId)}
                </div>
                <div className="card-detail">{detail(r)}</div>
              </article>
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
