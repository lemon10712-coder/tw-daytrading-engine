import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNumberOrNull, parseLevels, yyyymmddToIso, mapWithConcurrency } from '../lib/util.js';

test('toNumberOrNull: 正常數字字串轉數字', () => {
  assert.equal(toNumberOrNull('2205.0000'), 2205);
});

test('toNumberOrNull: 空字串/undefined/null 回傳 null（不是 0，避免誤判成真的價格0）', () => {
  assert.equal(toNumberOrNull(''), null);
  assert.equal(toNumberOrNull(undefined), null);
  assert.equal(toNumberOrNull(null), null);
});

test('toNumberOrNull: 非數字字串回傳 null', () => {
  assert.equal(toNumberOrNull('--'), null);
});

test('parseLevels: 底線分隔字串解析成數字陣列', () => {
  assert.deepEqual(parseLevels('2210.0000_2215.0000_2220.0000_'), [2210, 2215, 2220]);
});

test('parseLevels: 空字串回傳空陣列', () => {
  assert.deepEqual(parseLevels(''), []);
  assert.deepEqual(parseLevels(undefined), []);
});

test('yyyymmddToIso: 轉換成 ISO 日期格式', () => {
  assert.equal(yyyymmddToIso('20260730'), '2026-07-30');
});

test('yyyymmddToIso: 格式不對回傳 null', () => {
  assert.equal(yyyymmddToIso('202607'), null);
  assert.equal(yyyymmddToIso(undefined), null);
});

test('mapWithConcurrency: 全部成功時保持原始順序', async () => {
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
  assert.deepEqual(results.map((r) => r.value), [10, 20, 30, 40]);
  assert.ok(results.every((r) => r.ok));
});

test('mapWithConcurrency: 單一項目失敗不影響其他項目，回傳 error 而不是拋出整批例外', async () => {
  const results = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error('模擬失敗');
    return n;
  });
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, '模擬失敗');
  assert.equal(results[2].ok, true);
});

test('mapWithConcurrency: 併發上限不超過設定值（用計數器驗證同時執行數）', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 5));
    concurrent--;
  });
  assert.ok(maxConcurrent <= 2);
});
