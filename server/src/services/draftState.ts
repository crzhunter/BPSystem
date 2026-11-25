import type { DatabaseSync } from 'node:sqlite';
import {
  cmOrder,
  currentStep,
  currentOrder,
  type OrderVersion,
  type Side,
} from '../data/cmOrder.ts';
import { check, HttpError, integer, stringValue } from '../utils/input.ts';

export type Slots = (number | null)[];
export type Action = { heroId: number; assignedPlayerId: number | null; roleHint: number | null };
export type Draft = {
  ourSide: Side;
  firstPickSide: Side;
  radiantPlayerIds: Slots;
  direPlayerIds: Slots;
  radiantTeamId: number | null;
  direTeamId: number | null;
  title: string;
  notes: string;
  patch: string;
  cmOrderVersion: OrderVersion;
  actions: Action[];
};
export const slotsFor = (draft: Draft, side: Side) =>
  draft[side === 'radiant' ? 'radiantPlayerIds' : 'direPlayerIds'];
function side(value: unknown): Side {
  check(value === 'radiant' || value === 'dire', '请选择天辉或夜魇');
  return value;
}
function id(value: unknown) {
  return integer(value, 1, Number.MAX_SAFE_INTEGER, '编号');
}
function slots(value: unknown, playerExists: (id: number) => boolean): Slots {
  check(Array.isArray(value) && value.length <= 5, '每方最多五个选手位置');
  return Array.from({ length: 5 }, (_, i) => {
    if (value[i] == null) return null;
    const n = id(value[i]);
    check(playerExists(n), '阵容包含已删除或不存在的选手');
    return n;
  });
}
export function normalizeDraft(db: DatabaseSync, input: Record<string, unknown>): Draft {
  const player = db.prepare('SELECT 1 FROM players WHERE id=?');
  const playerExists = (id: number) => !!player.get(id);
  function team(value: unknown) {
    if (value == null) return null;
    const n = id(value);
    check(db.prepare('SELECT 1 FROM teams WHERE id=?').get(n), '战队不存在');
    return n;
  }
  const draft: Draft = {
    ourSide: side(input.ourSide ?? 'radiant'),
    firstPickSide: side(input.firstPickSide ?? 'radiant'),
    title: stringValue(input.title ?? '未命名对局', '对局名称', 120, true),
    cmOrderVersion: input.cmOrderVersion === 'classic' ? 'classic' : currentOrder,
    patch: stringValue(
      input.patch ??
        db.prepare("SELECT value FROM settings WHERE key='constants_patch'").get()?.value ??
        '7.42',
      '版本',
      32,
    ),
    notes: stringValue(input.notes ?? '', '备注', 4000),
    radiantTeamId: team(input.radiantTeamId),
    direTeamId: team(input.direTeamId),
    radiantPlayerIds: slots(input.radiantPlayerIds ?? [], playerExists),
    direPlayerIds: slots(input.direPlayerIds ?? [], playerExists),
    actions: [],
  };
  const roster = [...draft.radiantPlayerIds, ...draft.direPlayerIds].filter((v) => v !== null);
  check(new Set(roster).size === roster.length, '同一选手只能占一个位置');
  const actions = input.actions ?? [];
  check(Array.isArray(actions) && actions.length <= 24, '禁选记录最多 24 步');
  const order = cmOrder(draft.firstPickSide, draft.cmOrderVersion);
  const used = new Set<number>(),
    assigned = new Set<number>();
  const roles = { radiant: new Set<number>(), dire: new Set<number>() };
  const hero = db.prepare('SELECT 1 FROM heroes WHERE id=?');
  for (const [i, a] of actions.entries()) {
    const step = order[i];
    check(a && typeof a === 'object' && !Array.isArray(a), '禁选动作格式无效');
    check(
      (a.stepIndex === undefined || a.stepIndex === step.step) &&
        (a.step === undefined || a.step === step.step),
      '只能执行当前步骤，请刷新对局进度',
    );
    check(
      (a.side === undefined || a.side === step.side) &&
        (a.actionType === undefined || a.actionType === step.actionType),
      '动作不符合当前禁选顺序',
    );
    const heroId = id(a.heroId);
    check(!used.has(heroId), '该英雄已被禁用或选取');
    check(hero.get(heroId), '英雄不存在');
    used.add(heroId);
    const assignedPlayerId = a.assignedPlayerId == null ? null : id(a.assignedPlayerId);
    const roleHint = a.roleHint == null ? null : integer(a.roleHint, 1, 5, '选取位置');
    check(
      step.actionType === 'pick' || (!assignedPlayerId && !roleHint),
      '禁人步骤不能分配选手或位置',
    );
    const lineup = slotsFor(draft, step.side);
    if (assignedPlayerId) {
      check(
        lineup.includes(assignedPlayerId) && !assigned.has(assignedPlayerId),
        '请选择本方尚未分配英雄的选手',
      );
      assigned.add(assignedPlayerId);
    }
    const role = roleHint ?? (assignedPlayerId ? lineup.indexOf(assignedPlayerId) + 1 : null);
    if (role) {
      check(!roles[step.side].has(role), '该方位置已经分配英雄');
      roles[step.side].add(role);
    }
    draft.actions.push({ heroId, assignedPlayerId, roleHint });
  }
  return draft;
}

