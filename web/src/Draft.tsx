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
  roomFrom,
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
import type { RolePreference } from '../../server/src/services/rolePriority';

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
  const [moreTools, setMoreTools] = useState(false);
  const [instant, setInstant] = useState(false),
    search = useRef<HTMLInputElement>(null);
  const [preference, setPreference] = useState<RolePreference>('auto');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(0);
  function clearFilters() {
    setQuery('');
    setRoleFilter(0);
  }
  const [replacing, setReplacing] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editInFlight = useRef(false);
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
    api<Advice>('/bp/recommend', 'POST', { ...d, rolePreference: preference })
      .then((data) => {
        if (active) setAnalysis({ draft: d, revision, data });
      })
      .catch((e) => {
        if (active) setAnalysis({ draft: d, revision, error: failure(e) });
      });
    return () => {
      active = false;
    };
  }, [d, revision, ready, preference]);
  function change(next: Room) {
    setReplacing(null);
    setPending(null);
    setRedo([]);
    setD(next);
  }
  function play(a: Action) {
    if (step.isCompleted || d.actions.some((old) => old.heroId === a.heroId)) return;
    change({ ...d, actions: [...d.actions, a] });
    clearFilters();
  }
  async function editAction(index: number, action: Action) {
    if (editInFlight.current) return;
    if (d.actions.some((a, i) => i !== index && a.heroId === action.heroId)) {
      notify('这英雄已经锁过了，换一个', true);
      return;
    }
    let next = { ...d, actions: d.actions.map((a, i) => (i === index ? action : a)) };
    try {
      if (d.id) {
        editInFlight.current = true;
        setSavingEdit(true);
        const path = '/bp/sessions/' + d.id;
        const saved = roomFrom(await api<Room>(path));
        if (saved.revision !== d.revision) throw new Error('存档已被更新，请重新载入或另存本局');
        // 现场可能已多走几手。存档前缀一致时单改已保存的手，只带回修订号，保留本机后续动作。
        const prefix = roomFrom({ ...d, actions: d.actions.slice(0, saved.actions.length) });
        if (index < saved.actions.length && JSON.stringify(saved) === JSON.stringify(prefix)) {
          const updated = await api<Room>(path + '/action/' + (index + 1), 'PUT', {
            ...action,
            revision: d.revision,
          });
          next = { ...next, revision: updated.revision };
        } else notify('已改本机草稿，点「存档」可保存本局进度');
      }
      change(next);
      clearFilters();
    } catch (e) {
      notify(failure(e), true);
    } finally {
      editInFlight.current = false;
      setSavingEdit(false);
    }
  }
  function undo() {
    setReplacing(null);
    setPending(null);
    const last = d.actions.at(-1);
    if (last) {
      setRedo([...redo, last]);
      setD({ ...d, actions: d.actions.slice(0, -1) });
    }
  }
  function replay() {
    setReplacing(null);
    setPending(null);
    const a = redo.at(-1);
    if (a) {
      clearFilters();
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
    if (replacing !== null) {
      void editAction(replacing, { ...d.actions[replacing], heroId: id });
      return;
    }
    const suggested =
      step.isOurTurn && step.actionType === 'pick'
        ? data?.pickRecommendations.find((r) => r.heroId === id)
        : null;
    play({
      heroId: id,
      assignedPlayerId: suggested?.suggestedPlayerId ?? null,
      roleHint:
        suggested &&
        (suggested.suggestedPlayerId ||
          (preference !== 'auto' &&
            data?.composition.our.missingRoles.includes(suggested.suggestedRole)))
          ? suggested.suggestedRole
          : null,
    });
  }
  function select(id: number) {
    if (instant || replacing !== null) lock(id);
    else setPending(id);
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (e.isComposing || e.repeat || editInFlight.current) return;
      if (e.key === 'Escape') {
        setReplacing(null);
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
  const editStep = replacing === null ? null : order[replacing];
  const actionText = step.actionType === 'ban' ? '禁用' : '选人';
  const nextOurStep = order.slice(d.actions.length).find((s) => s.side === d.ourSide);
  return (
    <div className="bp-room" inert={savingEdit} aria-busy={savingEdit}>
      <div className={'bp-tools bp-box' + (moreTools ? ' show-more' : '')}>
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
          className="extra-tool"
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
        <button
          className="more-tools"
          aria-expanded={moreTools}
          onClick={() => setMoreTools(!moreTools)}
        >
          {moreTools ? '收起操作' : '更多操作'}
        </button>
        <button
          className="extra-tool"
          disabled={!d.actions.length}
          title="撤销（Ctrl+Z）"
          onClick={undo}
        >
          <Undo2 />
          撤销
        </button>
        <button className="extra-tool" disabled={!redo.length} onClick={replay}>
          <Redo2 />
          重做
        </button>
        <button
          className="extra-tool"
          disabled={!d.actions.length}
          onClick={() => {
            if (confirm('清空本局禁选记录？双方阵容会保留。'))
              change({ ...d, actions: [], cmOrderVersion: '7.42-standard' });
          }}
        >
          <RotateCcw />
          重置
        </button>
        <button
          className="extra-tool"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen(!toolsOpen)}
        >
          <UsersRound />
          战队/选手配置
        </button>
        <button className="extra-tool" onClick={() => setArchive(true)}>
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
        advice={data}
        players={players}
        heroes={heroes}
        assign={editAction}
        replacing={replacing}
        replace={(i) => {
          setPending(null);
          clearFilters();
          setReplacing(i);
          document.querySelector('.pending-anchor')?.scrollIntoView({ block: 'nearest' });
        }}
      />
      <div className="bp-bench">
        <div className="pool-column">
          <div className="pending-anchor">
            <section
              className={
                'pending-slot ' +
                (editStep ? 'editing' : step.isOurTurn ? 'ours' : 'theirs') +
                (candidate ? ' armed' : '')
              }
              aria-label="本手操作"
            >
              <div className="pending-face">
                {candidate ? <Portrait hero={candidate} /> : <Target size={26} />}
              </div>
              <div className="pending-info">
                <b aria-live="polite">
                  {editStep
                    ? '替换第 ' +
                      editStep.step +
                      ' 手（' +
                      sideNames[editStep.side] +
                      (editStep.actionType === 'ban' ? '禁用' : '选人') +
                      '）'
                    : step.isCompleted
                      ? '本局禁选完成'
                      : '第 ' +
                        step.step +
                        ' 手 · ' +
                        (step.isOurTurn ? '轮到【我方】' : '等待【对方】') +
                        actionText}
                </b>
                <span>
                  {editStep
                    ? '点下方英雄替换' +
                      heroName(d.actions[editStep.step - 1].heroId) +
                      '，后续手数照旧'
                    : candidate
                      ? '待锁定 · ' + candidate.cnName
                      : step.isCompleted
                        ? '点已锁定的英雄可以改手'
                        : step.isOurTurn
                          ? '参考我方推荐，选好后锁定'
                          : '对方在游戏里锁出后，点下方英雄录入'}
                </span>
              </div>
              {editStep ? (
                <button className="confirm-pick" onClick={() => setReplacing(null)}>
                  取消替换
                </button>
              ) : (
                <button
                  className="confirm-pick"
                  disabled={!candidate || step.isCompleted}
                  onClick={() => pending && lock(pending)}
                >
                  <Check size={15} />
                  {step.isOurTurn ? '锁定' + actionText : '录入对方'}
                  <kbd>↵</kbd>
                </button>
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
            query={query}
            setQuery={(q) => {
              setQuery(q);
              setPending(null);
            }}
            role={roleFilter}
            setRole={(r) => {
              setRoleFilter(r);
              setPending(null);
            }}
            replacing={replacing !== null}
            heroes={heroes}
            d={d}
            search={search}
            pending={pending}
            select={select}
            lock={lock}
          />
          {data && (
            <div inert={replacing !== null}>
              <CompositionMeter data={data} our={d.ourSide} preview={projected} select={select} />
            </div>
          )}
        </div>
        <aside inert={replacing !== null}>
          {data ? (
            <RecommendationPanel
              data={data}
              planAction={nextOurStep?.actionType}
              preference={preference}
              setPreference={setPreference}
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
