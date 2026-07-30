import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchYahooChart, normalizeYahooChart } from '../lib/yahoo-finance.js';

// 2026-07-31 用真實請求抓到 ^SOX 5 日線的實際回應（節錄成 2 個資料點），測試不依賴即時網路
const REAL_RESPONSE_FIXTURE = {
  chart: {
    result: [
      {
        meta: {
          currency: 'USD',
          symbol: '^SOX',
          exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: 11236.426,
          regularMarketDayHigh: 11406.815,
          regularMarketDayLow: 10963.896,
          previousClose: 12343.84,
          dataGranularity: '1d',
        },
        timestamp: [1784899800, 1785418200],
        indicators: {
          quote: [
            {
              open: [12131.29, 11100.5],
              high: [12200.0, 11406.815],
              low: [11711.39, 10963.89],
              close: [11800.0, 11236.42],
              volume: [0, 0],
            },
          ],
        },
      },
    ],
  },
};

const NULL_BAR_FIXTURE = {
  chart: {
    result: [
      {
        meta: { symbol: '2330.TW' },
        timestamp: [1000, 1060, 1120],
        indicators: {
          quote: [
            {
              open: [null, 2205.0, 2206.0],
              high: [null, 2210.0, 2208.0],
              low: [null, 2200.0, 2204.0],
              close: [null, 2207.0, 2205.5],
              volume: [null, 1200, 800],
            },
          ],
        },
      },
    ],
  },
};

function mockFetch(jsonBody, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => jsonBody });
}

test('fetchYahooChart: 正常回應解析出 meta 與 bars', async () => {
  const result = await fetchYahooChart('^SOX', { interval: '1d', range: '5d' }, mockFetch(REAL_RESPONSE_FIXTURE));
  assert.equal(result.symbol, '^SOX');
  assert.equal(result.previousClose, 12343.84);
  assert.equal(result.bars.length, 2);
  assert.equal(result.bars[0].close, 11800.0);
});

test('fetchYahooChart: HTTP 非 200 要丟出明確錯誤', async () => {
  await assert.rejects(
    () => fetchYahooChart('2330.TW', {}, mockFetch({}, false, 404)),
    /HTTP 404/
  );
});

test('fetchYahooChart: chart.error 存在時要丟出錯誤（例如代號錯誤）', async () => {
  await assert.rejects(
    () => fetchYahooChart('BADSYMBOL', {}, mockFetch({ chart: { error: { code: 'Not Found' } } })),
    /Not Found|回傳錯誤/
  );
});

test('fetchYahooChart: 沒有 result 要丟出明確錯誤', async () => {
  await assert.rejects(
    () => fetchYahooChart('2330.TW', {}, mockFetch({ chart: { result: [] } })),
    /沒有回傳 result/
  );
});

test('normalizeYahooChart: 過濾掉 close 為 null 的分鐘（尚未開盤或無成交）', () => {
  const result = normalizeYahooChart(NULL_BAR_FIXTURE.chart.result[0]);
  assert.equal(result.bars.length, 2);
  assert.equal(result.bars[0].close, 2207.0);
  assert.equal(result.bars[0].volume, 1200);
});
