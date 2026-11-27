import { useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Popover, Reveal } from './MotionControls';
import { Shield, Swords, Ban, Sprout, Flame, Flag } from 'lucide-react';
import {
  cmOrder,
  currentStep,
  sideNames,
  sides,
  slotsKey,
  teamKey,
  type Room,
  type Action,
  type Advice,
} from './draftModel';
import type { Hero, Player, Team } from './api';
import { Portrait } from './HeroPoolGrid';

export function DraftHud({
  d,
  heroes,
  players,
  teams,
  assign,
  replace,
  replacing,
  advice,
}: {
  d: Room;
  heroes: Hero[];
  players: Player[];
  teams: Team[];
  assign: (i: number, a: Action) => void;
  replace: (i: number) => void;
  replacing: number | null;
  advice?: Advice;
}) {
  const [open, setOpen] = useState<{ i: number; x: number; y: number }>();
  const [lanes, setLanes] = useState(false);
  const order = cmOrder(d.firstPickSide, d.cmOrderVersion),
    step = currentStep(d.firstPickSide, d.ourSide, d.actions.length, d.cmOrderVersion);
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const next = order[d.actions.length + 1];
  const advantage = advice?.bpAdvantage;
  return (
    <>
      <div className="hud-sides">
        {sides.map((s) => {
          const team = order.filter((t) => t.side === s),
            slots = d[slotsKey(s)],
            first = d.firstPickSide === s,
            Icon = s === 'radiant' ? Sprout : Flame;
          const hasRoster = !!d[teamKey(s)] || slots.some(Boolean);
          const label = (id: number | null) => {
            const p = players.find((p) => p.id === id);
            return p?.alias || p?.nickname;
          };
          const lineup = advice?.composition[s === d.ourSide ? 'our' : 'enemy'];
          const picks = team.filter((t) => t.actionType === 'pick');
          const assigned = picks.map((t) => {
            const a = d.actions[t.step - 1];
            return (
              a &&
              (a.roleHint ||
                (a.assignedPlayerId && slots.indexOf(a.assignedPlayerId) + 1) ||
                lineup?.assignments.find((h) => h.heroId === a.heroId)?.role)
            );
          });
          const missing = [1, 2, 3, 4, 5].filter((r) => !assigned.includes(r));
          let free = 0;
          const displayRoles = assigned.map((r) => r || missing[free++]);
          return (
            <section className={'faction ' + s} key={s} aria-label={sideNames[s] + '禁选'}>
              <header>
                <Icon size={24} />
                <h2>
                  {sideNames[s]}{' '}
                  {hasRoster && (
                    <strong>
                      {teams.find((team) => team.id === d[teamKey(s)])?.name || '自定义阵容'}
                    </strong>
                  )}
                </h2>
                <b>{s === d.ourSide ? '我方' : '对方'}</b>
                <small>
                  <Flag size={12} />
                  {first ? '先选' : '后选'}
                </small>
              </header>
              <div className="pick-hand">
                {team
                  .filter((t) => t.actionType === 'pick')
                  .map((t, slot) => {
                    const i = t.step - 1,
                      a = d.actions[i],
                      h = byId.get(a?.heroId);
                    const others = team
                      .filter((k) => k.actionType === 'pick' && k.step !== t.step)
                      .map((k) => d.actions[k.step - 1])
                      .filter(Boolean);
                    const roleOf = (act: Action) =>
                      act.roleHint ??
                      (act.assignedPlayerId ? slots.indexOf(act.assignedPlayerId) + 1 : 0);
                    const occupied = others.map(roleOf);
                    return (
                      <div
                        className={'pick-slot ' + (!a && t.step === step.step ? 'current' : '')}
                        key={i}
                      >
                        <button
                          className="pick-face"
                          disabled={!a}
                          aria-pressed={replacing === i}
                          aria-label={
                            '替换第 ' +
                            t.step +
                            ' 手 · ' +
                            sideNames[s] +
                            '选人 ' +
                            (h?.cnName ?? '')
                          }
                          onClick={() => replace(i)}
                        >
                          {h ? <Portrait hero={h} /> : <Shield size={23} />}
                          <small>
                            {displayRoles[slot]}号位{' '}
                            {hasRoster ? label(slots[displayRoles[slot] - 1]) : ''}
                          </small>
                          {h && <b>{h.cnName}</b>}
                        </button>
                        {a && (
                          <>
                            {s !== d.ourSide &&
                              !roleOf(a) &&
                              lineup?.assignments.some((v) => v.heroId === a.heroId) && (
                                <button
                                  className="assign-trigger"
                                  disabled={occupied.includes(displayRoles[slot])}
                                  onClick={() =>
                                    assign(i, {
                                      ...a,
                                      roleHint: displayRoles[slot],
                                      assignedPlayerId: slots[displayRoles[slot] - 1],
                                    })
                                  }
                                >
                                  钉住 {displayRoles[slot]} 号位
                                </button>
                              )}
                            <button
                              className="assign-trigger"
                              aria-expanded={open?.i === i}
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setOpen({
                                  i,
                                  x: Math.max(8, Math.min(innerWidth - 280, rect.left)),
                                  y: Math.min(innerHeight - 225, rect.bottom + 3),
                                });
                              }}
                            >
                              {roleOf(a) ? '已钉' : '预测'} {displayRoles[slot]}号位 · 调整
                            </button>
                            <AnimatePresence>
                              {open?.i === i && (
                                <div
                                  style={
                                    {
                                      '--slot-x': open.x + 'px',
                                      '--slot-y': open.y + 'px',
                                    } as CSSProperties
                                  }
                                >
                                  <Popover
                                    label="位置与选手"
                                    className="slot-overlay"
                                    close={() => setOpen(undefined)}
                                  >
                                    <h3>分配位置</h3>
                                    <div className="assignment-options">
                                      {[0, 1, 2, 3, 4, 5].map((r) => (
                                        <button
                                          key={r}
                                          disabled={occupied.includes(
                                            r ||
                                              (a.assignedPlayerId
                                                ? slots.indexOf(a.assignedPlayerId) + 1
                                                : -1),
                                          )}
                                          aria-pressed={(a.roleHint ?? 0) === r}
                                          onClick={() => {
                                            assign(i, {
                                              ...a,
                                              roleHint: r || null,
                                              assignedPlayerId: r ? slots[r - 1] : null,
                                            });
                                            setOpen(undefined);
                                          }}
                                        >
                                          {r ? r + '号位' : '自动'}
                                        </button>
                                      ))}
                                    </div>
                                    <h3>分配选手</h3>
                                    <div className="assignment-options">
                                      {[
                                        null,
                                        ...slots.filter((id): id is number => id !== null),
                                      ].map((id) => (
                                        <button
                                          key={id ?? 0}
                                          disabled={
                                            !!id &&
                                            (others.some((x) => x.assignedPlayerId === id) ||
                                              occupied.includes(slots.indexOf(id) + 1))
                                          }
                                          aria-pressed={a.assignedPlayerId === id}
                                          onClick={() => {
                                            assign(i, {
                                              ...a,
                                              assignedPlayerId: id,
                                              roleHint: id ? slots.indexOf(id) + 1 : a.roleHint,
                                            });
                                            setOpen(undefined);
                                          }}
                                        >
                                          {label(id) ?? '解除绑定'}
                                        </button>
                                      ))}
                                    </div>
                                    {a.assignedPlayerId && (
                                      <a
                                        href={`#replays?mode=wards&playerId=${a.assignedPlayerId}&side=${s}`}
                                      >
                                        查看录像
                                      </a>
                                    )}
                                  </Popover>
                                </div>
                              )}
                            </AnimatePresence>
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
              <div className="ban-hand">
                {[1, 2, 3].map((p) => (
                  <div key={p}>
                    <small>{['首轮禁用', '次轮禁用', '末轮禁用'][p - 1]}</small>
                    <div>
                      {team
                        .filter((t) => t.phase === p && t.actionType === 'ban')
                        .map((t) => {
                          const a = d.actions[t.step - 1],
                            h = byId.get(a?.heroId);
                          return (
                            <button
                              key={t.step}
                              disabled={!a}
                              aria-pressed={replacing === t.step - 1}
                              aria-label={
                                '替换第 ' +
                                t.step +
                                ' 手 · ' +
                                sideNames[s] +
                                '禁用 ' +
                                (h?.cnName ?? '')
                              }
                              onClick={() => replace(t.step - 1)}
                              className={
                                'ban-slot ' +
                                (h ? 'filled ' : '') +
                                (!a && t.step === step.step ? 'current' : '')
                              }
                              title={'第 ' + t.step + ' 手 · ' + (h?.cnName ?? '待禁')}
                            >
                              {h ? (
                                <>
                                  <Portrait hero={h} />
                                  <b>{h.cnName}</b>
                                </>
                              ) : (
                                <>
                                  <Ban size={12} />
                                  {t.step}
                                </>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {advantage ? (
        <section className="bp-balance bp-box" aria-label="BP 胜率预估">
          <div className="balance-strip">
            <strong>BP 胜率预估</strong>
            <b>天辉 {advantage.radiantWinProb.toFixed(1)}%</b>
            <div
              className="balance-track"
              role="meter"
              aria-label="天辉预估胜率"
              aria-valuenow={advantage.radiantWinProb}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: advantage.radiantWinProb + '%' }} />
            </div>
            <b>夜魇 {advantage.direWinProb.toFixed(1)}%</b>
            <span>{advantage.summary}</span>
          </div>
          <div className="balance-details">
            <button className="lane-toggle" aria-expanded={lanes} onClick={() => setLanes(!lanes)}>
              看分路
            </button>
            <Reveal open={lanes}>
              <div className="adv-components">
                <span>天辉分差</span>
                {(
                  [
                    ['metaEdge', '版本'],
                    ['matchupEdge', '对位'],
                    ['compositionEdge', '阵容'],
                    ['sideEdge', '阵营'],
                  ] as const
                ).map(([key, label]) => (
                  <span key={key}>
                    {label} {advantage[key] > 0 ? '+' : ''}
                    {advantage[key].toFixed(1)}
                  </span>
                ))}
              </div>
              {!!advice?.laneForecast.length && (
                <div className="lane-forecast">
                  {advice.laneForecast.map((l) => (
                    <div key={l.label}>
                      <small>
                        {l.label} · {l.location}
                      </small>
                      <b>{l.verdict}</b>
                      <span>
                        {l.ourHeroes.map((id) => byId.get(id)?.cnName).join('、') || '待亮'} 对{' '}
                        {l.enemyHeroes.map((id) => byId.get(id)?.cnName).join('、') || '待亮'}
                      </span>
                      {l.partial && <small>分路待定</small>}
                    </div>
                  ))}
                </div>
              )}
            </Reveal>
          </div>
        </section>
      ) : (
        <div className="bp-balance bp-box">
          <div className="balance-strip" role="status">
            正在看双方阵容…
          </div>
        </div>
      )}
      <div
        className="hud-track bp-box"
        role="group"
        aria-label={'禁选进度，第 ' + step.phase + ' 阶段，已走 ' + d.actions.length + ' 手'}
      >
        <div className="track-head">
          <b>阶段战术简报</b>
          <span>
            第 {step.phase} 阶段 · {d.actions.length} / 24 手
          </span>
          <small>
            {step.isCompleted
              ? '阵容锁定'
              : sideNames[step.side] +
                (step.isFirstPickTeam ? '先选' : '后选') +
                ' · ' +
                (step.step === 24
                  ? '尾选针对敌核'
                  : next?.actionType === 'ban' && step.actionType === 'pick'
                    ? '下轮禁用保护核心'
                    : step.actionType === 'ban'
                      ? '封锁关键配合'
                      : '留意双人配合')}
          </small>
          {next?.side === step.side && (
            <strong>
              下一手仍由{step.isOurTurn ? '我方' : '对方'}
              {next.actionType === step.actionType
                ? next.actionType === 'pick'
                  ? '连选'
                  : '连禁'
                : next.actionType === 'pick'
                  ? '选人'
                  : '禁用'}
            </strong>
          )}
        </div>
        {advice && (
          <small className="remaining-roles">
            我方待出 {advice.composition.our.missingRoles.join('/') || '无'} · 敌方待出{' '}
            {advice.composition.enemy.missingRoles.join('/') || '无'}
          </small>
        )}
        <div className="steps">
          {order.map((t) => {
            const a = d.actions[t.step - 1],
              Icon = t.actionType === 'pick' ? Swords : Ban;
            return (
              <span
                aria-current={t.step === step.step && !step.isCompleted ? 'step' : undefined}
                key={t.step}
                className={t.side + (a ? ' done' : '')}
                title={
                  '第 ' +
                  t.step +
                  ' 手 · ' +
                  sideNames[t.side] +
                  (t.actionType === 'pick' ? '选取' : '禁用') +
                  (a ? ' ' + byId.get(a.heroId)?.cnName : '')
                }
              >
                <Icon size={11} />
                {t.step}
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
