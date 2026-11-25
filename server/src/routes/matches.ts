import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { OpenDotaClient } from '../services/opendota.ts';
import { importMatch, listMatches, matchDetail, matchIds } from '../services/matches.ts';
import { HttpError, stringValue } from '../utils/input.ts';

export function matchRoutes(db: DatabaseSync, client: OpenDotaClient) {
  const r = Router();
  r.post('/matches/import', async (req, res) => {
    const ids = matchIds(req.body.matchIds);
    const tag = req.body.tag === undefined ? undefined : stringValue(req.body.tag, '赛事标签', 100);
    const results = [];
    for (const matchId of ids) {
      if (typeof matchId !== 'number') {
        results.push({ matchId: matchId.slice(0, 80), imported: false, error: '比赛 ID 或链接无效' });
        continue;
      }
      try {
        results.push(await importMatch(db, client, matchId, tag));
      } catch (e) {
        results.push({
          matchId,
          imported: false,
          error: e instanceof HttpError ? e.message : '比赛数据无法入库',
        });
      }
    }
    res.json({ results });
  });
  r.get('/matches', (req, res) =>
    res.json(listMatches(db, String(req.query.tag ?? '').trim(), String(req.query.q ?? '').trim())),
  );
  r.get('/matches/:matchId', (req, res) => res.json(matchDetail(db, req.params.matchId)));
  r.delete('/matches/:matchId', (req, res) => {
    const removed = db
      .prepare("DELETE FROM matches WHERE match_id=? AND source='tournament'")
      .run(req.params.matchId);
    if (!removed.changes) throw new HttpError(404, '比赛不存在');
    res.sendStatus(204);
  });
  return r;
}
