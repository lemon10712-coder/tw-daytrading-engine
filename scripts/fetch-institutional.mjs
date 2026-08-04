// 三大法人（外資／投信／自營商）盤後動向擷取。這是「盤後結算」資料，通常收盤後下午才會
// 有當天數字，設計上排程掛在收盤後（約14:30-15:00），跟盤中每5分鐘那組 run-engine.mjs
// 是完全獨立的排程與資料目錄，不要合併，理由見 NOTES.md。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taipeiNow, formatDateYYYYMMDD } from './lib/time.js';
import { fetchLatestSettledMarketSummary, fetchStockFlows } from './lib/institutional-investors.js';
import { analyzeInstitutionalTrend } from './lib/institutional-analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INSTITUTIONAL_DIR = 'data/institutional';
const TREND_LOOKBACK_DAYS = 20;

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function writeJson(relativePath, data) {
  const fullPath = path.join(ROOT, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// 用既有每日檔案（data/institutional/YYYY-MM-DD.json）反推近期趨勢，不用另外維護一份
// 累積檔案——跟 market-state/sector-radar 的「按日期分檔＋latest.json 彙總」慣例一致。
function buildTrend(currentDateIso, currentMarket) {
  const dir = path.join(ROOT, INSTITUTIONAL_DIR);
  let files = [];
  if (existsSync(dir)) {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${currentDateIso}.json`);
  }
  const trend = files
    .map((f) => {
      try {
        const doc = loadJson(`${INSTITUTIONAL_DIR}/${f}`);
        if (!doc.market?.settled) return null;
        return {
          date: doc.market.date,
          foreignNet: doc.market.foreign?.net ?? null,
          trustNet: doc.market.trust?.net ?? null,
          dealerNet: doc.market.dealer?.net ?? null,
          totalNet: doc.market.total?.net ?? null,
        };
      } catch {
        return null; // 單一檔案壞掉不該讓整個趨勢計算中斷
      }
    })
    .filter(Boolean);

  if (currentMarket.settled) {
    trend.push({
      date: currentMarket.date,
      foreignNet: currentMarket.foreign?.net ?? null,
      trustNet: currentMarket.trust?.net ?? null,
      dealerNet: currentMarket.dealer?.net ?? null,
      totalNet: currentMarket.total?.net ?? null,
    });
  }

  trend.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return trend.slice(-TREND_LOOKBACK_DAYS);
}

async function main() {
  const sectorsConfig = loadJson('config/sectors.json');
  const trackedCodes = [...new Set(sectorsConfig.sectors.flatMap((s) => s.representative_stocks.map((st) => st.code)))];

  const now = taipeiNow();
  const requestedDateIso = formatDateYYYYMMDD(now);
  const generatedAtTaipei = `${requestedDateIso} ${now.toTimeString().slice(0, 8)}`;

  console.log(`=== fetch-institutional 開始（台北時間 ${generatedAtTaipei}，要求日期 ${requestedDateIso}）===`);

  console.log('[全市場彙總] 查詢最近已結算交易日...');
  const market = await fetchLatestSettledMarketSummary(requestedDateIso);
  if (market.settled) {
    console.log(`[全市場彙總] 取得 ${market.date} 資料，合計買賣超 ${market.total?.net ?? 'N/A'} 元，內部勾稽 ${market.validation.matches ? '通過' : '⚠不一致'}`);
  } else {
    console.log(`[全市場彙總] 失敗：${market.reason}`);
  }

  let stockFlows = { date: requestedDateIso, settled: false, reason: '全市場彙總都查不到已結算資料，個股別略過', stocks: {}, missingCodes: trackedCodes };
  if (market.settled) {
    console.log(`[個股別] 查詢 ${market.date} 的 ${trackedCodes.length} 檔追蹤股票...`);
    stockFlows = await fetchStockFlows(market.date, trackedCodes);
    if (stockFlows.settled) {
      const gotCount = trackedCodes.length - stockFlows.missingCodes.length;
      console.log(`[個股別] 取得 ${gotCount}/${trackedCodes.length} 檔，勾稽不一致 ${stockFlows.validation.mismatches.length} 檔`);
      if (stockFlows.missingCodes.length > 0) {
        console.log(`  T86（上市）查無資料代號：${stockFlows.missingCodes.join(', ')}`);
        console.log('  已知限制：這份清單裡有些是上櫃股票（例如5347世界先進），T86 只收錄上市股票，上櫃三大法人資料（TPEx）尚未串接，屬於本次已知缺口，不是查詢出錯。');
        stockFlows.missingCodesNote = '查無資料的代號多半是上櫃股票——TWSE T86 只收錄上市股票，上櫃（TPEx）三大法人個股資料尚未串接，是已知功能缺口，不代表查詢失敗。';
      }
    } else {
      console.log(`[個股別] 失敗：${stockFlows.reason}`);
    }
  }

  const trend = buildTrend(market.date ?? requestedDateIso, market);
  const analysis = analyzeInstitutionalTrend(trend);
  console.log(`[動向解讀] ${analysis.headline}`);
  if (analysis.data_limitation_note) console.log(`[動向解讀] ⚠ ${analysis.data_limitation_note}`);

  const dayEntry = {
    requested_date: requestedDateIso,
    generated_at_taipei: generatedAtTaipei,
    market,
    tracked_stocks: stockFlows,
  };

  const latestDoc = {
    schema_version: 1,
    requested_date: requestedDateIso,
    resolved_date: market.settled ? market.date : null,
    generated_at_taipei: generatedAtTaipei,
    is_data_stale_vs_request: market.settled ? market.date !== requestedDateIso : null,
    market,
    tracked_stocks: stockFlows,
    trend, // 近 20 個已結算交易日的全市場買賣超金額，畫趨勢圖用
    analysis, // 規則式動向解讀（方向變化/連續天數/一句話總結），純從 trend 算出，非AI臆測
  };

  const targetFileDate = market.settled ? market.date : requestedDateIso;
  writeJson(`${INSTITUTIONAL_DIR}/${targetFileDate}.json`, dayEntry);
  writeJson(`${INSTITUTIONAL_DIR}/latest.json`, latestDoc);

  console.log('=== 完成，已寫入 ===');
  console.log(`  ${INSTITUTIONAL_DIR}/${targetFileDate}.json（當日原始資料）`);
  console.log(`  ${INSTITUTIONAL_DIR}/latest.json（給網站讀，含近 ${trend.length} 個交易日趨勢）`);
}

main().catch((err) => {
  console.error('fetch-institutional 執行失敗：', err);
  process.exitCode = 1;
});
