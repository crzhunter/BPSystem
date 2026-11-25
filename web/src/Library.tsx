import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Save, Search, Shield, Trash2, UserRound, UsersRound, X } from 'lucide-react';
import { api, failure, positions, type Notify, type Player, type Team } from './api';
import { PlayerAnalysis, TeamSync } from './Analytics';
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
export function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-intro">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
const blankPlayer = () => ({ accountInput: '', nickname: '', roles: [] as number[], notes: '' });
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
      <label>
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
      <fieldset className="wide">
        <legend>擅长位置</legend>
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
          {onCancel ? '保存修改' : '添加选手'}
        </button>
      </div>
    </form>
  );
}
export function Players({ players, ...common }: Common & { players: Player[] }) {
  const [draft, setDraft] = useState(blankPlayer),
    [edit, setEdit] = useState(blankPlayer),
    [editing, setEditing] = useState(0);
  const [q, setQ] = useState(''),
    [role, setRole] = useState(0);
  const { busy, save } = useSave(common);
  const filtered = players.filter(
    (p) =>
      (!role || p.roles.includes(role)) &&
      (p.nickname.toLowerCase().includes(q.trim().toLowerCase()) ||
        String(p.accountId).includes(q.trim())),
  );
  return (
    <>
      <PageIntro title="选手库" description="维护参赛账号与擅长位置，供战队和对局室调用。" />
      <section className="form-panel panel">
        <h2>
          <UserRound />
          快速添加选手
        </h2>
        <PlayerEditor
          value={draft}
          setValue={setDraft}
          busy={busy}
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              () => api('/players', 'POST', draft),
              '已添加选手',
              () => setDraft(blankPlayer()),
            );
          }}
        />
      </section>
      <section className="form-panel panel">
        <div className="board-head">
          <h2>
            <UsersRound />
            选手名单
          </h2>
          <span className="muted">{players.length} 名选手</span>
        </div>
        <div className="filters">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索选手"
              placeholder="搜索昵称或账号"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select aria-label="筛选位置" value={role} onChange={(e) => setRole(+e.target.value)}>
            <option value="0">全部位置</option>
            {positions.map((v, i) => (
              <option key={v} value={i + 1}>
                {i + 1} 号位
              </option>
            ))}
          </select>
        </div>
        {filtered.map((p) => (
          <div className="list-item" key={p.id}>
            {editing === p.id ? (
              <PlayerEditor
                value={edit}
                setValue={setEdit}
                busy={busy}
                onCancel={() => setEditing(0)}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(
                    () => api('/players/' + p.id, 'PUT', edit),
                    '已更新选手',
                    () => setEditing(0),
                  );
                }}
              />
            ) : (
              <>
                <div className="item-summary">
                  <div className="initial">{p.nickname.slice(0, 1)}</div>
                  <div>
                    <strong>{p.nickname}</strong>
                    <small>
                      {p.accountId} ·{' '}
                      {p.roles.length ? p.roles.map((r) => r + ' 号位').join(' / ') : '未指定位置'}
                    </small>
                  </div>
                  <div className="item-actions">
                    <button
                      aria-label={'编辑' + p.nickname}
                      title="编辑选手"
                      onClick={() => {
                        setEdit({
                          accountInput: String(p.accountId),
                          nickname: p.nickname,
                          roles: p.roles,
                          notes: p.notes,
                        });
                        setEditing(p.id);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      disabled={busy}
                      aria-label={'删除' + p.nickname}
                      title="删除选手"
                      onClick={() => {
                        if (confirm('删除「' + p.nickname + '」？该选手将从所有战队阵容移除。'))
                          void save(() => api('/players/' + p.id, 'DELETE'), '已删除选手');
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {p.notes && <p className="item-note">{p.notes}</p>}
                <div className="library-tools">
                  <button
                    className="subtle-button"
                    disabled={busy}
                    onClick={() =>
                      save(
                        () => api('/players/' + p.id + '/sync', 'POST'),
                        '已同步「' + p.nickname + '」的战绩',
                      )
                    }
                  >
                    同步战绩
                  </button>
                  <PlayerAnalysis player={p} />
                </div>
              </>
            )}
          </div>
        ))}
        {!filtered.length && (
          <p className="empty">
            {players.length ? '没有符合条件的选手' : '选手库为空，可在上方添加第一名选手。'}
          </p>
        )}
      </section>
    </>
  );
}
const blankTeam = () => ({ name: '', tag: '', color: '#38bdf8', notes: '', slots: [0, 0, 0, 0, 0] });
export function Teams({ teams, players, ...common }: Common & { teams: Team[]; players: Player[] }) {
  const [editing, setEditing] = useState(0),
    [draft, setDraft] = useState(blankTeam);
  const { busy, save } = useSave(common);
  function reset() {
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
    window.scrollTo(0, 0);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const { slots, ...fields } = draft;
    const members = slots.flatMap((playerId, i) => (playerId ? [{ slot: i + 1, playerId }] : []));
    void save(
      () =>
        api(editing ? '/teams/' + editing : '/teams', editing ? 'PUT' : 'POST', { ...fields, members }),
      editing ? '已更新战队与阵容' : '已创建战队',
      reset,
    );
  }
  return (
    <>
      <PageIntro title="战队管理" description="保存首发阵容和替补，在对局室一键导入战队。" />
      <section className="form-panel panel">
        <h2>
          <Shield />
          {editing ? '编辑战队' : '创建战队'}
        </h2>
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
                          slots: draft.slots.map((n, j) => (j === i ? +e.target.value : n)),
                        })
                      }
                    >
                      <option value={0}>选择选手</option>
                      {players.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          disabled={v !== p.id && draft.slots.includes(p.id)}
                        >
                          {p.nickname}
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
      </section>
      <section className="form-panel panel">
        <div className="board-head">
          <h2>
            <UsersRound />
            战队名单
          </h2>
          <span className="muted">{teams.length} 支战队</span>
        </div>
        {teams.map((t) => (
          <div className="list-item" key={t.id}>
            <div className="item-summary">
              <div className="initial" style={{ color: t.color }}>
                <Shield size={19} />
              </div>
              <div>
                <strong>
                  {t.name} {t.tag && <small>〔{t.tag}〕</small>}
                </strong>
                <small>
                  首发 {t.roster.filter((m) => m.player).length}/5 · 替补 {t.subs.length}
                </small>
              </div>
              <div className="item-actions">
                <button title="编辑战队" aria-label={'编辑' + t.name} onClick={() => edit(t)}>
                  <Pencil size={16} />
                </button>
                <button
                  title="删除战队"
                  disabled={busy}
                  aria-label={'删除' + t.name}
                  onClick={() => {
                    if (confirm('确定删除「' + t.name + '」的战队预设？'))
                      void save(
                        () => api('/teams/' + t.id, 'DELETE'),
                        '已删除战队',
                        () => {
                          if (editing === t.id) reset();
                        },
                      );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <p className="item-note">
              {t.roster.map((m) => m.slot + ' 号位 ' + (m.player?.nickname ?? '待定')).join('　')}
            </p>
            {t.notes && <p className="item-note">{t.notes}</p>}
            <TeamSync
              id={t.id}
              players={[...t.roster, ...t.subs].flatMap((m) => (m.player ? [m.player] : []))}
              {...common}
            />
            {[...t.roster, ...t.subs].map(
              (m) => m.player && <PlayerAnalysis key={m.slot} player={m.player} />,
            )}
          </div>
        ))}
        {!teams.length && <p className="empty">还没有战队预设，保存后可在对局室导入。</p>}
      </section>
    </>
  );
}
