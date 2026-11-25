import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Ban,
  BookOpen,
  ChevronDown,
  Flag,
  Layers3,
  LockKeyhole,
  Search,
  Shield,
  SlidersHorizontal,
  Sprout,
  Swords,
  UserRound,
  UsersRound,
  Flame,
} from 'lucide-react';
import { api, failure, positions, type Hero, type Player, type Team, type Notify } from './api';
import { SlotIntel } from './Analytics';
type Side = 'radiant' | 'dire';
const sides: Side[] = ['radiant', 'dire'];
const names = { radiant: '天辉', dire: '夜魇' };
const opposite = (s: Side): Side => (s === 'radiant' ? 'dire' : 'radiant');
type Lineup = { team: number; slots: number[] };
type Prep = { our: Side; first: Side; radiant: Lineup; dire: Lineup };
const empty = (): Lineup => ({ team: 0, slots: [0, 0, 0, 0, 0] });
function initial(): Prep {
  try {
    const p = JSON.parse(localStorage.getItem('bp-prep-v1') || 'null');
    if (
      p &&
      sides.includes(p.our) &&
      sides.includes(p.first) &&
      sides.every(
        (s) =>
          Number.isInteger(p[s]?.team) &&
          Array.isArray(p[s]?.slots) &&
          p[s].slots.length === 5 &&
          p[s].slots.every(Number.isSafeInteger),
      )
    )
      return p;
  } catch {
    /* 隐私模式或旧缓存无法读取时使用空阵容。 */
  }
  return { our: 'radiant', first: 'radiant', radiant: empty(), dire: empty() };
}
export function Draft({
  players,
  teams,
  heroes,
  notify,
}: {
  players: Player[];
  teams: Team[];
  heroes: Hero[];
  notify: Notify;
}) {
  const [p, setP] = useState(initial);
  const [syncing, setSyncing] = useState(false),
    [revision, setRevision] = useState(0);
  const selected = players.filter((pl) => sides.some((s) => p[s].slots.includes(pl.id)));
  async function syncLineup() {
    setSyncing(true);
    const errors: string[] = [];
    try {
      for (const pl of selected) {
        try {
          await api('/players/' + pl.id + '/sync', 'POST');
        } catch (e) {
          errors.push(pl.nickname + '：' + failure(e));
        }
      }
      setRevision((n) => n + 1);
      notify(
        errors.length ? errors.join('；') : '已同步本场 ' + selected.length + ' 名选手',
        !!errors.length,
      );
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    try {
      localStorage.setItem('bp-prep-v1', JSON.stringify(p));
    } catch {
      notify('浏览器无法保存当前备战阵容', true);
    }
  }, [p, notify]);
  function importTeam(side: Side, id: number) {
    const team = teams.find((t) => t.id === id);
    const slots = team?.roster.map((m) => m.player?.id ?? 0) ?? empty().slots;
    if (id === -1) {
      location.hash = 'teams';
      return;
    }
    if (slots.some((id) => id && p[opposite(side)].slots.includes(id))) {
      notify('该战队有选手已在另一阵营，请先调整阵容', true);
      return;
    }
    setP({ ...p, [side]: { team: id, slots } });
    notify(team ? '已导入「' + team.name + '」首发阵容' : '已清空该方阵容');
  }
  function changeSlot(side: Side, index: number, id: number) {
    if (id === -1) {
      location.hash = 'players';
      return;
    }
    setP({ ...p, [side]: { team: 0, slots: p[side].slots.map((v, i) => (i === index ? id : v)) } });
  }
  return (
    <>
      <section className="hero-banner">
        <div className="banner-content">
          <span className="mode-label">
            <span className="live-dot" />
            赛前准备
          </span>
          <h1>
            实时 <em>BP</em> 对局室
          </h1>
          <p>配置对阵双方与先选顺序，准备本场队长模式禁选。</p>
        </div>
        <span className="patch">
          <Layers3 size={13} />
          7.3x CM
        </span>
      </section>
      <section className="tactics panel">
        <h2>
          <SlidersHorizontal />
          对局配置
        </h2>
        {(['our', 'first'] as const).map((key) => (
          <div className="toggle-group" key={key}>
            <span>{key === 'our' ? '我方阵营' : '先选方'}</span>
            <div className="segmented">
              {sides.map((s) => (
                <button
                  key={s}
                  aria-pressed={p[key] === s}
                  className={p[key] === s ? 'chosen ' + s : ''}
                  onClick={() => setP({ ...p, [key]: s })}
                >
                  {key === 'our' ? names[s] : names[s] + '先选'}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          className="subtle-button swap"
          onClick={() => {
            setP({
              ...p,
              our: opposite(p.our),
              first: opposite(p.first),
              radiant: p.dire,
              dire: p.radiant,
            });
            notify('双方阵容已交换阵营');
          }}
        >
          <ArrowLeftRight size={15} />
          交换阵营
        </button>
      </section>
      <div className="section-heading">
        <h2>
          <UsersRound />
          双方阵容
        </h2>
        <button className="subtle-button" disabled={syncing || !selected.length} onClick={syncLineup}>
          {syncing ? '正在逐人同步…' : '同步本场双方数据'}
        </button>
      </div>
      <div className="rosters">
        {sides.map((side) => {
          const Icon = side === 'radiant' ? Sprout : Flame;
          const team = teams.find((t) => t.id === p[side].team);
          return (
            <section key={side} className={'roster panel ' + side}>
              <div className="roster-cover">
                <div className="cover-title">
                  <div className="faction-icon">
                    <Icon size={24} />
                  </div>
                  <h3>{names[side]}</h3>
                  <span className="faction-tag">{side === p.our ? '我方' : '对方'}</span>
                </div>
                <span className="pick-tag">
                  <Flag size={11} />
                  {side === p.first ? '先选方' : '后选方'}
                </span>
              </div>
              <div className="roster-body">
                <div className="import-select">
                  <Shield size={15} />
                  <select
                    aria-label={names[side] + '一键导入战队'}
                    value={team?.id ?? 0}
                    onChange={(e) => importTeam(side, +e.target.value)}
                  >
                    <option value="0">{team ? '清空阵容' : '一键导入战队'}</option>
                    {!teams.length && <option value="-1">前往创建战队…</option>}
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="slots">
                  {positions.map((pos, i) => (
                    <div className="slot" key={pos}>
                      <span className="pos-num">0{i + 1}</span>
                      <span className="pos-name">
                        {pos}
                        <small>{i + 1} 号位</small>
                      </span>
                      <div className="player-select">
                        <UserRound size={13} />
                        <select
                          aria-label={names[side] + (i + 1) + '号位选手'}
                          value={players.some((pl) => pl.id === p[side].slots[i]) ? p[side].slots[i] : 0}
                          onChange={(e) => changeSlot(side, i, +e.target.value)}
                        >
                          <option value="0">选择选手</option>
                          {!players.length && <option value="-1">前往添加选手…</option>}
                          {players.map((pl) => (
                            <option
                              key={pl.id}
                              value={pl.id}
                              disabled={
                                p[opposite(side)].slots.includes(pl.id) ||
                                p[side].slots.some((v, j) => j !== i && v === pl.id)
                              }
                            >
                              {pl.nickname}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={13} />
                      </div>
                      {selected.some((pl) => pl.id === p[side].slots[i]) && (
                        <SlotIntel
                          key={p[side].slots[i]}
                          id={p[side].slots[i]}
                          side={side}
                          revision={revision}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <DraftBoard heroes={heroes} />
    </>
  );
}
const localSlugs = [
  'antimage',
  'phantom_assassin',
  'morphling',
  'earthshaker',
  'nevermore',
  'invoker',
  'medusa',
  'tiny',
  'mars',
  'puck',
  'pangolier',
  'rubick',
  'crystal_maiden',
  'lion',
];
function DraftBoard({ heroes }: { heroes: Hero[] }) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? heroes.filter((h) =>
        [h.cnName, h.localizedName, h.name, ...h.aliases].some((n) =>
          n.toLowerCase().includes(q.trim().toLowerCase()),
        ),
      )
    : localSlugs
        .slice(0, 8)
        .map((slug) => heroes.find((h) => h.name === 'npc_dota_hero_' + slug))
        .filter((h): h is Hero => !!h);
  return (
    <section className="board panel">
      <div className="board-head">
        <h2>
          <Swords />
          CM 禁选面板
        </h2>
        <span className="locked">
          <LockKeyhole size={12} />
          第三阶段开放
        </span>
      </div>
      <p className="board-note">实时禁选、Ban/Pick 评分与对手侦察将在第三阶段启用。</p>
      <div className="draft-grid">
        {sides.map((s) => (
          <div className={'draft-side ' + s} key={s}>
            <b>
              <span className="dot" />
              {names[s]}
            </b>
            {(['禁用', '选取'] as const).map((name, i) => (
              <div key={name} className="draft-row">
                <span>{name}</span>
                <div className="draft-boxes">
                  {Array.from({ length: i ? 5 : 7 }, (_, j) => (
                    <div title={names[s] + name + '槽位 ' + (j + 1)} key={j}>
                      {i ? <Shield size={13} /> : <Ban size={13} />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hero-library">
        <div className="board-head">
          <h2>
            <BookOpen />
            英雄速查
          </h2>
          <span className="muted">{heroes.length} 名英雄</span>
        </div>
        <div className="search">
          <Search size={16} />
          <input
            aria-label="搜索英雄"
            placeholder="搜索英雄名称、简称或英文名"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="hero-results">
          {filtered.map((h) => {
            const slug = h.name.replace('npc_dota_hero_', '');
            return (
              <div key={h.id} title={h.localizedName} className="hero-tile">
                <img
                  loading="lazy"
                  alt=""
                  src={
                    localSlugs.includes(slug)
                      ? '/art/' + slug + '.png'
                      : 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/' +
                        encodeURIComponent(slug) +
                        '.png'
                  }
                />
                <b>{h.cnName || h.localizedName}</b>
              </div>
            );
          })}
        </div>
        {!filtered.length && <p className="empty">没有找到匹配的英雄</p>}
      </div>
    </section>
  );
}
