import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/db/index.ts';
test('迁移可重入，保留已有数据和版本，启用外键', (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const name of [
    'schema_migrations',
    'settings',
    'players',
    'teams',
    'team_members',
    'heroes',
    'api_cache',
    'draft_sessions',
    'draft_actions',
    'matches',
    'match_players',
    'match_picks_bans',
    'hero_matchups',
  ])
    assert.ok(tables.includes(name), name);
  assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  db.exec("UPDATE heroes SET cn_name='保留名称' WHERE id=1");
  migrate(db);
  assert.equal(db.prepare('SELECT cn_name FROM heroes WHERE id=1').get()?.cn_name, '保留名称');
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 1);
});
test('我方、先选方可独立设置，禁选顺序与槽位均受约束', (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  db.exec("INSERT INTO draft_sessions(created_at,updated_at) VALUES ('a','a')");
  const session = db.prepare('SELECT * FROM draft_sessions').get()!;
  assert.equal(session.first_pick_side, 'radiant');
  assert.equal(session.our_side, 'radiant');
  assert.equal(session.cm_order_version, '7.3x-standard');
  assert.equal(session.patch, '7.3x');
  db.exec("UPDATE draft_sessions SET our_side='dire',first_pick_side='radiant'");
  for (const col of ['our_side', 'first_pick_side'])
    assert.throws(() => db.exec('UPDATE draft_sessions SET ' + col + "='first'"), /CHECK/);
  const insert = db.prepare(
    "INSERT INTO draft_actions(session_id,step_index,phase,action_type,side,is_first_pick_team,role_hint,created_at) VALUES (1,?,?,?,?,?,?,'a')",
  );
  for (const args of [
    [0, 1, 'ban', 'dire', 0, null],
    [25, 1, 'ban', 'dire', 0, null],
    [1, 4, 'ban', 'dire', 0, null],
    [1, 1, 'swap', 'dire', 0, null],
    [1, 1, 'ban', 'first', 1, null],
    [1, 1, 'ban', 'dire', 2, null],
    [1, 1, 'pick', 'dire', 0, 6],
  ])
    assert.throws(() => insert.run(...args), /CHECK/);
  insert.run(24, 3, 'pick', 'dire', 0, 5);
  assert.throws(() => insert.run(24, 3, 'pick', 'radiant', 1, 1), /UNIQUE/);
  db.exec('DELETE FROM draft_sessions');
  assert.equal(db.prepare('SELECT count(*) n FROM draft_actions').get()?.n, 0);
});
test('比赛保留阵营、选取次序、未知先选方和空账号', (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  db.exec("INSERT INTO matches(match_id,imported_at) VALUES(1,'a')");
  const insert = db.prepare(
    'INSERT INTO match_players(match_id,player_slot,hero_id,side,is_radiant,draft_order,pick_order) VALUES (1,128,1,?,?,3,1)',
  );
  assert.throws(() => insert.run('first', 0), /CHECK/);
  assert.throws(() => insert.run('dire', 2), /CHECK/);
  insert.run('dire', 0);
  assert.throws(() => insert.run('dire', 0), /UNIQUE/);
  const p = db.prepare('SELECT * FROM match_players').get()!;
  assert.equal(p.draft_order, 3);
  assert.equal(p.pick_order, 1);
  assert.equal(p.account_id, null);
  assert.equal(p.lane_pos_json, '{}');
  const ban = db.prepare(
    'INSERT INTO match_picks_bans(match_id,order_index,is_pick,hero_id,side,is_first_pick_team) VALUES(1,0,?,1,?,?)',
  );
  assert.throws(() => ban.run(2, 'dire', null), /CHECK/);
  assert.throws(() => ban.run(1, 'dire', 2), /CHECK/);
  ban.run(0, 'dire', null);
  db.exec('DELETE FROM matches');
  for (const table of ['match_players', 'match_picks_bans'])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ' + table).get()?.n, 0);
});
