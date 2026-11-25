import type { DatabaseSync } from 'node:sqlite';
import { heroAliases } from './heroAliases.ts';
import { heroSnapshot } from './snapshot.ts';
export interface HeroData {
  id: number;
  name: string;
  localized_name: string;
  primary_attr?: string;
  attack_type?: string;
  roles?: string[];
  img?: string;
  icon?: string;
}
export function upsertHeroes(db: DatabaseSync, heroes: HeroData[]) {
  const put =
    db.prepare(`INSERT INTO heroes (id,name,localized_name,cn_name,aliases_json,primary_attr,attack_type,roles_json,img,icon,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,localized_name=excluded.localized_name,
    cn_name=excluded.cn_name,aliases_json=excluded.aliases_json,primary_attr=excluded.primary_attr,attack_type=excluded.attack_type,
    roles_json=excluded.roles_json,img=excluded.img,icon=excluded.icon,updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  for (const h of heroes) {
    const names = heroAliases.get(h.name);
    const slug = h.name.replace('npc_dota_hero_', '');
    const path = '/apps/dota2/images/dota_react/heroes/';
    put.run(
      h.id,
      h.name,
      h.localized_name,
      names?.cnName ?? '',
      JSON.stringify(names?.aliases ?? []),
      h.primary_attr ?? '',
      h.attack_type ?? '',
      JSON.stringify(h.roles ?? []),
      h.img ?? path + slug + '.png',
      h.icon ?? path + 'icons/' + slug + '.png',
      now,
    );
  }
}
export function seedHeroes(db: DatabaseSync) {
  upsertHeroes(db, heroSnapshot);
}
