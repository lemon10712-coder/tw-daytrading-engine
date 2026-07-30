import { toNumberOrNull, yyyymmddToIso } from './util.js';

const TAIFEX_MIS_URL = 'https://mis.taifex.com.tw/futures/api/getQuoteList';

// 台指期（含夜盤）報價查詢，CID 預設 TXF（台指期），回傳陣列第一筆通常是現貨參考、
// 之後幾筆是各月份合約（SymbolID 例如 TXFH6-F），由呼叫端自己挑近月合約。
export async function fetchTaifexQuotes(
  { marketType = '0', symbolType = 'F', kindId = '1', cid = 'TXF' } = {},
  fetchImpl = fetch
) {
  const res = await fetchImpl(TAIFEX_MIS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ MarketType: marketType, SymbolType: symbolType, KindID: kindId, CID: cid }),
  });
  if (!res.ok) {
    throw new Error(`TAIFEX MIS 查詢失敗：HTTP ${res.status}`);
  }
  const raw = await res.json();
  if (raw.RtCode !== '0' || !raw.RtData?.QuoteList) {
    throw new Error(`TAIFEX MIS 回傳異常：RtCode=${raw.RtCode} RtMsg=${raw.RtMsg || '無訊息'}`);
  }
  return raw.RtData.QuoteList.map(normalizeTaifexQuote);
}

export function normalizeTaifexQuote(q) {
  return {
    symbolId: q.SymbolID,
    name: q.DispCName,
    status: q.Status ?? null,
    last: toNumberOrNull(q.CLastPrice),
    open: toNumberOrNull(q.COpenPrice),
    high: toNumberOrNull(q.CHighPrice),
    low: toNumberOrNull(q.CLowPrice),
    ref: toNumberOrNull(q.CRefPrice),
    limitUp: toNumberOrNull(q.CCeilPrice),
    limitDown: toNumberOrNull(q.CFloorPrice),
    openInterest: toNumberOrNull(q.OpenInterest),
    quoteDate: yyyymmddToIso(q.CDate),
    quoteTime: q.CTime || null,
  };
}
