// Phase 0 主要引擎入口：抓資料 → 算指標 → 判斷大盤方向／族群同步性 → 寫出分類 JSON。
// 這支腳本會被 GitHub Actions 排程呼叫（盤前一次＋盤中每 5 分鐘），本機也可以直接
// `node scripts/run-engine.mjs` 手動跑一次驗證。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTradingDay, taipeiNow, formatDateYYYYMMDD } from './lib/time.js';
import { fetchTwseQuotes } from './lib/twse-quotes.js';
import { fetchYahooChart } from './lib/yahoo-finance.js';
import { fetchTaifexQuotes } from './lib/taifex-futures.js';
import { latestVWAP, calcOpeningRange, calcSectorSync } from './lib/indicators.js';
import { classifyInternational, classifyTaiwanMarket, classifyMarketState } from './lib/market-state.js';
import { mapWithConcurrency } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const INTL_SYMBOLS = [
  { name: '道瓊工業指數', symbol: '^DJI' },
  { name: 'S&P 500', symbol: '^GSPC' },
  { name: 'Nasdaq', symbol: '^IXIC' },
  { name: '費城半導體指數', symbol: '^SOX' },
  { name: 'NVIDIA', symbol: 'NVDA' },
  { name: 'AMD', symbol: 'AMD' },
  { name: 'Micron', symbol: 'MU' },
  { name: '台積電ADR', symbol: 'TSM' },
  { name: '美元指數', symbol: 'DX-Y.NYB' },
  { name: '美國10年期公債殖利率', symbol: '^TNX' },
  { name: '原油', symbol: 'CL=F' },
];

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function writeJson(relativePath, data) {
  const fullPath = path.join(ROOT, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// 依「每次更新 append 一筆」的資料模型設計（見 NOTES.md），同一天的檔案累積當日多次快照
function appendDailyEntry(relativePath, todayIso, entry) {
  const fullPath = path.join(ROOT, relativePath);
  let doc = { schema_version: 1, date: todayIso, entries: [] };
  if (existsSync(fullPath)) {
    try {
      const existing = JSON.parse(readFileSync(fullPath, 'utf8'));
      if (existing.date === todayIso && Array.isArray(existing.entries)) {
        doc = existing;
      }
    } catch {
      // 讀取/解析失敗就視為今天第一筆，不中斷整個流程
    }
  }
  doc.entries.push(entry);
  writeJson(relativePath, doc);
}

function pctChange(current, base) {
  if (current == null || base == null || base === 0) return null;
  return (current - base) / base;
}

async function fetchIntlSignals() {
  const results = await mapWithConcurrency(INTL_SYMBOLS, 5, async (item) => {
    const chart = await fetchYahooChart(item.symbol, { interval: '1d', range: '5d' });
    return {
      name: item.name,
      symbol: item.symbol,
      price: chart.regularMarketPrice,
      previousClose: chart.previousClose,
      pctChange: pctChange(chart.regularMarketPrice, chart.previousClose),
    };
  });
  return results.map((r, i) =>
    r.ok ? r.value : { name: INTL_SYMBOLS[i].name, symbol: INTL_SYMBOLS[i].symbol, error: r.error, pctChange: null }
  );
}

// 上市股票在 Yahoo Finance 是 .TW 後綴，上櫃股票是 .TWO（例：5347 世界先進其實是上櫃）。
// 呼叫端不會事先知道每檔股票是上市還上櫃，所以先試 .TW，查不到（chart.error）再試 .TWO，
// 不假設全部股票都是上市。
async function fetchSingleStockChart(code) {
  try {
    return await fetchYahooChart(`${code}.TW`, { interval: '1m', range: '1d' });
  } catch (err) {
    // Yahoo 對查無此代號的股票有時回 HTTP 404、有時回 200 但 chart.error 或空 result，三種都要當「這檔可能是上櫃」重試
    if (!/沒有回傳 result|Not Found|HTTP 404/i.test(err.message)) throw err;
    return await fetchYahooChart(`${code}.TWO`, { interval: '1m', range: '1d' });
  }
}

async function fetchStockVwapSignals(codes, thresholds) {
  const results = await mapWithConcurrency(codes, 5, async (code) => {
    const chart = await fetchSingleStockChart(code);
    return {
      code,
      vwap: latestVWAP(chart.bars),
      openingRange: calcOpeningRange(chart.bars, thresholds.opening_range),
      barsCount: chart.bars.length,
    };
  });
  const byCode = {};
  codes.forEach((code, i) => {
    byCode[code] = results[i].ok ? results[i].value : { code, error: results[i].error, vwap: null, openingRange: null };
  });
  return byCode;
}

async function main() {
  const thresholds = loadJson('config/thresholds.json');
  const sectorsConfig = loadJson('config/sectors.json');
  const now = taipeiNow();
  const todayIso = formatDateYYYYMMDD(now);
  const generatedAtTaipei = `${todayIso} ${now.toTimeString().slice(0, 8)}`;

  console.log(`=== run-engine 開始（台北時間 ${generatedAtTaipei}）===`);

  const trading = await isTradingDay(now);
  console.log('[交易日檢查]', trading);

  const allCodes = [...new Set(sectorsConfig.sectors.flatMap((s) => s.representative_stocks.map((st) => st.code)))];
  console.log(`[TWSE 報價] 開始抓取 ${allCodes.length} 檔股票...`);
  const twseQuotes = await fetchTwseQuotes(allCodes);
  const quoteByCode = Object.fromEntries(twseQuotes.map((q) => [q.code, q]));
  console.log(`[TWSE 報價] 完成，取得 ${twseQuotes.length} 檔`);

  console.log('[國際指標] 開始抓取...');
  const intlSignals = await fetchIntlSignals();
  console.log(`[國際指標] 完成，${intlSignals.filter((s) => s.pctChange != null).length}/${intlSignals.length} 項有效`);

  console.log('[台股整體] 開始抓取加權/櫃買/台指期...');
  let taiexPctChange = null;
  let tpexPctChange = null;
  let txFuturesBasisPct = null;
  let txQuotes = [];
  try {
    const taiex = await fetchYahooChart('^TWII', { interval: '1d', range: '5d' });
    taiexPctChange = pctChange(taiex.regularMarketPrice, taiex.previousClose);
  } catch (err) {
    console.log('  加權指數抓取失敗：', err.message);
  }
  try {
    const tpex = await fetchYahooChart('^TWOII', { interval: '1d', range: '5d' });
    tpexPctChange = pctChange(tpex.regularMarketPrice, tpex.previousClose);
  } catch (err) {
    console.log('  櫃買指數抓取失敗：', err.message);
  }
  try {
    txQuotes = await fetchTaifexQuotes();
    const txFuture = txQuotes.find((q) => q.symbolId?.endsWith('-F'));
    const txSpot = txQuotes.find((q) => q.symbolId === 'TXF-S');
    if (txFuture?.last != null && txSpot?.last) {
      txFuturesBasisPct = (txFuture.last - txSpot.last) / txSpot.last;
    }
  } catch (err) {
    console.log('  台指期抓取失敗：', err.message);
  }

  const intlResult = classifyInternational(intlSignals, thresholds.market_state);
  const taiwanResult = classifyTaiwanMarket({ taiexPctChange, tpexPctChange, txFuturesBasisPct }, thresholds.market_state);
  const marketState = classifyMarketState({ intl: intlResult, taiwan: taiwanResult });
  console.log(`[大盤方向] ${marketState.state} — ${marketState.reason}`);

  console.log(`[VWAP] 開始抓取 ${allCodes.length} 檔股票分鐘K線...`);
  const vwapByCode = await fetchStockVwapSignals(allCodes, thresholds);
  const vwapOkCount = Object.values(vwapByCode).filter((v) => v.vwap != null).length;
  console.log(`[VWAP] 完成，${vwapOkCount}/${allCodes.length} 檔取得有效 VWAP`);

  const sectorRadar = sectorsConfig.sectors.map((sector) => {
    const signals = sector.representative_stocks.map((st) => {
      const quote = quoteByCode[st.code];
      const vwapInfo = vwapByCode[st.code];
      const pctChangeVal = quote ? pctChange(quote.price, quote.prevClose) : null;
      const aboveVwap = quote?.price != null && vwapInfo?.vwap != null ? quote.price > vwapInfo.vwap : null;
      return {
        code: st.code,
        name: st.name,
        price: quote?.price ?? null,
        pctChange: pctChangeVal,
        vwap: vwapInfo?.vwap ?? null,
        aboveVwap,
      };
    });
    const sync = calcSectorSync(signals, thresholds.sector_sync);
    return { id: sector.id, name: sector.name, ...sync, stocks: signals };
  });

  const marketStateEntry = {
    generated_at_taipei: generatedAtTaipei,
    trading_day: trading,
    market_state: marketState,
    intl: intlResult,
    taiwan: taiwanResult,
    tx_futures_raw: txQuotes,
  };
  const sectorRadarEntry = { generated_at_taipei: generatedAtTaipei, sectors: sectorRadar };

  appendDailyEntry(`data/market-state/${todayIso}.json`, todayIso, marketStateEntry);
  appendDailyEntry(`data/sector-radar/${todayIso}.json`, todayIso, sectorRadarEntry);
  writeJson('data/quotes/latest.json', { generated_at_taipei: generatedAtTaipei, quotes: quoteByCode });

  console.log('=== 完成，已寫入 ===');
  console.log(`  data/market-state/${todayIso}.json`);
  console.log(`  data/sector-radar/${todayIso}.json`);
  console.log('  data/quotes/latest.json');
}

main().catch((err) => {
  console.error('run-engine 執行失敗：', err);
  process.exitCode = 1;
});
