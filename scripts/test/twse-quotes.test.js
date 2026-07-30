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

const OTC_RESPONSE_FIXTURE = {
  msgArray: [
    {
      c: '5347',
      n: '世界',
      z: '138.0000',
      o: '133.0000',
      h: '142.5000',
      l: '131.0000',
      y: '133.0000',
      u: '146.0000',
      w: '120.0000',
      a: '138.0000_138.5000_',
      b: '137.5000_137.0000_',
      d: '20260730',
      t: '13:30:00',
      tv: '1439',
      v: '38788',
      ov: '1779',
    },
  ],
  rtcode: '0000',
  rtmessage: 'OK',
};

// 查無此代號時，TWSE MIS 實際上是回傳 c 為空字串（不是 HTTP 錯誤），要用這個模擬「查不到」
const NOT_FOUND_RESPONSE_FIXTURE = { msgArray: [{ tv: '-', s: '-', c: '', z: '-' }], rtcode: '0000', rtmessage: 'OK' };

function mockFetch(jsonBody, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => jsonBody });
}

// 依 URL 是否包含 tse_/otc_ 回傳不同的模擬結果，用來測「上市查不到自動改查上櫃」的行為
function mockFetchByExchange({ tseResponse, otcResponse }) {
  return async (url) => {
    const body = url.includes('ex_ch=tse_') ? tseResponse : otcResponse;
    return { ok: true, status: 200, json: async () => body };
  };
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

test('fetchTwseQuotes: 上市查詢查不到（c為空字串）時自動改查上櫃，不用呼叫端事先分辨（5347 世界先進真實案例）', async () => {
  const fakeFetch = mockFetchByExchange({
    tseResponse: NOT_FOUND_RESPONSE_FIXTURE,
    otcResponse: OTC_RESPONSE_FIXTURE,
  });
  const result = await fetchTwseQuotes(['5347'], fakeFetch);
  assert.equal(result.length, 1);
  assert.equal(result[0].code, '5347');
  assert.equal(result[0].name, '世界');
  assert.equal(result[0].price, 138);
  assert.equal(result[0].error, undefined);
});

test('fetchTwseQuotes: 混合上市與上櫃股票，各自正確合併', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('ex_ch=tse_')) {
      return { ok: true, status: 200, json: async () => REAL_RESPONSE_FIXTURE }; // 只含 2330
    }
    return { ok: true, status: 200, json: async () => OTC_RESPONSE_FIXTURE }; // 只含 5347
  };
  const result = await fetchTwseQuotes(['2330', '5347'], fakeFetch);
  assert.equal(result.length, 2);
  const codes = result.map((q) => q.code).sort();
  assert.deepEqual(codes, ['2330', '5347']);
});

test('fetchTwseQuotes: 上市上櫃都查無此代號，回傳明確錯誤標註而不是靜默漏掉', async () => {
  const fakeFetch = mockFetchByExchange({
    tseResponse: NOT_FOUND_RESPONSE_FIXTURE,
    otcResponse: NOT_FOUND_RESPONSE_FIXTURE,
  });
  const result = await fetchTwseQuotes(['9999999'], fakeFetch);
  assert.equal(result.length, 1);
  assert.equal(result[0].code, '9999999');
  assert.equal(result[0].price, null);
  assert.match(result[0].error, /查無此代號/);
});
