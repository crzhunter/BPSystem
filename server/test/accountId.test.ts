import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountId } from '../src/utils/accountId.ts';
for (const input of [
  123456789,
  ' 123456789 ',
  '76561198083722517',
  'https://www.opendota.com/players/123456789',
  'https://dotabuff.com/players/123456789/?view=all',
]) {
  test('解析有效账号 ' + input, () => assert.equal(parseAccountId(input), 123456789));
}
test('账号边界按无符号 32 位处理', () => {
  for (const id of [1, 4294967295]) {
    assert.equal(parseAccountId(id), id);
    assert.equal(parseAccountId(String(76561197960265728n + BigInt(id))), id);
  }
});
test('拒绝溢出、精度丢失和伪造的主页地址', () => {
  for (const input of [
    '',
    null,
    {},
    false,
    0,
    -1,
    '1e4',
    '01.2',
    '123abc',
    '4294967296',
    '76561197960265728',
    '76561202255233024',
    Number('76561198083722517'),
    'https://www.opendota.com.evil.invalid/players/3',
    'https://opendota.com/matches/1',
    'https://www.dotabuff.com/players/0',
    'https://x@dotabuff.com/players/2',
    'https://dotabuff.com/players/76561198083722517',
  ]) {
    assert.throws(() => parseAccountId(input), /有效/);
  }
});
