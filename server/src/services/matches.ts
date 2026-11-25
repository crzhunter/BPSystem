import type { DatabaseSync } from 'node:sqlite';
import { listItems } from '../data/catalog.ts';
import { transaction } from '../db/index.ts';
import { HttpError, check } from '../utils/input.ts';
import type { OpenDotaClient } from './opendota.ts';
import {
  bit,
  faction,
  numberField,
  optionalNumber,
  record,
  rows,
  textField,
  upstream,
} from './odFields.ts';

export function matchIds(input: unknown) {
  const entries = Array.isArray(input) ? input : [input];
  const tokens = entries.flatMap((entry) => {
    check(typeof entry === 'string' || typeof entry === 'number', '请输入比赛 ID 或比赛链接');
    return String(entry)
      .trim()
      .split(/[\s,，;；]+/)
      .filter(Boolean);
  });
  check(tokens.length > 0, '请输入至少一个比赛 ID');
  return [
    ...new Set(
      tokens.map((token) => {
        const link = token.match(
          /^(?:https?:\/\/)?(?:(?:www|cn|zh)\.)?(?:opendota|dotabuff)\.com\/matches\/(\d+)(?:[/?#][^\s]*)?$/i,
        );
        const digits = link?.[1] ?? token;
        const id = Number(digits);
        return /^\d+$/.test(digits) && Number.isSafeInteger(id) && id > 0 ? id : token;
      }),
    ),
  ];
}

const participantJoin = ' FROM match_players mp LEFT JOIN players p ON p.account_id=mp.account_id ';
const summary = `SELECT m.match_id AS matchId,m.tag,m.patch,m.start_time AS startTime,m.duration,
  m.radiant_win AS radiantWin,m.has_parsed AS hasParsed,m.imported_at AS importedAt,
  m.radiant_name AS radiantName,m.dire_name AS direName,
  (SELECT count(*) FROM match_players WHERE match_id=m.match_id) AS playersCount,
  (SELECT count(distinct side) FROM match_players WHERE match_id=m.match_id) AS teamsCount,
  (SELECT count(p.id) ${participantJoin} WHERE mp.match_id=m.match_id) AS linkedPlayersCount,
  (SELECT json_group_array(json_object('orderIndex',order_index,'heroId',hero_id,'side',side,'isPick',is_pick)
    ORDER BY order_index) FROM match_picks_bans WHERE match_id=m.match_id) AS preview
  FROM matches m WHERE m.source='tournament'`;

export function listMatches(db: DatabaseSync, tag: string, q: string) {
  return db
    .prepare(
      summary +
        ` AND (?='' OR m.tag=?) AND
    (instr(CAST(m.match_id AS TEXT),?) OR instr(lower(m.tag),lower(?))
     OR instr(lower(COALESCE(m.radiant_name,'') || ' ' || COALESCE(m.dire_name,'')),lower(?))
     OR EXISTS(SELECT 1 ${participantJoin} WHERE mp.match_id=m.match_id AND
       instr(lower(COALESCE(p.nickname,'') || ' ' || COALESCE(mp.personaname,'') || ' ' || COALESCE(mp.account_id,'')), lower(?))))
    ORDER BY m.start_time DESC,m.match_id DESC`,
    )
    .all(tag, tag, q, q, q, q)
    .map(({ preview, ...m }) => ({
      ...m,
      hasParsed: !!m.hasParsed,
      picksBans: JSON.parse(String(preview)),
    }));
}
export function matchDetail(db: DatabaseSync, id: string) {
  const m = db.prepare(summary + ' AND m.match_id=?').get(id);
  if (!m) throw new HttpError(404, '比赛不存在');
  const { preview, ...metadata } = m;
  const players = db
    .prepare(
      `SELECT mp.*,p.id AS linkedPlayerId,p.nickname AS linkedNickname
    ${participantJoin} WHERE mp.match_id=? ORDER BY mp.player_slot`,
    )
    .all(id);
  const items = new Map(listItems(db).map((i) => [i.id, i]));
  const picksBans = db
    .prepare(
      `SELECT order_index AS orderIndex,is_pick AS isPick,hero_id AS heroId,
    side,is_first_pick_team AS isFirstPickTeam FROM match_picks_bans WHERE match_id=? ORDER BY order_index`,
    )
    .all(id);
  const count = (key: string) =>
    players.reduce((sum, p) => sum + JSON.parse(String(p[key])).length, 0);
  return {
    ...metadata,
    hasParsed: !!m.hasParsed,
    players: players.map((p) => ({
      ...p,
      items: (JSON.parse(String(p.items_json)) as number[]).map((id) =>
        id ? (items.get(id) ?? { id, cnName: '未收录物品', imgUrl: null }) : null,
      ),
    })),
    picksBans,
    telemetry: {
      obsCount: count('obs_log_json'),
      senCount: count('sen_log_json'),
      hasParsed: !!m.hasParsed,
    },
  };
}

export async function importMatch(
  db: DatabaseSync,
  client: OpenDotaClient,
  id: number,
  tag?: string,
  refreshParsed = false,
) {
  const m = record(await client.get('/matches/' + id, undefined, refreshParsed));
  upstream(numberField(m.match_id) === id);
  const players = rows(m.players),
    draft = rows(m.picks_bans ?? [])
      .map((d) => ({
        order: numberField(d.order),
        hero: numberField(d.hero_id, 1),
        pick: bit(d.is_pick),
        side: bit(d.team) === 0 ? 'radiant' : 'dire',
      }))
      .sort((a, b) => a.order - b.order);
  // 上游缺失玩家时保留上次的完整记分板。
  upstream(
    players.length === 10 &&
      players.every((p) =>
        [0, 1, 2, 3, 4, 128, 129, 130, 131, 132].includes(numberField(p.player_slot)),
      ) &&
      new Set(players.map((p) => Number(p.player_slot))).size === 10,
  );
  const flag = m.od_data && record(m.od_data).has_parsed;
  const hasParsed =
    flag === true ||
    flag === 1 ||
    (typeof m.version === 'number' && m.version > 0) ||
    players.some(
      (p) =>
        (Array.isArray(p.obs_log) && p.obs_log.length > 0) ||
        (Array.isArray(p.sen_log) && p.sen_log.length > 0) ||
        (p.lane_pos != null && Object.keys(record(p.lane_pos)).length > 0),
    );
  const picks = draft.filter((d) => d.pick);
  const first = picks[0]?.side;
  return transaction(db, () => {
    const old = db.prepare('SELECT tag,has_parsed FROM matches WHERE match_id=?').get(id);
    const linkedCount = () =>
      Number(
        db.prepare('SELECT count(p.id) AS n ' + participantJoin + ' WHERE mp.match_id=?').get(id)
          ?.n,
      );
    // 轮询期间删除的比赛不能被回填复活；较早发出的未解析响应也不能覆盖已解析记录。
    if (refreshParsed && !old) throw new HttpError(404, '比赛已删除');
    if (!hasParsed && (old?.has_parsed || refreshParsed)) {
      if (tag !== undefined) db.prepare('UPDATE matches SET tag=? WHERE match_id=?').run(tag, id);
      return {
        matchId: id,
        imported: false,
        updated: true,
        hasParsed: !!old?.has_parsed,
        linkedPlayersCount: linkedCount(),
      };
    }
    const teamName = (value: unknown) => (value ? textField(record(value).name) : null);
    db.prepare(
      `INSERT INTO matches(match_id,source,tag,patch,start_time,duration,radiant_win,has_parsed,
      radiant_name,dire_name,imported_at) VALUES(?,'tournament',?,?,?,?,?,?,?,?,?)
      ON CONFLICT(match_id) DO UPDATE SET source=excluded.source,tag=excluded.tag,patch=excluded.patch,
      start_time=excluded.start_time,duration=excluded.duration,radiant_win=excluded.radiant_win,
      has_parsed=excluded.has_parsed,radiant_name=excluded.radiant_name,dire_name=excluded.dire_name,
      imported_at=excluded.imported_at`,
    ).run(
      id,
      tag ?? old?.tag ?? '',
      m.patch == null ? null : String(m.patch),
      optionalNumber(m.start_time),
      optionalNumber(m.duration),
      bit(m.radiant_win),
      Number(hasParsed),
      teamName(m.radiant_team) ?? textField(m.radiant_name),
      teamName(m.dire_team) ?? textField(m.dire_name),
      new Date().toISOString(),
    );
    db.prepare('DELETE FROM match_players WHERE match_id=?').run(id);
    db.prepare('DELETE FROM match_picks_bans WHERE match_id=?').run(id);
    const add =
      db.prepare(`INSERT INTO match_players(match_id,player_slot,side,is_radiant,account_id,
      personaname,hero_id,kills,deaths,assists,gpm,xpm,hero_damage,tower_damage,last_hits,lane,lane_role,
      draft_order,pick_order,items_json,obs_log_json,sen_log_json,lane_pos_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const p of players) {
      const f = faction(p.player_slot),
        hero = numberField(p.hero_id, 1);
      const index = picks.findIndex((d) => d.side === f.side && d.hero === hero);
      const account = optionalNumber(p.account_id);
      upstream(
        (p.obs_log == null || Array.isArray(p.obs_log)) &&
          (p.sen_log == null || Array.isArray(p.sen_log)),
      );
      const lanePosition = p.lane_pos == null ? {} : record(p.lane_pos);
      const items = Array.from({ length: 6 }, (_, i) => optionalNumber(p['item_' + i]) ?? 0);
      add.run(
        id,
        f.slot,
        f.side,
        f.radiant,
        account && account < 4294967295 ? account : null,
        textField(p.personaname ?? p.name),
        hero,
        ...[
          p.kills,
          p.deaths,
          p.assists,
          p.gold_per_min,
          p.xp_per_min,
          p.hero_damage,
          p.tower_damage,
          p.last_hits,
          p.lane,
          p.lane_role,
        ].map(optionalNumber),
        optionalNumber(p.draft_order) ?? picks[index]?.order ?? null,
        optionalNumber(p.pick_order) ?? (index < 0 ? null : index + 1),
        JSON.stringify(items),
        JSON.stringify(p.obs_log ?? []),
        JSON.stringify(p.sen_log ?? []),
        JSON.stringify(lanePosition),
      );
    }
    const action = db.prepare(
      'INSERT INTO match_picks_bans(match_id,order_index,is_pick,hero_id,side,is_first_pick_team) VALUES(?,?,?,?,?,?)',
    );
    for (const d of draft)
      action.run(
        id,
        d.order,
        d.pick,
        d.hero,
        d.side,
        first == null ? null : Number(d.side === first),
      );
    return {
      matchId: id,
      imported: !old,
      updated: !!old,
      hasParsed,
      linkedPlayersCount: linkedCount(),
    };
  });
}
