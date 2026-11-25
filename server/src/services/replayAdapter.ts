import type { DatabaseSync } from 'node:sqlite';

export type ReplayLayer = 'wards' | 'farming';
export type WardEvent = { x: number; y: number; time: number };
export type PositionSample = { x: number; y: number; weight: number };
export type ReplayTrack = {
  playerSlot: number;
  obs: WardEvent[];
  sen: WardEvent[];
  positions: PositionSample[];
};

/** 插件按比赛编号定位录像，返回指定槽位的原始地图坐标。允许外部解析器异步工作。 */
export interface ReplayParserAdapter {
  parseReplay(
    matchId: number,
    slots: number[],
    layer: ReplayLayer,
  ): ReplayTrack[] | Promise<ReplayTrack[]>;
}

function numeric(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function readWardEvents(json: string): WardEvent[] {
  const result: WardEvent[] = [];
  for (const event of JSON.parse(json)) {
    const x = numeric(event?.x),
      y = numeric(event?.y),
      time = numeric(event?.time);
    if (x !== null && y !== null && time !== null) result.push({ x, y, time });
  }
  return result;
}
function positions(json: string): PositionSample[] {
  const result: PositionSample[] = [];
  for (const [column, rows] of Object.entries(JSON.parse(json))) {
    const x = numeric(column);
    if (x === null || !rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    for (const [row, count] of Object.entries(rows)) {
      const y = numeric(row),
        weight = numeric(count);
      if (y !== null && weight !== null && weight > 0) result.push({ x, y, weight });
    }
  }
  return result;
}

export class OpenDotaReplayAdapter implements ReplayParserAdapter {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  parseReplay(matchId: number, slots: number[], layer: ReplayLayer): ReplayTrack[] {
    if (!slots.length) return [];
    const columns = layer === 'wards' ? 'obs_log_json, sen_log_json' : 'lane_pos_json';
    return this.db
      .prepare(
        `SELECT player_slot, ${columns} FROM match_players
      WHERE match_id=? AND player_slot IN (${slots.map(() => '?').join(',')}) ORDER BY player_slot`,
      )
      .all(matchId, ...slots)
      .map((row) => ({
        playerSlot: Number(row.player_slot),
        obs: layer === 'wards' ? readWardEvents(String(row.obs_log_json)) : [],
        sen: layer === 'wards' ? readWardEvents(String(row.sen_log_json)) : [],
        positions: layer === 'farming' ? positions(String(row.lane_pos_json)) : [],
      }));
  }
}
