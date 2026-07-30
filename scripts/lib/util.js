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
