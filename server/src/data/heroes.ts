import type { DatabaseSync } from 'node:sqlite';
import { heroAliases } from './heroAliases.ts';

export interface HeroData {
  id: number;
  name: string;
  localized_name: string;
  cn_name?: string;
  primary_attr?: string;
  attack_type?: string;
  roles?: string[];
  img?: string;
  icon?: string;
}
export function upsertHeroes(db: DatabaseSync, heroes: HeroData[], now = new Date().toISOString()) {
  const put =
    db.prepare(`INSERT INTO heroes (id,name,localized_name,cn_name,aliases_json,primary_attr,attack_type,roles_json,img,icon,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,localized_name=excluded.localized_name,
    cn_name=excluded.cn_name,aliases_json=excluded.aliases_json,primary_attr=COALESCE(NULLIF(excluded.primary_attr,''),heroes.primary_attr),attack_type=COALESCE(NULLIF(excluded.attack_type,''),heroes.attack_type),
    roles_json=excluded.roles_json,img=excluded.img,icon=excluded.icon,updated_at=excluded.updated_at`);
  for (const h of heroes) {
    const names = heroAliases.get(h.name);
    const slug = h.name.replace('npc_dota_hero_', '');
    const path = '/apps/dota2/images/dota_react/heroes/';
    put.run(
      h.id,
      h.name,
      h.localized_name,
      h.cn_name ?? names?.cnName ?? '',
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
