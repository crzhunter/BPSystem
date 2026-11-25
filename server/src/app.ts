import express, { type ErrorRequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { root } from './db/index.ts';
import { rosterRoutes } from './routes/rosters.ts';
import { systemRoutes } from './routes/system.ts';
import { matchRoutes } from './routes/matches.ts';
import { replayRoutes } from './routes/replays.ts';
import { OpenDotaReplayAdapter, type ReplayParserAdapter } from './services/replayAdapter.ts';
import { backupRoutes } from './routes/backup.ts';
import { bpRoutes } from './routes/bp.ts';
import { OpenDotaClient } from './services/opendota.ts';
import { HttpError } from './utils/input.ts';

export function createApp(
  db: DatabaseSync,
  port = 3001,
  client = new OpenDotaClient(db),
  production = process.env.NODE_ENV === 'production',
  replayAdapter: ReplayParserAdapter = new OpenDotaReplayAdapter(db),
  dist = resolve(root, 'web/dist'),
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
        (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') &&
        !(
          req.body === undefined &&
          /^\/(?:(?:constants|heroes(?:\/matchups)?|(?:players|teams)\/\d+)\/sync|players\/resync-patch|bp\/sessions\/\d+\/(?:undo|reset)|matches\/\d+\/request-parse)$/.test(
            req.path,
          )
        )
      )
        return next(new HttpError(400, '请提交 JSON 对象'));
      next();
    },
    systemRoutes(db, client, port),
    rosterRoutes(db, client),
    matchRoutes(db, client),
    replayRoutes(db, client, replayAdapter),
    bpRoutes(db, client),
    backupRoutes(db),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  if (production && existsSync(resolve(dist, 'index.html'))) {
    const noStore = 'no-store, no-cache, must-revalidate';
    app.use(
      express.static(dist, {
        setHeaders(res, path) {
          const file = relative(dist, path).split(sep).join('/');
          // 入口随部署切换；只有 Vite 文件名带内容哈希的资源可长期复用。
          let policy = 'no-cache';
          if (file === 'index.html' || file === 'sw.js') policy = noStore;
          else if (/^assets\/[^/]+-[\w-]{8}\.\w+$/.test(file)) policy = 'public, max-age=31536000, immutable';
          res.setHeader('Cache-Control', policy);
        },
      }),
    );
    app.get('/{*path}', (_req, res) =>
      res.sendFile('index.html', { root: dist, headers: { 'Cache-Control': noStore } }),
    );
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
