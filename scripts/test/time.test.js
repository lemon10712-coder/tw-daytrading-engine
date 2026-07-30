import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateYYYYMMDD,
  rocDateToIso,
  isWeekend,
  parseHolidaySchedule,
  isTradingDay,
} from '../lib/time.js';

// 2026-07-31 實際從 TWSE OpenAPI 抓到的部分資料，節錄成固定 fixture，測試不依賴即時網路
const HOLIDAY_FIXTURE = [
  { Name: '中華民國開國紀念日', Date: '1150101', Weekday: '四', Description: '依規定放假1日。' },
  { Name: '農曆除夕及春節', Date: '1150215', Weekday: '日', Description: '' },
  { Name: '農曆除夕及春節', Date: '1150216', Weekday: '一', Description: '' },
];

function mockFetch(jsonBody, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    json: async () => jsonBody,
  });
}

test('formatDateYYYYMMDD: 格式化成 YYYY-MM-DD', () => {
  assert.equal(formatDateYYYYMMDD(new Date(2026, 6, 31)), '2026-07-31');
});

test('rocDateToIso: 民國年轉西元年', () => {
  assert.equal(rocDateToIso('1150101'), '2026-01-01');
  assert.equal(rocDateToIso('1150215'), '2026-02-15');
});

test('isWeekend: 週六週日回傳 true', () => {
  assert.equal(isWeekend(new Date(2026, 0, 3)), true); // 週六
  assert.equal(isWeekend(new Date(2026, 1, 15)), true); // 週日
});

test('isWeekend: 平日回傳 false', () => {
  assert.equal(isWeekend(new Date(2026, 0, 5)), false); // 週一
});

test('parseHolidaySchedule: 正確解析並轉換日期', () => {
  const parsed = parseHolidaySchedule(HOLIDAY_FIXTURE);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].date, '2026-01-01');
  assert.equal(parsed[0].name, '中華民國開國紀念日');
});

test('parseHolidaySchedule: 非陣列輸入要丟出錯誤，不能吞掉', () => {
  assert.throws(() => parseHolidaySchedule({ not: 'an array' }));
});

test('isTradingDay: 週六直接判定非交易日，不用打 API', async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    throw new Error('不應該被呼叫');
  };
  const result = await isTradingDay(new Date(2026, 0, 3), fakeFetch);
  assert.equal(result.isTradingDay, false);
  assert.equal(result.reason, '週末');
  assert.equal(called, false);
});

test('isTradingDay: 平日但命中假日清單，判定非交易日', async () => {
  const fakeFetch = mockFetch(HOLIDAY_FIXTURE);
  const result = await isTradingDay(new Date(2026, 0, 1), fakeFetch);
  assert.equal(result.isTradingDay, false);
  assert.equal(result.reason, '中華民國開國紀念日');
  assert.equal(result.source, 'twse_openapi');
});

test('isTradingDay: 平日且不在假日清單，判定為交易日', async () => {
  const fakeFetch = mockFetch(HOLIDAY_FIXTURE);
  const result = await isTradingDay(new Date(2026, 0, 5), fakeFetch);
  assert.equal(result.isTradingDay, true);
  assert.equal(result.reason, null);
});

test('isTradingDay: API 呼叫失敗時明確回傳 null（無法驗證），不能誤判成交易日', async () => {
  const fakeFetch = mockFetch({}, false, 500);
  const result = await isTradingDay(new Date(2026, 0, 5), fakeFetch);
  assert.equal(result.isTradingDay, null);
  assert.match(result.reason, /無法查證/);
});
