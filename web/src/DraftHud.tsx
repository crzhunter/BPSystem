import { Shield, Swords, Ban, Sprout, Flame, Flag } from 'lucide-react';
import {
  cmOrder,
  currentStep,
  sideNames,
  sides,
  slotsKey,
  type Room,
  type Action,
  type Advice,
} from './draftModel';
import type { Hero, Player } from './api';
import { Portrait } from './HeroPoolGrid';

export function DraftHud({
  d,
  heroes,
  players,
  assign,
  advice,
}: {
  d: Room;
  heroes: Hero[];
  players: Player[];
  assign: (i: number, a: Action) => void;
  advice?: Advice;
}) {
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
          return (
            <section className={'faction ' + s} key={s} aria-label={sideNames[s] + '禁选'}>
              <header>
                <Icon size={24} />
                <h2>{sideNames[s]}</h2>
                <b>{s === d.ourSide ? '我方' : '对方'}</b>
                <small>
                  <Flag size={12} />
                  {first ? '先选' : '后选'}
                </small>
              </header>
              <div className="pick-hand">
                {team
                  .filter((t) => t.actionType === 'pick')
                  .map((t) => {
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
                        <div className="pick-face">
                          {h ? <Portrait hero={h} /> : <Shield size={23} />}
                          <small>第 {t.step} 手</small>
                        </div>
                        <b>{h?.cnName ?? '待选'}</b>
                        {a && (
                          <div className="bind-slot">
                            <select
                              aria-label={sideNames[s] + h?.cnName + '位置'}
                              value={a.roleHint ?? 0}
                              onChange={(e) =>
                                assign(i, { ...a, roleHint: +e.target.value || null })
                              }
                            >
                              <option
                                value={0}
                                disabled={
                                  !!a.assignedPlayerId &&
                                  occupied.includes(slots.indexOf(a.assignedPlayerId) + 1)
                                }
                              >
                                自动位置
                              </option>
                              {[1, 2, 3, 4, 5].map((r) => (
                                <option key={r} value={r} disabled={occupied.includes(r)}>
                                  {r} 号位
                                </option>
                              ))}
                            </select>
                            {slots.some(Boolean) && (
                              <select
                                aria-label={sideNames[s] + h?.cnName + '选手'}
                                value={a.assignedPlayerId ?? 0}
                                onChange={(e) =>
                                  assign(i, { ...a, assignedPlayerId: +e.target.value || null })
                                }
                              >
                                <option value={0}>待分配</option>
                                {slots.map(
                                  (id, j) =>
                                    id && (
                                      <option
                                        key={id}
                                        value={id}
                                        disabled={
                                          others.some((x) => x.assignedPlayerId === id) ||
                                          (!a.roleHint && occupied.includes(j + 1))
                                        }
                                      >
                                        {players.find((p) => p.id === id)?.nickname}
                                      </option>
                                    ),
                                )}
                              </select>
                            )}
                            {a.assignedPlayerId && (
                              <a
                                href={`#replays?mode=wards&playerId=${a.assignedPlayerId}&side=${s}`}
                              >
                                查看录像
                              </a>
                            )}
                          </div>
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
                            <span
                              key={t.step}
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
                            </span>
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
      {advantage && (
        <section className="bp-balance bp-box" aria-label="BP 胜率预估">
          <header>
            <strong>BP 胜率预估</strong>
            <span>{advantage.summary}</span>
          </header>
          <div className="balance-labels">
            <b>天辉 {advantage.radiantWinProb.toFixed(1)}%</b>
            <b>夜魇 {advantage.direWinProb.toFixed(1)}%</b>
          </div>
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
        </section>
      )}
      <div className="hud-track bp-box">
        <div className="track-head">
          <b>禁选进度</b>
          <span>
            第 {step.phase} 阶段 · {d.actions.length} / 24 手
          </span>
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
