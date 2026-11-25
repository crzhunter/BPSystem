import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { recommend } from '../services/bpEngine.ts';
import { parsePreference } from '../services/rolePriority.ts';
import { normalizeDraft, readSession, writeSession } from '../services/draftState.ts';
import { syncMatchups } from '../services/matchups.ts';
import type { OpenDotaClient } from '../services/opendota.ts';
import { check, HttpError, integer } from '../utils/input.ts';

export function bpRoutes(db: DatabaseSync, client: OpenDotaClient) {
  const r = Router(),
    path = '/bp/sessions';
  const id = (value: unknown) => integer(value, 1, Number.MAX_SAFE_INTEGER, '对局编号');
  r.get(path, (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT s.id,s.title,s.patch,s.status,s.notes,s.our_side ourSide,
    s.first_pick_side firstPickSide,s.updated_at updatedAt,s.revision,
    (SELECT COUNT(*) FROM draft_actions a WHERE a.session_id=s.id) actionCount
    FROM draft_sessions s ORDER BY s.updated_at DESC,s.id DESC`,
        )
        .all(),
    ),
  );
  r.post(path, (req, res) =>
    res.status(201).json(transaction(db, () => writeSession(db, normalizeDraft(db, req.body)))),
  );
  r.get(path + '/:id', (req, res) => res.json(readSession(db, id(Number(req.params.id)))));
  function edit(
    sessionId: number,
    body: Record<string, unknown>,
    operation: 'update' | 'action' | 'undo' | 'reset',
  ) {
    return transaction(db, () => {
      const old = readSession(db, sessionId);
      if (body.revision !== undefined && body.revision !== old.revision)
        throw new HttpError(409, '存档已被更新，请重新载入或另存本局');
      const actions = old.actions.map(({ heroId, assignedPlayerId, roleHint }) => ({
        heroId,
        assignedPlayerId,
        roleHint,
      }));
      let input: Record<string, unknown> = { ...old, actions };
      if (operation === 'update') input = { ...input, ...body };
      if (operation === 'action') {
        const step = integer(body.stepIndex ?? body.step ?? actions.length + 1, 1, 24, '禁选步骤');
        check(step <= actions.length + 1, '请先完成前面的禁选步骤');
        check(!actions.some((a) => a.heroId === body.heroId), '该英雄已被禁用或选取');
        // 显式指定已执行的步号可修正录入；后续步骤仍按完整快照重新校验。
        const edited: unknown[] = [...actions];
        edited[step - 1] = body;
        input.actions = edited;
      }
      if (operation === 'undo') {
        check(actions.length, '当前没有可撤销的动作');
        actions.pop();
      }
      if (operation === 'reset') input.actions = [];
      return writeSession(db, normalizeDraft(db, input), sessionId);
    });
  }
  r.put(path + '/:id', (req, res) => res.json(edit(id(Number(req.params.id)), req.body, 'update')));
  for (const op of ['action', 'undo', 'reset'] as const)
    r.post(path + '/:id/' + op, (req, res) =>
      res.json(edit(id(Number(req.params.id)), req.body ?? {}, op)),
    );
  r.delete(path + '/:id', (req, res) => {
    if (!db.prepare('DELETE FROM draft_sessions WHERE id=?').run(id(Number(req.params.id))).changes)
      throw new HttpError(404, '对局存档不存在');
    res.sendStatus(204);
  });
  r.post('/bp/recommend', (req, res) =>
    res.json(
      recommend(
        db,
        req.body.sessionId === undefined
          ? normalizeDraft(db, req.body)
          : readSession(db, id(req.body.sessionId)),
        req.body.previewHeroId == null
          ? undefined
          : integer(req.body.previewHeroId, 1, Number.MAX_SAFE_INTEGER, '预览英雄'),
        parsePreference(req.body.rolePreference),
      ),
    ),
  );
  r.post('/heroes/matchups/sync', async (req, res) =>
    res.json(await syncMatchups(db, client, req.body?.heroIds)),
  );
  return r;
}
