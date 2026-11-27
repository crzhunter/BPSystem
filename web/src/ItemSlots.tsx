import { atlasColumns, atlasRows, iconIndex } from './itemAtlas';
export type Equipment = { cnName: string; imgUrl: string | null } | null;
export function ItemSlots({ items, neutralItem }: { items: Equipment[]; neutralItem?: Equipment }) {
  return (
    <div className="score-items" aria-label="物品栏">
      {Array.from({ length: 7 }, (_, i) => {
        const item = i === 6 ? neutralItem : items[i];
        const icon = item?.imgUrl ? iconIndex.get(item.imgUrl.split('/').pop()!) : undefined;
        return (
          <span
            key={i}
            className={i === 6 ? 'neutral-slot' : undefined}
            title={(i === 6 ? '中立装备 · ' : '') + (item?.cnName ?? '空格')}
            tabIndex={item ? 0 : undefined}
          >
            {item && <i aria-hidden="true">{item.cnName.slice(0, 2)}</i>}
            {icon !== undefined ? (
              <span
                className="item-icon"
                role="img"
                aria-label={item!.cnName}
                style={{
                  backgroundSize: atlasColumns * 100 + '% ' + atlasRows * 100 + '%',
                  backgroundPosition:
                    ((icon % atlasColumns) * 100) / (atlasColumns - 1) +
                    '% ' +
                    (Math.floor(icon / atlasColumns) * 100) / (atlasRows - 1) +
                    '%',
                }}
              />
            ) : item?.imgUrl ? (
              <img
                src={item.imgUrl}
                alt={item.cnName}
                onError={(e) => {
                  e.currentTarget.hidden = true;
                }}
              />
            ) : null}
            {item && <small>{item.cnName}</small>}
          </span>
        );
      })}
    </div>
  );
}
