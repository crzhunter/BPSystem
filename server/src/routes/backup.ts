import { Router } from 'express';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { check, HttpError } from '../utils/input.ts';

const tables = [
  'settings',
  'heroes',
  'players',
  'teams',
  'team_members',
  'matches',
  'match_players',
  'match_picks_bans',
  'player_pub_heroes',
  'player_pub_matches',
  'draft_sessions',
  'draft_actions',
  'hero_matchups',
] as const;
const settingsWhere = " WHERE key IN ('pub_recent_days','tournament_match_weight')";
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validateJson(column: string, value: string, table: string) {
  const parsed: unknown = JSON.parse(value);
  if (column === 'raw_json') return;
  if (column === 'lane_pos_json') {
    check(object(parsed), '分路坐标无效');
  } else {
    check(Array.isArray(parsed), '备份中的列表字段无效');
    if (column === 'roles_json' && table === 'players')
      check(
        parsed.every((role) => Number.isInteger(role) && role >= 1 && role <= 5),
        '选手位置无效',
      );
    if (column === 'aliases_json' || (column === 'roles_json' && table === 'heroes'))
      check(
        parsed.every((v) => typeof v === 'string'),
        '英雄资料无效',
      );
  }
}
function validateSetting(row: Record<string, unknown>) {
  const n = Number(row.value);
  check(
    typeof row.value === 'string' &&
      row.value.trim() &&
      Number.isFinite(n) &&
      ((row.key === 'pub_recent_days' && Number.isInteger(n) && n >= 1 && n <= 365) ||
        (row.key === 'tournament_match_weight' && n >= 0 && n <= 100)),
    '备份中的分析设置无效',
  );
}
export function backupRoutes(db: DatabaseSync) {
  const r = Router();
  r.get('/backup/export', (_req, res) => {
    const data = transaction(db, () =>
      Object.fromEntries(
        tables.map((t) => [
          t,
          db.prepare('SELECT * FROM ' + t + (t === 'settings' ? settingsWhere : '')).all(),
        ]),
      ),
    );
    res.attachment('BPSystem-' + new Date().toISOString().slice(0, 10) + '.json');
    res.json({ version: 2, exportedAt: new Date().toISOString(), ...data });
  });
  r.post('/backup/import', (req, res) => {
    const snapshot: Record<string, unknown> = req.body;
    check(
      snapshot.version === 2 &&
        typeof snapshot.exportedAt === 'string' &&
        Number.isFinite(Date.parse(snapshot.exportedAt)) &&
        tables.every((t) => Array.isArray(snapshot[t])),
      '请选择完整的二期 JSON 备份',
    );
    try {
      const counts = transaction(db, () => {
        // 子表先删除、父表先恢复；INSERT 保留主键，外键约束会让整份错误的快照回滚。
        for (const t of [...tables].reverse())
          db.exec('DELETE FROM ' + t + (t === 'settings' ? settingsWhere : ''));
        const counts: Record<string, number> = {};
        for (const t of tables) {
          const columns = db.prepare('PRAGMA table_info(' + t + ')').all();
          const insert = db.prepare(
            'INSERT INTO ' +
              t +
              ' (' +
              columns.map((c) => c.name).join(',') +
              ') VALUES (' +
              columns.map(() => '?').join(',') +
              ')',
          );
          const rows = snapshot[t] as unknown[];
          for (const row of rows) {
            check(object(row) && Object.keys(row).length === columns.length, '备份字段不完整');
            if (t === 'settings') validateSetting(row);
            if (t === 'players')
              check(
                Number.isInteger(row.account_id) &&
                  Number(row.account_id) > 0 &&
                  Number(row.account_id) <= 4294967295,
                '选手账号无效',
              );
            if (t === 'team_members')
              check(Number.isInteger(row.slot) && Number(row.slot) > 0, '阵容位置无效');
            const values = columns.map((c) => {
              const key = String(c.name),
                v = row[key];
              check(Object.hasOwn(row, key), '备份缺少字段 ' + key);
              if (v === null && !c.notnull && !c.pk) return null;
              check(
                c.type === 'INTEGER' ? Number.isSafeInteger(v) : typeof v === 'string',
                '备份字段类型无效：' + key,
              );
              if (key.endsWith('_json')) validateJson(key, String(v), t);
              return v as SQLInputValue;
            });
            insert.run(...values);
          }
          counts[t] = rows.length;
        }
        db.exec('DELETE FROM api_cache');
        return counts;
      });
      res.json({ counts });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (
        e instanceof SyntaxError ||
        (object(e) && e.code === 'ERR_SQLITE_ERROR' && (Number(e.errcode) & 255) === 19)
      )
        throw new HttpError(400, '备份数据格式、唯一键或关联关系无效，已撤销恢复');
      throw e;
    }
  });
  return r;
}
