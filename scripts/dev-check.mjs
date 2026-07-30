// 手動即時驗證用的小工具，不是自動化排程的一部分，也不是單元測試（單元測試在 scripts/test/
// 用 fixture 資料跑，不依賴即時網路）。開發時想確認四個真實資料來源目前是否正常運作時執行：
//   npm run dev-check
import { fetchTwseQuotes } from './lib/twse-quotes.js';
import { fetchYahooChart } from './lib/yahoo-finance.js';
import { fetchTaifexQuotes } from './lib/taifex-futures.js';
import { isTradingDay, taipeiNow, formatDateYYYYMMDD } from './lib/time.js';

async function main() {
  const now = taipeiNow();
  console.log(`=== 即時資料來源健檢（台北時間 ${formatDateYYYYMMDD(now)} ${now.toTimeString().slice(0, 8)}）===\n`);

  try {
    const trading = await isTradingDay(now);
    console.log('[交易日曆]', trading);
  } catch (err) {
    console.log('[交易日曆] 失敗：', err.message);
  }

  try {
    const quotes = await fetchTwseQuotes(['2330', '2454']);
    console.log('\n[TWSE 即時報價] 成功，範例：', quotes[0]);
  } catch (err) {
    console.log('\n[TWSE 即時報價] 失敗：', err.message);
  }

  try {
    const chart = await fetchYahooChart('2330.TW', { interval: '1m', range: '1d' });
    console.log('\n[Yahoo 分鐘K線] 成功，bars 筆數：', chart.bars.length, '最新一筆：', chart.bars.at(-1));
  } catch (err) {
    console.log('\n[Yahoo 分鐘K線] 失敗：', err.message);
  }

  try {
    const sox = await fetchYahooChart('^SOX', { interval: '1d', range: '5d' });
    console.log('\n[Yahoo 國際指標 SOX] 成功，最新收盤：', sox.bars.at(-1)?.close);
  } catch (err) {
    console.log('\n[Yahoo 國際指標 SOX] 失敗：', err.message);
  }

  try {
    const taifex = await fetchTaifexQuotes();
    console.log('\n[TAIFEX 台指期] 成功，筆數：', taifex.length, '第一筆：', taifex[0]);
  } catch (err) {
    console.log('\n[TAIFEX 台指期] 失敗：', err.message);
  }
}

main();
