import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcVWAPSeries,
  latestVWAP,
  calcOpeningRange,
  calcPriorDayLevels,
  calcSectorSync,
} from '../lib/indicators.js';

// --- calcVWAPSeries / latestVWAP ---
// 手算驗證：
// bar1 typical=(101+99+100)/3=100, PV=10000, cumV=100        -> VWAP=100
// bar2 typical=(103+101+102)/3=102, PV=20400, cumV=300        -> VWAP=30400/300=101.333...
// bar3 typical=(105+103+104)/3=104, PV=10400, cumV=400        -> VWAP=40800/400=102
const VWAP_BARS = [
  { time: 't1', high: 101, low: 99, close: 100, volume: 100 },
  { time: 't2', high: 103, low: 101, close: 102, volume: 200 },
  { time: 't3', high: 105, low: 103, close: 104, volume: 100 },
];

test('calcVWAPSeries: 手算數字比對，含中間值', () => {
  const series = calcVWAPSeries(VWAP_BARS);
  assert.equal(series[0].vwap, 100);
  assert.ok(Math.abs(series[1].vwap - 101.3333) < 0.001);
  assert.equal(series[2].vwap, 102);
});

test('latestVWAP: 回傳最後一筆有效值', () => {
  assert.equal(latestVWAP(VWAP_BARS), 102);
});

test('calcVWAPSeries: 缺欄位的 bar 該筆回傳 null，不中斷後續累積', () => {
  const bars = [
    { time: 't1', high: 101, low: 99, close: 100, volume: 100 },
    { time: 't2', high: null, low: null, close: null, volume: null },
    { time: 't3', high: 103, low: 101, close: 102, volume: 200 },
  ];
  const series = calcVWAPSeries(bars);
  assert.equal(series[1].vwap, null);
  assert.ok(series[2].vwap != null);
});

test('latestVWAP: 全部無效資料回傳 null', () => {
  const bars = [{ time: 't1', high: null, low: null, close: null, volume: null }];
  assert.equal(latestVWAP(bars), null);
});

// --- calcOpeningRange ---
// Taipei 09:00 = UTC 01:00（UTC+8），用這個對應關係構造測試資料
test('calcOpeningRange: 只取開盤後5分鐘內的 bar 算高低點', () => {
  const bars = [
    { time: '2026-07-31T01:00:00.000Z', high: 100, low: 98, close: 99, volume: 10 }, // 09:00 內
    { time: '2026-07-31T01:02:00.000Z', high: 103, low: 97, close: 100, volume: 10 }, // 09:02 內
    { time: '2026-07-31T01:04:00.000Z', high: 101, low: 96, close: 100, volume: 10 }, // 09:04 內
    { time: '2026-07-31T01:05:00.000Z', high: 999, low: 999, close: 999, volume: 10 }, // 09:05 已超出視窗
    { time: '2026-07-31T01:10:00.000Z', high: 999, low: 999, close: 999, volume: 10 }, // 09:10 超出視窗
  ];
  const result = calcOpeningRange(bars, { windowMinutes: 5 });
  assert.equal(result.high, 103);
  assert.equal(result.low, 96);
  assert.equal(result.barsUsed, 3);
});

test('calcOpeningRange: 空陣列回傳無資料且不拋錯', () => {
  const result = calcOpeningRange([]);
  assert.equal(result.high, null);
  assert.equal(result.reason, '無資料');
});

test('calcOpeningRange: 全部 bar 都不在開盤視窗內回傳明確原因', () => {
  const bars = [{ time: '2026-07-31T02:00:00.000Z', high: 100, low: 99, close: 99, volume: 10 }]; // 10:00
  const result = calcOpeningRange(bars);
  assert.equal(result.high, null);
  assert.match(result.reason, /尚無開盤區間資料/);
});

// --- calcPriorDayLevels ---
const DAILY_BARS = [
  { time: '2026-07-28', high: 100, low: 95, close: 98, volume: 1000 },
  { time: '2026-07-29', high: 105, low: 99, close: 103, volume: 1200 },
  { time: '2026-07-30', high: 108, low: 102, close: 106, volume: 1500 },
];

test('calcPriorDayLevels: 取得「今天以前最新一筆」的日線資料', () => {
  const result = calcPriorDayLevels(DAILY_BARS, '2026-07-31');
  assert.equal(result.date, '2026-07-30');
  assert.equal(result.high, 108);
  assert.equal(result.low, 102);
  assert.equal(result.close, 106);
});

test('calcPriorDayLevels: 不會把「今天自己」的資料誤當成昨天（避免look-ahead）', () => {
  const result = calcPriorDayLevels(DAILY_BARS, '2026-07-30');
  assert.equal(result.date, '2026-07-29');
});

test('calcPriorDayLevels: 找不到更早的資料時明確回傳原因', () => {
  const result = calcPriorDayLevels(DAILY_BARS, '2026-07-28');
  assert.equal(result.date, null);
  assert.match(result.reason, /找不到/);
});

// --- calcSectorSync ---
const THRESHOLDS = { min_stocks_for_valid_sync: 2, strong_sync_pct: 0.7, weak_sync_pct: 0.5 };

test('calcSectorSync: 樣本數不足時回傳資料不足，不強行給分類', () => {
  const result = calcSectorSync([{ code: 'A', pctChange: 0.02, aboveVwap: true }], THRESHOLDS);
  assert.equal(result.classification, '資料不足');
});

test('calcSectorSync: 強同步偏多（多數上漲+多數站上VWAP+平均為正）', () => {
  const signals = [
    { code: 'A', pctChange: 0.03, aboveVwap: true },
    { code: 'B', pctChange: 0.02, aboveVwap: true },
    { code: 'C', pctChange: 0.01, aboveVwap: true },
    { code: 'D', pctChange: 0.015, aboveVwap: true },
    { code: 'E', pctChange: -0.01, aboveVwap: false },
  ];
  const result = calcSectorSync(signals, THRESHOLDS);
  assert.equal(result.classification, '強同步偏多');
  assert.equal(result.upCount, 4);
});

test('calcSectorSync: 強同步偏空（多數下跌+多數跌破VWAP+平均為負）', () => {
  const signals = [
    { code: 'A', pctChange: -0.03, aboveVwap: false },
    { code: 'B', pctChange: -0.02, aboveVwap: false },
    { code: 'C', pctChange: -0.01, aboveVwap: false },
    { code: 'D', pctChange: -0.015, aboveVwap: false },
    { code: 'E', pctChange: 0.01, aboveVwap: true },
  ];
  const result = calcSectorSync(signals, THRESHOLDS);
  assert.equal(result.classification, '強同步偏空');
});

test('calcSectorSync: 一半一半，分類為中性分化', () => {
  const signals = [
    { code: 'A', pctChange: 0.02, aboveVwap: true },
    { code: 'B', pctChange: -0.02, aboveVwap: false },
  ];
  const result = calcSectorSync(signals, THRESHOLDS);
  assert.equal(result.classification, '中性分化');
});

test('calcSectorSync: 缺 aboveVwap 資料時只用漲跌家數判斷，不拋錯', () => {
  const signals = [
    { code: 'A', pctChange: 0.02, aboveVwap: null },
    { code: 'B', pctChange: 0.03, aboveVwap: null },
    { code: 'C', pctChange: 0.01, aboveVwap: null },
  ];
  const result = calcSectorSync(signals, THRESHOLDS);
  assert.equal(result.pctAboveVwap, null);
  assert.match(result.reason, /無VWAP資料/);
});