export function readSession(db: DatabaseSync, sessionId: number) {
  const row = db.prepare('SELECT * FROM draft_sessions WHERE id=?').get(sessionId);
  if (!row) throw new HttpError(404, '对局存档不存在');
  const draft: Draft = {
    title: String(row.title || '未命名对局'),
    notes: String(row.notes),
    cmOrderVersion: row.cm_order_version === currentOrder ? currentOrder : 'classic',
    patch: String(row.patch),
    ourSide: row.our_side as Side,
    firstPickSide: row.first_pick_side as Side,
    radiantTeamId: row.radiant_team_id as number | null,
    direTeamId: row.dire_team_id as number | null,
    radiantPlayerIds: JSON.parse(String(row.radiant_players_json)),
    direPlayerIds: JSON.parse(String(row.dire_players_json)),
    actions: db
      .prepare(
        `SELECT hero_id AS heroId, assigned_player_id AS assignedPlayerId,role_hint AS roleHint
      FROM draft_actions WHERE session_id=? ORDER BY step_index`,
      )
      .all(sessionId) as unknown as Action[],
  };
  const order = cmOrder(draft.firstPickSide, draft.cmOrderVersion);
  const timeline = order.map((s, i) => ({ ...s, action: draft.actions[i] ?? null }));
  return {
    ...draft,
    id: sessionId,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    status: row.status,
    timeline,
    currentStep: currentStep(
      draft.firstPickSide,
      draft.ourSide,
      draft.actions.length,
      draft.cmOrderVersion,
    ),
    actions: draft.actions.map((a, i) => ({ ...order[i], ...a })),
  };
}

// 保存快照和单步操作共用校验与写入；调用方事务保证元数据和动作共同生效。
export function writeSession(db: DatabaseSync, draft: Draft, sessionId?: number) {
  const now = new Date().toISOString();
  const status = draft.actions.length === 24 ? 'completed' : draft.actions.length ? 'live' : 'prep';
  const values = [
    draft.title,
    draft.notes,
    draft.patch,
    draft.ourSide,
    draft.firstPickSide,
    draft.radiantTeamId,
    draft.direTeamId,
    JSON.stringify(draft.radiantPlayerIds),
    JSON.stringify(draft.direPlayerIds),
    status,
    now,
  ];
  if (sessionId === undefined) {
    sessionId = Number(
      db
        .prepare(
          `INSERT INTO draft_sessions(title,notes,patch,our_side,first_pick_side,radiant_team_id,
      dire_team_id,radiant_players_json,dire_players_json,status,updated_at,created_at,cm_order_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(...values, now, draft.cmOrderVersion).lastInsertRowid,
    );
  } else {
    db.prepare(
      `UPDATE draft_sessions SET title=?,notes=?,patch=?,our_side=?,first_pick_side=?,radiant_team_id=?,
      dire_team_id=?,radiant_players_json=?,dire_players_json=?,status=?,updated_at=?,cm_order_version=?,revision=revision+1 WHERE id=?`,
    ).run(...values, draft.cmOrderVersion, sessionId);
  }
  const order = cmOrder(draft.firstPickSide, draft.cmOrderVersion);
  db.prepare('DELETE FROM draft_actions WHERE session_id=? AND step_index>?').run(
    sessionId,
    draft.actions.length,
  );
  const put =
    db.prepare(`INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,hero_id,assigned_player_id,role_hint,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,step_index) DO UPDATE SET side=excluded.side,hero_id=excluded.hero_id,
    assigned_player_id=excluded.assigned_player_id,role_hint=excluded.role_hint,created_at=excluded.created_at
    WHERE side!=excluded.side OR hero_id IS NOT excluded.hero_id OR assigned_player_id IS NOT excluded.assigned_player_id OR role_hint IS NOT excluded.role_hint`);
  draft.actions.forEach((a, i) => {
    const s = order[i];
    put.run(
      sessionId!,
      s.step,
      s.phase,
      s.actionType,
      s.side,
      Number(s.isFirstPickTeam),
      a.heroId,
      a.assignedPlayerId,
      a.roleHint,
      now,
    );
  });
  return readSession(db, sessionId);
}
