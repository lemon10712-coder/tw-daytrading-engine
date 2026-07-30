import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInternational, classifyTaiwanMarket, classifyMarketState } from '../lib/market-state.js';

const THRESHOLDS = { flat_band_pct: 0.3, min_intl_signals_for_valid: 1 };

// --- classifyInternational ---
test('classifyInternational: 多數上漲判定偏多', () => {
  const result = classifyInternational(
    [
      { name: 'DJI', pctChange: 0.01 },
      { name: 'SOX', pctChange: 0.02 },
      { name: 'NVDA', pctChange: -0.005 },
    ],
    THRESHOLDS
  );
  assert.equal(result.direction, '偏多');
});

test('classifyInternational: 多數下跌判定偏空', () => {
  const result = classifyInternational(
    [
      { name: 'DJI', pctChange: -0.015 },
      { name: 'SOX', pctChange: -0.02 },
    ],
    THRESHOLDS
  );
  assert.equal(result.direction, '偏空');
});

test('classifyInternational: 樣本數不足回傳資料不足', () => {
  const result = classifyInternational([], THRESHOLDS);
  assert.equal(result.direction, '資料不足');
});

test('classifyInternational: 全部在平盤區間判定中性', () => {
  const result = classifyInternational(
    [
      { name: 'DJI', pctChange: 0.001 },
      { name: 'SOX', pctChange: -0.001 },
    ],
    THRESHOLDS
  );
  assert.equal(result.direction, '中性');
});

// --- classifyTaiwanMarket ---
test('classifyTaiwanMarket: 加權櫃買都上漲判定偏多', () => {
  const result = classifyTaiwanMarket({ taiexPctChange: 0.01, tpexPctChange: 0.008 }, THRESHOLDS);
  assert.equal(result.direction, '偏多');
});

test('classifyTaiwanMarket: 加權櫃買都無資料回傳資料不足', () => {
  const result = classifyTaiwanMarket({}, THRESHOLDS);
  assert.equal(result.direction, '資料不足');
});

test('classifyTaiwanMarket: 台指期正價差有備註但不影響方向判斷', () => {
  const result = classifyTaiwanMarket(
    { taiexPctChange: 0.01, tpexPctChange: 0.005, txFuturesBasisPct: 0.005 },
    THRESHOLDS
  );
  assert.match(result.txBasisNote, /正價差/);
  assert.equal(result.direction, '偏多');
});

test('classifyTaiwanMarket: 台指期基差很小時備註寫接近平盤', () => {
  const result = classifyTaiwanMarket(
    { taiexPctChange: 0.01, tpexPctChange: 0.005, txFuturesBasisPct: 0.0001 },
    THRESHOLDS
  );
  assert.match(result.txBasisNote, /接近平盤/);
});

// --- classifyMarketState（整合兩層） ---
test('classifyMarketState: 國際與台股都缺資料，回傳資料不足', () => {
  const intl = classifyInternational([], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({}, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '資料不足');
});

test('classifyMarketState: 台股缺資料時不能單靠國際判斷方向，回傳觀望', () => {
  const intl = classifyInternational([{ name: 'DJI', pctChange: 0.01 }], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({}, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '觀望');
});

test('classifyMarketState: 國際缺資料時不能單靠台股判斷方向，回傳觀望', () => {
  const intl = classifyInternational([], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({ taiexPctChange: 0.01, tpexPctChange: 0.01 }, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '觀望');
});

test('classifyMarketState: 台股本身平盤，回傳震盪', () => {
  const intl = classifyInternational([{ name: 'DJI', pctChange: 0.01 }], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({ taiexPctChange: 0.001, tpexPctChange: -0.001 }, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '震盪');
});

test('classifyMarketState: 國際與台股方向一致偏多，才輸出偏多', () => {
  const intl = classifyInternational([{ name: 'DJI', pctChange: 0.01 }], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({ taiexPctChange: 0.01, tpexPctChange: 0.008 }, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '偏多');
});

test('classifyMarketState: 國際與台股方向一致偏空，才輸出偏空', () => {
  const intl = classifyInternational([{ name: 'DJI', pctChange: -0.01 }], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({ taiexPctChange: -0.01, tpexPctChange: -0.008 }, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '偏空');
});

test('classifyMarketState: 國際偏多但台股偏空，訊號衝突回傳觀望，不能各打五十大板隨便選一個', () => {
  const intl = classifyInternational([{ name: 'DJI', pctChange: 0.01 }], THRESHOLDS);
  const taiwan = classifyTaiwanMarket({ taiexPctChange: -0.01, tpexPctChange: -0.008 }, THRESHOLDS);
  const result = classifyMarketState({ intl, taiwan });
  assert.equal(result.state, '觀望');
  assert.match(result.reason, /訊號衝突/);
});
