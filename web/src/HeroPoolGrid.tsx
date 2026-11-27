import { SegmentedControl } from './MotionControls';
import { LiquidGlass } from './LiquidGlass';
import { memo, useMemo, useState, type ReactNode, type MouseEvent, type RefObject } from 'react';
import { Search, Dumbbell, Feather, Sparkles, Orbit, Check } from 'lucide-react';
import type { Hero } from './api';
import { cmOrder, sideNames, type Room } from './draftModel';

type Face = Pick<Hero, 'id' | 'portraitUrl' | 'cnName'> & { primaryAttr?: string };
export function Portrait({ hero }: { hero: Face }) {
  const [failure, setFailure] = useState<{ id: number; remote: boolean }>();
  if (failure?.id === hero.id && failure.remote)
    return (
      <span
        aria-label={hero.cnName}
        className={'face-fallback' + (hero.primaryAttr ? ' attr-' + hero.primaryAttr : '')}
      >
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
// 事件从英雄池容器委托；下一手只需更新锁定状态发生变化的格子。
const HeroTile = memo(function HeroTile({
  h,
  status,
  takenTitle,
  match,
  filtering,
  selected,
  disabled,
}: {
  h: Hero;
  takenTitle?: string;
  status?: 'ban' | 'radiant' | 'dire';
  match: boolean;
  filtering: boolean;
  selected: boolean;
  disabled: boolean;
}) {
  const label = status === 'ban' ? '已禁' : status ? sideNames[status] + '选' : '';
  return (
    <button
      data-hero={h.id}
      title={takenTitle ?? h.cnName + ' · ' + h.typicalRoles.join('/') + ' 号位'}
      aria-label={h.cnName + (label ? ' · ' + label : '')}
      className={[
        'pool-tile',
        status === 'ban' ? 'banned' : status ? 'picked ' + status : '',
        !match ? 'dimmed' : filtering ? 'matched' : '',
        selected ? 'selected' : '',
      ].join(' ')}
      disabled={disabled}
      aria-pressed={selected}
    >
      <Portrait hero={h} />
      <span className="tile-name">
        {h.cnName.length > 4
          ? (h.aliases.find((a) => a.length <= 4 && /[\u3400-\u9fff]/.test(a)) ?? h.cnName)
          : h.cnName}
      </span>
      {status && <b className={'taken ' + status}>{label}</b>}
      {selected && <Check size={13} className="tile-check" />}
    </button>
  );
});
export function HeroPoolGrid({
  heroes,
  d,
  pending,
  select,
  staged,
  search,
  query,
  setQuery,
  replacing,
  role,
  setRole,
}: {
  heroes: Hero[];
  d: Room;
  pending: number | null;
  select: (id: number) => void;
  staged: ReactNode;
  search: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (value: string) => void;
  replacing: boolean;
  role: number;
  setRole: (value: number) => void;
}) {
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
  function choose(event: MouseEvent<HTMLDivElement>) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-hero]');
    if (button && !button.disabled) select(Number(button.dataset.hero));
  }
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
        <LiquidGlass className="pool-search">
          <Search size={15} />
          <input
            ref={search}
            aria-label="搜索英雄"
            placeholder="英雄名、拼音首字母或简称"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || !term || pending) return;
              const hits = sections.flatMap((g) =>
                g.list.filter(({ h, terms }) => !used.has(h.id) && matches(h, terms)),
              );
              if (hits.length === 1) {
                e.preventDefault();
                e.stopPropagation();
                select(hits[0].h.id);
              }
            }}
          />
          {query ? (
            <button
              aria-label="清空搜索"
              onClick={() => {
                setQuery('');
                search.current?.focus();
              }}
            >
              ×
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </LiquidGlass>
        <SegmentedControl
          label="位置筛选"
          value={role}
          onChange={setRole}
          options={[0, 1, 2, 3, 4, 5].map((r) => ({ value: r, label: r ? r + '号位' : '全部' }))}
        />
      </div>
      {staged}
      <div className="attr-jumps">
        {groups.map((g) => (
          <button key={g.key} className={'attr-' + g.key} onClick={() => jump(g.key)}>
            <g.icon size={14} />
            {g.name}
          </button>
        ))}
      </div>
      <div className="pool-quads" onClick={choose}>
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
                return (
                  <HeroTile
                    key={h.id}
                    h={h}
                    status={taken?.actionType === 'ban' ? 'ban' : taken?.side}
                    takenTitle={
                      taken &&
                      '第 ' +
                        taken.step +
                        ' 手 · ' +
                        sideNames[taken.side] +
                        (taken.actionType === 'ban' ? '已禁' : '已选')
                    }
                    match={match}
                    filtering={filtering}
                    selected={selected}
                    disabled={!!taken || (!replacing && d.actions.length === 24)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
