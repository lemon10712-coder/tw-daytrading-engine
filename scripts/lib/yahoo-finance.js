const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// 用來抓台股個股分鐘K線（VWAP／開盤高低點用）跟國際指標（^DJI/^GSPC/^IXIC/^SOX/
// NVDA/AMD/MU/TSM/DX-Y.NYB/^TNX/CL=F 等），已用真實請求驗證過回傳格式。
export async function fetchYahooChart(symbol, { interval = '1m', range = '1d' } = {}, fetchImpl = fetch) {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    throw new Error(`Yahoo Finance chart 查詢失敗（symbol=${symbol}）：HTTP ${res.status}`);
  }
  const raw = await res.json();
  if (raw.chart?.error) {
    throw new Error(`Yahoo Finance chart 回傳錯誤（symbol=${symbol}）：${JSON.stringify(raw.chart.error)}`);
  }
  const result = raw.chart?.result?.[0];
  if (!result) {
    throw new Error(`Yahoo Finance chart 沒有回傳 result（symbol=${symbol}），可能代號錯誤或無資料`);
  }
  return normalizeYahooChart(result);
}

export function normalizeYahooChart(result) {
  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const bars = timestamps
    .map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: quote.open?.[i] ?? null,
      high: quote.high?.[i] ?? null,
      low: quote.low?.[i] ?? null,
      close: quote.close?.[i] ?? null,
      volume: quote.volume?.[i] ?? null,
    }))
    // 尚未開盤/該分鐘無成交時 Yahoo 常回傳整列 null，過濾掉避免污染 VWAP 計算
    .filter((bar) => bar.close !== null);
  return {
    symbol: meta.symbol,
    currency: meta.currency ?? null,
    exchangeTimezone: meta.exchangeTimezoneName || meta.timezone || null,
    previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
    regularMarketPrice: meta.regularMarketPrice ?? null,
    regularMarketDayHigh: meta.regularMarketDayHigh ?? null,
    regularMarketDayLow: meta.regularMarketDayLow ?? null,
    dataGranularity: meta.dataGranularity ?? null,
    bars,
  };
}
