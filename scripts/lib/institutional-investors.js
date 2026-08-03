// 三大法人（外資／投信／自營商）買賣超資料擷取。資料來源是 TWSE 官方免費開放資料，
// 屬於「盤後結算」統計，通常收盤後下午才會有當天數字，不是即時資料——呼叫端不應該
// 拿這裡的資料當成盤中即時籌碼看待。
//
// 目前只接 TWSE 上市（BFI82U 全市場彙總 + T86 個股別），上櫃（TPEx）尚未串接，
// 但 fetchMarketSummary/fetchStockFlows 的回傳形狀刻意跟「未來加一個 fetchTpexXxx
// 再合併」的擴充方式相容（都是 { date, settled, reason?, ... } 這種形狀）。

const TWSE_BFI82U_URL = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U';
const TWSE_T86_URL = 'https://www.twse.com.tw/rwd/zh/fund/T86';

function formatLocalYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToYYYYMMDD(iso) {
  return iso.replace(/-/g, '');
}

function parseAmount(str) {
  if (str === undefined || str === null) return null;
  const n = Number(String(str).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 全市場三大法人買賣金額彙總（新台幣元）。對應官方頁面「115年MM月DD日 三大法人買賣金額統計表」。
export async function fetchMarketSummary(dateIso, fetchImpl = fetch) {
  const url = `${TWSE_BFI82U_URL}?response=json&dayDate=${isoToYYYYMMDD(dateIso)}&type=day`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    return { date: dateIso, settled: false, reason: `TWSE BFI82U API 呼叫失敗：HTTP ${res.status}` };
  }
  const raw = await res.json();
  if (raw.stat !== 'OK' || !Array.isArray(raw.data)) {
    return {
      date: dateIso,
      settled: false,
      reason: `TWSE 回應：「${raw.stat || '格式異常'}」（常見原因：非交易日、假日、或當天尚未結算，通常收盤後下午才會有數字）`,
    };
  }

  const byLabel = Object.fromEntries(
    raw.data.map((row) => [row[0], { buy: parseAmount(row[1]), sell: parseAmount(row[2]), net: parseAmount(row[3]) }])
  );

  const dealerSelf = byLabel['自營商(自行買賣)'] ?? null;
  const dealerHedge = byLabel['自營商(避險)'] ?? null;
  const trust = byLabel['投信'] ?? null;
  const foreign = byLabel['外資及陸資(不含外資自營商)'] ?? null;
  const foreignDealer = byLabel['外資自營商'] ?? null;
  const total = byLabel['合計'] ?? null;

  const dealerNet = (dealerSelf?.net ?? 0) + (dealerHedge?.net ?? 0);
  // 官方注記：外資自營商買賣金額已計入自營商買賣金額，不納入三大法人合計數計算，
  // 所以勾稽公式不含 foreignDealer。
  const reconstructedTotal = dealerNet + (trust?.net ?? 0) + (foreign?.net ?? 0);
  const totalMatches = total?.net != null && Math.abs(reconstructedTotal - total.net) < 1;

  return {
    date: dateIso,
    settled: true,
    source: 'TWSE BFI82U（上市，全市場彙總）',
    currency: 'TWD',
    foreign: foreign ? { buy: foreign.buy, sell: foreign.sell, net: foreign.net } : null,
    trust: trust ? { buy: trust.buy, sell: trust.sell, net: trust.net } : null,
    dealer: {
      buy: (dealerSelf?.buy ?? 0) + (dealerHedge?.buy ?? 0),
      sell: (dealerSelf?.sell ?? 0) + (dealerHedge?.sell ?? 0),
      net: dealerNet,
      self: dealerSelf,
      hedge: dealerHedge,
    },
    foreignDealer: foreignDealer ?? null,
    total: total ? { buy: total.buy, sell: total.sell, net: total.net } : null,
    validation: {
      rule: '自營商(自行+避險) + 投信 + 外資及陸資(不含外資自營商) 應等於合計',
      reconstructed_total: reconstructedTotal,
      official_total: total?.net ?? null,
      matches: totalMatches,
    },
  };
}

// 指定股票代號清單的個股別三大法人買賣超（股數，非金額）。對應官方「三大法人買賣超日報」。
export async function fetchStockFlows(dateIso, codes, fetchImpl = fetch) {
  const url = `${TWSE_T86_URL}?response=json&date=${isoToYYYYMMDD(dateIso)}&selectType=ALL`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    return { date: dateIso, settled: false, reason: `TWSE T86 API 呼叫失敗：HTTP ${res.status}`, stocks: {} };
  }
  const raw = await res.json();
  if (raw.stat !== 'OK' || !Array.isArray(raw.data)) {
    return {
      date: dateIso,
      settled: false,
      reason: `TWSE 回應：「${raw.stat || '格式異常'}」（常見原因：非交易日、假日、或當天尚未結算）`,
      stocks: {},
    };
  }

  const codeSet = new Set(codes);
  const stocks = {};
  const mismatches = [];
  raw.data.forEach((row) => {
    const code = row[0];
    if (!codeSet.has(code)) return;
    const foreignNet = parseAmount(row[4]);
    const trustNet = parseAmount(row[10]);
    const dealerNet = parseAmount(row[11]);
    const totalNet = parseAmount(row[18]);
    const reconstructed = (foreignNet ?? 0) + (trustNet ?? 0) + (dealerNet ?? 0);
    if (totalNet != null && Math.abs(reconstructed - totalNet) >= 1) {
      mismatches.push({ code, reconstructed, officialTotal: totalNet });
    }
    stocks[code] = {
      name: (row[1] || '').trim(),
      foreignNet,
      trustNet,
      dealerNet,
      totalNet,
    };
  });

  const missingCodes = codes.filter((c) => !stocks[c]);
  return {
    date: dateIso,
    settled: true,
    source: 'TWSE T86（上市，個股別）',
    unit: 'shares',
    stocks,
    missingCodes,
    validation: {
      rule: '外陸資買賣超 + 投信買賣超 + 自營商買賣超 應等於三大法人買賣超',
      mismatches,
    },
  };
}

// 從今天開始往回找最近一個「已結算」的交易日資料（跳過假日/週末/尚未結算的當天），
// 避免呼叫端在收盤前執行時，因為當天還沒結算就整段功能失敗。回傳的 date 欄位是
// 實際查到資料的那一天，不是原本要求的日期，呼叫端要用回傳的 date 顯示，不要
// 誤植成「今天」的資料。
export async function fetchLatestSettledMarketSummary(startDateIso, fetchImpl = fetch, maxLookbackDays = 7) {
  // 刻意不用 toISOString()（會轉成UTC，日期可能跟輸入的台北日期差一天）——這裡只是
  // 拿 Date 物件當日曆算加減，全程只用 getFullYear/getMonth/getDate/setDate 這組
  // 「純本地欄位」的方法，不經過任何UTC轉換，才不會重演這個離線位移一天的錯誤。
  const [y, m, d] = startDateIso.split('-').map(Number);
  const cursor = new Date(y, m - 1, d);
  for (let i = 0; i <= maxLookbackDays; i++) {
    const iso = formatLocalYYYYMMDD(cursor);
    const result = await fetchMarketSummary(iso, fetchImpl);
    if (result.settled) return result;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { date: startDateIso, settled: false, reason: `往回查了 ${maxLookbackDays} 天都沒有已結算的三大法人資料` };
}
