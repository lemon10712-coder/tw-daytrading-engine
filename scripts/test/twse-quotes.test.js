import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTwseQuotes, normalizeTwseQuote } from '../lib/twse-quotes.js';

// 2026-07-31 用真實請求抓到的實際回應（節錄，欄位結構未改動），測試不依賴即時網路
const REAL_RESPONSE_FIXTURE = {
  msgArray: [
    {
      c: '2330',
      n: '台積電',
      z: '2205.0000',
      o: '2205.0000',
      h: '2260.0000',
      l: '2190.0000',
      y: '2200.0000',
      u: '2420.0000',
      w: '1980.0000',
      a: '2210.0000_2215.0000_2220.0000_',
      b: '2205.0000_2200.0000_2195.0000_',
      d: '20260730',
      t: '13:30:00',
      tv: '5494',
      v: '44328',
      ov: '77679',
    },
  ],
  rtcode: '0000',
  rtmessage: 'OK',
};

function mockFetch(jsonBody, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => jsonBody });
}

test('fetchTwseQuotes: 空代號陣列直接回傳空陣列，不發送請求', async () => {
  let called = false;
  const result = await fetchTwseQuotes([], async () => {
    called = true;
  });
  assert.deepEqual(result, []);
  assert.equal(called, false);
});

test('fetchTwseQuotes: 正常回應解析成標準化物件', async () => {
  const result = await fetchTwseQuotes(['2330'], mockFetch(REAL_RESPONSE_FIXTURE));
  assert.equal(result.length, 1);
  assert.equal(result[0].code, '2330');
  assert.equal(result[0].name, '台積電');
  assert.equal(result[0].price, 2205);
  assert.equal(result[0].quoteDate, '2026-07-30');
});

test('fetchTwseQuotes: HTTP 非 200 要丟出明確錯誤', async () => {
  await assert.rejects(
    () => fetchTwseQuotes(['2330'], mockFetch({}, false, 500)),
    /HTTP 500/
  );
});

test('fetchTwseQuotes: rtcode 非 0000 要丟出明確錯誤，不能假裝成功', async () => {
  await assert.rejects(
    () => fetchTwseQuotes(['2330'], mockFetch({ rtcode: '9999', rtmessage: '查無資料' })),
    /rtcode=9999/
  );
});

test('normalizeTwseQuote: 五檔字串正確解析成陣列', () => {
  const q = normalizeTwseQuote(REAL_RESPONSE_FIXTURE.msgArray[0]);
  assert.deepEqual(q.bestAskLevels, [2210, 2215, 2220]);
  assert.deepEqual(q.bestBidLevels, [2205, 2200, 2195]);
});

test('normalizeTwseQuote: 漲跌停價正確帶出', () => {
  const q = normalizeTwseQuote(REAL_RESPONSE_FIXTURE.msgArray[0]);
  assert.equal(q.limitUp, 2420);
  assert.equal(q.limitDown, 1980);
});

test('normalizeTwseQuote: 成交量欄位原樣保留但不做語意宣稱', () => {
  const q = normalizeTwseQuote(REAL_RESPONSE_FIXTURE.msgArray[0]);
  assert.deepEqual(q.rawVolumeFields, { tv: '5494', v: '44328', ov: '77679' });
});
