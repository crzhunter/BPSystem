import { useCallback, useEffect, useState } from 'react';
import {
  Swords,
  Trophy,
  Shield,
  UsersRound,
  SlidersHorizontal,
  PanelLeft,
  ChevronRight,
  Radio,
  Database,
  Check,
  CircleAlert,
  X,
} from 'lucide-react';
import { api, failure, type Player, type Team, type Hero } from './api';
import { Draft } from './Draft';
import { Matches } from './Matches';
import { Players, Teams } from './Library';
import { SettingsView } from './Settings';
const pages = [
  { id: 'draft', name: '实时 BP 对局室', short: '对局室', icon: Swords },
  { id: 'teams', name: '战队管理', short: '战队', icon: Shield },
  { id: 'players', name: '选手库', short: '选手', icon: UsersRound },
  { id: 'matches', name: '比赛库 / 导入', short: '比赛库', icon: Trophy },
  { id: 'settings', name: '系统设置', short: '设置', icon: SlidersHorizontal },
];
function pageFromHash() {
  return pages.find((p) => '#' + p.id === location.hash) ?? pages[0];
}
export function App() {
  const [page, setPage] = useState(pageFromHash);
  const [players, setPlayers] = useState<Player[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [heroes, setHeroes] = useState<Hero[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const refresh = useCallback(async () => {
    const [p, t, h] = await Promise.all([
      api<Player[]>('/players'),
      api<Team[]>('/teams'),
      api<Hero[]>('/heroes'),
      api('/health'),
    ]);
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
  const links = pages.map((p) => (
    <a
      key={p.id}
      href={'#' + p.id}
      aria-current={page.id === p.id ? 'page' : undefined}
      className={page.id === p.id ? 'active' : ''}
    >
      <p.icon size={19} />
      <span className="long">{p.name}</span>
      <span className="short">{p.short}</span>
    </a>
  ));
  return (
    <div className="app">
      <aside className="sidebar">
        <a href="#draft" className="brand">
          <img src="/icon.svg" alt="" />
          <div>
            <b>
              BP<span>System</span>
            </b>
            <small>Dota 2 赛事 BP 助手</small>
          </div>
        </a>
        <div className="nav-caption">赛事工作台</div>
        <nav aria-label="主导航">{links}</nav>
        <div className="side-foot">
          <Database size={17} />
          <div>
            本地英雄库<small>{heroes.length} 名英雄</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="crumb">
            <PanelLeft size={16} />
            <span>赛事工作台</span>
            <ChevronRight size={13} />
            <strong>{page.name}</strong>
          </div>
          <div className="mobile-brand">
            <img src="/icon.svg" alt="" />
            BPSystem
          </div>
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
          {page.id === 'draft' ? (
            <Draft players={players} teams={teams} heroes={heroes} notify={notify} ready={online === true} />
          ) : page.id === 'matches' ? (
            <Matches heroes={heroes} refresh={refresh} notify={notify} />
          ) : page.id === 'players' ? (
            <Players players={players} refresh={refresh} notify={notify} />
          ) : page.id === 'teams' ? (
            <Teams teams={teams} players={players} refresh={refresh} notify={notify} />
          ) : (
            <SettingsView heroCount={heroes.length} refresh={refresh} notify={notify} />
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="移动导航">
        {links}
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
  );
}
