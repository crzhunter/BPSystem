import { MotionConfig } from 'framer-motion';
import { LiquidGlass } from './LiquidGlass';
import { SegmentedControl } from './MotionControls';
import { blank, opposite, slotsKey, teamKey, sides } from './draftModel';
import { useDraftSession } from './useDraftSession';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Swords,
  Trophy,
  Shield,
  UsersRound,
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
const pages = [
  { id: 'draft', name: 'BP 对局室', short: '对局室', icon: Swords },
  { id: 'teams', name: '战队设置', short: '战队', icon: Shield },
  { id: 'players', name: '选手设置', short: '选手', icon: UsersRound },
  { id: 'matches', name: '比赛导入', short: '比赛', icon: Trophy },
  { id: 'replays', name: '回放复盘', short: '复盘', icon: MapPinned },
];
function pageFromHash() {
  const [tab, query] = location.hash.split('?');
  const target = tab === '#settings' ? '#matches' : tab;
  return {
    ...(pages.find((p) => '#' + p.id === target) ?? pages[0]),
    params: new URLSearchParams(query),
    maintenance: tab === '#settings',
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
      return next;
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
    if (page.maintenance && location.hash.split('?')[0] === '#settings')
      history.replaceState(null, '', '#matches');
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
          <div className="site-bar-spacer" aria-hidden="true" />
          <main>
            <div key={page.id}>
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
                <Matches
                  key={page.params.toString()}
                  settingsRequest={page.maintenance ? page.params : null}
                  heroes={heroes}
                  refresh={refresh}
                  notify={notify}
                />
              ) : page.id === 'replays' ? (
                <Suspense fallback={<p role="status">正在打开录像分析…</p>}>
                  <Replays
                    key={page.params.toString()}
                    initialParams={page.params}
                    heroes={heroes}
                    refresh={refresh}
                    notify={notify}
                    teams={teams}
                  />
                </Suspense>
              ) : page.id === 'players' ? (
                <Players heroes={heroes} players={players} refresh={refresh} notify={notify} />
              ) : (
                <Teams
                  teams={teams}
                  players={players}
                  heroes={heroes}
                  refresh={refresh}
                  notify={notify}
                  enter={(team, own) => {
                    const side = own ? session.d.ourSide : opposite(session.d.ourSide);
                    session.bind({
                      ...blank(),
                      ourSide: session.d.ourSide,
                      firstPickSide: session.d.firstPickSide,
                      [teamKey(side)]: team.id,
                      [slotsKey(side)]: team.roster.map((m) => m.player?.id ?? null),
                    });
                    location.hash = 'draft';
                  }}
                />
              )}
            </div>
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
