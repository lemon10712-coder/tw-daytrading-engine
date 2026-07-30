// 共用工具，兩個頁面（index.html／sectors.html）都會用到。
// 沒有後端，純讀 data/ 底下的 latest.json 靜態檔案渲染。

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

function renderDataWarnings(containerEl, warnings) {
  if (!warnings || warnings.length === 0) {
    containerEl.style.display = 'none';
    return;
  }
  containerEl.style.display = 'block';
  containerEl.innerHTML = `<strong>資料缺失／需注意</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
}
