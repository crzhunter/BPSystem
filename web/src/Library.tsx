import { StudioHeader, StudioDialog, useStudioData } from './Studio';
import { ProfileExtras, rankName } from './ProfileExtras';
import { ProfileCard, TeamSync } from './Analytics';
import type { teamScouting } from '../../server/src/services/scouting';
import { useState, type FormEvent } from 'react';
import { Medal, Plus, Save, Shield, X } from 'lucide-react';
import { api, failure, positions, type Hero, type Notify, type Player, type Team } from './api';
type Common = { refresh: () => Promise<void>; notify: Notify };
function useSave({ refresh, notify }: Common) {
  const [busy, setBusy] = useState(false);
  async function save(work: () => Promise<unknown>, message: string, done?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      done?.();
      await refresh();
      notify(message);
    } catch (e) {
      notify(failure(e), true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}
const blankPlayer = () => ({
  accountInput: '',
  nickname: '',
  alias: '',
  rankTier: null as number | null,
  leaderboardRank: null as number | null,
  primaryRole: null as number | null,
  styleTags: [] as string[],
  roles: [] as number[],
  notes: '',
});
type PlayerForm = ReturnType<typeof blankPlayer>;
function PlayerEditor({
  value,
  setValue,
  busy,
  onSubmit,
  onCancel,
}: {
  value: PlayerForm;
  setValue: (v: PlayerForm) => void;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  onCancel?: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="form-grid">
      <label className="studio-field">
        选手账号
        <input
          required
          value={value.accountInput}
          onChange={(e) => setValue({ ...value, accountInput: e.target.value })}
          placeholder="Steam32、Steam64 或选手主页链接"
        />
      </label>
      <label>
        选手昵称
        <input
          required
          maxLength={60}
          value={value.nickname}
          onChange={(e) => setValue({ ...value, nickname: e.target.value })}
          placeholder="输入比赛使用的昵称"
        />
      </label>
      <label>
        队内代号
        <input
          value={value.alias}
          maxLength={60}
          onChange={(e) => setValue({ ...value, alias: e.target.value })}
        />
      </label>
      <label>
        段位奖章
        <select
          value={value.rankTier ?? 0}
          onChange={(e) => setValue({ ...value, rankTier: Number(e.target.value) || null })}
        >
          <option value={0}>未设置</option>
          {[
            ...Array.from({ length: 35 }, (_, i) => (Math.floor(i / 5) + 1) * 10 + (i % 5) + 1),
            80,
          ].map((n) => (
            <option key={n} value={n}>
              {rankName(n)}
            </option>
          ))}
        </select>
      </label>
      {value.rankTier === 80 && (
        <label>
          冠绝排名
          <input
            type="number"
            min="1"
            max="999999"
            value={value.leaderboardRank ?? ''}
            onChange={(e) =>
              setValue({ ...value, leaderboardRank: Number(e.target.value) || null })
            }
          />
        </label>
      )}
      <label>
        主位置
        <select
          value={value.primaryRole ?? 0}
          onChange={(e) => setValue({ ...value, primaryRole: Number(e.target.value) || null })}
        >
          <option value={0}>未设置</option>
          {positions.map((s, i) => (
            <option key={s} value={i + 1}>
              {i + 1}号位 · {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        风格标签（逗号分隔）
        <input
          value={value.styleTags.join('，')}
          onChange={(e) => setValue({ ...value, styleTags: e.target.value.split(/[,，]/) })}
        />
      </label>
      <fieldset className="wide">
        <legend>可兼任位置</legend>
        <div className="role-checks">
          {positions.map((p, i) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={value.roles.includes(i + 1)}
                onChange={(e) =>
                  setValue({
                    ...value,
                    roles: e.target.checked
                      ? [...value.roles, i + 1]
                      : value.roles.filter((r) => r !== i + 1),
                  })
                }
              />
              {i + 1} 号位
            </label>
          ))}
        </div>
      </fieldset>
      <label className="wide">
        选手备注
        <textarea
          maxLength={2000}
          value={value.notes}
          onChange={(e) => setValue({ ...value, notes: e.target.value })}
          placeholder="英雄偏好、打法或沟通习惯（选填）"
        />
      </label>
      <div className="actions wide">
        {onCancel && (
          <button type="button" className="subtle-button" onClick={onCancel}>
            取消
          </button>
        )}
        <button className="primary" disabled={busy}>
          <Save size={15} />
          保存选手
        </button>
      </div>
    </form>
  );
}
export function Players({
  players,
  heroes,
  ...common
}: Common & { players: Player[]; heroes: Hero[] }) {
  const [q, setQ] = useState(''),
    [role, setRole] = useState(0),
    [id, setId] = useState(0);
  const [dialog, setDialog] = useState<'new' | 'edit' | 'batch' | null>(null),
    [draft, setDraft] = useState(blankPlayer),
    [text, setText] = useState('');
  const { busy, save } = useSave(common);
  const visible = players.filter(
    (p) =>
      (!role || p.primaryRole === role || p.roles.includes(role)) &&
      [p.nickname, p.alias, String(p.accountId)].some((s) =>
        s.toLowerCase().includes(q.trim().toLowerCase()),
      ),
  );
  const selected = visible.find((p) => p.id === id) ?? visible[0];
  const close = () => setDialog(null);
  return (
    <div className="studio-page">
      <StudioHeader
        title="选手设置"
        description="维护位置、队内代号和招牌英雄，为下一场对局准备选手档案。"
        stat={players.length + ' 名选手'}
      >
        <button
          className="primary"
          onClick={() => {
            setDraft(blankPlayer());
            setDialog('new');
          }}
        >
          新增选手
        </button>
        <button className="satin-btn" onClick={() => setDialog('batch')}>
          批量导入选手
        </button>
      </StudioHeader>
      <div className="studio-split directory-layout">
        <aside className="studio-panel">
          <h2>选手名录</h2>
          <input
            className="studio-field"
            aria-label="搜索选手"
            placeholder="搜索昵称、代号或账号"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select aria-label="筛选位置" value={role} onChange={(e) => setRole(+e.target.value)}>
            <option value={0}>全部位置</option>
            {positions.map((s, i) => (
              <option key={s} value={i + 1}>
                {i + 1}号位
              </option>
            ))}
          </select>
          <div className="directory-list">
            {visible.map((p) => (
              <button
                className="directory-row"
                key={p.id}
                aria-pressed={selected?.id === p.id}
                onClick={() => setId(p.id)}
              >
                <b>{p.alias || p.nickname}</b>
                <small>{p.accountId}</small>
              </button>
            ))}
          </div>
          {!visible.length && <p className="hint">没有符合条件的选手。</p>}
        </aside>
        <section className="studio-panel">
          {selected ? (
            <div key={selected.id}>
              <header className="profile-heading">
                <div>
                  <h2>{selected.alias || selected.nickname}</h2>
                  <p className="player-identity">
                    {selected.nickname} · {selected.accountId}
                    {selected.rankTier ? (
                      <span className="rank-medal" data-tier={Math.floor(selected.rankTier / 10)}>
                        <Medal size={16} aria-hidden="true" />
                        {rankName(selected.rankTier)}
                        {selected.rankTier === 80 &&
                          selected.leaderboardRank &&
                          ' #' + selected.leaderboardRank}
                      </span>
                    ) : (
                      ' · 段位未设置'
                    )}
                  </p>
                </div>
                <div className="studio-actions">
                  <button
                    onClick={() => {
                      setDraft({ ...selected, accountInput: String(selected.accountId) });
                      setDialog('edit');
                    }}
                  >
                    编辑档案
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      save(() => api('/players/' + selected.id + '/sync', 'POST'), '选手战绩已同步')
                    }
                  >
                    同步战绩
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm('删除「' + selected.nickname + '」及其阵容绑定？'))
                        void save(() => api('/players/' + selected.id, 'DELETE'), '已删除选手');
                    }}
                  >
                    删除
                  </button>
                </div>
              </header>
              <p>
                {selected.primaryRole ? '主打 ' + selected.primaryRole + ' 号位 · ' : ''}
                {selected.roles.map((r) => r + '号位').join(' / ')} {selected.styleTags.join(' · ')}
              </p>
              <p>{selected.notes}</p>
              <ProfileExtras player={selected} heroes={heroes} notify={common.notify} />
              <ProfileCard player={selected} />
            </div>
          ) : (
            <p className="empty">添加选手后可查看档案、英雄池与近期比赛。</p>
          )}
        </section>
      </div>
      {dialog && (
        <StudioDialog
          title={
            dialog === 'batch' ? '多行批量导入选手' : dialog === 'new' ? '新增选手' : '编辑选手档案'
          }
          close={close}
        >
          {dialog === 'batch' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  () => api('/players/batch', 'POST', { text }),
                  '批量导入完成',
                  () => {
                    setText('');
                    close();
                  },
                );
              }}
            >
              <label>
                每行一个账号或主页链接
                <textarea
                  rows={7}
                  required
                  placeholder="Steam32、Steam64、OpenDota、Dotabuff 或 Stratz"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                导入选手
              </button>
            </form>
          ) : (
            <PlayerEditor
              value={draft}
              setValue={setDraft}
              busy={busy}
              onCancel={close}
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  async () => {
                    const p = await api<Player>(
                      dialog === 'new' ? '/players' : '/players/' + selected.id,
                      dialog === 'new' ? 'POST' : 'PUT',
                      { ...draft, styleTags: draft.styleTags.map((s) => s.trim()).filter(Boolean) },
                    );
                    setId(p.id);
                    setQ('');
                    setRole(0);
                  },
                  '选手档案已保存',
                  close,
                );
              }}
            />
          )}
        </StudioDialog>
      )}
    </div>
  );
}
const blankTeam = () => ({
  name: '',
  tag: '',
  color: '#38bdf8',
  notes: '',
  slots: [0, 0, 0, 0, 0],
});
export function Teams({
  teams,
  players,
  heroes,
  enter,
  ...common
}: Common & {
  teams: Team[];
  players: Player[];
  heroes: Hero[];
  enter: (team: Team, own: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [teamId, setTeamId] = useState(0),
    [search, setSearch] = useState(''),
    [account, setAccount] = useState('');
  const active = teams.find((t) => t.id === teamId) ?? teams[0];
  const report = useStudioData<ReturnType<typeof teamScouting>>(
    active ? '/teams/' + active.id + '/scouting' : null,
    teams,
  );
  const heroName = (id: number) => heroes.find((h) => h.id === id)?.cnName ?? String(id);
  const [editing, setEditing] = useState(0),
    [draft, setDraft] = useState(blankTeam);
  const { busy, save } = useSave(common);
  function reset() {
    setOpen(false);
    setSearch('');
    setAccount('');
    setEditing(0);
    setDraft(blankTeam());
  }
  function edit(t: Team) {
    setEditing(t.id);
    setDraft({
      name: t.name,
      tag: t.tag,
      color: t.color,
      notes: t.notes,
      slots: [...t.roster, ...t.subs].map((m) => m.player?.id ?? 0),
    });
    setOpen(true);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const { slots, ...fields } = draft;
    const members = slots.flatMap((playerId, i) => (playerId ? [{ slot: i + 1, playerId }] : []));
    void save(
      () =>
        api(editing ? '/teams/' + editing : '/teams', editing ? 'PUT' : 'POST', {
          ...fields,
          members,
        }),
      editing ? '已更新战队与阵容' : '已创建战队',
      reset,
    );
  }
  return (
    <div className="studio-page">
      <StudioHeader
        title="战队设置"
        description="安排首发与替补，侦察对手的招牌、摇摆位与英雄池短板。"
        stat={teams.length + ' 支战队'}
      >
        <button
          className="primary"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          新建战队
        </button>
      </StudioHeader>
      {open && (
        <StudioDialog title={editing ? '编辑战队与阵容' : '新建战队'} close={reset}>
          <form className="form-grid" onSubmit={submit}>
            <label>
              战队名称
              <input
                required
                maxLength={60}
                value={draft.name}
                placeholder="输入战队名称"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              战队简称
              <input
                maxLength={20}
                value={draft.tag}
                placeholder="输入比赛简称（选填）"
                onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
              />
            </label>
            <label>
              战队颜色
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </label>
            <label>
              战队备注
              <input
                maxLength={2000}
                value={draft.notes}
                placeholder="打法与战术习惯（选填）"
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
            <fieldset className="wide">
              <legend>首发与替补</legend>
              {!players.length && (
                <p className="hint">
                  请先前往<a href="#players">选手库</a>添加参赛选手。
                </p>
              )}
              <label>
                搜索可绑定选手
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="昵称、代号或账号"
                />
              </label>
              <div className="quick-player">
                <input
                  aria-label="快捷新建选手账号"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="新选手账号或链接"
                />
                <button
                  type="button"
                  disabled={busy || !account.trim()}
                  onClick={() =>
                    save(async () => {
                      const p = await api<Player>('/players', 'POST', { accountInput: account });
                      setDraft((prev) => {
                        const slots = [...prev.slots],
                          i = slots.indexOf(0);
                        slots[i < 0 ? slots.length : i] = p.id;
                        return { ...prev, slots };
                      });
                      setAccount('');
                    }, '已创建并加入当前阵容')
                  }
                >
                  新建并绑定
                </button>
              </div>
              <p className="hint">选择已在阵中的选手，即可互换两个位置。</p>
              <div className="team-slots">
                {draft.slots.map((v, i) => (
                  <label key={i}>
                    {i < 5 ? i + 1 + ' 号位 · ' + positions[i] : '替补 ' + (i - 4)}
                    <div className="flex gap-2">
                      <select
                        value={v}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map((n, j) =>
                              j === i ? +e.target.value : n && n === +e.target.value ? v : n,
                            ),
                          })
                        }
                      >
                        <option value={0}>选择选手</option>
                        {players
                          .filter(
                            (p) =>
                              v === p.id ||
                              [p.nickname, p.alias, String(p.accountId)].some((s) =>
                                s.toLowerCase().includes(search.toLowerCase()),
                              ),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.alias || p.nickname}
                            </option>
                          ))}
                      </select>
                      {i >= 5 && (
                        <button
                          type="button"
                          aria-label="移除替补槽位"
                          onClick={() =>
                            setDraft({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })
                          }
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <button
                className="subtle-button sub-add"
                type="button"
                onClick={() => setDraft({ ...draft, slots: [...draft.slots, 0] })}
              >
                <Plus size={14} />
                添加替补
              </button>
            </fieldset>
            <div className="actions wide">
              {editing > 0 && (
                <button type="button" className="subtle-button" onClick={reset}>
                  取消
                </button>
              )}
              <button className="primary" disabled={busy}>
                <Save size={15} />
                {editing ? '保存修改' : '保存战队'}
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
      <div className="studio-split directory-layout">
        <section className="studio-panel">
          <h2>战队名录</h2>
          <div className="directory-list">
            {teams.map((t) => (
              <button
                className="directory-row"
                key={t.id}
                aria-pressed={t.id === active?.id}
                onClick={() => setTeamId(t.id)}
              >
                <Shield size={15} style={{ color: t.color }} />
                {t.name}
                <small>{t.tag}</small>
              </button>
            ))}
          </div>
          {active ? (
            <>
              <h3>{active.name} · 首发阵容</h3>
              {[...active.roster, ...active.subs].map((m) => (
                <div className="roster-line" key={m.slot}>
                  <small>{m.slot <= 5 ? m.slot + '号位' : '替补 ' + (m.slot - 5)}</small>
                  <b>{m.player?.alias || m.player?.nickname || '空位'}</b>
                </div>
              ))}
              {!active.subs.length && <p className="hint">替补席暂无选手</p>}
              <p>{active.notes}</p>
              <div className="studio-actions">
                <button onClick={() => edit(active)}>编辑阵容</button>
                <TeamSync
                  id={active.id}
                  players={[...active.roster, ...active.subs].flatMap((m) =>
                    m.player ? [m.player] : [],
                  )}
                  {...common}
                />
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm('删除战队「' + active.name + '」？'))
                      void save(() => api('/teams/' + active.id, 'DELETE'), '已删除战队');
                  }}
                >
                  删除战队
                </button>
              </div>
              <div className="studio-actions">
                <button className="satin-btn pick" onClick={() => enter(active, true)}>
                  设为我方进入 BP
                </button>
                <button className="satin-btn ban" onClick={() => enter(active, false)}>
                  设为敌方进入 BP
                </button>
              </div>
            </>
          ) : (
            <p className="empty">新建战队后，在这里安排首发与替补。</p>
          )}
        </section>
        <section className="studio-panel">
          <h2>对手侦察报告</h2>
          {report?.data ? (
            <>
              <div className="side-splits">
                {(['radiant', 'dire'] as const).map((key, i) => (
                  <div key={key}>
                    <span>{i ? '夜魇' : '天辉'}胜率</span>
                    <b>
                      {report.data![key].winrate == null ? '—' : report.data![key].winrate + '%'}
                    </b>
                    <small>{report.data![key].games} 场 · 至少三名首发同场</small>
                  </div>
                ))}
              </div>
              {(['topBans', 'flexPicks'] as const).map((key, i) => (
                <section key={key} className="studio-card">
                  <h3>{i ? '多人摇摆预警' : '优先禁用绝活'}</h3>
                  {report.data![key].map((h) => (
                    <div className="roster-line" key={h.heroId}>
                      <img className="mini-face" src={'/portraits/' + h.heroId + '.webp'} alt="" />
                      <b>{heroName(h.heroId)}</b>
                      <small>{h.players.join(' / ')}</small>
                    </div>
                  ))}
                  {!report.data![key].length && <p className="hint">暂无符合条件的英雄样本。</p>}
                </section>
              ))}
              <section className="studio-card">
                <h3>位置厚度与突破口</h3>
                {report.data.roles.map((r) => (
                  <p className="roster-line" key={r.role}>
                    <b>
                      {r.role}号位 {r.name}
                    </b>
                    <span>
                      {r.depth} 名 · {r.diagnosis}
                    </span>
                  </p>
                ))}
              </section>
            </>
          ) : (
            <p className="empty">
              {report?.error || (active ? '正在读取侦察报告…' : '选择战队后可查看侦察报告。')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
