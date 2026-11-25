import { useState } from 'react';
import { Search, Swords } from 'lucide-react';
import type { Hero, Player } from './api';
import {
  cmOrder,
  currentStep,
  slotsKey,
  sideNames,
  stepLabel,
  type Room,
  type Action,
} from './draftModel';
import { HeroPortrait } from './DraftPanels';

export function DraftPicker({
  d,
  heroes,
  players,
  play,
}: {
  d: Room;
  heroes: Hero[];
  players: Player[];
  play: (a: Action) => void;
}) {
  const [q, setQ] = useState(''),
    [attr, setAttr] = useState(''),
    [role, setRole] = useState(0);
  const [assigned, setAssigned] = useState(0);
  const step = currentStep(d.firstPickSide, d.ourSide, d.actions.length),
    order = cmOrder(d.firstPickSide);
  const slots = d[slotsKey(step.side)];
  const used = new Set(d.actions.map((a) => a.heroId));
  const selected = d.actions.filter(
    (_, i) => order[i].actionType === 'pick' && order[i].side === step.side,
  );
  const takenRoles = selected.map(
    (a) => a.roleHint ?? (a.assignedPlayerId ? slots.indexOf(a.assignedPlayerId) + 1 : null),
  );
  const term = q.trim().toLowerCase();
  const list = heroes.filter(
    (h) =>
      (!attr || h.primaryAttr === attr) &&
      (!role || h.typicalRoles.includes(role)) &&
      [h.cnName, h.localizedName, h.name, ...h.aliases].some((n) => n.toLowerCase().includes(term)),
  );
  // 优先展示随应用分发的常见英雄，首次打开即可看见完整肖像。
  const featured = [1, 10, 7, 11, 74, 94, 19, 129, 13, 120, 86, 5, 26, 44];
  const rank = (id: number) => {
    const i = featured.indexOf(id);
    return i < 0 ? 1000 + id : i;
  };
  list.sort((a, b) => rank(a.id) - rank(b.id));
  const assignmentKey = step.side + '-' + step.step;
  const [forStep, setForStep] = useState('');
  const position = forStep === assignmentKey && !takenRoles.includes(assigned) ? assigned : 0;
  return (
    <section className="panel picker">
      <div className={'active-step ' + step.side}>
        <div>
          <span>
            第 {step.phase} 阶段 · {sideNames[step.side]}
          </span>
          <h2>
            <Swords />
            {stepLabel(step)}
          </h2>
        </div>
        <strong>
          {String(step.step).padStart(2, '0')}
          <small> / 24</small>
        </strong>
      </div>
      <div className="picker-body">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="搜索英雄"
            value={q}
            placeholder="搜索中文名、简称或英文名"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="picker-filters">
          <select aria-label="英雄属性" value={attr} onChange={(e) => setAttr(e.target.value)}>
            <option value="">全部属性</option>
            {Object.entries({ str: '力量', agi: '敏捷', int: '智力', all: '全才' }).map(
              ([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ),
            )}
          </select>
          <select aria-label="英雄位置" value={role} onChange={(e) => setRole(+e.target.value)}>
            <option value={0}>全部位置</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 号位
              </option>
            ))}
          </select>
        </div>
        {step.actionType === 'pick' && !step.isCompleted && (
          <label className="assignment">
            选人归属
            <select
              aria-label="选人归属"
              value={position}
              onChange={(e) => {
                setAssigned(+e.target.value);
                setForStep(assignmentKey);
              }}
            >
              <option value={0}>暂不分配</option>
              {slots.map((id, i) => (
                <option
                  key={i}
                  disabled={
                    takenRoles.includes(i + 1) ||
                    (!!id && selected.some((a) => a.assignedPlayerId === id))
                  }
                  value={i + 1}
                >
                  {i + 1} 号位{id ? ' · ' + players.find((p) => p.id === id)?.nickname : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid-caption">
          <b>英雄池</b>
          <span>{list.filter((h) => !used.has(h.id)).length} 名可选</span>
        </div>
        <div className="room-heroes">
          {list.map((h) => {
            const i = d.actions.findIndex((a) => a.heroId === h.id);
            const name = h.cnName || '英雄 ' + h.id;
            return (
              <button
                key={h.id}
                className="hero-tile"
                aria-label={(step.actionType === 'ban' ? '禁用' : '选取') + name}
                disabled={step.isCompleted || used.has(h.id)}
                onClick={() => {
                  play({
                    heroId: h.id,
                    assignedPlayerId: position ? slots[position - 1] : null,
                    roleHint: position || null,
                  });
                }}
              >
                <HeroPortrait h={h} />
                <b>{name}</b>
                {i >= 0 && <small>{order[i].actionType === 'ban' ? '已禁' : '已选'}</small>}
              </button>
            );
          })}
        </div>
        {!list.length && <p className="empty">没有找到匹配的英雄</p>}
      </div>
    </section>
  );
}
