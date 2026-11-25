import { Router } from 'express';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { check, HttpError, integer, stringValue } from '../utils/input.ts';
import { parseAccountId } from '../utils/accountId.ts';

type Row = Record<string, SQLOutputValue>;
function player(row: Row) {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    nickname: String(row.nickname),
    roles: JSON.parse(String(row.roles_json)) as number[],
    notes: String(row.notes),
    steamName: row.steam_name,
    avatarUrl: row.avatar_url,
  };
}
function existing(db: DatabaseSync, table: 'players' | 'teams', id: string) {
  const row = db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id);
  if (!row) throw new HttpError(404, '记录不存在或已删除');
  return row;
}
function teamList(db: DatabaseSync) {
  const members = db
    .prepare(
      'SELECT p.*,m.team_id,m.slot FROM team_members m JOIN players p ON p.id=m.player_id ORDER BY m.slot',
    )
    .all();
  return db
    .prepare('SELECT * FROM teams ORDER BY id')
    .all()
    .map((t) => {
      const assigned = members
        .filter((m) => m.team_id === t.id)
        .map((m) => ({ slot: Number(m.slot), player: player(m) }));
      return {
        ...t,
        id: Number(t.id),
        roster: Array.from(
          { length: 5 },
          (_, i) => assigned.find((m) => m.slot === i + 1) ?? { slot: i + 1, player: null },
        ),
        subs: assigned.filter((m) => m.slot > 5),
      };
    });
}
function playerFields(body: Record<string, unknown>, old?: Row) {
  const id = parseAccountId(body.accountInput ?? body.accountId ?? old?.account_id);
  const nickname = stringValue(body.nickname ?? old?.nickname ?? String(id), '选手昵称', 60, true);
  const roles = body.roles ?? JSON.parse(String(old?.roles_json ?? '[]'));
  check(Array.isArray(roles), '位置须为数组');
  const positions = [...new Set(roles.map((r) => integer(r, 1, 5, '位置')))].sort();
  return [
    id,
    nickname,
    JSON.stringify(positions),
    stringValue(body.notes ?? old?.notes ?? '', '选手备注', 2000),
  ] as const;
}
function teamFields(body: Record<string, unknown>, old?: Row) {
  const color = body.color ?? old?.color ?? '#38bdf8';
  check(typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color), '战队颜色须为六位色值');
  return [
    stringValue(body.name ?? old?.name, '战队名称', 60, true),
    stringValue(body.tag ?? old?.tag ?? '', '战队简称', 20),
    color,
    stringValue(body.notes ?? old?.notes ?? '', '战队备注', 2000),
  ] as const;
}
type Assignment = { slot: number; playerId: number };
function replaceRoster(db: DatabaseSync, teamId: number, members: unknown) {
  check(Array.isArray(members), '请提供阵容成员列表');
  const slots = new Set<number>(),
    players = new Set<number>();
  const rows: Assignment[] = members.map((m) => {
    check(m && typeof m === 'object', '阵容成员无效');
    const slot = integer(m.slot, 1, Number.MAX_SAFE_INTEGER, '槽位'),
      playerId = integer(m.playerId, 1, Number.MAX_SAFE_INTEGER, '选手');
    check(!slots.has(slot) && !players.has(playerId), '同一战队的位置和选手不可重复');
    check(db.prepare('SELECT 1 FROM players WHERE id=?').get(playerId), '该选手已不存在');
    slots.add(slot);
    players.add(playerId);
    return { slot, playerId };
  });
  db.prepare('DELETE FROM team_members WHERE team_id=?').run(teamId);
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO team_members(team_id,player_id,slot,created_at) VALUES (?,?,?,?)',
  );
  for (const m of rows) insert.run(teamId, m.playerId, m.slot, now);
  db.prepare('UPDATE teams SET updated_at=? WHERE id=?').run(now, teamId);
}
export function rosterRoutes(db: DatabaseSync) {
  const r = Router();
  r.get('/players', (_req, res) =>
    res.json(db.prepare('SELECT * FROM players ORDER BY id').all().map(player)),
  );
  r.post('/players', (req, res) => {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        'INSERT INTO players(account_id,nickname,roles_json,notes,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(...playerFields(req.body), now, now);
    res.status(201).json(player(existing(db, 'players', String(result.lastInsertRowid))));
  });
  r.put('/players/:id', (req, res) => {
    const old = existing(db, 'players', req.params.id);
    db.prepare(
      'UPDATE players SET account_id=?,nickname=?,roles_json=?,notes=?,updated_at=? WHERE id=?',
    ).run(...playerFields(req.body, old), new Date().toISOString(), old.id);
    res.json(player(existing(db, 'players', req.params.id)));
  });
  r.get('/teams', (_req, res) => res.json(teamList(db)));
  r.post('/teams', (req, res) => {
    const id = transaction(db, () => {
      const now = new Date().toISOString();
      const result = db
        .prepare('INSERT INTO teams(name,tag,color,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(...teamFields(req.body), now, now);
      const id = Number(result.lastInsertRowid);
      if (req.body.members !== undefined) replaceRoster(db, id, req.body.members);
      return id;
    });
    res.status(201).json(teamList(db).find((t) => t.id === id));
  });
  r.put('/teams/:id', (req, res) => {
    const old = existing(db, 'teams', req.params.id);
    transaction(db, () => {
      db.prepare('UPDATE teams SET name=?,tag=?,color=?,notes=?,updated_at=? WHERE id=?').run(
        ...teamFields(req.body, old),
        new Date().toISOString(),
        old.id,
      );
      if (req.body.members !== undefined) replaceRoster(db, Number(old.id), req.body.members);
    });
    res.json(teamList(db).find((t) => t.id === old.id));
  });
  r.put('/teams/:id/roster', (req, res) => {
    const t = existing(db, 'teams', req.params.id);
    transaction(db, () => replaceRoster(db, Number(t.id), req.body.members));
    res.json(teamList(db).find((row) => row.id === t.id));
  });
  for (const table of ['players', 'teams'] as const) {
    r.delete('/' + table + '/:id', (req, res) => {
      const old = existing(db, table, String(req.params.id));
      db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(old.id);
      res.sendStatus(204);
    });
  }
  return r;
}
