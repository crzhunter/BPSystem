import { AnimatePresence, motion } from 'framer-motion';
import { LiquidGlass } from './LiquidGlass';
import { Popover, SegmentedControl, spring } from './MotionControls';
import type { useDraftSession } from './useDraftSession';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeftRight,
  Redo2,
  RotateCcw,
  Undo2,
  UsersRound,
  Target,
  Crosshair,
} from 'lucide-react';
import { api, failure, type Player, type Team, type Hero, type Notify } from './api';
import {
  cmOrder,
  currentStep,
  blank,
  setupOf,
  slotsKey,
  teamKey,
  sideNames,
  sides,
  opposite,
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
  session,
  players,
  teams,
  heroes,
  notify,
  ready,
}: {
  session: ReturnType<typeof useDraftSession>;
  players: Player[];
  teams: Team[];
  heroes: Hero[];
  notify: Notify;
  ready: boolean;
}) {
  const { d, setD, redo, setRedo, instant, watchlist, setWatchlist } = session;
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(''),
    [archive, setArchive] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false),
    [pending, setPending] = useState<number | null>(null);
  const [intel, setIntel] = useState(false),
    [watch, setWatch] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const update = () => {
      setMobile(media.matches);
      setSheet(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [preference, setPreference] = useState<RolePreference>('auto');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(0);
  function clearFilters() {
    setQuery('');
    setRoleFilter(0);
  }
  const [replacing, setReplacing] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ draft: Room; id: number; result: Advice['preview'] }>();
  const candidate = heroes.find((h) => h.id === pending);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    api<Advice>('/bp/recommend', 'POST', {
      ...d,
      previewHeroId: pending,
      replacementStep: replacing === null ? undefined : replacing + 1,
    })
      .then((data) => {
        if (active) setPreview({ draft: d, id: pending, result: data.preview });
      })
      .catch((e) => {
        if (active) notify(failure(e), true);
      });
    return () => {
      active = false;
    };
  }, [d, pending, replacing, notify]);
  const projected = preview?.draft === d && preview.id === pending ? preview.result : null;
  const [analysis, setAnalysis] = useState<{
    draft: Room;
    revision: number;
    preference: RolePreference;
    data?: Advice;
    error?: string;
  }>();
  const data = analysis?.data;
  const synced =
    analysis?.draft === d && analysis.revision === revision && analysis.preference === preference;
  const order = cmOrder(d.firstPickSide, d.cmOrderVersion),
    step = currentStep(d.firstPickSide, d.ourSide, d.actions.length, d.cmOrderVersion);
  const heroName = (id: number) => heroes.find((h) => h.id === id)?.cnName || '英雄 ' + id;
  useEffect(() => {
    let active = true;
    if (!ready) return;
    const controller = new AbortController();
    api<Advice>('/bp/recommend', 'POST', { ...d, rolePreference: preference }, controller.signal)
      .then((data) => {
        if (active) setAnalysis({ draft: d, revision, preference, data });
      })
      .catch((e) => {
        if (active)
          setAnalysis((old) => ({
            draft: d,
            revision,
            preference,
            data: old?.data,
            error: failure(e),
          }));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [d, revision, ready, preference]);
  function change(next: Room) {
    setReplacing(null);
    setPending(null);
    setRedo([]);
    setD(next);
  }
  function openRoom(room: Room) {
    setReplacing(null);
    setPending(null);
    clearFilters();
    session.bind(room);
  }
  function play(a: Action) {
    if (step.isCompleted || d.actions.some((old) => old.heroId === a.heroId)) return;
    change({ ...d, actions: [...d.actions, a] });
    clearFilters();
  }
  function editAction(index: number, action: Action) {
    if (!session.edit(index, action)) return;
    setReplacing(null);
    setPending(null);
    clearFilters();
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
    setSheet(false);
    if (archive || !heroes.some((h) => h.id === id) || d.actions.some((a) => a.heroId === id))
      return;
    if (replacing !== null) {
      void editAction(replacing, { ...d.actions[replacing], heroId: id });
      return;
    }
    const suggested =
      synced && !analysis?.error && step.isOurTurn && step.actionType === 'pick'
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
    if (!d.actions.some((a) => a.heroId === id) && (!step.isCompleted || replacing !== null))
      setPending(id);
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (e.isComposing || e.repeat) return;
      if (e.key === 'Escape') {
        setReplacing(null);
        setPending(null);
        setToolsOpen(false);
        return;
      }
      if (archive || toolsOpen || sheet || intel || document.querySelector('[role="dialog"]'))
        return;
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
      if (
        e.key === 'Enter' &&
        pending &&
        (!el.closest('button,a,summary') || el.closest('button[data-hero][aria-pressed="true"]')) &&
        (!typing || el === search.current)
      ) {
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
  const actionType = editStep?.actionType ?? step.actionType;
  const actionText = actionType === 'ban' ? '禁用' : '选入';
  const confirmText = '确认' + (editStep ? '替换为' : actionText);
  function staged(compact: boolean) {
    if (!candidate) return null;
    return (
      <div className={'staged-preview' + (compact ? ' compact' : '')}>
        <Portrait hero={candidate} />
        <span title={projected?.text}>
          {candidate.typicalRoles.join('/')}号位
          {projected
            ? compact
              ? projected.fillsRole
                ? ' · 补' + projected.fillsRole + '号位'
                : ' · ' +
                  (projected.boostedDims.length
                    ? '补强' + projected.boostedDims.length + '项'
                    : '覆盖已有职能')
              : ' · ' + projected.text
            : ''}
        </span>
        <button className={'satin-btn ' + actionType} onClick={() => lock(candidate.id)}>
          {confirmText} {candidate.cnName}
        </button>
        {!compact && (
          <button
            aria-pressed={watchlist.includes(candidate.id)}
            onClick={() =>
              setWatchlist((ids) =>
                ids.includes(candidate.id)
                  ? ids.filter((id) => id !== candidate.id)
                  : [...ids, candidate.id],
              )
            }
          >
            {watchlist.includes(candidate.id) ? '★ 已备选' : '☆ 加入备选'}
          </button>
        )}
      </div>
    );
  }
  const nextOurStep = order.slice(d.actions.length).find((s) => s.side === d.ourSide);
  const recommendations = data ? (
    <RecommendationPanel
      data={data}
      key={turnKey}
      actionText={editStep ? '确认替换' : step.isOurTurn ? actionText : '录入对方'}
      actionType={actionType}
      canLock={synced && !analysis?.error && (!step.isCompleted || !!editStep)}
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
  );
  const diagnosis = data && (
    <CompositionMeter data={data} our={d.ourSide} preview={projected} select={select} />
  );
  return (
    <div className="bp-room studio-page">
      <header className="room-controls studio-header">
        <div className="room-heading">
          <h1>BP 对局室</h1>
          <small>
            {d.patch} · {sideNames[d.firstPickSide]}先选
          </small>
        </div>
        <LiquidGlass>
          <button
            className="setup-trigger"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            <UsersRound size={17} />
            <span>对局配置</span>
          </button>
        </LiquidGlass>
        <button className="satin-btn" onClick={() => setIntel(true)}>
          对战情报
        </button>
        <button className="satin-btn" aria-expanded={watch} onClick={() => setWatch(!watch)}>
          备选池 · {watchlist.length}
        </button>
        <div className="turn-island">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={editStep ? 'replace' : step.isOurTurn ? 'ours' : 'theirs'}
              initial={{ scaleX: 0.96 }}
              animate={{ scaleX: 1 }}
              exit={{ scaleX: 0.96, opacity: 0 }}
              transition={spring}
            >
              <LiquidGlass
                className={
                  'turn-pill ' + (editStep ? 'editing' : step.isOurTurn ? 'ours' : 'theirs')
                }
              >
                <Target size={17} />
                <strong>
                  {editStep
                    ? '替换第 ' +
                      editStep.step +
                      ' 手 · ' +
                      heroName(d.actions[editStep.step - 1].heroId)
                    : step.isCompleted
                      ? '禁选完成'
                      : '第 ' +
                        step.step +
                        ' 手 · ' +
                        (step.isOurTurn ? '我方回合' : '录入对方') +
                        ' · ' +
                        actionText}
                </strong>
                {editStep && (
                  <button
                    onClick={() => {
                      setReplacing(null);
                      setPending(null);
                    }}
                  >
                    取消替换
                  </button>
                )}
                {staged(true)}
              </LiquidGlass>
            </motion.div>
          </AnimatePresence>
        </div>
        <LiquidGlass className="history-controls">
          <button disabled={!d.actions.length} onClick={undo} title="撤销（Ctrl+Z）">
            <Undo2 />
            撤销
          </button>
          <button disabled={!redo.length} onClick={replay}>
            <Redo2 />
            重做
          </button>
          <button onClick={() => openRoom({ ...blank(), ...setupOf(d, instant) })}>
            <RotateCcw />
            重开
          </button>
          <button disabled={!!session.writes} onClick={() => setArchive(true)}>
            <Archive />
            存档
          </button>
        </LiquidGlass>
      </header>
      {watch && (
        <div className="watch-strip studio-panel">
          {watchlist.length
            ? watchlist.map((id) => (
                <span key={id}>
                  <button
                    disabled={d.actions.some((a) => a.heroId === id)}
                    onClick={() => select(id)}
                  >
                    {heroName(id)}
                  </button>
                  <button
                    aria-label={'移除' + heroName(id)}
                    onClick={() => setWatchlist((ids) => ids.filter((n) => n !== id))}
                  >
                    ×
                  </button>
                </span>
              ))
            : '预选英雄后，点击「加入备选」钉在这里。'}
        </div>
      )}
      {intel && (
        <Popover label="对战情报" className="studio-overlay" close={() => setIntel(false)}>
          <button className="dialog-close" onClick={() => setIntel(false)}>
            关闭
          </button>
          {data ? (
            <Scouting
              data={data.scoutingCard}
              heroName={heroName}
              teamId={d[teamKey(enemy)]}
              slots={d[slotsKey(enemy)]}
            />
          ) : (
            '正在读取情报…'
          )}
        </Popover>
      )}
      <DraftHud
        d={d}
        teams={teams}
        advice={data}
        players={players}
        heroes={heroes}
        assign={editAction}
        replacing={replacing}
        replace={(i) => {
          setPending(null);
          clearFilters();
          setReplacing(i);
          document.querySelector('.room-controls')?.scrollIntoView({ block: 'nearest' });
        }}
      />
      <div className="bp-bench studio-split">
        <div className="pool-column">
          {mobile && (
            <button className="sheet-trigger" onClick={() => setSheet(true)}>
              <Crosshair size={15} />
              推荐与诊断
            </button>
          )}
          <AnimatePresence>
            {toolsOpen && (
              <Popover
                label="对局与阵容配置"
                className="studio-overlay room-setup"
                close={() => setToolsOpen(false)}
              >
                <h2>对局与阵容配置</h2>
                <div className="setup-options">
                  <div className="setup-choice">
                    <span>我方阵营</span>
                    <SegmentedControl<Side>
                      label="我方阵营"
                      value={d.ourSide}
                      options={sides.map((s) => ({ value: s, label: sideNames[s] }))}
                      onChange={(ourSide) => change({ ...d, ourSide })}
                    />
                  </div>
                  <div className="setup-choice">
                    <span>先选方</span>
                    <SegmentedControl<Side>
                      label="先选方"
                      value={d.firstPickSide}
                      disabled={!!d.actions.length}
                      options={sides.map((s) => ({ value: s, label: sideNames[s] + '先选' }))}
                      onChange={(firstPickSide) => change({ ...d, firstPickSide })}
                    />
                  </div>
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
                  <button
                    onClick={() =>
                      change({
                        ...d,
                        radiantTeamId: null,
                        direTeamId: null,
                        radiantPlayerIds: Array(5).fill(null),
                        direPlayerIds: Array(5).fill(null),
                        actions: d.actions.map((a) => ({ ...a, assignedPlayerId: null })),
                      })
                    }
                  >
                    清空双边战队（自由模式）
                  </button>
                </div>{' '}
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
              </Popover>
            )}
          </AnimatePresence>
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
            staged={staged(false)}
          />
          {!mobile && diagnosis}
        </div>
        {!mobile && (
          <aside className={!synced ? 'syncing' : ''} aria-busy={!synced}>
            {recommendations}
          </aside>
        )}
      </div>
      {analysis?.error && <p role="alert">{analysis.error}</p>}
      <AnimatePresence>
        {mobile && sheet && (
          <Popover label="推荐与诊断" className="sheet-overlay" close={() => setSheet(false)}>
            <div className="sheet-heading">
              <h2>推荐与诊断</h2>
              <button onClick={() => setSheet(false)}>关闭</button>
            </div>
            {recommendations}
            {diagnosis}
          </Popover>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {archive && (
          <DraftArchive
            d={d}
            apply={openRoom}
            close={() => setArchive(false)}
            notify={notify}
            detach={() => session.bind({ ...d, id: undefined, revision: undefined })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
