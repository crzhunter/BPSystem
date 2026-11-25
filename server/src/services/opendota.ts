import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { transaction } from '../db/index.ts';
import { upsertHeroes, type HeroData } from '../data/heroes.ts';
import { apiKey } from './settings.ts';
import { HttpError } from '../utils/input.ts';
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

interface Options {
  fetch?: typeof fetch;
  ttlMs?: number;
  retryMs?: number;
  freeLimit?: number;
  keyedLimit?: number;
  windowMs?: number;
}
export class OpenDotaClient {
  private db: DatabaseSync;
  private options: Options;
  private timestamps: number[] = [];
  private pending = new Map<string, Promise<unknown>>();
  constructor(db: DatabaseSync, options: Options = {}) {
    this.db = db;
    this.options = options;
  }

  private async reserve(keyed: boolean) {
    const limit = keyed ? (this.options.keyedLimit ?? 120) : (this.options.freeLimit ?? 50);
    const window = this.options.windowMs ?? 60000;
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => t > now - window);
      if (this.timestamps.length < limit) {
        this.timestamps.push(now);
        return;
      }
      await delay(Math.max(1, this.timestamps[0] + window - now));
    }
  }

  async get(path: string, ttlMs = this.options.ttlMs ?? 3600000): Promise<unknown> {
    const cached = this.db
      .prepare('SELECT payload_json FROM api_cache WHERE cache_key=? AND expires_at>?')
      .get(path, new Date().toISOString());
    if (cached) return JSON.parse(String(cached.payload_json));
    const active = this.pending.get(path);
    if (active) return active;
    // 相同资源合并请求，密钥不进入缓存键或错误日志。
    const request = this.request(path, ttlMs).finally(() => this.pending.delete(path));
    this.pending.set(path, request);
    return request;
  }
  private async request(path: string, ttlMs: number) {
    const url = new URL('https://api.opendota.com/api' + path);
    const key = apiKey(this.db);
    if (key) url.searchParams.set('api_key', key);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reserve(!!key);
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(15000) });
      } catch {
        throw new HttpError(502, '连接 OpenDota 超时或网络不可用');
      }
      if (response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new HttpError(502, 'OpenDota 返回了无效数据');
        }
        if (path === '/heroStats' && !validHeroes(payload))
          throw new HttpError(502, 'OpenDota 英雄资料格式异常');
        const now = new Date();
        this.db
          .prepare('INSERT OR REPLACE INTO api_cache VALUES (?,?,?,?)')
          .run(path, JSON.stringify(payload), new Date(+now + ttlMs).toISOString(), now.toISOString());
        return payload;
      }
      await response.body?.cancel();
      if (response.status === 403)
        throw new HttpError(502, 'OpenDota 拒绝访问，请检查接口密钥或稍后重试');
      if (response.status === 404) throw new OpenDotaNotFound();
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) break;
      const retry = response.headers.get('Retry-After');
      const wait =
        retry && /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : (this.options.retryMs ?? 400) * 2 ** attempt;
      if (wait > 60000) throw new HttpError(503, 'OpenDota 请求频繁，请稍后同步');
      await delay(wait);
    }
    throw new HttpError(502, 'OpenDota 暂时不可用，请稍后重试');
  }
  async syncPlayer(id: number) {
    const player = this.db.prepare('SELECT account_id FROM players WHERE id=?').get(id);
    if (!player) throw new HttpError(404, '选手不存在');
    const base = '/players/' + player.account_id;
    const read = async (path: string, hidden: unknown) => {
      try {
        return await this.get(base + path);
      } catch (error) {
        if (error instanceof OpenDotaNotFound) return hidden;
        throw error;
      }
    };
    const info = record(await read('', {}));
    const profile = info.profile == null ? null : record(info.profile);
    const heroes = rows(await read('/heroes', []));
    let matches;
    try {
      // 默认投影不含经济和分路，随同最近 50 场一起请求。
      const query = new URLSearchParams({ limit: '50' });
      for (const field of [
        'hero_id',
        'start_time',
        'kills',
        'deaths',
        'assists',
        'gold_per_min',
        'xp_per_min',
        'lane',
        'lane_role',
        'party_size',
        'leagueid',
      ])
        query.append('project', field);
      matches = rows(await this.get(base + '/matches?' + query));
    } catch (error) {
      if (!(error instanceof HttpError) || error.status === 503) throw error;
      matches = rows(await read('/recentMatches', []));
    }
    const now = new Date().toISOString();
    const playedHeroes = heroes.filter((h) => numberField(h.games) > 0);
    const privateProfile =
      !profile || !Object.keys(profile).length || (!playedHeroes.length && !matches.length);
    transaction(this.db, () => {
      // 网络等待期间可能已经换绑账号；旧账号数据不能写入新选手档案。
      if (
        this.db.prepare('SELECT account_id FROM players WHERE id=?').get(id)?.account_id !==
        player.account_id
      )
        throw new HttpError(409, '选手账号已变更，请重新同步');
      this.db
        .prepare(
          `UPDATE players SET steam_name=COALESCE(?,steam_name),avatar_url=COALESCE(?,avatar_url),
        is_profile_private=?,last_synced_at=?,updated_at=? WHERE id=?`,
        )
        .run(
          textField(profile?.personaname),
          textField(profile?.avatarfull ?? profile?.avatarmedium ?? profile?.avatar),
          Number(privateProfile),
          now,
          now,
          id,
        );
      if (heroes.length) this.db.prepare('DELETE FROM player_pub_heroes WHERE player_id=?').run(id);
      const heroInsert = this.db.prepare('INSERT INTO player_pub_heroes VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const h of heroes) {
        const games = numberField(h.games),
          wins = numberField(h.win);
        upstream(wins <= games);
        heroInsert.run(
          id,
          numberField(h.hero_id, 1),
          games,
          wins,
          optionalNumber(h.last_played),
          numberField(h.with_games ?? 0),
          numberField(h.with_win ?? 0),
          numberField(h.against_games ?? 0),
          numberField(h.against_win ?? 0),
          now,
        );
      }
      const matchInsert = this.db.prepare(
        'INSERT OR REPLACE INTO player_pub_matches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      for (const m of matches.slice(0, 50)) {
        if (Number(m.leagueid) > 0) continue;
        const f = faction(m.player_slot);
        matchInsert.run(
          id,
          numberField(m.match_id, 1),
          numberField(m.hero_id, 1),
          f.slot,
          f.side,
          f.radiant,
          Number(f.radiant === bit(m.radiant_win)),
          numberField(m.start_time),
          ...[
            m.duration,
            m.kills,
            m.deaths,
            m.assists,
            m.gold_per_min,
            m.xp_per_min,
            m.lane,
            m.lane_role,
            m.game_mode,
            m.lobby_type,
            m.party_size,
          ].map(optionalNumber),
        );
      }
    });
  }
  async syncHeroes() {
    const data = await this.get('/heroStats');
    if (!validHeroes(data)) throw new HttpError(502, 'OpenDota 英雄资料格式异常');
    transaction(this.db, () => upsertHeroes(this.db, data));
    return {
      synced: data.length,
      heroCount: Number(this.db.prepare('SELECT COUNT(*) AS n FROM heroes').get()?.n),
    };
  }
}
class OpenDotaNotFound extends HttpError {
  constructor() {
    super(502, 'OpenDota 未找到该记录');
  }
}
function validHeroes(data: unknown): data is HeroData[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every(
      (h) =>
        h &&
        Number.isSafeInteger(h.id) &&
        h.id > 0 &&
        typeof h.name === 'string' &&
        typeof h.localized_name === 'string' &&
        ['primary_attr', 'attack_type', 'img', 'icon'].every(
          (k) => h[k] == null || typeof h[k] === 'string',
        ) &&
        (h.roles == null ||
          (Array.isArray(h.roles) && h.roles.every((r: unknown) => typeof r === 'string'))),
    )
  );
}
