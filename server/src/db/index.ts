import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from './schema.ts';
import { patchMatchups } from '../data/matchupsSnapshot.ts';
import { heroSnapshot, sampledAt, snapshotPatch } from '../data/snapshot.ts';
import { itemsSnapshot } from '../data/itemsSnapshot.ts';
import { storeConstants } from '../data/catalog.ts';
import { deriveMeta, type HeroMeta } from '../data/heroMeta.ts';
import { fillMissingPatches, patchScope } from '../services/settings.ts';

export const root = fileURLToPath(new URL('../../../', import.meta.url));

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  migrations.forEach((sql, index) =>
    transaction(db, () => {
      const version = index + 1;
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return;
      db.exec(sql);
      // 初始快照仅随首次迁移写入，重启时保留后续同步的数据。
      if (version === 4)
        storeConstants(
          db,
          {
            patch: snapshotPatch,
            matchups: patchMatchups,
            heroes: heroSnapshot,
            items: Object.values(itemsSnapshot),
          },
          sampledAt,
        );
      if (version === 5) fillMissingPatches(db, patchScope(db));
      if (version === 6) {
        // v5 可能有用户同步过的职业对位和阵营样本。只追加新的天梯榜，保留旧快照及其日期。
        const legacy = db
          .prepare(
            "SELECT hero_id,payload FROM hero_meta WHERE json_type(payload,'$.community_pub') IS NULL",
          )
          .all();
        if (legacy.length) {
          const old = new Map(
            legacy.map((r) => [Number(r.hero_id), JSON.parse(String(r.payload)) as HeroMeta]),
          );
          const rows = heroSnapshot.map((h) => {
            const m = old.get(h.id);
            return {
              ...h,
              sideSample: m?.patch === snapshotPatch ? (m.sideBias ?? undefined) : h.sideSample,
            };
          });
          const update = db.prepare(
            'UPDATE hero_meta SET payload=json_set(payload,?,json(?)) WHERE hero_id=?',
          );
          for (const bracket of ['immortal_pub', 'community_pub'] as const)
            for (const row of deriveMeta(rows, snapshotPatch, sampledAt, bracket))
              if (old.has(row.id)) update.run('$.' + bracket, JSON.stringify(row), row.id);
        }
      }
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(
        version,
        new Date().toISOString(),
      );
    }),
  );
}

export function openDb(path = process.env.DB_PATH || resolve(root, 'data/bpsystem.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000');
  migrate(db);
  return db;
}
