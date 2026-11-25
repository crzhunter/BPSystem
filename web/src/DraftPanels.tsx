import { useState } from 'react';
import { Flag, Flame, Sprout, Swords, ScanLine, Crosshair, Shield } from 'lucide-react';
import { type Hero, type Team, type Player, positions } from './api';
import { SlotIntel } from './Analytics';
import {
  cmOrder,
  sideNames,
  slotsKey,
  teamKey,
  heroArt,
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
    order = cmOrder(d.firstPickSide);
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
export function Audit({ data }: { data: Advice['lineupAudit'] }) {
  const tags = [
    ['stun', '硬控'],
    ['initiate', '先手'],
    ['push', '拆塔'],
    ['save', '救人'],
  ] as const;
  return (
    <section className="panel intel-card">
      <h2>
        <Shield />
        我方阵容体检
      </h2>
      <div className="coverage">
        {[1, 2, 3, 4, 5].map((n) => (
          <span className={data.coveredRoles.includes(n) ? 'on' : ''} key={n}>
            {n} 号位
          </span>
        ))}
      </div>
      <p>{tags.map(([t, label]) => label + ' ' + data.tagCounts[t]).join(' · ')}</p>
      {data.warnings.length ? (
        <ul>
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <p>各位置与关键战术职能已齐备。</p>
      )}
    </section>
  );
}
export function Rankings({
  type,
  data,
  heroName,
  players,
}: {
  type: 'ban' | 'pick';
  data: Advice;
  heroName: Names;
  players: Player[];
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = type === 'ban' ? data.banRecommendations : data.pickRecommendations;
  return (
    <section className="panel intel-card">
      <h2>
        {type === 'ban' ? <Crosshair /> : <Swords />}
        {type === 'ban' ? '敌方禁人威胁' : '我方选人推荐'}
      </h2>
      {(expanded ? rows : rows.slice(0, 3)).map((row, i) => (
        <div key={row.heroId} className="intel-row">
          <div>
            <small>{i + 1}</small>
            <b>{heroName(row.heroId)}</b>
            <strong>{row.score.toFixed(1)}</strong>
          </div>
          {'suggestedRole' in row && (
            <p>
              {row.suggestedRole} 号位
              {row.suggestedPlayerId
                ? ' · ' +
                  (players.find((p) => p.id === row.suggestedPlayerId)?.nickname ?? '待定选手')
                : ''}
            </p>
          )}
          <p>{row.reasons.join(' · ')}</p>
        </div>
      ))}
      {!rows.length && <p>本局该项禁选已结束。</p>}
      {rows.length > 3 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '查看全部 ' + rows.length + ' 名'}
        </button>
      )}
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
    if (teamId != null) {
      params.set('teamId', String(teamId));
    } else {
      // 槽位按 1–5 号位排列：首位已选对手天然优先核心，眼位则先查两个辅助位。
      const firstPlayer = slots.find((id) => id != null);
      const playerId =
        mode === 'wards' ? slots.slice(3).find((id) => id != null) ?? firstPlayer : firstPlayer;
      if (playerId != null) params.set('playerId', String(playerId));
    }
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
      {!data.topBans.length && <p>暂无对手英雄池样本。</p>}
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
export function HeroPortrait({ h }: { h: Hero }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="portrait-fallback" aria-hidden="true">
      {h.cnName.slice(0, 1)}
    </span>
  ) : (
    <img alt="" loading="lazy" src={heroArt(h.name)} onError={() => setFailed(true)} />
  );
}
