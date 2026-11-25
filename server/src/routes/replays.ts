import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { check, HttpError, stringValue } from '../utils/input.ts';
import { importMatch } from '../services/matches.ts';
import type { OpenDotaClient } from '../services/opendota.ts';
import type { ReplayParserAdapter } from '../services/replayAdapter.ts';
import {
  farmingHeatmap,
  replayMatchParticipants,
  replayPlayerMatches,
  replayPlayers,
  wardHeatmap,
  type ReplayFilters,
} from '../services/replay.ts';

function id(value: unknown) {
  check(
    typeof value === 'string' &&
      /^\d+$/.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) > 0,
    '编号须为正整数',
  );
  return Number(value);
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (value === undefined) return options[0];
  check(options.includes(value as T), '筛选项无效');
  return value as T;
}
function filters(q: Record<string, unknown>, farming: boolean): ReplayFilters {
  if (q.accountId !== undefined || q.playerSlot !== undefined)
    check(q.matchId !== undefined, '按参赛账号或槽位筛选时须指定比赛');
  if (q.playerSlot !== undefined)
    check(
      typeof q.playerSlot === 'string' && /^(?:[0-4]|12[89]|13[0-2])$/.test(q.playerSlot),
      '参赛槽位无效',
    );
  const individual =
    q.playerId !== undefined || q.accountId !== undefined || q.playerSlot !== undefined;
  return {
    matchId: q.matchId === undefined ? undefined : id(q.matchId),
    teamId: q.teamId === undefined ? undefined : id(q.teamId),
    playerId: q.playerId === undefined ? undefined : id(q.playerId),
    accountId: q.accountId === undefined ? undefined : id(q.accountId),
    playerSlot: q.playerSlot === undefined ? undefined : Number(q.playerSlot),
    heroId: !farming || q.heroId === undefined ? undefined : id(q.heroId),
    tag: q.tag === undefined ? undefined : stringValue(q.tag, '赛事标签', 100),
    side: choice(q.side, ['all', 'radiant', 'dire']),
    wardType: choice(q.wardType, ['both', 'obs', 'sen']),
    phase: choice(q.phase, ['all', 'early', 'mid', 'late']),
    roleScope: choice(q.roleScope ?? (individual ? 'all' : 'cores'), ['cores', 'all']),
  };
}
export function replayRoutes(
  db: DatabaseSync,
  client: OpenDotaClient,
  adapter: ReplayParserAdapter,
) {
  const r = Router();
  r.get('/replays/players', (_req, res) => res.json(replayPlayers(db)));
  r.get('/replays/players/:playerId/matches', (req, res) =>
    res.json(replayPlayerMatches(db, id(req.params.playerId))),
  );
  r.get('/replays/matches/:matchId/participants', (req, res) =>
    res.json(replayMatchParticipants(db, id(req.params.matchId))),
  );
  function state(matchId: number) {
    const row = db
      .prepare(
        `SELECT m.has_parsed,
      (SELECT COALESCE(SUM(json_array_length(obs_log_json)+json_array_length(sen_log_json)),0)
        FROM match_players WHERE match_id=m.match_id) wardCount
      FROM matches m WHERE m.match_id=? AND m.source='tournament'`,
      )
      .get(matchId);
    if (!row) throw new HttpError(404, '比赛不存在');
    return { matchId, hasParsed: !!row.has_parsed, wardCount: Number(row.wardCount) };
  }
  r.post('/matches/:matchId/request-parse', async (req, res) => {
    const matchId = id(req.params.matchId);
    if (state(matchId).hasParsed) {
      res.json({ matchId, jobId: null, status: 'already_parsed' });
      return;
    }
    res.json({ matchId, jobId: await client.requestParse(matchId), status: 'queued' });
  });
  r.get('/matches/:matchId/parse-status', async (req, res) => {
    const matchId = id(req.params.matchId),
      jobId = req.query.jobId;
    check(typeof jobId === 'string' && /^[\w-]{1,128}$/.test(jobId), '请提供有效的解析任务编号');
    let local = state(matchId);
    let status = local.hasParsed ? 'completed' : await client.parseStatus(jobId, matchId);
    if (!local.hasParsed && status === 'completed') {
      await importMatch(db, client, matchId, undefined, true);
      local = state(matchId);
      // 任务出队也可能是录像过期，必须核对重新抓取的比赛才能确认成功。
      if (!local.hasParsed) status = 'failed';
    }
    res.json({ ...local, status });
  });
  r.get('/replays/wards', async (req, res) =>
    res.json(await wardHeatmap(db, adapter, filters(req.query, false))),
  );
  r.get('/replays/farming', async (req, res) =>
    res.json(await farmingHeatmap(db, adapter, filters(req.query, true))),
  );
  return r;
}
