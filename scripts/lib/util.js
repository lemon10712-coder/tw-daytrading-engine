export function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// TWSE MIS 的五檔字串格式如 "2210.0000_2215.0000_2220.0000_" ，用底線分隔、可能有結尾空字串
export function parseLevels(str) {
  if (!str) return [];
  return str.split('_').filter((s) => s !== '').map(Number);
}

export function yyyymmddToIso(yyyymmdd) {
  if (!yyyymmdd || String(yyyymmdd).length !== 8) return null;
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// 有限併發的 map，避免對外部 API（尤其 Yahoo Finance，單次要對幾十檔股票各打一次）
// 一次全部平行發送造成被限流或大量失敗。失敗的項目回傳 { error } 而不是讓整批中斷。
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      try {
        results[current] = { ok: true, value: await fn(items[current], current) };
      } catch (err) {
        results[current] = { ok: false, error: err.message };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
