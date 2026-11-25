import { useEffect, useState } from 'react';
import { api, failure, type Notify, type Player } from './api';

type Side = 'radiant' | 'dire';
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
  patchPub: Stats;
  patchTournament: Stats;
  isPatch742Sample: boolean;
  pub: Stats & { recentGames: number };
  tournament: Stats;
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
export function PlayerAnalysis({ player }: { player: Player }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="analysis-toggle">
      <button className="subtle-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起' : '查看'}
        {player.nickname}的战绩
      </button>
      {open && <ProfileCard player={player} />}
    </div>
  );
}
function ProfileCard({ player }: { player: Player }) {
  const { profile: p, error } = useProfile(player.id, player.lastSyncedAt);
  if (!p) return <p className="hint">{error || '正在读取战绩…'}</p>;
  const form = p.recentForm;
  return (
    <section className="analysis-card">
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
              <b>{['综合', '比赛', '路人'][i]}</b>　天辉 {pct(s.radiant.winrate)}（{s.radiant.games} 场）
              · 夜魇 {pct(s.dire.winrate)}（{s.dire.games} 场）
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
      <h3>绝活英雄池</h3>
      {p.heroPool.map((h) => (
        <div className="pool-row" key={h.heroId}>
          <b>
            {h.grade} · {h.name}
          </b>
          <span>
            {h.isPatch742Sample ? '7.42 起有战绩 · ' + h.patch742Wins + ' 胜 / ' + h.patch742Games + ' 场' : '旧版参考 · 过往曾用'} · 熟练分 {h.weightedScore}
          </span>
          <small>
            历史比赛 {h.tournament.games} 场 · 胜率 {pct(h.tournament.winrate)}　生涯路人 {h.pub.games} 场 · 胜率{' '}
            {pct(h.pub.winrate)}（近期 {h.pub.recentGames} 场）
          </small>
        </div>
      ))}
      {!p.heroPool.length && <p>同步路人战绩或导入比赛后，可查看英雄评分。</p>}
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
        '全队同步完成，成功 ' + (results.length - failed.length) + ' 人，失败 ' + failed.length + ' 人',
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
