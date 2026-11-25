import { createApp } from './app.ts';
import { openDb } from './db/index.ts';
const port = Number(process.env.PORT || 3001);
const db = openDb();
const production = !import.meta.filename.endsWith('.ts') || process.env.NODE_ENV === 'production';
const server = createApp(db, port, undefined, production).listen(port, '0.0.0.0', () =>
  console.log('BPSystem 服务已启动，端口', port),
);
function stop() {
  server.close(() => db.close());
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
