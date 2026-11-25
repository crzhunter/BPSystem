import { useCallback, useEffect, useState } from 'react';
import { Crosshair, Footprints, Layers, MapPinned, Search, UsersRound } from 'lucide-react';
import { api, failure, type Team } from './api';
import type { replayPlayerMatches, replayPlayers } from '../../server/src/services/replay';
import { Portrait } from './HeroPoolGrid';
import { PageIntro } from './Library';
import { MinimapHeatmap, type WardMap, type FarmMap } from './MinimapHeatmap';
import { ParseReplayButton } from './ParseReplayButton';
import './replays.css';

type MatchRow = ReturnType<typeof replayPlayerMatches>[number];
type Directory = ReturnType<typeof replayPlayers>;
type Mode = 'wards' | 'farming';

// 切换选手或筛选时只展示当前请求的数据，避免上一人的迟到响应覆盖热图。
function useReplayData<T>(path: string | null, revision: number) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    if (!path) return;
    let active = true;
    api<T>(path).then(
      (data) => {
        if (active) setResult({ path, data });
      },
      (error) => {
        if (active) setResult({ path, error: failure(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path, revision]);
  return result?.path === path ? result : undefined;
}
function Select({
  label,
  value,
  options,
  set,
}: {
  label: string;
  value: string;
  options: [string, string][];
  set: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {value && !options.some(([key]) => key === value) && <option value={value}>{value}</option>}
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function WardStats({ data }: { data: WardMap }) {
  const s = data.summary;
  return (
    <>
      <section className="panel replay-card">
        <h2>
          <Crosshair />
          视野统计
        </h2>
        <div className="replay-metrics">
          <div>
            <span>
              <i className="obs-key" />
              假眼
            </span>
            <strong>{s.obsCount}</strong>
          </div>
          <div>
            <span>
              <i className="sen-key" />
              真眼
            </span>
            <strong>{s.senCount}</strong>
          </div>
        </div>
        <p className="hint">
          天辉 {s.radiantCount} 个 · 夜魇 {s.direCount} 个
        </p>
        <p className="hint">
          范围内共 {s.matchCount} 场，已解析 {s.parsedMatchCount} 场
        </p>
      </section>
      <section className="panel replay-card">
        <h2>
          <MapPinned />
          高频眼位
        </h2>
        {data.hotspots.length ? (
          <ol className="hotspots">
            {data.hotspots.map((h, i) => (
              <li key={i}>
                <span>
                  {h.zone}
                  <small>
                    坐标 {Math.round(64 + 128 * h.nx)}，{Math.round(192 - 128 * h.ny)}
                  </small>
                </span>
                <b>{h.count} 次</b>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">有了眼位记录，就能看到最常插眼的区域。</p>
        )}
      </section>
    </>
  );
}
function FarmStats({ data }: { data: FarmMap }) {
  const s = data.summary;
  return (
    <>
      <section className="panel replay-card">
        <h2>
          <Footprints />
          经济与经验
        </h2>
        <div className="replay-metrics">
          <div>
            <span>平均每分钟金钱</span>
            <strong>{s.avgGpm?.toFixed(0) ?? '—'}</strong>
          </div>
          <div>
            <span>平均每分钟经验</span>
            <strong>{s.avgXpm?.toFixed(0) ?? '—'}</strong>
          </div>
        </div>
        <p className="hint">
          {s.matchCount} 场比赛 · {s.samplePlayers} 人次
        </p>
      </section>
      <section className="panel replay-card">
        <h2>
          <Layers />
          区域活动占比
        </h2>
        {data.zoneBreakdown.map((z) => (
          <div className="zone" key={z.zone}>
            <label>
              {z.zone}
              <b>{z.percentage.toFixed(1)}%</b>
              <progress max="100" value={z.percentage} />
            </label>
          </div>
        ))}
        <p className="hint">按录像里英雄在各区出现的次数计算，多场一起看。</p>
      </section>
    </>
  );
}
function HeroFace({ row }: { row: MatchRow }) {
  return (
    <span className="replay-face">
      <Portrait
        hero={{ id: row.heroId, cnName: row.heroCnName, portraitUrl: row.heroPortraitUrl }}
      />
    </span>
  );
}
const sideName = { radiant: '天辉', dire: '夜魇' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function MatchCard({
  row,
  active,
  choose,
  reload,
}: {
  row: MatchRow;
  active: boolean;
  choose: () => void;
  reload: () => void;
}) {
  return (
    <div className="replay-record">
      <button className="replay-choice record-choice" aria-pressed={active} onClick={choose}>
        <HeroFace row={row} />
        <span className="record-info">
          <span className="record-title">
            <b>{row.heroCnName}</b>
            <span className={'replay-side ' + row.side}>{sideName[row.side]}</span>
            {row.resultKnown ? (
              <span className={'replay-outcome ' + (row.win ? 'win' : 'loss')}>
                {row.win ? '胜' : '负'}
              </span>
            ) : (
              <span>胜负未知</span>
            )}
          </span>
          <span>
            {row.tag || '未标注赛事'} ·{' '}
            {row.startTime == null ? '日期未知' : dateFormat.format(row.startTime * 1000)}
          </span>
          <span>
            比赛 {row.matchId} · 击杀 / 死亡 / 助攻　
            {[row.kills, row.deaths, row.assists].map((v) => v ?? '—').join(' / ')}
          </span>
        </span>
      </button>
      {!row.hasParsed && (
        <ParseReplayButton matchId={row.matchId} onParsed={reload} label="请求解析" />
      )}
    </div>
  );
}
function Retry({ error, reload }: { error: string; reload: () => void }) {
  return (
    <p className="hint" role="alert">
      {error}{' '}
      <button className="subtle-button" onClick={reload}>
        重新加载
      </button>
    </p>
  );
}

function HeatmapPanel({
  identity,
  matchId,
  records,
  name,
  mode,
  setMode,
  side,
  setSide,
  initialRole,
  revision,
  reload,
  selectedMatch,
}: {
  identity: { playerId: number } | { accountId: number } | { playerSlot: number };
  matchId: number | null;
  records: MatchRow[];
  name: string;
  mode: Mode;
  setMode: (v: Mode) => void;
  side: string;
  setSide: (v: string) => void;
  initialRole: string;
  revision: number;
  reload: () => void;
  selectedMatch?: MatchRow;
}) {
  const [wardType, setWardType] = useState('both'),
    [phase, setPhase] = useState('all'),
    [roleScope, setRoleScope] = useState(initialRole),
    [heroId, setHeroId] = useState(''),
    [tag, setTag] = useState('');
  const params = new URLSearchParams({ side });
  for (const [key, value] of Object.entries(identity)) params.set(key, String(value));
  if (matchId != null) params.set('matchId', String(matchId));
  else if (tag) params.set('tag', tag);
  if (mode === 'wards') {
    params.set('phase', phase);
    params.set('wardType', wardType);
  } else {
    params.set('roleScope', roleScope);
    if (!matchId && heroId) params.set('heroId', heroId);
  }
  const wardResult = useReplayData<WardMap>(
    mode === 'wards' ? '/replays/wards?' + params : null,
    revision,
  );
  const farmResult = useReplayData<FarmMap>(
    mode === 'farming' ? '/replays/farming?' + params : null,
    revision,
  );
  const ward = wardResult?.data,
    farm = farmResult?.data,
    error = wardResult?.error || farmResult?.error;
  let hint = '正在读取录像数据…';
  if (selectedMatch && !selectedMatch.hasParsed)
    hint = '这场比赛尚未解析，可在参赛记录中请求解析。';
  else if (ward) {
    if (!ward.summary.parsedMatchCount) hint = '当前筛选下没有已解析比赛。';
    else if (!ward.points.length) hint = '当前筛选下没有眼位，可调整眼位类型或比赛时段。';
    else hint = '悬停或点按标记查看眼位详情，重复点按可查看重叠眼位。';
  } else if (farm)
    hint = farm.cells.length
      ? '颜色越暖，选手越常在这一带活动。'
      : '这些录像里还没找到刷钱路线。';
  const tags = Array.from(new Set(records.map((r) => r.tag).filter(Boolean)));
  const heroes = new Map(records.map((r) => [String(r.heroId), r.heroCnName]));
  return (
    <>
      <div className="replay-tabs" aria-label="分析模式">
        <button aria-pressed={mode === 'wards'} onClick={() => setMode('wards')}>
          <Crosshair />
          眼位热力图
        </button>
        <button aria-pressed={mode === 'farming'} onClick={() => setMode('farming')}>
          <Footprints />
          刷钱热力图
        </button>
      </div>
      <section className="panel replay-filters" aria-label="热图筛选">
        <Select
          label="阵营"
          value={side}
          set={setSide}
          options={[
            ['all', '全部阵营'],
            ['radiant', '天辉'],
            ['dire', '夜魇'],
          ]}
        />
        {mode === 'wards' ? (
          <>
            <Select
              label="眼位类型"
              value={wardType}
              set={setWardType}
              options={[
                ['both', '假眼和真眼'],
                ['obs', '仅假眼'],
                ['sen', '仅真眼'],
              ]}
            />
            <Select
              label="比赛时段"
              value={phase}
              set={setPhase}
              options={[
                ['all', '全场'],
                ['early', '0–10 分钟'],
                ['mid', '10–25 分钟'],
                ['late', '25 分钟起'],
              ]}
            />
          </>
        ) : (
          <>
            <Select
              label="位置范围"
              value={roleScope}
              set={setRoleScope}
              options={[
                ['all', '全部位置'],
                ['cores', '仅核心位（1–3 号位）'],
              ]}
            />
            {!matchId && heroes.size > 0 && (
              <Select
                label="英雄"
                value={heroId}
                set={setHeroId}
                options={[['', '全部英雄'], ...heroes]}
              />
            )}
          </>
        )}
        {!matchId && tags.length > 0 && (
          <Select
            label="赛事标签"
            value={tag}
            set={setTag}
            options={[['', '全部赛事'], ...tags.map((t): [string, string] => [t, t])]}
          />
        )}
      </section>
      <div className="replay-layout">
        <section className="panel replay-map-card">
          <header>
            <div>
              <h2>
                {name}的{mode === 'wards' ? '布眼分布' : '刷钱分布'}
              </h2>
              <p className="hint">
                {selectedMatch
                  ? selectedMatch.heroCnName + ' · 比赛 ' + matchId
                  : '合看已解析的比赛'}
              </p>
            </div>
            <span className="density-legend">
              低<i />高
            </span>
          </header>
          <MinimapHeatmap points={ward?.points} cells={farm?.cells} farming={mode === 'farming'} />
          {error ? (
            <Retry error={error} reload={reload} />
          ) : (
            <p className="hint" role="status">
              {hint}
            </p>
          )}
        </section>
        <aside className="replay-stats">
          {ward && <WardStats data={ward} />}
          {farm && <FarmStats data={farm} />}
        </aside>
      </div>
    </>
  );
}

export function Replays({
  teams,
  initialParams,
}: {
  teams: Team[];
  initialParams: URLSearchParams;
}) {
  const [mode, setMode] = useState<Mode>(
    initialParams.get('mode') === 'farming' ? 'farming' : 'wards',
  );
  const initialSide = initialParams.get('side');
  const [side, setSide] = useState(
    initialSide === 'radiant' || initialSide === 'dire' ? initialSide : 'all',
  );
  const [teamId, setTeamId] = useState(Number(initialParams.get('teamId')) || null);
  const [playerId, setPlayerId] = useState(Number(initialParams.get('playerId')) || null);
  const [entryMatch, setEntryMatch] = useState(Number(initialParams.get('matchId')) || null);
  const [drillId, setDrillId] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const directory = useReplayData<Directory>('/replays/players', revision);
  const participants = useReplayData<MatchRow[]>(
    entryMatch ? '/replays/matches/' + entryMatch + '/participants' : null,
    revision,
  );
  const team = teams.find((t) => t.id === teamId);
  const allPlayers = directory?.data ?? [];
  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const roster =
    teamId === null
      ? allPlayers
      : [...(team?.roster ?? []), ...(team?.subs ?? [])].flatMap(
          (member) => (member.player && byId.get(member.player.id)) || [],
        );
  const visible = roster.filter((p) =>
    p.nickname.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const saved = playerId === null ? visible[0] : visible.find((p) => p.id === playerId);
  const group = participants?.data;
  const member =
    slot !== null
      ? group?.find((p) => p.playerSlot === slot)
      : playerId !== null
        ? group?.find((p) => p.playerId === playerId)
        : (group?.find((p) => p.playerId !== null) ?? group?.[0]);
  const savedId = entryMatch ? member?.playerId : saved?.id;
  const name = entryMatch ? member?.playerName : saved?.nickname;
  const matchId = entryMatch ?? drillId;
  const history = useReplayData<MatchRow[]>(
    savedId ? '/replays/players/' + savedId + '/matches' : null,
    revision,
  );
  const records = history?.data ?? (member ? [member] : []);
  const selectedMatch = records.find((r) => r.matchId === matchId) ?? member;
  const parsedCount = savedId ? byId.get(savedId)?.parsedMatchCount : undefined;
  // 只有已入库的选手可以跨场聚合。公开账号和匿名槽位始终与比赛编号一起查询。
  const identity = savedId
    ? { playerId: savedId }
    : member
      ? member.accountId != null
        ? { accountId: member.accountId }
        : { playerSlot: member.playerSlot }
      : null;
  function openPlayer(id: number | null, match: number | null = null) {
    if (entryMatch) setTeamId(null);
    setEntryMatch(null);
    setSlot(null);
    setPlayerId(id);
    setDrillId(match);
  }
  function chooseMatch(row: MatchRow) {
    if (side !== 'all' && side !== row.side) setSide('all');
    if (row.matchId !== entryMatch && savedId) openPlayer(savedId, row.matchId);
  }
  return (
    <div className="replays">
      <PageIntro
        title="录像分析"
        description="选择选手查看多场布眼与刷钱分布，或打开一场比赛复盘当场表现。"
      />
      <section className="panel replay-picker">
        {entryMatch ? (
          <>
            <header>
              <h2>
                <UsersRound />
                本场参赛选手
              </h2>
              <button className="subtle-button" onClick={() => openPlayer(savedId ?? null)}>
                查看选手库录像
              </button>
            </header>
            <p className="hint">比赛 {entryMatch} · 选择参赛者查看个人热图</p>
            {participants?.error ? (
              <Retry error={participants.error} reload={reload} />
            ) : !group ? (
              <p className="hint">正在读取参赛名单…</p>
            ) : group.length ? (
              <div className="participant-grid">
                {group.map((p) => (
                  <button
                    key={p.playerSlot}
                    className="replay-choice participant-choice"
                    aria-pressed={member?.playerSlot === p.playerSlot}
                    onClick={() => {
                      setSlot(p.playerSlot);
                      if (side !== p.side) setSide('all');
                    }}
                  >
                    <HeroFace row={p} />
                    <span>
                      <b>{p.heroCnName}</b>
                      <small>{p.playerName}</small>
                      <span className={'replay-side ' + p.side}>{sideName[p.side]}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p className="hint">这场比赛尚无参赛名单。</p>
                <ParseReplayButton matchId={entryMatch} onParsed={reload} label="请求解析" />
              </>
            )}
            {group?.length && !member ? (
              <p className="hint">该选手未参加这场比赛，请选择本场参赛者。</p>
            ) : null}
          </>
        ) : (
          <>
            <header>
              <h2>
                <UsersRound />
                选择选手
              </h2>
              <label className="replay-search">
                <Search size={15} />
                <input
                  type="search"
                  aria-label="搜索选手昵称"
                  placeholder="搜索选手昵称"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    openPlayer(null);
                  }}
                />
              </label>
            </header>
            <div className="replay-team-bar" aria-label="按战队筛选">
              {[{ id: null, name: '全部选手' }, ...teams].map((t) => (
                <button
                  key={t.id ?? 'all'}
                  aria-pressed={teamId === t.id}
                  onClick={() => {
                    setTeamId(t.id);
                    setSearch('');
                    openPlayer(null);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="replay-players">
              {visible.map((p) => (
                <button
                  key={p.id}
                  className="replay-choice player-choice"
                  aria-pressed={saved?.id === p.id}
                  onClick={() => openPlayer(p.id)}
                >
                  <b>{p.nickname}</b>
                  <small>{p.roles.length ? p.roles.join('、') + ' 号位' : '位置未设置'}</small>
                  <span className="parsed-count">已解析 {p.parsedMatchCount} 场</span>
                </button>
              ))}
            </div>
            {directory?.error ? (
              <Retry error={directory.error} reload={reload} />
            ) : !directory ? (
              <p className="hint">正在读取选手…</p>
            ) : !visible.length ? (
              <p className="hint">
                {allPlayers.length ? '没有符合条件的选手。' : '选手库为空，可前往选手库添加选手。'}
              </p>
            ) : (
              !saved && <p className="hint">未找到链接中的选手，请重新选择。</p>
            )}
          </>
        )}
      </section>
      {identity && name && (
        <>
          <section className="panel replay-picker replay-history">
            <header>
              <h2>
                <Layers />
                {name}的参赛记录
              </h2>
              {savedId && (
                <button
                  className="replay-choice aggregate-choice"
                  aria-pressed={matchId === null}
                  onClick={() => openPlayer(savedId)}
                >
                  合看已解析的比赛（{parsedCount ?? records.filter((r) => r.hasParsed).length}{' '}
                  场）
                </button>
              )}
            </header>
            <div className="replay-records">
              {records.map((row) => (
                <MatchCard
                  key={row.matchId}
                  row={row}
                  active={row.matchId === matchId}
                  choose={() => chooseMatch(row)}
                  reload={reload}
                />
              ))}
            </div>
            {history?.error ? (
              <Retry error={history.error} reload={reload} />
            ) : (
              !records.length && (
                <p className="hint">{history ? '暂无导入的赛事记录。' : '正在读取参赛记录…'}</p>
              )
            )}
          </section>
          <HeatmapPanel
            key={savedId ?? 'slot-' + member?.playerSlot}
            identity={identity}
            matchId={matchId}
            name={name}
            records={records}
            selectedMatch={selectedMatch}
            mode={mode}
            setMode={setMode}
            side={side}
            setSide={setSide}
            initialRole={initialParams.get('roleScope') === 'cores' ? 'cores' : 'all'}
            revision={revision}
            reload={reload}
          />
        </>
      )}
    </div>
  );
}
