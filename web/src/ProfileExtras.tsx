import { useState } from 'react';
import { api, failure, type Player, type Hero, type Notify } from './api';
import { useStudioData } from './Studio';
import { ItemSlots, type Equipment } from './ItemSlots';
export function rankName(tier: number | null) {
  if (!tier) return '段位未设置';
  if (tier === 80) return '冠绝一世';
  const names = ['', '先锋', '卫士', '中军', '统帅', '传奇', '万古流芳', '超凡入圣'];
  return names[Math.floor(tier / 10)] + ' ' + (tier % 10) + ' 星';
}
const kinds = { signature: '招牌绝活', comfort: '常用熟练', avoid: '不玩避坑' };
type Mark = { heroId: number; kind: keyof typeof kinds; note: string };
type Recent = {
  matchId: number;
  heroId: number;
  heroCnName: string;
  source: string;
  detailAvailable: boolean;
  side: string;
  win: boolean;
  resultKnown?: boolean;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gpm: number | null;
  xpm: number | null;
  items: Equipment[];
  neutralItem: Equipment;
};
export function ProfileExtras({
  player,
  heroes,
  notify,
}: {
  player: Player;
  heroes: Hero[];
  notify: Notify;
}) {
  const [q, setQ] = useState(''),
    [id, setId] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const base = '/players/' + player.id;
  const marks = useStudioData<Mark[]>(base + '/overrides', revision),
    recent = useStudioData<Recent[]>(base + '/recent-matches', player.lastSyncedAt);
  const options = heroes.filter((h) =>
    [h.cnName, h.localizedName, ...h.aliases].some((n) =>
      n.toLowerCase().includes(q.trim().toLowerCase()),
    ),
  );
  const heroId = options.some((h) => h.id === id) ? id : options[0]?.id;
  async function mark(id: number, kind?: keyof typeof kinds) {
    if (busy) return;
    setBusy(true);
    try {
      await api(base + '/overrides/' + id, kind ? 'PUT' : 'DELETE', kind ? { kind } : undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="studio-card">
        <h3>手动英雄池</h3>
        <div className="studio-actions">
          <input
            value={q}
            aria-label="搜索英雄标签"
            placeholder="搜索英雄名或简称"
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="待标记英雄"
            value={heroId ?? ''}
            onChange={(e) => setId(+e.target.value)}
          >
            {options.map((h) => (
              <option key={h.id} value={h.id}>
                {h.cnName}
              </option>
            ))}
          </select>
          {(Object.keys(kinds) as (keyof typeof kinds)[]).map((k) => (
            <button
              key={k}
              disabled={!heroId || busy}
              aria-pressed={marks?.data?.some((m) => m.heroId === heroId && m.kind === k)}
              onClick={() => heroId && mark(heroId, k)}
            >
              {kinds[k]}
            </button>
          ))}
        </div>
        <div className="id-chips">
          {marks?.data?.map((m) => (
            <button
              key={m.heroId}
              disabled={busy}
              title="移除此标签"
              onClick={() => mark(m.heroId)}
            >
              {heroes.find((h) => h.id === m.heroId)?.cnName} · {kinds[m.kind]} ×
            </button>
          ))}
        </div>
        {marks?.error && <p role="alert">{marks.error}</p>}
      </section>
      <section className="studio-card">
        <h3>近期比赛</h3>
        {recent?.data?.map((r) => (
          <article className="recent-row" key={r.matchId}>
            <div>
              <img className="mini-face" src={'/portraits/' + r.heroId + '.webp'} alt="" />
              <b>{r.heroCnName}</b> · {r.side === 'radiant' ? '天辉' : '夜魇'} ·{' '}
              {r.resultKnown === false ? '结果未知' : r.win ? '胜' : '负'} · {r.matchId}
            </div>
            <p>
              {r.source} · K/D/A {[r.kills, r.deaths, r.assists].map((n) => n ?? '—').join('/')} ·
              GPM {r.gpm ?? '—'} · XPM {r.xpm ?? '—'}
            </p>
            <ItemSlots items={r.items} neutralItem={r.neutralItem} />
            {r.detailAvailable ? (
              <a href={'#replays?playerId=' + player.id + '&matchId=' + r.matchId}>查看本场复盘</a>
            ) : (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(base + '/recent-matches/' + r.matchId + '/replay', 'POST', {});
                    location.hash = 'replays?playerId=' + player.id + '&matchId=' + r.matchId;
                  } catch (e) {
                    notify(failure(e), true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                读取终局出装并复盘
              </button>
            )}
          </article>
        ))}
        {!recent?.data?.length && <p className="hint">{recent?.error || '暂无近期比赛记录。'}</p>}
      </section>
    </>
  );
}
