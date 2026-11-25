import { useEffect, useState } from 'react';
import { Trophy, Download, List } from 'lucide-react';
import { api, failure, type Hero, type Notify } from './api';
import { PageIntro } from './Library';
import { atlasColumns, atlasRows, iconIndex } from './itemAtlas';
import { ParseReplayButton } from './ParseReplayButton';

type Action = { orderIndex: number; heroId: number; side: 'radiant' | 'dire'; isPick: number };
type Summary = {
  matchId: number;
  tag: string;
  duration: number | null;
  startTime: number | null;
  hasParsed: boolean;
  radiantName: string | null;
  direName: string | null;
  radiantWin: number | null;
  playersCount: number;
  linkedPlayersCount: number;
  picksBans: Action[];
};
type Participant = {
  items: ({ cnName: string; imgUrl: string | null } | null)[];
  player_slot: number;
  hero_id: number;
  side: Action['side'];
  account_id: number | null;
  personaname: string | null;
  linkedPlayerId: number | null;
  linkedNickname: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gpm: number | null;
  xpm: number | null;
  hero_damage: number | null;
  tower_damage: number | null;
  last_hits: number | null;
};
type Detail = Summary & {
  players: Participant[];
  telemetry: { obsCount: number; senCount: number };
};
type Result = {
  matchId: number | string;
  updated?: boolean;
  error?: string;
  linkedPlayersCount?: number;
};
type Common = { heroes: Hero[]; refresh: () => Promise<void>; notify: Notify };
const faction = { radiant: '天辉', dire: '夜魇' };
function duration(n: number | null) {
  return n == null ? '时长未知' : Math.floor(n / 60) + ' 分 ' + (n % 60) + ' 秒';
}
function MatchDetail({
  id,
  revision,
  name,
  refresh,
  notify,
  changed,
}: {
  id: number;
  revision: number;
  name: (id: number) => string;
  refresh: Common['refresh'];
  notify: Notify;
  changed: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api<Detail>('/matches/' + id)
      .then((row) => {
        if (current) {
          setD(row);
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(failure(e));
      });
    return () => {
      current = false;
    };
  }, [id, revision]);
  async function add(p: Participant) {
    setBusy(true);
    try {
      await api('/players', 'POST', {
        accountId: p.account_id,
        nickname: p.personaname?.trim().slice(0, 60) || String(p.account_id),
      });
      changed();
      await refresh();
      notify('已加入选手库，并关联该账号的历史比赛');
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  if (error || !d) return <p className="hint">{error || '正在读取比赛详情…'}</p>;
  return (
    <div className="match-detail">
      <h3>禁选顺序</h3>
      <div className="timeline">
        {d.picksBans.map((a) => (
          <span className={'pick-step ' + a.side} key={a.orderIndex}>
            {a.orderIndex + 1} · {faction[a.side]}
            {a.isPick ? '选' : '禁'} {name(a.heroId)}
          </span>
        ))}
      </div>
      {!d.picksBans.length && <p className="hint">这场比赛没有禁选记录。</p>}
      <div className="scoreboards">
        {(['radiant', 'dire'] as const).map((side) => (
          <section key={side}>
            <h3>
              {faction[side]} · {(side === 'radiant' ? d.radiantName : d.direName) || '参赛阵容'}
            </h3>
            {d.players
              .filter((p) => p.side === side)
              .map((p) => (
                <div className="score-entry" key={p.player_slot}>
                  <strong>
                    {name(p.hero_id)} ·{' '}
                    {p.linkedNickname || p.personaname || p.account_id || '匿名选手'}
                  </strong>
                  <span>
                    击杀 / 死亡 / 助攻　
                    {[p.kills, p.deaths, p.assists].map((n) => n ?? '—').join(' / ')}
                  </span>
                  <span>
                    每分钟金钱 / 经验　{p.gpm ?? '—'} / {p.xpm ?? '—'}
                  </span>
                  <span>
                    英雄伤害 {p.hero_damage ?? '—'} · 推塔伤害 {p.tower_damage ?? '—'} · 正补{' '}
                    {p.last_hits ?? '—'}
                  </span>
                  <div className="score-items" aria-label="物品栏">
                    {Array.from({ length: 6 }, (_, i) => {
                      const item = p.items[i];
                      const icon = item?.imgUrl
                        ? iconIndex.get(item.imgUrl.split('/').pop()!)
                        : undefined;
                      return (
                        <span
                          key={i}
                          title={item?.cnName ?? '空物品栏'}
                          tabIndex={item ? 0 : undefined}
                        >
                          {item && <i aria-hidden="true">{item.cnName.slice(0, 2)}</i>}
                          {icon !== undefined ? (
                            <span
                              className="item-icon"
                              role="img"
                              aria-label={item!.cnName}
                              style={{
                                backgroundSize: atlasColumns * 100 + '% ' + atlasRows * 100 + '%',
                                backgroundPosition:
                                  ((icon % atlasColumns) * 100) / (atlasColumns - 1) +
                                  '% ' +
                                  (Math.floor(icon / atlasColumns) * 100) / (atlasRows - 1) +
                                  '%',
                              }}
                            />
                          ) : item?.imgUrl ? (
                            <img
                              src={item.imgUrl}
                              alt={item.cnName}
                              onError={(e) => {
                                e.currentTarget.hidden = true;
                              }}
                            />
                          ) : null}
                          {item && <small>{item.cnName}</small>}
                        </span>
                      );
                    })}
                  </div>
                  {p.linkedPlayerId ? (
                    <small>已关联选手库</small>
                  ) : p.account_id ? (
                    <button className="subtle-button" disabled={busy} onClick={() => add(p)}>
                      加入选手库
                    </button>
                  ) : (
                    <small>账号未公开</small>
                  )}
                </div>
              ))}
          </section>
        ))}
      </div>
      <p className="hint">
        {d.hasParsed
          ? '录像记录 · 侦察守卫 ' +
            d.telemetry.obsCount +
            ' 个 · 岗哨守卫 ' +
            d.telemetry.senCount +
            ' 个'
          : '录像未解析，暂无视野统计。'}
      </p>
    </div>
  );
}
export function Matches({ heroes, refresh, notify }: Common) {
  const [input, setInput] = useState(''),
    [tag, setTag] = useState(''),
    [q, setQ] = useState(''),
    [filter, setFilter] = useState('');
  const [matches, setMatches] = useState<Summary[]>([]),
    [results, setResults] = useState<Result[]>([]);
  const [revision, setRevision] = useState(0),
    [open, setOpen] = useState(0),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const changed = () => setRevision((value) => value + 1);
  const name = (id: number) => heroes.find((h) => h.id === id)?.cnName || '英雄 ' + id;
  useEffect(() => {
    let current = true;
    setLoading(true);
    api<Summary[]>('/matches?' + new URLSearchParams({ q, tag: filter }))
      .then((list) => {
        if (current) {
          setMatches(list);
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(failure(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [q, filter, revision]);
  async function importBatch() {
    setBusy(true);
    setResults([]);
    try {
      const data = await api<{ results: Result[] }>('/matches/import', 'POST', {
        matchIds: [input],
        tag: tag.trim() || undefined,
      });
      setResults(data.results);
      changed();
      if (data.results.every((r) => !r.error)) setInput('');
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: number) {
    if (!confirm('删除比赛 ' + id + ' 及其记分板、禁选和录像记录？')) return;
    setBusy(true);
    try {
      await api('/matches/' + id, 'DELETE');
      setOpen(0);
      changed();
      notify('已删除比赛');
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageIntro
        title="比赛库 / 导入"
        description="导入赛事对局，复盘双方阵容、禁选顺序和选手表现。"
      />
      <form
        className="panel form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void importBatch();
        }}
      >
        <h2>
          <Download />
          批量导入比赛
        </h2>
        <div className="form-grid">
          <label className="wide">
            比赛 ID 或比赛链接
            <textarea
              required
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="粘贴比赛 ID、OpenDota 或 Dotabuff 链接，用换行、空格或逗号分隔"
            />
          </label>
          <label>
            赛事标签（选填）
            <input
              value={tag}
              maxLength={100}
              onChange={(e) => setTag(e.target.value)}
              placeholder="例如：第3届水友赛"
            />
          </label>
        </div>
        <div className="actions">
          <button className="primary" disabled={busy || !input.trim()}>
            {busy ? '正在处理…' : '导入比赛'}
          </button>
        </div>
        <ul aria-live="polite">
          {results.map((r) => (
            <li className="item-note" key={r.matchId}>
              {r.matchId} ·{' '}
              {r.error ||
                (r.updated ? '已更新' : '已导入') + '，关联 ' + r.linkedPlayersCount + ' 名选手'}
            </li>
          ))}
        </ul>
      </form>
      <section className="panel form-panel">
        <h2>
          <Trophy />
          已导入比赛
        </h2>
        <div className="form-grid">
          <label>
            搜索比赛
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="比赛 ID、队名或选手"
            />
          </label>
          <label>
            筛选赛事标签
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="完整标签"
            />
          </label>
        </div>
        {error && (
          <p className="notice">
            {error} <button onClick={changed}>重试</button>
          </p>
        )}
        {matches.map((m) => (
          <article key={m.matchId} className="list-item">
            <h3>
              {m.tag || '赛事对局'} · {m.matchId}
            </h3>
            <div className="match-meta">
              <b>{m.radiantWin == null ? '胜方未知' : m.radiantWin ? '天辉胜利' : '夜魇胜利'}</b>
              <span>{m.hasParsed ? '已解析录像' : '未解析'}</span>
              <span>{duration(m.duration)}</span>
              <span>
                已关联 {m.linkedPlayersCount}/{m.playersCount} 人
              </span>
            </div>
            <p className="hint">
              {m.radiantName || '天辉'} 对阵 {m.direName || '夜魇'}
              {m.startTime ? ' · ' + new Date(m.startTime * 1000).toLocaleDateString('zh-CN') : ''}
            </p>
            {m.picksBans.length > 0 && (
              <p className="hint">
                开局禁选 ·{' '}
                {m.picksBans
                  .slice(0, 4)
                  .map((a) => (a.isPick ? '选 ' : '禁 ') + name(a.heroId))
                  .join(' / ')}
              </p>
            )}
            <div className="match-tools">
              <a className="subtle-button" href={'#replays?matchId=' + m.matchId}>
                查看热力图
              </a>
              {!m.hasParsed && (
                <ParseReplayButton matchId={m.matchId} label="请求解析录像" onParsed={changed} />
              )}
              <button
                className="subtle-button"
                aria-expanded={open === m.matchId}
                onClick={() => setOpen(open === m.matchId ? 0 : m.matchId)}
              >
                <List size={14} />
                {open === m.matchId ? '收起详情' : '展开记分板'}
              </button>
              <button className="subtle-button" disabled={busy} onClick={() => remove(m.matchId)}>
                删除比赛
              </button>
            </div>
            {open === m.matchId && (
              <MatchDetail
                id={m.matchId}
                revision={revision}
                name={name}
                refresh={refresh}
                notify={notify}
                changed={changed}
              />
            )}
          </article>
        ))}
        {!matches.length && !error && (
          <p className="empty">
            {loading
              ? '正在读取比赛…'
              : q || filter
                ? '没有符合条件的比赛'
                : '比赛库为空，可在上方粘贴比赛 ID 开始导入。'}
          </p>
        )}
      </section>
    </>
  );
}
