import express, { type ErrorRequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './db/index.ts';
import { rosterRoutes } from './routes/rosters.ts';
import { systemRoutes } from './routes/system.ts';
import { matchRoutes } from './routes/matches.ts';
import { backupRoutes } from './routes/backup.ts';
import { OpenDotaClient } from './services/opendota.ts';
import { HttpError } from './utils/input.ts';

export function createApp(
  db: DatabaseSync,
  port = 3001,
  client = new OpenDotaClient(db),
  production = process.env.NODE_ENV === 'production',
) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/backup/import', express.json({ limit: '64mb' }));
  app.use(express.json({ limit: '128kb' }));
  app.use(
    '/api',
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (
        ['POST', 'PUT'].includes(req.method) &&
        !/^\/(?:heroes|(?:players|teams)\/\d+)\/sync$/.test(req.path) &&
        (!req.body || Array.isArray(req.body) || typeof req.body !== 'object')
      )
        return next(new HttpError(400, '请提交 JSON 对象'));
      next();
    },
    systemRoutes(db, client, port),
    rosterRoutes(db, client),
    matchRoutes(db, client),
    backupRoutes(db),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  const dist = resolve(root, 'web/dist');
  if (production && existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  const onError: ErrorRequestHandler = (e, _req, res, _next) => {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    if (e.errcode === 2067) {
      res.status(409).json({ error: '该账号或位置已有记录' });
      return;
    }
    if (e.status === 400 || e.status === 413) {
      res.status(e.status).json({ error: '请求内容无效或过大' });
      return;
    }
    console.error('服务处理失败', e.code ?? e.name);
    res.status(500).json({ error: '服务处理失败，请重试' });
  };
  app.use(onError);
  return app;
}
