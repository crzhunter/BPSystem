import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeftRight,
  Redo2,
  RotateCcw,
  Undo2,
  Swords,
  UsersRound,
  Check,
  Target,
  Crosshair,
} from 'lucide-react';
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
  stepLabel,
  type Room,
  type Action,
  type Side,
  type Advice,
} from './draftModel';
import { Roster, Scouting } from './DraftPanels';
import { HeroPoolGrid, Portrait } from './HeroPoolGrid';
import { DraftHud } from './DraftHud';
import { RecommendationPanel } from './RecommendationPanel';
import { CompositionMeter } from './CompositionMeter';
import { DraftArchive } from './DraftArchive';

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
  const [toolsOpen, setToolsOpen] = useState(false),
    [pending, setPending] = useState<number | null>(null);
  const [instant, setInstant] = useState(false),
    search = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ draft: Room; id: number; result: Advice['preview'] }>();
  const candidate = heroes.find((h) => h.id === pending);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    api<Advice>('/bp/recommend', 'POST', { ...d, previewHeroId: pending })
      .then((data) => {
        if (active) setPreview({ draft: d, id: pending, result: data.preview });
      })
      .catch((e) => {
        if (active) notify(failure(e), true);
      });
    return () => {
      active = false;
    };
  }, [d, pending, notify]);
  const projected = preview?.draft === d && preview.id === pending ? preview.result : null;
  const [analysis, setAnalysis] = useState<{
    draft: Room;
    revision: number;
    data?: Advice;
    error?: string;
  }>();
  const data = analysis?.draft === d && analysis.revision === revision ? analysis.data : undefined;
  const order = cmOrder(d.firstPickSide, d.cmOrderVersion),
    step = currentStep(d.firstPickSide, d.ourSide, d.actions.length, d.cmOrderVersion);
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
        if (!data.composition || !data.weights) throw new Error('当前端口仍在运行旧版 BP 服务，请重启服务以载入新版推荐。');
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
    setPending(null);
    setRedo([]);
    setD(next);
  }
  function play(a: Action) {
    if (step.isCompleted || d.actions.some((old) => old.heroId === a.heroId)) return;
    change({ ...d, actions: [...d.actions, a] });
  }
  function undo() {
    setPending(null);
    const last = d.actions.at(-1);
    if (last) {
      setRedo([...redo, last]);
      setD({ ...d, actions: d.actions.slice(0, -1) });
    }
  }
  function replay() {
    setPending(null);
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
  function lock(id: number) {
    if (archive || !heroes.some((h) => h.id === id)) return;
    const suggested =
      step.isOurTurn && step.actionType === 'pick'
        ? data?.pickRecommendations.find((r) => r.heroId === id)
        : null;
    play({
      heroId: id,
      assignedPlayerId: suggested?.suggestedPlayerId ?? null,
      roleHint: suggested?.suggestedPlayerId ? suggested.suggestedRole : null,
    });
  }
  function select(id: number) {
    if (instant) lock(id);
    else setPending(id);
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (e.isComposing || e.repeat) return;
      if (e.key === 'Escape') {
        setPending(null);
        setToolsOpen(false);
        return;
      }
      if (archive) return;
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) replay();
        else undo();
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === 'Enter' && pending && (!typing || el === search.current)) {
        e.preventDefault();
        lock(pending);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  useEffect(() => {
    // 只有尚未进行的本机草稿跟随同步版本。保留历史对局的补丁标记。
    if (
      data?.patch &&
      !d.id &&
      !d.actions.length &&
      d.cmOrderVersion !== 'classic' &&
      d.patch !== data.patch
    )
      setD({ ...d, patch: data.patch });
  }, [data?.patch, d]);
  const turnKey = [d.actions.length, step.side, d.ourSide, d.firstPickSide].join('/');
  const enemy = opposite(d.ourSide);
  return (
    <div className="bp-room">
      <div className="bp-title">
        <div>
          <span className="mode-dot" />
          队长模式 <small>· {d.id ? d.title : '本机草稿'}</small>
          <h1>实时 BP 对局室</h1>
        </div>
        <div className={'turn-readout ' + step.side}>
          <strong>{String(step.step).padStart(2, '0')}</strong>
          <span>
            / 24 手
            <b>
              {sideNames[step.side]} · {stepLabel(step)}
            </b>
          </span>
        </div>
      </div>
      <div className="bp-tools bp-box">
        <b className="version-badge">
          {d.patch}
          {d.cmOrderVersion === 'classic' ? ' · 历史顺序' : ''}
        </b>
        <label>
          我方阵营
          <select
            aria-label="我方阵营"
            value={d.ourSide}
            onChange={(e) => change({ ...d, ourSide: e.target.value as Side })}
          >
            {sides.map((s) => (
              <option value={s} key={s}>
                {sideNames[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          先选方
          <select
            aria-label="先选方"
            value={d.firstPickSide}
            disabled={!!d.actions.length}
            onChange={(e) => change({ ...d, firstPickSide: e.target.value as Side })}
          >
            {sides.map((s) => (
              <option value={s} key={s}>
                {sideNames[s]}先选
              </option>
            ))}
          </select>
        </label>
        <button
          title="交换双方阵营及先选权"
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
          <ArrowLeftRight />
          换边
        </button>
        <button className="fast-toggle" aria-pressed={instant} onClick={() => setInstant(!instant)}>
          <i />
          单击直锁
        </button>
        <button disabled={!d.actions.length} title="撤销（Ctrl+Z）" onClick={undo}>
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
            if (confirm('清空本局禁选记录？双方阵容会保留。'))
              change({ ...d, actions: [], cmOrderVersion: '7.42-standard' });
          }}
        >
          <RotateCcw />
          重置
        </button>
        <button aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>
          <UsersRound />
          战队/选手配置
        </button>
        <button onClick={() => setArchive(true)}>
          <Archive />
          存档
        </button>
      </div>
      {toolsOpen && (
        <section className="roster-drawer bp-box">
          <div className="roster-pair">
            {sides.map((s) => (
              <Roster
                key={s}
                side={s}
                d={d}
                players={players}
                teams={teams}
                revision={revision}
                update={roster}
                heroName={heroName}
              />
            ))}
          </div>
          <div className="controls-row">
            <button disabled={!!busy || !picked.length} onClick={() => sync('对位')}>
              {busy === '对位' ? '同步中…' : '同步已选英雄对位'}
            </button>
            <button disabled={!!busy || !playerIds.length} onClick={() => sync('战绩')}>
              {busy === '战绩' ? '同步中…' : '同步双方选手战绩'}
            </button>
            <button onClick={() => setToolsOpen(false)}>收起配置</button>
          </div>
        </section>
      )}
      <DraftHud
        d={d}
        players={players}
        heroes={heroes}
        assign={(i, a) => change({ ...d, actions: d.actions.map((old, j) => (i === j ? a : old)) })}
      />
      <div className="bp-bench">
        <div className="pool-column">
          <div className="pending-anchor">
            <section className={'pending-slot ' + (candidate ? 'armed' : '')} aria-label="待确认槽">
              <div className="pending-face">
                {candidate ? <Portrait hero={candidate} /> : <Target size={26} />}
              </div>
              <div className="pending-info">
                <small>
                  待确认槽 · {sideNames[step.side]}
                  {step.actionType === 'ban' ? '禁用' : '选取'}
                </small>
                <b>{candidate?.cnName ?? (step.isCompleted ? '本局禁选完成' : '请选择英雄')}</b>
                {candidate ? (
                  <span>
                    {projected
                      ? (projected.denied ? '若被选入 · ' : '选入后 · ') + projected.text
                      : '正在计算阵容变化…'}
                  </span>
                ) : (
                  <span>单击预选，双击锁入</span>
                )}
              </div>
              <button
                className="confirm-pick"
                disabled={!candidate || step.isCompleted}
                onClick={() => pending && lock(pending)}
              >
                <Check size={15} />
                {step.actionType === 'ban' ? '锁定禁用' : '锁定选择'}
                <kbd>↵</kbd>
              </button>
              {candidate && (
                <div className="pending-dims" aria-live="polite">
                  {[
                    ['disable', '先手'],
                    ['frontline', '前排'],
                    ['burst', '爆发'],
                    ['sustain', '持续'],
                    ['push', '推进'],
                    ['teamfight', '团战'],
                  ].map(([k, n]) => (
                    <span key={k}>
                      {n}{' '}
                      <b>
                        {projected ? '+' + projected.delta[k as keyof typeof projected.delta] : '…'}
                      </b>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="mobile-bp-links">
            <button onClick={() => document.getElementById('recommendations')?.scrollIntoView()}>
              <Crosshair size={14} />
              查看推荐
            </button>
            <button onClick={() => search.current?.focus()}>
              <Swords size={14} />
              查找英雄
            </button>
            <button onClick={() => document.getElementById('composition')?.scrollIntoView()}>
              阵容诊断
            </button>
          </div>
          <HeroPoolGrid
            heroes={heroes}
            d={d}
            search={search}
            pending={pending}
            select={select}
            lock={lock}
          />
          {data && <CompositionMeter data={data} our={d.ourSide} preview={projected} />}
        </div>
        <aside>
          {data ? (
            <RecommendationPanel
              data={data}
              turn={turnKey}
              pending={pending}
              select={select}
              lock={lock}
              scouting={
                d[slotsKey(enemy)].some(Boolean) ? (
                  <Scouting
                    data={data.scoutingCard}
                    heroName={heroName}
                    teamId={d[teamKey(enemy)]}
                    slots={d[slotsKey(enemy)]}
                  />
                ) : undefined
              }
            />
          ) : (
            <p role="status" className="bp-box rec-wait">
              {(analysis?.draft === d && analysis.error) || '正在计算本局推荐…'}
            </p>
          )}
        </aside>
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
