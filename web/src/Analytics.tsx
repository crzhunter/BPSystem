import { useEffect, useState } from 'react';
import { api, failure, type Notify, type Player } from './api';

type Side = 'radiant' | 'dire';
type Counts = Stats & {
  radiantGames: number;
  radiantWins: number;
  direGames: number;
  direWins: number;
};
type Stats = { games: number; wins: number; winrate: number | null };
type Split = Record<Side, Stats> & { delta: number | null };
type Signature = {
  heroId: number;
  name: string;
  grade: string;
  weightedScore: number;
  source: string;
  patch742Games: number;
  patch742Wins: number;
  patchPub: Counts;
  patchTournament: Counts;
  isPatch742Sample: boolean;
  pub: Counts & { recentGames: number };
  tournament: Counts;
};
type Profile = {
  privacyHint: string | null;
  lastSyncedAt: string | null;
  heroPool: Signature[];
  sideSplits: Record<'pub' | 'tournament' | 'combined', Split>;
  recentForm: Stats & {
    avgKda: number | null;
    avgGpm: number | null;
    avgXpm: number | null;
    streak: { count: number; type: string | null };
  };
  roleDistribution: { role: number; games: number; percent: number | null }[];
};
const pct = (v: number | null) => (v == null ? '—' : v + '%');
function useProfile(id: number, revision: number | string | null) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setProfile(null);
    setError('');
    api<Profile>('/players/' + id + '/analytics')
      .then((p) => {
        if (current) setProfile(p);
      })
      .catch((e) => {
        if (current) setError(failure(e));
      });
    return () => {
      current = false;
    };
  }, [id, revision]);
  return { profile, error };
}
export function SlotIntel({ id, side, revision }: { id: number; side: Side; revision: number }) {
  const { profile, error } = useProfile(id, revision);
  if (!profile) return <p className="intel">{error || '正在读取战绩…'}</p>;
  const split = profile.sideSplits.combined[side];
  return (
    <div className="intel">
      <span>
        {side === 'radiant' ? '天辉' : '夜魇'} ·{' '}
        {split.games ? pct(split.winrate) + ' 胜率' : '还没打过'}
      </span>
      {profile.privacyHint && (
        <span className="private" title={profile.privacyHint}>
          路人战绩未公开
        </span>
      )}
      {profile.heroPool.slice(0, 3).map((h) => (
        <span className="hero-pill" key={h.heroId}>
          <b>{h.name}</b>
          <small>{h.isPatch742Sample ? '7.42 起有战绩' : '旧版参考'}</small>
          {h.patchTournament.games > 0 && <small>赛 {pct(h.patchTournament.winrate)}</small>}
          {h.patchPub.games > 0 && <small>路 {pct(h.patchPub.winrate)}</small>}
        </span>
      ))}
    </div>
  );
}
export function ProfileCard({ player }: { player: Player }) {
  const { profile: p, error } = useProfile(player.id, player.lastSyncedAt);
  const [scope, setScope] = useState('patch'),
    [side, setSide] = useState<'all' | 'radiant' | 'dire'>('all');
  if (!p) return <p className="hint">{error || '正在读取战绩…'}</p>;
  const form = p.recentForm;
  return (
    <section className="studio-card analysis-card">
      {p.privacyHint && <p className="notice">{p.privacyHint}</p>}
      <h3>7.42+ 近期路人状态</h3>
      {form.games ? (
        <>
          <p>
            最近 {form.games} 场 · 胜率 {pct(form.winrate)} · {form.streak.count} {form.streak.type}
          </p>
          <p>
            平均 KDA {form.avgKda ?? '—'} · 每分钟金钱 {form.avgGpm ?? '—'} · 每分钟经验{' '}
            {form.avgXpm ?? '—'}
          </p>
        </>
      ) : (
        <p>暂无逐场路人记录</p>
      )}
      <h3>7.42+ 阵营胜率</h3>
      <div className="side-stats">
        {(['combined', 'tournament', 'pub'] as const).map((source, i) => {
          const s = p.sideSplits[source];
          return (
            <p key={source}>
              <b>{['综合', '比赛', '路人'][i]}</b>　天辉 {pct(s.radiant.winrate)}（{s.radiant.games}{' '}
              场） · 夜魇 {pct(s.dire.winrate)}（{s.dire.games} 场）
            </p>
          );
        })}
      </div>
      <h3>位置倾向</h3>
      <p>
        {p.roleDistribution
          .filter((r) => r.games)
          .map((r) => r.role + ' 号位 ' + pct(r.percent) + '（' + r.games + ' 场）')
          .join(' · ') || '暂无可推断位置的分路记录'}
      </p>
      <h3>英雄池战绩</h3>
      <div className="studio-actions">
        <select aria-label="英雄池样本" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="patch">7.42 起</option>
          <option value="life">生涯</option>
          <option value="tour">仅赛事</option>
        </select>
        <select
          aria-label="英雄池阵营"
          value={side}
          onChange={(e) => setSide(e.target.value as typeof side)}
        >
          <option value="all">全部阵营</option>
          <option value="radiant">天辉</option>
          <option value="dire">夜魇</option>
        </select>
      </div>
      {side !== 'all' && <small>阵营筛选仅统计有阵营信息的逐场记录。</small>}
      {p.heroPool.map((h) => {
        const sources =
          scope === 'patch'
            ? [h.patchPub, h.patchTournament]
            : scope === 'tour'
              ? [h.tournament]
              : [h.pub, h.tournament];
        const games = sources.reduce(
          (n, s) =>
            n + (side === 'all' ? s.games : s[side === 'dire' ? 'direGames' : 'radiantGames']),
          0,
        );
        const wins = sources.reduce(
          (n, s) => n + (side === 'all' ? s.wins : s[side === 'dire' ? 'direWins' : 'radiantWins']),
          0,
        );
        return games ? (
          <div className="roster-line" key={h.heroId}>
            <img className="mini-face" src={'/portraits/' + h.heroId + '.webp'} alt="" />
            <b>{h.name}</b>
            <span>
              {wins} 胜 / {games} 场 · {Math.round((100 * wins) / games)}%
            </span>
          </div>
        ) : null;
      })}
      {!p.heroPool.length && <p>同步战绩或导入比赛后可查看英雄统计。</p>}
    </section>
  );
}
export function TeamSync({
  id,
  players,
  refresh,
  notify,
}: {
  id: number;
  players: Player[];
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  async function sync() {
    setBusy(true);
    try {
      const { results } = await api<{ results: { playerId: number; error?: string }[] }>(
        '/teams/' + id + '/sync',
        'POST',
      );
      const failed = results.filter((r) => r.error);
      setErrors(
        failed.map(
          (r) => (players.find((p) => p.id === r.playerId)?.nickname ?? '选手') + '：' + r.error,
        ),
      );
      await refresh();
      notify(
        '全队同步完成，成功 ' +
          (results.length - failed.length) +
          ' 人，失败 ' +
          failed.length +
          ' 人',
        !!failed.length,
      );
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="subtle-button" disabled={busy || !players.length} onClick={sync}>
        {busy ? '正在逐人同步…' : '一键同步全队'}
      </button>
      {errors.map((msg) => (
        <p className="hint" key={msg}>
          {msg}
        </p>
      ))}
    </>
  );
}
