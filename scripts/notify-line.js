// 廣播純文字訊息到 LINE 官方帳號（沿用 daily-trading-site 已驗證的同一個 channel，
// 目前該帳號唯一好友就是使用者本人，broadcast 等於私訊）。Token 一律從環境變數讀，
// 不寫死在程式碼裡；GitHub Secret 不能跨 repo 共用，這個 repo 要另外設定一份。
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const message = process.argv[2];

if (!message) {
  console.error('Usage: node notify-line.js "<message text>"');
  process.exit(1);
}
if (!token) {
  console.error('LINE_CHANNEL_ACCESS_TOKEN 未設定，跳過 LINE 推播（不讓整個 workflow 失敗）。');
  process.exit(0);
}

async function main() {
  const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ type: 'text', text: message.slice(0, 4900) }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE 推播失敗（HTTP ${res.status}）：${body}`);
    process.exit(1);
  }
  console.log('LINE 推播已送出。');
}

main();
