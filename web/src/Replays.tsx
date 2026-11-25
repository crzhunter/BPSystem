import { useCallback, useEffect, useState } from 'react';
import { Crosshair, Footprints, Layers, MapPinned } from 'lucide-react';
import { api, failure, type Hero, type Player, type Team } from './api';
import { PageIntro } from './Library';
import { MinimapHeatmap, type WardMap, type FarmMap } from './MinimapHeatmap';
import { ParseReplayButton } from './ParseReplayButton';
import './replays.css';

type MatchOption = { matchId: number; tag: string };
type Report = { mode: 'wards'; data: WardMap } | { mode: 'farming'; data: FarmMap };
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
function WardStats({ data, reload }: { data: WardMap; reload: () => void }) {
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
          <p className="hint">有眼位样本后，这里会列出布眼最集中的区域。</p>
        )}
      </section>
      <section className="panel replay-card">
        <h2>
          待解析比赛 <small>{data.unparsedMatches.length} 场</small>
        </h2>
        {data.unparsedMatches.map((m) => (
          <div className="parse-row" key={m.matchId}>
            <b>
              {m.tag || '赛事对局'} · {m.matchId}
            </b>
            <ParseReplayButton matchId={m.matchId} onParsed={reload} />
          </div>
        ))}
        {!data.unparsedMatches.length && <p className="hint">当前范围内没有待解析比赛。</p>}
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
          {s.matchCount} 场比赛 · {s.samplePlayers} 人次 · 位置权重 {s.totalWeight}
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
        <p className="hint">按位置采样权重计算，同一名选手跨场分别计入。</p>
      </section>
    </>
  );
}
export function Replays({
  teams,
  players,
  heroes,
  initialParams,
}: {
  teams: Team[];
  players: Player[];
  heroes: Hero[];
  initialParams: URLSearchParams;
}) {
  const [mode, setMode] = useState<Report['mode']>(
    initialParams.get('mode') === 'farming' ? 'farming' : 'wards',
  );
  const [matchId, setMatchId] = useState(initialParams.get('matchId') || ''),
    [teamId, setTeamId] = useState(initialParams.get('teamId') || ''),
    [playerId, setPlayerId] = useState(initialParams.get('playerId') || ''),
    [heroId, setHeroId] = useState('');
  // 每次只按一种范围查询。混合链接优先保留原有单场入口，再取战队或选手。
  const [scope, setScope] = useState(
    matchId ? 'match' : teamId ? 'team' : playerId ? 'player' : 'all',
  );
  const initialSide = initialParams.get('side');
  const [side, setSide] = useState<string>(
      initialSide === 'radiant' || initialSide === 'dire' ? initialSide : 'all',
    ),
    [wardType, setWardType] = useState('both'),
    [phase, setPhase] = useState('all');
  const [roleScope, setRoleScope] = useState('cores'),
    [tag, setTag] = useState('');
  const [matches, setMatches] = useState<MatchOption[]>([]),
    [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const [result, setResult] = useState<{ key: string; report?: Report; error?: string }>();
  const selectedId = scope === 'match' ? matchId : scope === 'team' ? teamId : playerId;
  const ready = scope === 'all' || !!selectedId;
  const q = new URLSearchParams({ side });
  if (scope !== 'all')
    q.set(scope === 'match' ? 'matchId' : scope === 'team' ? 'teamId' : 'playerId', selectedId);
  if (tag) q.set('tag', tag);
  if (mode === 'wards') {
    q.set('wardType', wardType);
    q.set('phase', phase);
  } else {
    q.set('roleScope', roleScope);
    if (heroId) q.set('heroId', heroId);
  }
  const path = '/replays/' + mode + '?' + q,
    key = path + '#' + revision;
  useEffect(() => {
    let active = true;
    api<MatchOption[]>('/matches')
      .then((list) => {
        if (active) {
          setMatches(list);
          setListError('');
        }
      })
      .catch((e) => {
        if (active) setListError(failure(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    async function load() {
      try {
        const report: Report =
          mode === 'wards'
            ? { mode, data: await api<WardMap>(path) }
            : { mode, data: await api<FarmMap>(path) };
        if (active) setResult({ key, report });
      } catch (e) {
        if (active) setResult({ key, error: failure(e) });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [ready, key, path, mode]);
  const current = ready && result?.key === key ? result : undefined,
    report = current?.report;
  const ward = report?.mode === 'wards' ? report.data : undefined,
    farm = report?.mode === 'farming' ? report.data : undefined;
  let message = '';
  if (!ready)
    message =
      '请选择要分析的' + (scope === 'match' ? '比赛' : scope === 'team' ? '战队' : '选手') + '。';
  else if (!current) message = '正在读取录像数据…';
  else if (current.error) message = current.error;
  else if (ward && !ward.summary.matchCount)
    message = '当前范围没有比赛。可调整筛选，或到比赛库导入对局。';
  else if (ward && !ward.summary.parsedMatchCount)
    message = '当前比赛尚未解析，可在待解析比赛列表中提交请求。';
  else if (ward && !ward.points.length) message = '当前筛选没有眼位，可切换阵营、眼位类型或比赛时段。';
  else if (farm && !farm.cells.length)
    message = '当前范围没有位置采样。可切换到全部位置，或在眼位页请求解析比赛。';
  return (
    <div className="replays">
      <PageIntro
        title="录像分析"
        description="对照地图复盘布眼与核心走位，也可以汇总多场比赛，查看队伍的常用区域。"
      />
      <div className="replay-tabs" aria-label="分析模式">
        <button aria-pressed={mode === 'wards'} onClick={() => setMode('wards')}>
          <Crosshair />
          眼位热力图
        </button>
        <button aria-pressed={mode === 'farming'} onClick={() => setMode('farming')}>
          <Footprints />
          核心打钱路线热力图
        </button>
      </div>
      <section className="panel replay-filters" aria-label="录像筛选">
        <Select
          label="分析范围"
          value={scope}
          set={setScope}
          options={[
            ['all', '全部已解析比赛'],
            ['match', '单场比赛'],
            ['team', '按战队多场聚合'],
            ['player', '按选手聚合'],
          ]}
        />
        {scope === 'match' && (
          <Select
            label="比赛"
            value={matchId}
            set={setMatchId}
            options={[
              ['', '请选择比赛'],
              ...matches.map((m): [string, string] => [
                String(m.matchId),
                [m.matchId, m.tag].filter(Boolean).join(' · '),
              ]),
            ]}
          />
        )}
        {scope === 'team' && (
          <Select
            label="战队"
            value={teamId}
            set={setTeamId}
            options={[
              ['', '请选择战队'],
              ...teams.map((t): [string, string] => [String(t.id), t.name]),
            ]}
          />
        )}
        {scope === 'player' && (
          <Select
            label="选手"
            value={playerId}
            set={setPlayerId}
            options={[
              ['', '请选择选手'],
              ...players.map((p): [string, string] => [String(p.id), p.nickname]),
            ]}
          />
        )}
        <Select
          label="阵营"
          value={side}
          set={setSide}
          options={[
            ['all', '全部'],
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
                ['both', '假眼＋真眼'],
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
                ['early', '0–10 分钟 · 对线期'],
                ['mid', '10–25 分钟 · 中期'],
                ['late', '25 分钟起 · 后期'],
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
                ['cores', '仅核心位（1–3 号位）'],
                ['all', '全部位置'],
              ]}
            />
            <Select
              label="英雄"
              value={heroId}
              set={setHeroId}
              options={[
                ['', '全部英雄'],
                ...heroes.map((h): [string, string] => [String(h.id), h.cnName]),
              ]}
            />
          </>
        )}
        <Select
          label="赛事标签"
          value={tag}
          set={setTag}
          options={[
            ['', '全部赛事'],
            ...Array.from(new Set(matches.map((m) => m.tag).filter(Boolean)), (t): [string, string] => [
              t,
              t,
            ]),
          ]}
        />
        {listError && (
          <p role="alert">
            比赛列表读取失败{' '}
            <button className="subtle-button" onClick={reload}>
              重试
            </button>
          </p>
        )}
      </section>
      <div className="replay-layout">
        <section className="panel replay-map-card">
          <header>
            <h2>{mode === 'wards' ? '布眼分布' : '打钱位置分布'}</h2>
            <span className="density-legend">
              低<i />高
            </span>
          </header>
          <MinimapHeatmap points={ward?.points} cells={farm?.cells} farming={mode === 'farming'} />
          <p className="hint" role="status">
            {message ||
              (mode === 'wards'
                ? '悬停或点按标记查看眼位详情，重复点按可查看重叠眼位。'
                : '颜色越暖，选手在该区域的位置采样越密集。')}
          </p>
          {current?.error && (
            <button className="subtle-button" onClick={reload}>
              重新加载
            </button>
          )}
        </section>
        <aside className="replay-stats">
          {ward && <WardStats data={ward} reload={reload} />}
          {farm && <FarmStats data={farm} />}
        </aside>
      </div>
    </div>
  );
}
