import { useMemo, useState, type RefObject } from 'react';
import { Search, Dumbbell, Feather, Sparkles, Orbit, Check } from 'lucide-react';
import type { Hero } from './api';
import { cmOrder, sideNames, type Room } from './draftModel';

type Face = Pick<Hero, 'id' | 'portraitUrl' | 'cnName'> & { primaryAttr?: string };
export function Portrait({ hero }: { hero: Face }) {
  const [failure, setFailure] = useState<{ id: number; remote: boolean }>();
  if (failure?.id === hero.id && failure.remote)
    return (
      <span aria-label={hero.cnName} className={'face-fallback' + (hero.primaryAttr ? ' attr-' + hero.primaryAttr : '')}>
        {hero.cnName.slice(0, 2)}
      </span>
    );
  const remote = failure?.id === hero.id;
  return (
    <img
      alt=""
      draggable="false"
      src={remote ? hero.portraitUrl : '/portraits/' + hero.id + '.webp'}
      onError={() => setFailure({ id: hero.id, remote })}
    />
  );
}
const groups = [
  { key: 'str', name: '力量', icon: Dumbbell },
  { key: 'agi', name: '敏捷', icon: Feather },
  { key: 'int', name: '智力', icon: Sparkles },
  { key: 'all', name: '全才', icon: Orbit },
] as const;
const collator = new Intl.Collator('zh-CN-u-co-pinyin');
const boundaries = [...'阿八擦搭蛾发噶哈击喀垃妈拿哦趴期然撒塌挖夕压匝'];
const initials = 'abcdefghjklmnopqrstwxyz';
function pinyin(name: string) {
  return [...name]
    .map((ch) => {
      if (!/[\u3400-\u9fff]/.test(ch)) return ch;
      let index = boundaries.length - 1;
      while (index > 0 && collator.compare(ch, boundaries[index]) < 0) index--;
      return initials[Math.max(index, 0)];
    })
    .join('');
}
export function HeroPoolGrid({
  heroes,
  d,
  pending,
  select,
  lock,
  search,
}: {
  heroes: Hero[];
  d: Room;
  pending: number | null;
  select: (id: number) => void;
  lock: (id: number) => void;
  search: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState(''),
    [role, setRole] = useState(0);
  const sections = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        list: heroes
          .filter((h) => h.primaryAttr === g.key)
          .map((h) => ({
            h,
            terms: [
              h.cnName,
              h.localizedName,
              h.name,
              ...h.aliases,
              pinyin(h.cnName),
              ...h.aliases.map(pinyin),
            ]
              .join(' ')
              .toLowerCase(),
          })),
      })),
    [heroes],
  );
  const order = cmOrder(d.firstPickSide, d.cmOrderVersion),
    used = new Map(d.actions.map((a, i) => [a.heroId, order[i]]));
  const term = query.trim().toLowerCase(),
    filtering = !!(term || role);
  const matches = (h: Hero, terms: string) =>
    (!term || terms.includes(term)) && (!role || h.typicalRoles.includes(role));
  const count = sections.reduce(
    (n, g) => n + g.list.filter(({ h, terms }) => matches(h, terms)).length,
    0,
  );
  const jump = (key: string) =>
    document.getElementById('pool-' + key)?.scrollIntoView({ block: 'start' });
  return (
    <section className="bp-pool bp-box" aria-label="四属性英雄池">
      <div className="bp-section-title">
        <h2>
          <Orbit />
          英雄池
        </h2>
        <small>
          {filtering ? count + ' / ' : ''}
          {heroes.length} 名英雄
        </small>
      </div>
      <div className="pool-filters">
        <label className="pool-search">
          <Search size={15} />
          <input
            ref={search}
            aria-label="搜索英雄"
            placeholder="英雄名、拼音首字母或简称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="role-chips" aria-label="位置筛选">
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <button key={r} aria-pressed={r === role} onClick={() => setRole(r)}>
              {r ? r + '号位' : '全部'}
            </button>
          ))}
        </div>
      </div>
      <div className="attr-jumps">
        {groups.map((g) => (
          <button key={g.key} className={'attr-' + g.key} onClick={() => jump(g.key)}>
            <g.icon size={14} />
            {g.name}
          </button>
        ))}
      </div>
      <div className="pool-quads">
        {sections.map((g) => (
          <section id={'pool-' + g.key} key={g.key} className={'attr-group attr-' + g.key}>
            <h3>
              <g.icon size={16} />
              {g.name}
              <small>{g.list.length}</small>
            </h3>
            <div className="tile-grid">
              {g.list.map(({ h, terms }) => {
                const taken = used.get(h.id),
                  match = matches(h, terms),
                  selected = pending === h.id;
                const label = taken
                  ? taken.actionType === 'ban'
                    ? '已禁'
                    : sideNames[taken.side]
                  : '';
                return (
                  <button
                    key={h.id}
                    data-hero={h.id}
                    title={h.cnName + ' · ' + h.typicalRoles.join('/') + ' 号位'}
                    aria-label={h.cnName + (label ? ' · ' + label : '')}
                    className={[
                      'pool-tile',
                      taken?.actionType === 'ban' ? 'banned' : '',
                      !match ? 'dimmed' : filtering ? 'matched' : '',
                      selected ? 'selected' : '',
                    ].join(' ')}
                    disabled={!!taken || d.actions.length === 24}
                    aria-pressed={selected}
                    onClick={() => select(h.id)}
                    onDoubleClick={() => lock(h.id)}
                  >
                    <Portrait hero={h} />
                    <span className="tile-name">{h.cnName}</span>
                    {taken && (
                      <b className={'taken ' + (taken.actionType === 'ban' ? 'ban' : taken.side)}>
                        {label}
                      </b>
                    )}
                    {selected && <Check size={13} className="tile-check" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
