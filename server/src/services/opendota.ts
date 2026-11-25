import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { transaction } from '../db/index.ts';
import { upsertHeroes, type HeroData } from '../data/heroes.ts';
import { apiKey } from './settings.ts';
import { HttpError } from '../utils/input.ts';

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
