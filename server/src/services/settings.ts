import type { DatabaseSync } from 'node:sqlite';
import { isMetaBracket, patch742Id, patch742StartTime } from '../data/heroMeta.ts';
import { sampledAt } from '../data/snapshot.ts';

export type PatchScope = {
  id: number;
  startTime: number;
  ids: number[];
  calendar: { id: number; start: number }[];
  verifiedThrough: number;
};
export function setting(db: DatabaseSync, key: string) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value as string | undefined;
}
export function apiKey(db: DatabaseSync) {
  return setting(db, 'opendota_api_key') || process.env.OPENDOTA_API_KEY || '';
}
export function savedBracket(db: DatabaseSync) {
  const value = setting(db, 'metaBracket');
  return isMetaBracket(value) ? value : 'immortal_pub';
}
export function readSettings(db: DatabaseSync) {
  const key = apiKey(db);
  return {
    metaBracket: savedBracket(db),
    patch: setting(db, 'constants_patch') ?? '7.42',
    hasOpenDotaApiKey: !!key,
    maskedPreview: key ? '••••' + (key.length > 4 ? key.slice(-4) : '') : '',
    tournamentMatchWeight: bounded(setting(db, 'tournament_match_weight'), 4, 0, 8),
    pubRecentDays: Math.round(bounded(setting(db, 'pub_recent_days'), 60, 1, 365)),
    playerPoolWeight: bounded(setting(db, 'player_pool_weight'), 0.18, 0.15, 0.2),
  };
}

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  return value?.trim() && Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value)))
    : fallback;
}

export function patchScope(db: DatabaseSync): PatchScope {
  const stored = setting(db, 'patch_742_scope');
  return stored
    ? (JSON.parse(stored) as PatchScope)
    : {
        id: patch742Id,
        startTime: patch742StartTime,
        ids: [patch742Id],
        verifiedThrough: Math.floor(Date.parse(sampledAt) / 1000),
        calendar: [
          { id: patch742Id, start: patch742StartTime },
          { id: 60, start: Math.floor(Date.parse('2026-03-24T00:50:59.580Z') / 1000) },
        ],
      };
}

// OpenDota 的逐场投影有时省略 patch。只在已核实的日历范围内按开赛秒回填，保留明确上报的 ID。
export function fillMissingPatches(db: DatabaseSync, scope: PatchScope, playerId?: number) {
  if (!scope.calendar.length) return;
  const query = db.prepare(
    `WITH calendar AS MATERIALIZED (
    SELECT json_extract(value,'$.id') id,json_extract(value,'$.start') start FROM json_each(?)
  ) UPDATE player_pub_matches SET patch=(
    SELECT id FROM calendar WHERE start<=start_time ORDER BY start DESC LIMIT 1
  ) WHERE patch IS NULL AND start_time BETWEEN ? AND ?` +
      (playerId === undefined ? '' : ' AND player_id=?'),
  );
  query.run(
    JSON.stringify(scope.calendar),
    Math.min(...scope.calendar.map((p) => p.start)),
    scope.verifiedThrough,
    ...(playerId === undefined ? [] : [playerId]),
  );
}
