// 共用工具，index.html 用。沒有後端，純讀 data/ 底下的 latest.json 靜態檔案渲染。

async function fetchJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`); // 避開瀏覽器快取，5分鐘更新一次的資料不該被快取卡住
  if (!res.ok) throw new Error(`讀取 ${path} 失敗：HTTP ${res.status}`);
  return res.json();
}

function pctClass(pct) {
  if (pct == null) return 'flat';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

function formatPct(pct) {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${(pct * 100).toFixed(2)}%`;
}

function formatPrice(price) {
  if (price == null) return '—';
  return price.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 三大法人買賣金額原始單位是「元」，數字動輒上億，直接顯示一長串位數不好讀，
// 換算成「億」為單位（保留2位小數）；小於1億的金額換算成「萬」，避免顯示成 0.00億。
function formatTwdAmount(amount) {
  if (amount == null) return '—';
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}萬`;
  return `${sign}${abs.toLocaleString('zh-TW')}元`;
}

// 三大法人個股別買賣超單位是「股」，換算成「張」（1張=1000股）比較符合台股慣例的閱讀方式
function formatShares(shares) {
  if (shares == null) return '—';
  const sign = shares > 0 ? '+' : shares < 0 ? '-' : '';
  const lots = Math.abs(shares) / 1000;
  return `${sign}${lots.toLocaleString('zh-TW', { maximumFractionDigits: 1 })}張`;
}

// 買超（正值）用紅色（--up），賣超（負值）用綠色（--down），跟現有 pctClass 語意一致，
// 只是這裡輸入是原始金額/股數而不是百分比
function netClass(value) {
  if (value == null) return 'flat';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function renderDataWarnings(containerEl, warnings) {
  if (!warnings || warnings.length === 0) {
    containerEl.style.display = 'none';
    return;
  }
  containerEl.style.display = 'block';
  containerEl.innerHTML = `<strong>資料缺失／需注意</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
}

// "2026-07-31 09:05:12" -> Date（字串本身就是台北時間的文字表示）
function parseTaipeiTimestamp(str) {
  const [datePart, timePart] = str.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function formatRelativeTime(taipeiStr) {
  const target = parseTaipeiTimestamp(taipeiStr);
  const diffMs = Date.now() - target.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return '剛剛更新';
  if (diffMin < 60) return `${diffMin} 分鐘前更新`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前更新`;
  return `${Math.round(diffHr / 24)} 天前更新`;
}
