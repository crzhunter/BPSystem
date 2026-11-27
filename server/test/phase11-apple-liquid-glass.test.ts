import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { blank, initialRoom, seedDefaultTeams, setupKey } from '../../web/src/draftModel.ts';
import { lensGeometry, lensPixel } from '../../web/src/glassMath.ts';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test('迁移仅保留阵容，连续刷新总是从第一手开始', () => {
  const store = storage();
  store.setItem('bp-prep-v1', '{损坏');
  store.setItem(
    'bp-live-v3',
    JSON.stringify({
      ...blank(),
      id: 50,
      revision: 3,
      title: '旧局',
      notes: '笔记',
      cmOrderVersion: 'classic',
      radiantTeamId: 2,
      ourSide: 'dire',
      radiantPlayerIds: [3, 4, 5, 6, 7],
      actions: [{ heroId: 42 }],
    }),
  );
  for (let i = 0; i < 2; i++) {
    const room = initialRoom(store);
    assert.deepEqual(room.actions, []);
    assert.equal(room.id, undefined);
    assert.equal(room.revision, undefined);
    assert.equal(room.cmOrderVersion, '7.42-standard');
    assert.equal(room.radiantTeamId, 2);
    assert.equal(room.ourSide, 'dire');
    assert.deepEqual(room.radiantPlayerIds, [3, 4, 5, 6, 7]);
    assert.equal(room.instant, true);
    assert.equal(room.notes, '');
    assert.equal(store.getItem('bp-live-v3'), null);
    assert.equal(store.getItem('bp-prep-v1'), null);
    assert.deepEqual(
      Object.keys(JSON.parse(store.getItem(setupKey)!)).sort(),
      [
        'ourSide',
        'firstPickSide',
        'radiantTeamId',
        'direTeamId',
        'radiantPlayerIds',
        'direPlayerIds',
        'instant',
      ].sort(),
    );
  }
});

test('v1 的槽位、v4 关闭直锁及新版本优先顺序', () => {
  const store = storage();
  store.setItem(
    'bp-prep-v1',
    JSON.stringify({ our: 'dire', first: 'dire', radiant: { team: 1, slots: [7, 0, 0, 0, 0] } }),
  );
  store.setItem(setupKey, JSON.stringify({ firstPickSide: 'radiant', instant: false }));
  const room = initialRoom(store);
  assert.deepEqual(room.radiantPlayerIds, [7, null, null, null, null]);
  assert.equal(room.firstPickSide, 'radiant');
  assert.equal(room.ourSide, 'dire');
  assert.equal(room.instant, false);
});

test('按首发位置装填两队，仅空白盘面应用并过滤重复选手', () => {
  const teams = [0, 1].map((i) => ({
    id: i + 10,
    roster: [5, 4, 3, 2, 1].map((slot) => ({ slot, player: { id: slot + i * 5 } })),
  }));
  const empty = blank();
  const room = seedDefaultTeams(empty, teams);
  assert.equal(room.radiantTeamId, 10);
  assert.equal(room.direTeamId, 11);
  assert.deepEqual(room.radiantPlayerIds, [1, 2, 3, 4, 5]);
  assert.deepEqual(room.direPlayerIds, [6, 7, 8, 9, 10]);
  assert.deepEqual(room.actions, []);
  assert.equal(seedDefaultTeams(room, teams), room);
  assert.deepEqual(seedDefaultTeams(empty, teams.slice(0, 1)).direPlayerIds, Array(5).fill(null));
  teams[1].roster[0].player.id = 1;
  assert.deepEqual(seedDefaultTeams(empty, teams).direPlayerIds, [6, 7, 8, 9, null]);
  const started = { ...empty, actions: [{ heroId: 1, roleHint: null, assignedPlayerId: null }] };
  assert.equal(seedDefaultTeams(started, teams), started);
  assert.equal(empty.radiantTeamId, null);
});

test('Snell 位移中心和外部中性，直边和两端圆角向内采样', () => {
  const g = lensGeometry(100, 60, 24, 26);
  assert.equal(g.bezel, 26);
  assert.deepEqual(lensPixel(g, 50, 30), [128, 128, 255, 255]);
  assert.deepEqual(lensPixel(g, 0, 0), [128, 128, 0, 255]);
  const [rx, gy, height] = lensPixel(g, 8, 8);
  assert.ok(rx > 128 && gy > 128 && height > 0 && height < 255);
  const mirrored = lensPixel(g, 91, 51);
  assert.equal(rx + mirrored[0], 256);
  assert.equal(gy + mirrored[1], 256);
  assert.ok(lensPixel(g, 0, 30)[0] > lensPixel(g, 7, 30)[0]);
  assert.equal(lensPixel(g, 0, 30)[1], 128);
  const wide = lensGeometry(680, 420, 32, 38);
  assert.equal(wide.bezel, 38);
  assert.equal(lensGeometry(100, 24, 12, 14).bezel, 10);
  let previous = 255;
  for (let i = 0; i < 38; i++) {
    const [, top, height] = lensPixel(wide, 340, i);
    assert.ok(top <= previous && height < 255);
    assert.equal(lensPixel(wide, i, 210)[0], top);
    assert.equal(lensPixel(wide, 679 - i, 210)[0], 256 - top);
    assert.equal(lensPixel(wide, 340, 419 - i)[1], 256 - top);
    previous = top;
  }
  assert.ok(lensPixel(wide, 340, 19)[1] > 150);
  assert.deepEqual(lensPixel(wide, 340, 38), [128, 128, 255, 255]);
});

test('Service Worker 使用 Phase 11 缓存壳', () => {
  assert.match(
    readFileSync(new URL('../../web/sw.js', import.meta.url), 'utf8'),
    /prefix \+ 'v7-__BUILD_ID__'/,
  );
});
