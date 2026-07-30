import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTaifexQuotes, normalizeTaifexQuote } from '../lib/taifex-futures.js';

// 2026-07-31 用真實請求抓到 TXF 的實際回應（節錄成 2 筆），測試不依賴即時網路
const REAL_RESPONSE_FIXTURE = {
  RtCode: '0',
  RtMsg: '',
  RtData: {
    QuoteList: [
      {
        SymbolID: 'TXF-S',
        DispCName: '臺指現貨',
        Status: 'TC',
        CLastPrice: '39933.30',
        COpenPrice: '40048.94',
        CHighPrice: '41155.42',
        CLowPrice: '39404.65',
        CRefPrice: '40039.18',
        CCeilPrice: '',
        CFloorPrice: '',
        OpenInterest: '',
        CDate: '20260730',
        CTime: '133315',
      },
      {
        SymbolID: 'TXFH6-F',
        DispCName: '臺指期086',
        Status: 'TC',
        CLastPrice: '40270.00',
        COpenPrice: '40007.00',
        CHighPrice: '41266.00',
        CLowPrice: '39701.00',
        CRefPrice: '40328.00',
        CCeilPrice: '44360.00',
        CFloorPrice: '36296.00',
        OpenInterest: '108640',
        CDate: '20260730',
        CTime: '134459',
      },
    ],
  },
};

function mockFetch(jsonBody, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => jsonBody });
}

test('fetchTaifexQuotes: 正常回應解析成標準化陣列', async () => {
  const result = await fetchTaifexQuotes({}, mockFetch(REAL_RESPONSE_FIXTURE));
  assert.equal(result.length, 2);
  assert.equal(result[1].symbolId, 'TXFH6-F');
  assert.equal(result[1].last, 40270);
  assert.equal(result[1].openInterest, 108640);
});

test('fetchTaifexQuotes: 空字串欄位（如現貨無漲跌停）轉成 null 而非 NaN', () => {
  const spot = normalizeTaifexQuote(REAL_RESPONSE_FIXTURE.RtData.QuoteList[0]);
  assert.equal(spot.limitUp, null);
  assert.equal(spot.openInterest, null);
});

test('fetchTaifexQuotes: HTTP 非 200 要丟出明確錯誤', async () => {
  await assert.rejects(
    () => fetchTaifexQuotes({}, mockFetch({}, false, 500)),
    /HTTP 500/
  );
});

test('fetchTaifexQuotes: RtCode 非 0 要丟出明確錯誤，不能假裝成功', async () => {
  await assert.rejects(
    () => fetchTaifexQuotes({}, mockFetch({ RtCode: '1', RtMsg: '查無資料' })),
    /RtCode=1/
  );
});

test('normalizeTaifexQuote: 日期時間正確轉換', () => {
  const q = normalizeTaifexQuote(REAL_RESPONSE_FIXTURE.RtData.QuoteList[1]);
  assert.equal(q.quoteDate, '2026-07-30');
  assert.equal(q.quoteTime, '134459');
});
