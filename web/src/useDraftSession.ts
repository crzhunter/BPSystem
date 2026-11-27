import { useEffect, useRef, useState } from 'react';
import { api, failure, type Notify } from './api';
import { initialRoom, roomFrom, setupKey, setupOf, type Action, type Room } from './draftModel';

export function useDraftSession(notify: Notify) {
  const [initial] = useState(initialRoom);
  const [d, setD] = useState<Room>(() => roomFrom(initial));
  const [instant, setInstant] = useState(initial.instant);
  const [redo, setRedo] = useState<Action[]>([]);
  const [writes, setWrites] = useState(0);
  const queue = useRef(Promise.resolve());
  const binding = useRef<{ revision?: number }>({});
  const setup = JSON.stringify(setupOf(d, instant));
  useEffect(() => {
    try {
      localStorage.setItem(setupKey, setup);
    } catch {
      notify('无法保存阵容偏好，本局仍可使用存档', true);
    }
  }, [setup, notify]);

  function bind(room: Room) {
    binding.current = { revision: room.revision };
    setRedo([]);
    setD(roomFrom(room));
  }
  function edit(index: number, action: Action) {
    if (d.actions.some((a, i) => i !== index && a.heroId === action.heroId)) {
      notify('该英雄已被锁定', true);
      return false;
    }
    setD({ ...d, actions: d.actions.map((a, i) => (i === index ? action : a)) });
    setRedo([]);
    if (!d.id) return true;
    const lineage = binding.current;
    const path = '/bp/sessions/' + d.id;
    setWrites((n) => n + 1);
    // 串行传递服务器修订号。迟到回包只更新同一绑定的版本，绝不回写整张旧盘面。
    queue.current = queue.current
      .then(async () => {
        if (lineage !== binding.current) return;
        const saved = roomFrom(await api<Room>(path));
        if (saved.revision !== lineage.revision)
          throw new Error('存档已更新，请重新载入或另存本局');
        const prefix = roomFrom({
          ...d,
          revision: lineage.revision,
          actions: d.actions.slice(0, saved.actions.length),
        });
        if (index >= saved.actions.length || JSON.stringify(saved) !== JSON.stringify(prefix)) {
          notify('已修改本机盘面，可通过存档保存本局进度');
          return;
        }
        const updated = await api<Room>(path + '/action/' + (index + 1), 'PUT', {
          ...action,
          revision: lineage.revision,
        });
        lineage.revision = updated.revision;
        setD((current) =>
          lineage === binding.current ? { ...current, revision: updated.revision } : current,
        );
      })
      .catch((e) => notify('改动已保留在本机。' + failure(e), true))
      .finally(() => setWrites((n) => n - 1));
    return true;
  }
  return { d, setD, instant, setInstant, redo, setRedo, bind, edit, writes };
}
