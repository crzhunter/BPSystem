import type { DatabaseSync } from 'node:sqlite';
import { upsertHeroes } from './heroes.ts';
import { heroTags } from './heroTags.ts';
import { deriveMeta, type HeroMeta, type PrimaryAttr, cdn } from './heroMeta.ts';
import type { Constants } from '../services/constants.ts';
import type { Item } from './itemsSnapshot.ts';
import { fillMissingPatches } from '../services/settings.ts';

export function storeConstants(db: DatabaseSync, data: Constants, now: string) {
  upsertHeroes(db, data.heroes, now);
  db.exec('DELETE FROM hero_meta');
  const meta = db.prepare('INSERT OR REPLACE INTO hero_meta VALUES(?,?)');
  for (const row of deriveMeta(data.heroes, data.patch, now)) meta.run(row.id, JSON.stringify(row));
  // 最新版本职业联赛组合随快照一起替换，手动同步的更广对位样本单独保留。
  db.exec('DELETE FROM patch_matchups');
  const pair = db.prepare('INSERT INTO patch_matchups VALUES(?,?,?,?)');
  for (const row of data.matchups) pair.run(...row);
  db.exec('DELETE FROM items');
  const item = db.prepare('INSERT OR REPLACE INTO items VALUES(?,?,?,?,?)');
  for (const i of data.items) item.run(i.id, i.key, i.cnName, i.localizedName, i.imgUrl);
  db.prepare("INSERT OR REPLACE INTO settings VALUES('constants_patch',?,?)").run(data.patch, now);
  if (data.scope) {
    db.prepare("INSERT OR REPLACE INTO settings VALUES('patch_742_scope',?,?)").run(JSON.stringify(data.scope), now);
    fillMissingPatches(db, data.scope);
  }
}
export function listItems(db: DatabaseSync) {
  return db.prepare('SELECT * FROM items ORDER BY id').all() as unknown as Item[];
}
export function heroPortraitUrl(name: string) {
  return cdn + 'heroes/' + name.replace(/^npc_dota_hero_/, '') + '.png';
}
export function listHeroes(db: DatabaseSync) {
  return db
    .prepare('SELECT h.*,m.payload FROM heroes h JOIN hero_meta m ON h.id=m.hero_id ORDER BY h.id')
    .all()
    .map((h) => {
      const roles = JSON.parse(String(h.roles_json)) as string[];
      return {
        id: Number(h.id),
        name: String(h.name),
        cnName: String(h.cn_name),
        localizedName: String(h.localized_name),
        aliases: JSON.parse(String(h.aliases_json)) as string[],
        primaryAttr: h.primary_attr as PrimaryAttr,
        img: String(h.img),
        icon: String(h.icon),
        portraitUrl: heroPortraitUrl(String(h.name)),
        attackType: String(h.attack_type),
        roles,
        meta: JSON.parse(String(h.payload)) as HeroMeta,
        ...heroTags(Number(h.id), roles),
      };
    });
}
