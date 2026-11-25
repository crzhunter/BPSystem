import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { check, HttpError } from '../utils/input.ts';
import { numberField, rows, upstream } from './odFields.ts';
import type { OpenDotaClient } from './opendota.ts';

export async function syncMatchups(db: DatabaseSync, client: OpenDotaClient, heroIds?: unknown) {
  const known = new Set(
    db
      .prepare('SELECT id FROM heroes ORDER BY id')
      .all()
      .map((h) => Number(h.id)),
  );
  check(
    heroIds === undefined || (Array.isArray(heroIds) && heroIds.every((id) => known.has(id))),
    '请选择英雄库中有效的英雄',
  );
  const ids = heroIds === undefined ? [...known] : [...new Set<number>(heroIds)];
  const results: { heroId: number; count: number; error?: string }[] = [];
  const put = db.prepare('INSERT OR REPLACE INTO hero_matchups VALUES(?,?,?,?,?)');
  for (const heroId of ids) {
    try {
      const data = rows(await client.get('/heroes/' + heroId + '/matchups'));
      const now = new Date().toISOString();
      transaction(db, () => {
        for (const d of data) {
          const against = numberField(d.hero_id, 1),
            games = numberField(d.games_played),
            wins = numberField(d.wins);
          upstream(wins <= games);
          put.run(heroId, against, games, wins, now);
        }
      });
      results.push({ heroId, count: data.length });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      results.push({ heroId, count: 0, error: e.message });
      // 上游不可用时保留已有对位，避免全库同步对同一故障反复消耗额度。
      break;
    }
  }
  return { synced: results.filter((r) => !r.error).length, requested: ids.length, results };
}
