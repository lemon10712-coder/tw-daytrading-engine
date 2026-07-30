import { toNumberOrNull, parseLevels, yyyymmddToIso } from './util.js';

const TWSE_MIS_BASE = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

// 台股即時報價批次查詢（收盤後/非交易時段回傳的是上次收盤快照，不是即時價，
// 用 normalizeTwseQuote 回傳的 quoteDate 跟呼叫當下的台北日期比對就能判斷是否為舊資料，
// 是否過舊由呼叫端（未來的市場狀態引擎）決定，這裡只負責忠實回傳）
export async function fetchTwseQuotes(codes, fetchImpl = fetch) {
  if (!codes || codes.length === 0) return [];
  const exCh = codes.map((c) => `tse_${c}.tw`).join('|');
  const url = `${TWSE_MIS_BASE}?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    throw new Error(`TWSE MIS 報價查詢失敗：HTTP ${res.status}`);
  }
  const raw = await res.json();
  if (raw.rtcode !== '0000' || !Array.isArray(raw.msgArray)) {
    throw new Error(`TWSE MIS 回傳異常：rtcode=${raw.rtcode} rtmessage=${raw.rtmessage || '無訊息'}`);
  }
  return raw.msgArray.map(normalizeTwseQuote);
}

export function normalizeTwseQuote(m) {
  return {
    code: m.c,
    name: m.n,
    price: toNumberOrNull(m.z),
    open: toNumberOrNull(m.o),
    high: toNumberOrNull(m.h),
    low: toNumberOrNull(m.l),
    prevClose: toNumberOrNull(m.y),
    limitUp: toNumberOrNull(m.u),
    limitDown: toNumberOrNull(m.w),
    bestBidLevels: parseLevels(m.b),
    bestAskLevels: parseLevels(m.a),
    quoteDate: yyyymmddToIso(m.d),
    quoteTime: m.t || null,
    // tv/v/ov 三個成交量相關欄位語意未經官方文件逐一確認，先原樣保留但不對外宣稱是「總量」，
    // VWAP／量價相關計算改用 yahoo-finance.js 抓到的分鐘K線 volume（語意明確：該分鐘成交股數）
    rawVolumeFields: { tv: m.tv ?? null, v: m.v ?? null, ov: m.ov ?? null },
  };
}
