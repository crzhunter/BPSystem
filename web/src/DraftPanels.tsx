import { Flag, Flame, Sprout, ScanLine } from 'lucide-react';
import { type Team, type Player, positions } from './api';
import { SlotIntel } from './Analytics';
import {
  cmOrder,
  sideNames,
  slotsKey,
  teamKey,
  type Room,
  type Side,
  type Advice,
} from './draftModel';

type Names = (id: number) => string;
export function Roster({
  side,
  d,
  players,
  teams,
  revision,
  update,
  heroName,
}: {
  side: Side;
  d: Room;
  players: Player[];
  teams: Team[];
  revision: number;
  heroName: Names;
  update: (side: Side, team: number | null, slots: (number | null)[]) => void;
}) {
  const slots = d[slotsKey(side)],
    order = cmOrder(d.firstPickSide, d.cmOrderVersion);
  const Icon = side === 'radiant' ? Sprout : Flame;
  const occupied = [...d.radiantPlayerIds, ...d.direPlayerIds];
  const picks = d.actions.filter(
    (_, i) => order[i].side === side && order[i].actionType === 'pick',
  );
  function assignedHero(playerId: number | null, slot: number) {
    const pick = picks.find((a) =>
      a.assignedPlayerId ? a.assignedPlayerId === playerId : a.roleHint === slot,
    );
    return (
      pick && (
        <span className="assigned-hero">
          已选 · {heroName(pick.heroId)}
          {pick.roleHint && pick.roleHint !== slot ? '（' + pick.roleHint + ' 号位）' : ''}
        </span>
      )
    );
  }
  return (
    <section className={'panel roster ' + side}>
      <div className="roster-cover">
        <div className="cover-title">
          <Icon size={22} />
          <h3>{sideNames[side]}</h3>
          <span className="faction-tag">{d.ourSide === side ? '我方' : '敌方'}</span>
        </div>
        <span className="pick-tag">
          <Flag size={12} />
          {side === d.firstPickSide ? '先选方' : '后选方'}
        </span>
      </div>
      <div className="room-roster-body">
        <select
          aria-label={sideNames[side] + '一键导入战队'}
          value={d[teamKey(side)] ?? 0}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id === -1) {
              location.hash = 'teams';
              return;
            }
            const team = teams.find((t) => t.id === id);
            update(
              side,
              team?.id ?? null,
              team?.roster.map((r) => r.player?.id ?? null) ?? Array(5).fill(null),
            );
          }}
        >
          <option value={0}>{d[teamKey(side)] ? '清空阵容' : '导入战队首发'}</option>
          {!teams.length && <option value={-1}>前往创建战队…</option>}
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {slots.map((playerId, i) => (
          <div className="room-slot" key={i}>
            <label>
              <b>{i + 1}</b>
              {positions[i]}
              <select
                aria-label={sideNames[side] + (i + 1) + '号位选手'}
                value={playerId ?? 0}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id === -1) {
                    location.hash = 'players';
                    return;
                  }
                  update(
                    side,
                    null,
                    slots.map((v, j) => (i === j ? id || null : v)),
                  );
                }}
              >
                <option value={0}>选择选手</option>
                {!players.length && <option value={-1}>前往添加选手…</option>}
                {players.map((p) => (
                  <option
                    key={p.id}
                    disabled={p.id !== playerId && occupied.includes(p.id)}
                    value={p.id}
                  >
                    {p.nickname}
                  </option>
                ))}
              </select>
            </label>
            {assignedHero(playerId, i + 1)}
            {playerId && (
              <a className="subtle-button" href={`#replays?mode=wards&playerId=${playerId}&side=${side}`}>
                查看选手录像
              </a>
            )}
            {playerId && <SlotIntel id={playerId} side={side} revision={revision} />}
          </div>
        ))}
        {(['pick', 'ban'] as const).map((type) => {
          const actions = d.actions.filter(
            (_, i) => order[i].side === side && order[i].actionType === type,
          );
          return (
            <div className="side-history" key={type}>
              <b>
                {type === 'pick' ? '已选' : '已禁'}{' '}
                <small>
                  {actions.length}/{type === 'pick' ? 5 : 7}
                </small>
              </b>
              <span>{actions.map((a) => heroName(a.heroId)).join('、') || '—'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function Scouting({
  data,
  heroName,
  teamId,
  slots,
}: {
  data: Advice['scoutingCard'];
  heroName: Names;
  teamId: number | null;
  slots: (number | null)[];
}) {
  function heatmapLink(mode: 'wards' | 'farming') {
    const params = new URLSearchParams({ mode, side: data.sideProfile.currentSide });
    if (teamId != null) params.set('teamId', String(teamId));
    // 即使有战队预设，也直接定位本场阵容中的辅助或核心。
    const first = slots.find((id) => id != null);
    const target = mode === 'wards' ? (slots.slice(3).find((id) => id != null) ?? first) : first;
    if (target != null) params.set('playerId', String(target));
    if (mode === 'farming') params.set('roleScope', 'cores');
    return '#replays?' + params;
  }
  return (
    <section className="panel intel-card">
      <h2>
        <ScanLine />
        对手情报卡
      </h2>
      <div className="controls-row">
        <a className="subtle-button" href={heatmapLink('wards')}>
          对手眼位热图
        </a>
        <a className="subtle-button" href={heatmapLink('farming')}>
          对手核心刷钱
        </a>
      </div>
      <h3>当前阵营表现</h3>
      <div className="side-splits">
        {(['radiant', 'dire'] as const).map((s) => (
          <div key={s} className={s === data.sideProfile.currentSide ? 'current' : ''}>
            <span>
              {sideNames[s]}
              {s === data.sideProfile.currentSide ? ' · 本场' : ''}
            </span>
            <b>{data.sideProfile[s].winrate == null ? '—' : data.sideProfile[s].winrate + '%'}</b>
            <small>{data.sideProfile[s].games} 人次</small>
          </div>
        ))}
      </div>
      <h3>优先禁用</h3>
      {data.topBans.map((b) => (
        <div className="intel-row" key={b.heroId}>
          <div>
            <b>{heroName(b.heroId)}</b>
            <strong>{b.score.toFixed(1)}</strong>
          </div>
          <p>
            {b.owner.role} 号位 · {b.owner.name}
          </p>
          <p>
            赛事 {b.tournament.wins} 胜 {b.tournament.games - b.tournament.wins} 负 · 路人{' '}
            {b.pub.wins} 胜 {b.pub.games - b.pub.wins} 负
          </p>
        </div>
      ))}
      {!data.topBans.length && <p>还没找到对手的英雄战绩。</p>}
      <h3>招牌组合</h3>
      {data.comfortCombos.map((c) => (
        <p className="combo" key={c.heroIds.join('-')}>
          <b>{c.heroIds.map(heroName).join(' + ')}</b>
          <br />
          {c.games} 场 · 胜率 {c.winrate}%
        </p>
      ))}
      {!data.comfortCombos.length && <p>暂无共同出场的赛事记录。</p>}
      <h3>摇摆位预警</h3>
      {data.flexPicks.map((f) => (
        <p key={f.heroId}>
          <b>{heroName(f.heroId)}</b> ·{' '}
          {f.players.map((p) => p.role + ' 号位 ' + p.name).join(' / ')}
        </p>
      ))}
      {!data.flexPicks.length && <p>暂无多人熟练使用的英雄。</p>}
    </section>
  );
}
