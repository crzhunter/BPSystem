import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { listHeroes } from '../data/catalog.ts';
import { check, HttpError, stringValue } from '../utils/input.ts';

export function extractTeam(db: DatabaseSync, matchId: string, side: unknown, name?: unknown) {
  check(side === 'radiant' || side === 'dire', '请选择比赛阵营');
  return transaction(db, () => {
    const match = db
      .prepare(
        "SELECT radiant_name,dire_name FROM matches WHERE match_id=? AND source='tournament'",
      )
      .get(matchId);
    if (!match) throw new HttpError(404, '比赛不存在');
    const rows = db
      .prepare(
        `SELECT mp.account_id,mp.personaname,mp.hero_id,mp.lane_role,p.primary_role
      FROM match_players mp LEFT JOIN players p USING(account_id) WHERE match_id=? AND side=? ORDER BY player_slot`,
      )
      .all(matchId, side);
    check(rows.length === 5 && rows.some((p) => p.account_id), '缺少完整阵容或公开账号，无法建队');
    const now = new Date().toISOString();
    const title = stringValue(
      name ?? match[side + '_name'] ?? matchId + (side === 'radiant' ? ' 天辉' : ' 夜魇'),
      '战队名称',
      60,
      true,
    );
    const teamId = Number(
      db.prepare('INSERT INTO teams(name,created_at,updated_at) VALUES(?,?,?)').run(title, now, now)
        .lastInsertRowid,
    );
    const roles = new Map(listHeroes(db).map((h) => [h.id, h.typicalRoles]));
    let best: number[] = [],
      bestScore = -1;
    // 五人至多 120 种排列，同时考虑原档案、英雄定位与实际分路，避免贪心抢占唯一位置。
    function assign(slots: number[], score: number) {
      if (slots.length === rows.length) {
        if (score > bestScore) {
          best = slots;
          bestScore = score;
        }
        return;
      }
      const p = rows[slots.length],
        typical = roles.get(Number(p.hero_id)) ?? [];
      for (let r = 1; r <= 5; r++)
        if (!slots.includes(r)) {
          const lane = [1, 2, 3, 3, 1][r - 1];
          assign(
            [...slots, r],
            score +
              (p.primary_role === r ? 30 : 0) +
              (typical.includes(r) ? 8 : 0) +
              (typical[0] === r ? 2 : 0) +
              (p.lane_role === lane ? 5 : 0),
          );
        }
    }
    assign([], 0);
    const add = db.prepare(
      'INSERT INTO players(account_id,nickname,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO NOTHING',
    );
    const bind = db.prepare(
      'INSERT INTO team_members(team_id,player_id,slot,created_at) SELECT ?,id,?,? FROM players WHERE account_id=?',
    );
    rows.forEach((p, i) => {
      if (!p.account_id) return;
      add.run(p.account_id, p.personaname || String(p.account_id), now, now);
      bind.run(teamId, best[i], now, p.account_id);
    });
    return { id: teamId, name: title, members: rows.filter((p) => p.account_id).length };
  });
}
