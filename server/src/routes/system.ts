import { Router } from 'express';
import { hostname, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { check, integer, stringValue } from '../utils/input.ts';
import { readSettings } from '../services/settings.ts';
import type { OpenDotaClient } from '../services/opendota.ts';

export function systemRoutes(db: DatabaseSync, client: OpenDotaClient, port: number) {
  const r = Router();
  r.get('/health', (_req, res) =>
    res.json({
      ok: true,
      db: 'ok',
      heroCount: db.prepare('SELECT count(*) n FROM heroes').get()?.n,
      timestamp: new Date().toISOString(),
    }),
  );
  r.get('/system/network', (_req, res) => {
    const urls = Object.values(networkInterfaces())
      .flat()
      .filter((ip) => ip && !ip.internal && ip.family === 'IPv4')
      .map((ip) => 'http://' + ip!.address + ':' + port);
    res.json({ port, lanUrls: [...new Set(urls)], hostname: hostname() });
  });
  r.get('/settings', (_req, res) => res.json(readSettings(db)));
  r.put('/settings', (req, res) => {
    const { opendotaApiKey, tournamentMatchWeight, pubRecentDays } = req.body;
    transaction(db, () => {
      const set = db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?,?)');
      const now = new Date().toISOString();
      if (opendotaApiKey !== undefined)
        set.run('opendota_api_key', stringValue(opendotaApiKey, '接口密钥', 512), now);
      if (tournamentMatchWeight !== undefined) {
        check(
          typeof tournamentMatchWeight === 'number' &&
            Number.isFinite(tournamentMatchWeight) &&
            tournamentMatchWeight >= 0 &&
            tournamentMatchWeight <= 100,
          '赛事权重须在 0 至 100 之间',
        );
        set.run('tournament_match_weight', String(tournamentMatchWeight), now);
      }
      if (pubRecentDays !== undefined)
        set.run('pub_recent_days', String(integer(pubRecentDays, 1, 365, '天梯统计天数')), now);
    });
    res.json(readSettings(db));
  });
  r.get('/heroes', (req, res) => {
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const rows = db
      .prepare(
        'SELECT id,name,localized_name,cn_name,aliases_json,img,icon,primary_attr,attack_type,roles_json FROM heroes ORDER BY id',
      )
      .all();
    res.json(
      rows
        .map((h) => ({
          id: h.id,
          name: h.name,
          localizedName: h.localized_name,
          cnName: h.cn_name,
          aliases: JSON.parse(String(h.aliases_json)),
          img: h.img,
          icon: h.icon,
          primaryAttr: h.primary_attr,
          attackType: h.attack_type,
          roles: JSON.parse(String(h.roles_json)),
        }))
        .filter((h) =>
          [h.name, h.localizedName, h.cnName, ...h.aliases].some((s) =>
            String(s).toLowerCase().includes(q),
          ),
        ),
    );
  });
  r.post('/heroes/sync', async (_req, res) => res.json(await client.syncHeroes()));
  return r;
}
