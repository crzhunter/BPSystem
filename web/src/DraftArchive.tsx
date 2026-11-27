import { useEffect, useState } from 'react';
import { Popover } from './MotionControls';
import { X, Archive } from 'lucide-react';
import { api, failure, type Notify } from './api';
import { roomFrom, type Room } from './draftModel';
type Summary = { id: number; title: string; actionCount: number; updatedAt: string };
export function DraftArchive({
  d,
  apply,
  close,
  notify,
  detach,
}: {
  d: Room;
  apply: (d: Room) => void;
  close: () => void;
  notify: Notify;
  detach: () => void;
}) {
  const [list, setList] = useState<Summary[]>([]),
    [title, setTitle] = useState(d.title),
    [notes, setNotes] = useState(d.notes),
    [patch, setPatch] = useState(d.patch),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<Summary[]>('/bp/sessions')
      .then((rows) => {
        if (active) setList(rows);
      })
      .catch((e) => {
        if (active) setError(failure(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  function save(copy: boolean) {
    void run(async () => {
      const update = !!d.id && !copy;
      const saved = await api<Room>(
        '/bp/sessions' + (update ? '/' + d.id : ''),
        update ? 'PUT' : 'POST',
        { ...d, title, notes, patch },
      );
      apply(roomFrom(saved));
      notify('已保存「' + saved.title + '」');
      close();
    });
  }
  return (
    <Popover
      label="对局存档"
      close={() => {
        if (!busy) close();
      }}
      className="archive-overlay"
    >
      <div className="archive-form">
        <div className="archive-head">
          <h2 id="archive-title">
            <Archive />
            对局存档
          </h2>
          <button aria-label="关闭存档" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <fieldset disabled={busy}>
          <label>
            对局名称
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            比赛版本
            <input value={patch} maxLength={32} onChange={(e) => setPatch(e.target.value)} />
          </label>
          <label>
            战术备注
            <textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="archive-actions">
            <button className="primary" disabled={!title.trim()} onClick={() => save(false)}>
              {d.id ? '更新当前存档' : '保存当前对局'}
            </button>
            {d.id && (
              <button className="subtle-button" disabled={!title.trim()} onClick={() => save(true)}>
                另存为新对局
              </button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <h3>已保存的对局</h3>
          {!list.length && !error && <p>暂无存档</p>}
          {list.map((s) => (
            <div className="archive-row" key={s.id}>
              <div>
                <b>{s.title}</b>
                <small>
                  {s.actionCount}/24 步 · {new Date(s.updatedAt).toLocaleString('zh-CN')}
                </small>
              </div>
              <button
                className="subtle-button"
                onClick={() =>
                  void run(async () => {
                    apply(roomFrom(await api<Room>('/bp/sessions/' + s.id)));
                    close();
                    notify('已载入「' + s.title + '」');
                  })
                }
              >
                载入
              </button>
              <button
                className="text-button"
                onClick={() => {
                  if (window.confirm('删除存档「' + s.title + '」？'))
                    void run(async () => {
                      await api('/bp/sessions/' + s.id, 'DELETE');
                      setList((rows) => rows.filter((row) => row.id !== s.id));
                      if (s.id === d.id) detach();
                    });
                }}
              >
                删除
              </button>
            </div>
          ))}
        </fieldset>
      </div>
    </Popover>
  );
}
