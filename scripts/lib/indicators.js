// 純計算函式，不做任何網路請求。輸入必須是呼叫端已經抓好的資料（time.js/yahoo-finance.js/
// twse-quotes.js 負責抓資料，這裡只負責算），方便單元測試跟避免 look-ahead：所有函式都只
// 使用傳入的 bars 陣列本身內含的資訊，不會偷看陣列以外「未來」的資料。

// VWAP（成交量加權平均價）= 累積(典型價格 × 成交量) / 累積(成交量)，典型價格 = (最高+最低+收盤)/3。
// bars 必須按時間升冪排序。回傳逐筆序列，方便畫圖或算「目前是否站上VWAP」。
export function calcVWAPSeries(bars) {
  let cumPV = 0;
  let cumVolume = 0;
  return bars.map((bar) => {
    if (bar.high == null || bar.low == null || bar.close == null || bar.volume == null) {
      return { time: bar.time, vwap: null };
    }
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPV += typicalPrice * bar.volume;
    cumVolume += bar.volume;
    return { time: bar.time, vwap: cumVolume > 0 ? cumPV / cumVolume : null };
  });
}

// 目前（最新一筆有效資料）的 VWAP 值
export function latestVWAP(bars) {
  const series = calcVWAPSeries(bars);
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].vwap != null) return series[i].vwap;
  }
  return null;
}

// 開盤區間高低點：只取「開盤後 windowMinutes 分鐘內」的 bars（預設09:00-09:05）。
// bar.time 必須是 ISO 字串（yahoo-finance.js 回傳的格式）。
export function calcOpeningRange(
  bars,
  { windowMinutes = 5, marketOpenHour = 9, marketOpenMinute = 0, timezone = 'Asia/Taipei' } = {}
) {
  if (!bars || bars.length === 0) {
    return { high: null, low: null, barsUsed: 0, reason: '無資料' };
  }
  const windowBars = bars.filter((bar) => {
    const t = new Date(bar.time);
    const taipei = new Date(t.toLocaleString('en-US', { timeZone: timezone }));
    const minutesSinceOpen = (taipei.getHours() - marketOpenHour) * 60 + (taipei.getMinutes() - marketOpenMinute);
    return minutesSinceOpen >= 0 && minutesSinceOpen < windowMinutes;
  });
  if (windowBars.length === 0) {
    return { high: null, low: null, barsUsed: 0, reason: '尚無開盤區間資料（可能還沒開盤、非交易日、或資料延遲）' };
  }
  const highs = windowBars.map((b) => b.high).filter((v) => v != null);
  const lows = windowBars.map((b) => b.low).filter((v) => v != null);
  return {
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    barsUsed: windowBars.length,
    reason: null,
  };
}

// 昨日高低收：從「日線」bars（time 格式 YYYY-MM-DD 或 ISO 皆可，只取前10碼比對）裡
// 找日期早於 todayIso 的最新一筆，避免誤把「今天」自己的資料當成昨天（look-ahead）。
export function calcPriorDayLevels(dailyBars, todayIso) {
  if (!dailyBars || dailyBars.length === 0) {
    return { high: null, low: null, close: null, date: null, reason: '無資料' };
  }
  const priorBars = dailyBars
    .filter((b) => b.time.slice(0, 10) < todayIso)
    .sort((a, b) => (a.time < b.time ? 1 : -1));
  if (priorBars.length === 0) {
    return { high: null, low: null, close: null, date: null, reason: '找不到今天以前的日線資料' };
  }
  const bar = priorBars[0];
  return { high: bar.high, low: bar.low, close: bar.close, date: bar.time.slice(0, 10), reason: null };
}

// 族群同步性：輸入這個族群裡每檔股票的訊號（{code, pctChange, aboveVwap}），
// 回傳分類（強同步偏多～強同步偏空/資料不足）+ 可追蹤的原因文字，門檻從外部傳入
// （對應 config/thresholds.json，不寫死在這裡）。
export function calcSectorSync(stockSignals, thresholds = {}) {
  const { min_stocks_for_valid_sync = 2, strong_sync_pct = 0.7, weak_sync_pct = 0.5 } = thresholds;
  const valid = (stockSignals || []).filter((s) => s.pctChange != null);

  if (valid.length < min_stocks_for_valid_sync) {
    return {
      classification: '資料不足',
      reason: `有效樣本數 ${valid.length} 檔，低於門檻 ${min_stocks_for_valid_sync} 檔`,
      upCount: valid.filter((s) => s.pctChange > 0).length,
      totalCount: valid.length,
      pctUp: null,
      pctAboveVwap: null,
      avgReturn: null,
      medianReturn: null,
    };
  }

  const upCount = valid.filter((s) => s.pctChange > 0).length;
  const pctUp = upCount / valid.length;
  const aboveVwapSamples = valid.filter((s) => s.aboveVwap != null);
  const aboveVwapCount = aboveVwapSamples.filter((s) => s.aboveVwap === true).length;
  const pctAboveVwap = aboveVwapSamples.length > 0 ? aboveVwapCount / aboveVwapSamples.length : null;

  const returns = valid.map((s) => s.pctChange).sort((a, b) => a - b);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const mid = Math.floor(returns.length / 2);
  const medianReturn = returns.length % 2 === 0 ? (returns[mid - 1] + returns[mid]) / 2 : returns[mid];

  const syncScore = pctAboveVwap != null ? (pctUp + pctAboveVwap) / 2 : pctUp;

  let classification;
  if (syncScore >= strong_sync_pct && avgReturn > 0) classification = '強同步偏多';
  else if (syncScore >= weak_sync_pct && avgReturn > 0) classification = '弱同步偏多';
  else if (syncScore <= 1 - strong_sync_pct && avgReturn < 0) classification = '強同步偏空';
  else if (syncScore <= 1 - weak_sync_pct && avgReturn < 0) classification = '弱同步偏空';
  else classification = '中性分化';

  return {
    classification,
    reason: `${valid.length} 檔中 ${upCount} 檔上漲（${(pctUp * 100).toFixed(0)}%）`
      + (pctAboveVwap != null ? `、${aboveVwapCount} 檔站上VWAP（${(pctAboveVwap * 100).toFixed(0)}%）` : '（無VWAP資料）')
      + `，平均漲跌幅 ${(avgReturn * 100).toFixed(2)}%`,
    upCount,
    totalCount: valid.length,
    pctUp,
    pctAboveVwap,
    avgReturn,
    medianReturn,
  };
}
