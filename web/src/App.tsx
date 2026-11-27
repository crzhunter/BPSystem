import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { LiquidGlass } from './LiquidGlass';
import { SegmentedControl, spring } from './MotionControls';
import { seedDefaultTeams, slotsKey, teamKey, sides } from './draftModel';
import { useDraftSession } from './useDraftSession';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Swords,
  Trophy,
  Shield,
  UsersRound,
  SlidersHorizontal,
  Radio,
  MapPinned,
  Check,
  CircleAlert,
  X,
} from 'lucide-react';
import { api, failure, type Player, type Team, type Hero } from './api';
import { Draft } from './Draft';
import { Matches } from './Matches';
const Replays = lazy(() => import('./Replays').then((module) => ({ default: module.Replays })));
import { Players, Teams } from './Library';
import { SettingsView } from './Settings';
const pages = [
  { id: 'draft', name: '实时 BP 对局室', short: '对局室', icon: Swords },
  { id: 'teams', name: '战队管理', short: '战队', icon: Shield },
  { id: 'players', name: '选手库', short: '选手', icon: UsersRound },
  { id: 'matches', name: '比赛库 / 导入', short: '比赛库', icon: Trophy },
  { id: 'replays', name: '录像分析', short: '录像分析', icon: MapPinned },
  { id: 'settings', name: '系统设置', short: '设置', icon: SlidersHorizontal },
];
function pageFromHash() {
  const [tab, query] = location.hash.split('?');
  return {
    ...(pages.find((p) => '#' + p.id === tab) ?? pages[0]),
    params: new URLSearchParams(query),
  };
}
export function App() {
  const [page, setPage] = useState(pageFromHash);
  const [players, setPlayers] = useState<Player[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [heroes, setHeroes] = useState<Hero[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const session = useDraftSession(notify);
  const { setD } = session;
  const refresh = useCallback(async () => {
    const [p, t, h] = await Promise.all([
      api<Player[]>('/players'),
      api<Team[]>('/teams'),
      api<Hero[]>('/heroes'),
      api('/health'),
    ]);
    const ids = new Set(p.map((player) => player.id));
    setD((room) => {
      let next = room;
      for (const side of sides) {
        const slots = slotsKey(side),
          team = teamKey(side);
        if (room[team] && !t.some((entry) => entry.id === room[team]))
          next = { ...next, [team]: null };
        if (room[slots].some((id) => id !== null && !ids.has(id)))
          next = { ...next, [slots]: room[slots].map((id) => (id && ids.has(id) ? id : null)) };
      }
      if (room.actions.some((a) => a.assignedPlayerId && !ids.has(a.assignedPlayerId)))
        next = {
          ...next,
          actions: room.actions.map((a) =>
            a.assignedPlayerId && !ids.has(a.assignedPlayerId)
              ? { ...a, assignedPlayerId: null }
              : a,
          ),
        };
      return seedDefaultTeams(next, t);
    });
    setPlayers(p);
    setTeams(t);
    setHeroes(h);
    setOnline(true);
  }, []);
  const load = useCallback(
    () =>
      refresh().catch((e) => {
        setOnline(false);
        notify(failure(e), true);
      }),
    [refresh, notify],
  );
  useEffect(() => {
    void load();
    const change = () => {
      setPage(pageFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('online', load);
    const disconnected = () => setOnline(false);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('online', load);
      window.removeEventListener('offline', disconnected);
    };
  }, [load]);
  useEffect(() => {
    document.title = page.name + ' · BPSystem';
  }, [page]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 5500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const navigation = (
    <SegmentedControl
      label="主导航"
      value={page.id}
      options={pages.map((p) => ({
        value: p.id,
        href: '#' + p.id,
        label: (
          <>
            <p.icon size={16} />
            <span className="long">{p.name}</span>
            <span className="short">{p.short}</span>
          </>
        ),
      }))}
    />
  );
  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <div className="workspace">
          <header className="site-bar">
            <a className="site-brand" href="#draft">
              <img src="/icon.svg" alt="" />
              BP<span>System</span>
            </a>
            <nav className="desktop-island">
              <LiquidGlass>{navigation}</LiquidGlass>
            </nav>
            <button
              className={'connection ' + (online ? 'on' : '')}
              onClick={load}
              title="重新检测服务连接"
            >
              <Radio size={15} />
              {online === null ? '连接中' : online ? '服务在线' : '重新连接'}
            </button>
          </header>
          <main>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={page.id}
                initial={{ y: 4 }}
                animate={{ y: 0 }}
                exit={{ y: -4, opacity: 0 }}
                transition={spring}
              >
                {page.id === 'draft' ? (
                  <Draft
                    session={session}
                    players={players}
                    teams={teams}
                    heroes={heroes}
                    notify={notify}
                    ready={online === true}
                  />
                ) : page.id === 'matches' ? (
                  <Matches heroes={heroes} refresh={refresh} notify={notify} />
                ) : page.id === 'replays' ? (
                  <Suspense fallback={<p role="status">正在打开录像分析…</p>}>
                    <Replays
                      key={page.params.toString()}
                      initialParams={page.params}
                      teams={teams}
                    />
                  </Suspense>
                ) : page.id === 'players' ? (
                  <Players players={players} refresh={refresh} notify={notify} />
                ) : page.id === 'teams' ? (
                  <Teams teams={teams} players={players} refresh={refresh} notify={notify} />
                ) : (
                  <SettingsView heroCount={heroes.length} refresh={refresh} notify={notify} />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <nav className="mobile-island">
          <LiquidGlass regular>{navigation}</LiquidGlass>
        </nav>
        {notice && (
          <div
            role={notice.error ? 'alert' : 'status'}
            className={'toast ' + (notice.error ? 'error' : '')}
          >
            {notice.error ? <CircleAlert size={18} /> : <Check size={18} />} {notice.message}
            <button aria-label="关闭提示" onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
