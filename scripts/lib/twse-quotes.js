import { toNumberOrNull, parseLevels, yyyymmddToIso } from './util.js';

const TWSE_MIS_BASE = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

async function queryMis(exPrefix, codes, fetchImpl) {
  if (codes.length === 0) return [];
  const exCh = codes.map((c) => `${exPrefix}_${c}.tw`).join('|');
  const url = `${TWSE_MIS_BASE}?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    throw new Error(`TWSE MIS 報價查詢失敗：HTTP ${res.status}`);
  }
  const raw = await res.json();
  if (raw.rtcode !== '0000' || !Array.isArray(raw.msgArray)) {
    throw new Error(`TWSE MIS 回傳異常：rtcode=${raw.rtcode} rtmessage=${raw.rtmessage || '無訊息'}`);
  }
  return raw.msgArray;
}

// 台股即時報價批次查詢（收盤後/非交易時段回傳的是上次收盤快照，不是即時價，
// 用 normalizeTwseQuote 回傳的 quoteDate 跟呼叫當下的台北日期比對就能判斷是否為舊資料，
// 是否過舊由呼叫端（未來的市場狀態引擎）決定，這裡只負責忠實回傳）。
//
// 上市（tse_）跟上櫃（otc_）是不同的查詢前綴，呼叫端通常不會事先知道每檔股票屬於哪邊
// （例：5347 世界先進看起來像晶圓代工權值股，其實是上櫃）。這裡先當全部是上市查一次，
// 查不到的（TWSE 對查無此代號的回應是 c 欄位為空字串）自動改用上櫃前綴重查一次，
// 不要求呼叫端自己先查證每檔股票的上市/上櫃別。
export async function fetchTwseQuotes(codes, fetchImpl = fetch) {
  if (!codes || codes.length === 0) return [];
  const tseResults = await queryMis('tse', codes, fetchImpl);
  const foundCodes = new Set(tseResults.filter((m) => m.c).map((m) => m.c));
  const missingCodes = codes.filter((c) => !foundCodes.has(c));

  let otcResults = [];
  if (missingCodes.length > 0) {
    otcResults = await queryMis('otc', missingCodes, fetchImpl);
  }

  const combined = [...tseResults.filter((m) => m.c), ...otcResults.filter((m) => m.c)];
  const stillMissing = codes.filter((c) => !combined.some((m) => m.c === c));
  const quotes = combined.map(normalizeTwseQuote);
  stillMissing.forEach((code) => {
    quotes.push({
      code,
      name: null,
      price: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      limitUp: null,
      limitDown: null,
      bestBidLevels: [],
      bestAskLevels: [],
      quoteDate: null,
      quoteTime: null,
      rawVolumeFields: {},
      error: '上市／上櫃查詢皆查無此代號，可能代號錯誤或已下市',
    });
  });
  return quotes;
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
