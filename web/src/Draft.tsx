import { useEffect, useState } from 'react';
import { Archive, ArrowLeftRight, Redo2, RotateCcw, Undo2, Layers3 } from 'lucide-react';
import { api, failure, type Player, type Team, type Hero, type Notify } from './api';
import {
  cmOrder,
  currentStep,
  initialRoom,
  slotsKey,
  teamKey,
  sideNames,
  sides,
  opposite,
  actionLabel,
  stepLabel,
  type Room,
  type Action,
  type Side,
  type Advice,
} from './draftModel';
import { Roster, Audit, Rankings, Scouting } from './DraftPanels';
import { DraftPicker } from './DraftPicker';
import { DraftArchive } from './DraftArchive';

const tabs = ['BP 进度', '智能推荐', '对手情报', '选择英雄'];
export function Draft({
  players,
  teams,
  heroes,
  notify,
  ready,
}: {
  players: Player[];
  teams: Team[];
  heroes: Hero[];
  notify: Notify;
  ready: boolean;
}) {
  const [d, setD] = useState(initialRoom),
    [redo, setRedo] = useState<Action[]>([]);
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(''),
    [archive, setArchive] = useState(false);
  const [tab, setTab] = useState(0),
    [toolsOpen, setToolsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<{
    draft: Room;
    revision: number;
    data?: Advice;
    error?: string;
  }>();
  const data = analysis?.draft === d && analysis.revision === revision ? analysis.data : undefined;
  const order = cmOrder(d.firstPickSide),
    step = currentStep(d.firstPickSide, d.ourSide, d.actions.length);
  const heroName = (id: number) => heroes.find((h) => h.id === id)?.cnName || '英雄 ' + id;
  useEffect(() => {
    try {
      localStorage.setItem('bp-live-v3', JSON.stringify(d));
    } catch {
      notify('本机无法保存草稿，请使用对局存档', true);
    }
  }, [d, notify]);
  useEffect(() => {
    if (!ready) return;
    // 从旧版草稿或另一设备恢复后，选手库中已删除的引用应释放对应位置。
    const known = new Set(players.map((p) => p.id)),
      teamIds = new Set(teams.map((t) => t.id));
    setD((old) => {
      let next = old;
      for (const s of sides) {
        const key = slotsKey(s),
          team = old[teamKey(s)];
        if (old[key].some((id) => id !== null && !known.has(id)))
          next = { ...next, [key]: old[key].map((id) => (id && known.has(id) ? id : null)) };
        if (team && !teamIds.has(team)) next = { ...next, [teamKey(s)]: null };
      }
      if (next !== old)
        next.actions = old.actions.map((a) =>
          a.assignedPlayerId && !known.has(a.assignedPlayerId)
            ? { ...a, assignedPlayerId: null }
            : a,
        );
      return next;
    });
  }, [players, teams, ready]);
  useEffect(() => {
    let active = true;
    api<Advice>('/bp/recommend', 'POST', d)
      .then((data) => {
        if (active) setAnalysis({ draft: d, revision, data });
      })
      .catch((e) => {
        if (active) setAnalysis({ draft: d, revision, error: failure(e) });
      });
    return () => {
      active = false;
    };
  }, [d, revision, ready]);
  function change(next: Room) {
    setRedo([]);
    setD(next);
  }
  function play(a: Action) {
    if (step.isCompleted || d.actions.some((old) => old.heroId === a.heroId)) return;
    change({ ...d, actions: [...d.actions, a] });
  }
  function undo() {
    const last = d.actions.at(-1);
    if (last) {
      setRedo([...redo, last]);
      setD({ ...d, actions: d.actions.slice(0, -1) });
    }
  }
  function replay() {
    const a = redo.at(-1);
    if (a) {
      setD({ ...d, actions: [...d.actions, a] });
      setRedo(redo.slice(0, -1));
    }
  }
  function roster(side: Side, team: number | null, slots: (number | null)[]) {
    if (slots.some((id) => id !== null && d[slotsKey(opposite(side))].includes(id))) {
      notify('该战队有选手已在另一阵营，请先调整阵容', true);
      return;
    }
    const prev = d[slotsKey(side)];
    const actions = d.actions.map((a, i) => {
      if (
        order[i].side !== side ||
        !a.assignedPlayerId ||
        slots.indexOf(a.assignedPlayerId) === prev.indexOf(a.assignedPlayerId)
      )
        return a;
      return {
        ...a,
        roleHint: a.roleHint ?? prev.indexOf(a.assignedPlayerId) + 1,
        assignedPlayerId: null,
      };
    });
    change({ ...d, [teamKey(side)]: team, [slotsKey(side)]: slots, actions });
  }
  const picked = d.actions.filter((_, i) => order[i].actionType === 'pick').map((a) => a.heroId);
  const playerIds = [...d.radiantPlayerIds, ...d.direPlayerIds].filter(
    (id): id is number => id !== null,
  );
  async function sync(kind: '对位' | '战绩') {
    setBusy(kind);
    try {
      if (kind === '对位') {
        const r = await api<{ synced: number; requested: number; results: { error?: string }[] }>(
          '/heroes/matchups/sync',
          'POST',
          { heroIds: picked },
        );
        const error = r.results.find((row) => row.error)?.error;
        notify(
          '对位同步 ' + r.synced + ' / ' + r.requested + ' 名英雄' + (error ? '，' + error : ''),
          !!error,
        );
      } else {
        const errors: string[] = [];
        for (const id of playerIds) {
          try {
            await api('/players/' + id + '/sync', 'POST');
          } catch (e) {
            errors.push((players.find((p) => p.id === id)?.nickname ?? '选手') + '：' + failure(e));
          }
        }
        notify(errors.length ? errors.join('；') : '本场双方战绩已同步', !!errors.length);
      }
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy('');
      setRevision((n) => n + 1);
    }
  }
  const loading = (
    <p className="panel intel-card" role="status">
      {analysis?.draft === d && analysis.error ? analysis.error : '正在计算本局情报…'}
    </p>
  );
  function column(s: Side) {
    const ours = s === d.ourSide;
    return (
      <div className={'room-column column-' + s} key={s}>
        <div className="view-progress">
          <Roster
            side={s}
            d={d}
            players={players}
            teams={teams}
            revision={revision}
            update={roster}
            heroName={heroName}
          />
        </div>
        <div className="view-advice">
          {data ? (
            <>
              {ours && <Audit data={data.lineupAudit} />}
              <Rankings
                type={ours ? 'pick' : 'ban'}
                data={data}
                heroName={heroName}
                players={players}
              />
            </>
          ) : (
            loading
          )}
        </div>
        {!ours && (
          <div className="view-scout">
            {data ? (
              <Scouting
                data={data.scoutingCard}
                heroName={heroName}
                teamId={d[teamKey(s)]}
                slots={d[slotsKey(s)]}
              />
            ) : (
              loading
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={'live-room mobile-view-' + tab}>
      <section className="hero-banner">
        <div className="banner-content">
          <span className="mode-label">
            <span className="live-dot" />
            {step.isCompleted ? '禁选已完成' : '队长模式'}
          </span>
          <h1>
            实时 <em>BP</em> 对局室
          </h1>
          <p>{d.id ? d.title + ' · 更新存档后可跨设备载入' : '本机草稿 · 14 次禁用，10 次选取'}</p>
        </div>
        <span className="patch">
          <Layers3 size={13} />
          {d.patch}
        </span>
      </section>
      <div className="mobile-command">
        <b>
          第 {step.step}/24 步 · {stepLabel(step)}
        </b>
        <button onClick={undo} disabled={!d.actions.length}>
          <Undo2 size={16} />
          撤销
        </button>
      </div>
      <div className="mobile-tabs" aria-label="对局室视图">
        {tabs.map((t, i) => (
          <button key={t} aria-pressed={tab === i} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>
      <button
        className="mobile-config"
        aria-expanded={toolsOpen}
        onClick={() => setToolsOpen(!toolsOpen)}
      >
        {toolsOpen ? '收起配置' : '对局配置与存档'}
        <span>
          {sideNames[d.ourSide]} · {d.firstPickSide === d.ourSide ? '我方先选' : '敌方先选'}
        </span>
      </button>
      <section aria-label="对局配置" className={'room-tools panel ' + (toolsOpen ? 'open' : '')}>
        <div className="controls-row">
          {(['ourSide', 'firstPickSide'] as const).map((key) => (
            <div className="toggle-group" key={key}>
              <span>{key === 'ourSide' ? '我方阵营' : '先选方'}</span>
              <div className="segmented">
                {sides.map((s) => (
                  <button
                    key={s}
                    aria-pressed={d[key] === s}
                    disabled={key === 'firstPickSide' && d.actions.length > 0 && d[key] !== s}
                    title={
                      key === 'firstPickSide' && d.actions.length
                        ? '重置进度后可重新指定先选方'
                        : undefined
                    }
                    className={d[key] === s ? 'chosen ' + s : ''}
                    onClick={() => change({ ...d, [key]: s })}
                  >
                    {sideNames[s]}
                    {key === 'firstPickSide' ? '先选' : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            className="subtle-button"
            onClick={() =>
              change({
                ...d,
                ourSide: opposite(d.ourSide),
                firstPickSide: opposite(d.firstPickSide),
                radiantTeamId: d.direTeamId,
                direTeamId: d.radiantTeamId,
                radiantPlayerIds: d.direPlayerIds,
                direPlayerIds: d.radiantPlayerIds,
              })
            }
          >
            <ArrowLeftRight size={15} />
            交换阵营
          </button>
          <button className="archive-button" onClick={() => setArchive(true)}>
            <Archive size={15} />
            对局存档
          </button>
        </div>
        <div className="controls-row commands">
          <button disabled={!d.actions.length} onClick={undo}>
            <Undo2 />
            撤销
          </button>
          <button disabled={!redo.length} onClick={replay}>
            <Redo2 />
            重做
          </button>
          <button
            disabled={!d.actions.length}
            onClick={() => {
              if (confirm('清空本局全部禁选动作？阵容设置会保留。')) change({ ...d, actions: [] });
            }}
          >
            <RotateCcw />
            重置
          </button>
          <button disabled={!!busy || !picked.length} onClick={() => void sync('对位')}>
            {busy === '对位' ? '正在同步对位…' : '同步已选英雄对位'}
          </button>
          <button disabled={!!busy || !playerIds.length} onClick={() => void sync('战绩')}>
            {busy === '战绩' ? '正在同步战绩…' : '同步本场双方数据'}
          </button>
        </div>
      </section>
      <section className="panel room-timeline view-progress" aria-label="24 步禁选进度">
        <div className="timeline-head">
          <h2>禁选进度</h2>
          <span>已完成 {d.actions.length} / 24 步</span>
        </div>
        <div className="phase-strip">
          {[1, 2, 3].map((phase) => (
            <div className="phase-group" key={phase}>
              <b>第{['一', '二', '三'][phase - 1]}阶段</b>
              <div>
                {order
                  .filter((s) => s.phase === phase)
                  .map((s) => {
                    const a = d.actions[s.step - 1],
                      label =
                        '第 ' +
                        s.step +
                        ' 步 · ' +
                        sideNames[s.side] +
                        actionLabel(s.actionType) +
                        (a ? ' · ' + heroName(a.heroId) : '');
                    return (
                      <span
                        key={s.step}
                        aria-label={label}
                        aria-current={
                          !step.isCompleted && s.step === step.step ? 'step' : undefined
                        }
                        className={
                          s.side +
                          (a ? ' done' : '') +
                          (s.step === step.step && !step.isCompleted ? ' active' : '')
                        }
                        title={label}
                      >
                        <b>{s.step}</b>
                        <small>{s.actionType === 'ban' ? '禁' : '选'}</small>
                      </span>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="room-columns">
        {column('radiant')}
        <div className="view-picker">
          <DraftPicker d={d} heroes={heroes} players={players} play={play} />
        </div>
        {column('dire')}
      </div>
      {archive && (
        <DraftArchive
          d={d}
          apply={change}
          close={() => setArchive(false)}
          notify={notify}
          detach={() => setD({ ...d, id: undefined, revision: undefined })}
        />
      )}
    </div>
  );
}
