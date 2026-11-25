import type { DatabaseSync } from 'node:sqlite';
export function setting(db: DatabaseSync, key: string) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value as string | undefined;
}
export function apiKey(db: DatabaseSync) {
  return setting(db, 'opendota_api_key') || process.env.OPENDOTA_API_KEY || '';
}
export function readSettings(db: DatabaseSync) {
  const key = apiKey(db);
  return {
    hasOpenDotaApiKey: !!key,
    maskedPreview: key ? '••••' + (key.length > 4 ? key.slice(-4) : '') : '',
    tournamentMatchWeight: Number(setting(db, 'tournament_match_weight') ?? 2),
    pubRecentDays: Number(setting(db, 'pub_recent_days') ?? 30),
  };
}
