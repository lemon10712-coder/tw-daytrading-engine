// 組出 LINE 摘要訊息文字（盤前完成／收盤摘要用），輸出到 stdout，
// 讓 workflow 用 `node scripts/build-summary-message.mjs | xargs -0 ... notify-line.js` 這類方式串接。
// 拆成獨立檔案而不是塞進 workflow yaml 裡的 inline script，方便本機直接測試訊息長相。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const label = process.argv[2] || 'update'; // 'premarket' | 'close' | 'update'

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function main() {
  const marketDoc = loadJson('data/market-state/latest.json');
  const entry = marketDoc.entry;

  const labelText = { premarket: '【盤前總覽】', close: '【收盤摘要】', update: '【盤中更新】' }[label] || '【更新】';

  const lines = [
    `台股當沖決策輔助系統 ${labelText}`,
    entry.generated_at_taipei,
    `大盤方向：${entry.market_state.state}`,
    entry.market_state.reason,
    '',
    `國際：${entry.intl.direction}｜台股：${entry.taiwan.direction}`,
    '',
    'https://lemon10712-coder.github.io/tw-daytrading-engine/',
  ];

  console.log(lines.join('\n'));
}

main();
