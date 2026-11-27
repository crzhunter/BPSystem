import { motion } from 'framer-motion';
import { SegmentedControl, Reveal, spring } from './MotionControls';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
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
  const [expanded, setExpanded] = useState<number[]>([]);
  const reflectionFrame = useRef(0);
  const pointer = useRef<{ card: HTMLElement; x: number; y: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(reflectionFrame.current), []);
  function reflect(event: PointerEvent<HTMLElement>) {
    pointer.current = { card: event.currentTarget, x: event.clientX, y: event.clientY };
    if (reflectionFrame.current) return;
    // 仅普通推荐卡追踪指针，每帧使用最后一个坐标，避免使玻璃采样面失效。
    reflectionFrame.current = requestAnimationFrame(() => {
      reflectionFrame.current = 0;
      const { card, x, y } = pointer.current!;
      const rect = card.getBoundingClientRect();
      const px = x - rect.left,
        py = y - rect.top;
      const angle = Math.atan2(py - rect.height / 2, px - rect.width / 2);
      card.style.setProperty('--px', px + 'px');
      card.style.setProperty('--py', py + 'px');
      card.style.setProperty('--spec-angle', Math.round((angle * 180) / Math.PI + 90) + 'deg');
    });
  }
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
        <small>{data.patch} 天梯加权综合（高分主导）</small>
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
                onPointerMove={reflect}
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
                <div className="card-detail">
                  <button
                    aria-expanded={expanded.includes(r.heroId)}
                    onClick={() =>
                      setExpanded((ids) =>
                        ids.includes(r.heroId)
                          ? ids.filter((id) => id !== r.heroId)
                          : [...ids, r.heroId],
                      )
                    }
                  >
                    {expanded.includes(r.heroId) ? '收起拆解' : '展开详细拆解'}
                  </button>
                  <Reveal open={expanded.includes(r.heroId)}>
                    <dl>
                      <dt>天梯战绩</dt>
                      <dd
                        title={
                          r.metaSummary.sampledAt.slice(0, 10) +
                          ' · 天梯合计 ' +
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
                  </Reveal>
                </div>
              </motion.article>
            ))}
          </div>
          <div className="rec-compact">
            {rows.slice(3).map((r, i) => (
              <motion.button
                layout="position"
                layoutId={'recommend-' + r.heroId}
                transition={spring}
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
              </motion.button>
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
