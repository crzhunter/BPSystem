import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db/index.ts';

const db = openDb(':memory:');
const server = createApp(db, 0, undefined, true).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const pages = ['draft', 'teams', 'players', 'matches', 'replays'];
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let browser;
try {
  assert.ok(
    existsSync(new URL('../../../web/dist/index.html', import.meta.url)),
    '请先运行 npm run build',
  );
  async function post(path, body) {
    const r = await fetch(origin + '/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(r.ok);
    return r.json();
  }
  const player = await post('players', {
    accountId: 55,
    nickname: '选手甲',
    alias: '队长',
    rankTier: 80,
    leaderboardRank: 120,
  });
  await post('teams', { name: '青岩', members: [{ slot: 1, playerId: player.id }] });
  db.exec(
    "INSERT INTO matches(match_id,tag,has_parsed,radiant_win,imported_at) VALUES(12345678,'训练赛',1,1,'a')",
  );
  const add =
    db.prepare(`INSERT INTO match_players(match_id,player_slot,side,is_radiant,account_id,hero_id,items_json,item_neutral,obs_log_json,lane_pos_json)
    VALUES(12345678,?,?,?,?,?,'[1,2,0,0,0,0]',3,'[{"x":110,"y":120,"time":90}]','{"120":{"130":4}}')`);
  for (let i = 0; i < 10; i++)
    add.run(i < 5 ? i : 123 + i, i < 5 ? 'radiant' : 'dire', Number(i < 5), 55 + i, i + 1);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BP_BROWSER_PATH || (existsSync(edge) ? edge : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(8000);
  await page.goto(origin + '/#draft');
  const compact = page.locator('.compact-row').first();
  await compact.waitFor();
  assert.equal(await page.locator('.pool-tile').count(), 127);
  assert.deepEqual(await page.locator('.attr-group h3 small').allTextContents(), [
    '36',
    '34',
    '34',
    '23',
  ]);
  assert.equal(await page.locator('.faction header h2 strong').count(), 0);
  async function rects() {
    return page.locator('.site-bar,.desktop-island,.desktop-island a').evaluateAll((nodes) =>
      nodes.map((e) => {
        const { x, y, width, height } = e.getBoundingClientRect();
        return [x, y, width, height];
      }),
    );
  }
  const before = await rects();
  const pool = await page.locator('.pool-quads').boundingBox();
  assert.ok(pool.y + pool.height <= 1080, '四组英雄首屏底边 ' + (pool.y + pool.height));
  // 从实际浏览器截图读取两面板间的像素，截图仅驻留内存。
  const panels = await page.locator('.bp-bench').evaluate((el) => {
    const l = el.querySelector('.pool-column').getBoundingClientRect(),
      r = el.querySelector('aside').getBoundingClientRect();
    return [Math.floor((l.right + r.left) / 2), Math.ceil(l.top + 10)];
  });
  const png = (await page.screenshot()).toString('base64');
  const pixel = await page.evaluate(
    async ({ png, panels }) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + png;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      return [...ctx.getImageData(...panels, 1, 1).data].slice(0, 3);
    },
    { png, panels },
  );
  assert.ok(
    pixel.every((v, i) => v >= [22, 30, 42][i]),
    '岩板间隙 ' + pixel,
  );
  for (const pageId of pages.slice(1).concat('draft')) {
    await page.locator('.desktop-island a[href="#' + pageId + '"]').click();
    await page.waitForFunction(
      (id) =>
        document.querySelector('.desktop-island [aria-current]')?.getAttribute('href') === '#' + id,
      pageId,
    );
    await page
      .locator('.studio-header h1')
      .filter({
        hasText: {
          draft: 'BP 对局室',
          teams: '战队设置',
          players: '选手设置',
          matches: '比赛导入',
          replays: '回放复盘',
        }[pageId],
      })
      .waitFor();
    if (pageId === 'players') {
      await page.getByRole('heading', { name: '手动英雄池', exact: true }).waitFor();
      assert.match(await page.locator('.rank-medal').innerText(), /冠绝一世\s*#120/);
    }
    assert.deepEqual(await rects(), before, pageId + ' 导航偏移');
  }
  await compact.waitFor();
  const rows = page.locator('.compact-row'),
    taken = page.locator('.pool-tile:disabled');
  await page.locator('.decision-lead').first().dblclick();
  assert.equal(await taken.count(), 0);
  for (let i = 0; i < 7; i++) {
    const row = rows.nth(i);
    await row.locator('.compact-summary').click();
    await row.getByText('分项贡献', { exact: true }).waitFor();
    assert.equal(await taken.count(), 0);
    await row.locator('.compact-summary').dblclick();
    assert.equal(await taken.count(), 0);
  }
  await rows.nth(0).locator('.compact-head .card-lock').click();
  await taken.first().waitFor();
  assert.equal(await taken.count(), 1);
  const tile = page.locator('.pool-tile:enabled').first();
  await tile.dblclick();
  assert.equal(await taken.count(), 1);
  await page.locator('.bp-pool .staged-preview .satin-btn').click();
  assert.equal(await taken.count(), 2);
  await tile.click();
  await tile.press('Enter');
  assert.equal(await taken.count(), 3);
  await page.getByTitle('撤销（Ctrl+Z）').click();
  await page.locator('.desktop-island a[href="#players"]').click();
  await page.getByRole('heading', { name: '选手设置', exact: true }).waitFor();
  await page.locator('.desktop-island a[href="#draft"]').click();
  await page.locator('.ban-slot.filled').first().waitFor();
  assert.equal(await taken.count(), 2);
  await page.locator('.ban-slot.filled').first().click();
  await tile.click();
  assert.equal(await taken.count(), 2);
  await page
    .locator('.bp-pool')
    .getByRole('button', { name: /确认替换为/ })
    .click();
  assert.equal(await taken.count(), 2);
  await rows.nth(0).locator('.compact-summary').click();
  await rows.nth(1).locator('.compact-summary').click();
  await rows.nth(1).getByText('分项贡献', { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.scrollHeight - innerHeight >= 500);
  await page.evaluate(() => window.scrollTo(0, 500));
  assert.ok((await page.evaluate(() => scrollY)) >= 400);
  assert.equal((await rects())[0][1], 0);
  await page.goto(origin + '/#settings');
  await page.getByRole('dialog', { name: '系统维护与备份' }).waitFor();
  assert.equal(new URL(page.url()).hash, '#matches');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  for (const pageId of pages) {
    await page.locator('.mobile-island a[href="#' + pageId + '"]').click();
    await page.waitForFunction(
      (id) =>
        document.querySelector('.mobile-island [aria-current]')?.getAttribute('href') === '#' + id,
      pageId,
    );
    await page
      .locator('.studio-header h1')
      .filter({
        hasText: {
          draft: 'BP 对局室',
          teams: '战队设置',
          players: '选手设置',
          matches: '比赛导入',
          replays: '回放复盘',
        }[pageId],
      })
      .waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      pageId + ' 移动端溢出',
    );
  }
  await page.locator('.record-choice').first().click();
  await page.getByRole('button', { name: '展开十人出装计分板' }).click();
  await page.locator('.score-entry').last().waitFor();
  assert.equal(await page.locator('.score-entry').count(), 10);
  assert.equal(await page.locator('.score-entry .score-items > span').count(), 70);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '单场计分板溢出',
  );
  await page.locator('.mobile-island a[href="#matches"]').click();
  await page.getByRole('button', { name: '批量粘贴导入比赛' }).click();
  await page
    .getByRole('dialog')
    .locator('textarea')
    .fill('决赛 https://stratz.com/matches/12345678，重复 12345678');
  assert.equal(await page.getByRole('dialog').locator('.id-chips > span').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('.mobile-island a[href="#teams"]').click();
  await page.getByRole('button', { name: '设为我方进入 BP' }).click();
  await page.locator('.faction header h2 strong').getByText('青岩').waitFor();
  assert.equal(await taken.count(), 0);
  await page.locator('.sheet-trigger').click();
  await compact.locator('.compact-summary').click();
  await compact.getByText('选手英雄池', { exact: true }).waitFor();
  assert.equal(await taken.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    '五页导航偏移 0px，吸顶 y=0，四组英雄底边 ' +
      (pool.y + pool.height) +
      'px，分栏间隙 RGB ' +
      pixel +
      '。桌面与手机交互通过。',
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}
