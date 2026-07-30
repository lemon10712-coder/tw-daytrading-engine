// 健檢：確認 run-engine.mjs 有沒有真的照排程跑，資料是不是新鮮。
// 只有在「盤中應該要有新資料卻沒有」時才回傳失敗（process.exitCode = 1），
// 讓呼叫的 GitHub Actions workflow 能觸發 LINE 失敗通知——呼應 daily-trading-site
// 的教訓：排程「有沒有跑」不能只放在 GitHub 後台等人發現，要主動通知。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taipeiNow, formatDateYYYYMMDD } from './lib/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function minutesBetween(aTaipei, bTaipei) {
  return Math.abs(aTaipei.getTime() - bTaipei.getTime()) / 60000;
}

function parseTaipeiTimestamp(str) {
  // "2026-07-31 09:05:12" -> Date（用本機環境時區解析字串裡的時分秒欄位，
  // 因為字串本身就是台北時間的文字表示，不是 ISO/UTC）
  const [datePart, timePart] = str.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function main() {
  const now = taipeiNow();
  const todayIso = formatDateYYYYMMDD(now);
  const hour = now.getHours();
  const minute = now.getMinutes();
  const minutesSinceMidnight = hour * 60 + minute;
  const marketOpen = 9 * 60; // 09:00
  const marketCloseBuffer = 13 * 60 + 40; // 13:40（收盤後留10分鐘緩衝再要求最後一筆資料）

  const marketStateDoc = loadJson('data/market-state/latest.json');
  const sectorRadarDoc = loadJson('data/sector-radar/latest.json');

  const issues = [];

  if (!marketStateDoc || !sectorRadarDoc) {
    issues.push('data/market-state/latest.json 或 data/sector-radar/latest.json 不存在，run-engine 可能從未成功執行過');
  } else {
    const entry = marketStateDoc.entry;
    const trading = entry.trading_day;

    if (trading.isTradingDay === true) {
      const entryTime = parseTaipeiTimestamp(entry.generated_at_taipei);
      const ageMinutes = minutesBetween(now, entryTime);
      const isMarketHours = minutesSinceMidnight >= marketOpen && minutesSinceMidnight <= marketCloseBuffer;

      if (marketStateDoc.date !== todayIso && minutesSinceMidnight >= marketOpen) {
        issues.push(`今天（${todayIso}）是交易日，但最新資料日期是 ${marketStateDoc.date}，盤中應有更新的資料卻沒有`);
      } else if (isMarketHours && ageMinutes > 15) {
        issues.push(`目前是盤中時段，但最新資料是 ${ageMinutes.toFixed(0)} 分鐘前的（${entry.generated_at_taipei}），超過 15 分鐘門檻，排程可能沒有正常觸發`);
      }
    }
    // 非交易日／盤前／盤後不強制要求資料新鮮，避免誤報
  }

  const generatedSummary = marketStateDoc
    ? `最新資料時間：${marketStateDoc.entry.generated_at_taipei}，大盤狀態：${marketStateDoc.entry.market_state.state}`
    : '無資料';

  console.log(`=== 健檢（台北時間 ${todayIso} ${now.toTimeString().slice(0, 8)}）===`);
  console.log(generatedSummary);

  if (issues.length > 0) {
    console.log('\n發現問題：');
    issues.forEach((issue) => console.log(`  - ${issue}`));
    process.exitCode = 1;
  } else {
    console.log('\n健檢通過，無異常。');
  }
}

main();
