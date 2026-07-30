import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNumberOrNull, parseLevels, yyyymmddToIso } from '../lib/util.js';

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
