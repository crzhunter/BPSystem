import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from './schema.ts';
import { patchMatchups } from '../data/matchupsSnapshot.ts';
import { heroSnapshot, sampledAt, snapshotPatch } from '../data/snapshot.ts';
import { itemsSnapshot } from '../data/itemsSnapshot.ts';
import { storeConstants } from '../data/catalog.ts';
import { deriveMeta, statKeys, type Counts, type HeroMeta, type SideSample } from '../data/heroMeta.ts';
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

function migrateLadder(db: DatabaseSync) {
  // v6 双榜保存了相同的四档原始计数。由 v5 升级过的库把完整快照放在 community_pub。
  const legacy = db.prepare(`
    SELECT hero_id,coalesce(json_extract(payload,'$.community_pub'),payload) sample
    FROM hero_meta WHERE json_type(payload,'$.ladder') IS NULL
  `).all();
  if (!legacy.length) return;
  const bundled = new Map(heroSnapshot.map((h) => [h.id, h]));
  type Sample = Counts & { id: number; sideSample?: SideSample };
  const batches = new Map<string, { patch: string; date: string; heroes: Sample[] }>();
  for (const entry of legacy) {
    const id = Number(entry.hero_id);
    const stored = JSON.parse(String(entry.sample)) as
      Pick<HeroMeta, 'patch' | 'sampledAt' | 'sideBias'> & { counts: Partial<Counts> };
    const { patch } = stored;
    let date = stored.sampledAt;
    let counts = stored.counts;
    let sideSample: SideSample | undefined = stored.sideBias ?? undefined;
    // v5 仅有高分计数。同补丁有更新的完整快照时整批采用，避免把不同日期的胜场和登场混算。
    const seed = bundled.get(id);
    if (seed && counts['5_pick'] === undefined && patch === snapshotPatch && date <= sampledAt) {
      counts = seed;
      date = sampledAt;
      sideSample ??= seed.sideSample;
    }
    const key = JSON.stringify([patch, date]);
    const batch = batches.get(key) ?? { patch, date, heroes: [] };
    batch.heroes.push({
      ...(Object.fromEntries(statKeys.map((k) => [k, counts[k] ?? 0])) as Counts),
      id,
      sideSample,
    });
    batches.set(key, batch);
  }
  // 只追加新榜，旧采样、时间戳和阵营记录仍可追溯。事务失败时整批撤销。
  const update = db.prepare("UPDATE hero_meta SET payload=json_set(payload,'$.ladder',json(?)) WHERE hero_id=?");
  for (const { heroes, patch, date } of batches.values())
    for (const row of deriveMeta(heroes, patch, date)) update.run(JSON.stringify(row), row.id);
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
      if (version === 7) migrateLadder(db);
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
