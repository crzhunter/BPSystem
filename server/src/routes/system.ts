import { Router } from 'express';
import { listHeroes, listItems } from '../data/catalog.ts';
import { hostname, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { check, integer, stringValue } from '../utils/input.ts';
import { readSettings } from '../services/settings.ts';
import type { OpenDotaClient } from '../services/opendota.ts';

export function lanUrls(interfaces: ReturnType<typeof networkInterfaces>, port: number) {
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter(
        (ip) =>
          !ip.internal && ip.family === 'IPv4' && !/^(169\.254|198\.1[89])\./.test(ip.address),
      )
      .map((ip) => {
        const address = ip.address;
        const range = address.startsWith('192.168.')
          ? 0
          : address.startsWith('10.')
            ? 1
            : /^172\.(1[6-9]|2\d|3[01])\./.test(address)
              ? 2
              : 3;
        const wifi = /wi-?fi|wireless|wlan|无线/i.test(name);
        return { address, priority: range + (wifi && range < 3 ? -3 : 0) };
      }),
  );
  addresses.sort((a, b) => a.priority - b.priority);
  return [...new Set(addresses.map((ip) => 'http://' + ip.address + ':' + port))];
}

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
    res.json({ port, lanUrls: lanUrls(networkInterfaces(), port), hostname: hostname() });
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
    res.json(
      listHeroes(db).filter((h) =>
        [h.name, h.localizedName, h.cnName, ...h.aliases].some((s) =>
          String(s).toLowerCase().includes(q),
        ),
      ),
    );
  });
  r.get('/items', (_req, res) => res.json(listItems(db)));
  r.post('/constants/sync', async (_req, res) => res.json(await client.syncConstants()));
  r.post('/heroes/sync', async (_req, res) => res.json(await client.syncHeroes()));
  return r;
}
