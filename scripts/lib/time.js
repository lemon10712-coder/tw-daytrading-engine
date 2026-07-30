const TAIPEI_TZ = 'Asia/Taipei';
const HOLIDAY_SCHEDULE_URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';

// 回傳「目前台北時間」的 Date 物件（其 getFullYear/getMonth/getDate/getDay/getHours 等
// 欄位讀出來就是台北時間，不受執行環境本身時區影響——GitHub Actions runner 預設是 UTC）
export function taipeiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TAIPEI_TZ }));
}

export function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// TWSE OpenAPI 的日期是民國年（例：'1150101' = 民國115年1月1日 = 2026-01-01）
export function rocDateToIso(rocDate) {
  const roc = String(rocDate);
  const year = parseInt(roc.slice(0, roc.length - 4), 10) + 1911;
  const month = roc.slice(-4, -2);
  const day = roc.slice(-2);
  return `${year}-${month}-${day}`;
}

export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function parseHolidaySchedule(rawArray) {
  if (!Array.isArray(rawArray)) {
    throw new Error('TWSE 假日行事曆回傳格式不是陣列，無法解析');
  }
  return rawArray.map((item) => ({
    date: rocDateToIso(item.Date),
    name: item.Name,
    weekday: item.Weekday,
  }));
}

export async function fetchHolidaySchedule(fetchImpl = fetch) {
  const res = await fetchImpl(HOLIDAY_SCHEDULE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) {
    throw new Error(`TWSE 假日行事曆 API 呼叫失敗：HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseHolidaySchedule(raw);
}

// 判斷某天是否為交易日。這是「盤前模組」的第 0 步，daily-trading-site 曾經因為
// 沒查交易日曆（2026-07-10 颱風休市）生出不該存在的進場建議，這裡刻意用官方
// TWSE OpenAPI 即時查證，不用寫死在程式碼裡的假日清單（每年都要手動更新、容易漏）。
// 查不到時明確回傳 isTradingDay: null（無法驗證），不能假裝已確認。
export async function isTradingDay(date, fetchImpl = fetch) {
  const iso = formatDateYYYYMMDD(date);
  if (isWeekend(date)) {
    return { date: iso, isTradingDay: false, reason: '週末', source: 'weekday_calc' };
  }
  try {
    const holidays = await fetchHolidaySchedule(fetchImpl);
    const match = holidays.find((h) => h.date === iso);
    if (match) {
      return { date: iso, isTradingDay: false, reason: match.name, source: 'twse_openapi' };
    }
    return { date: iso, isTradingDay: true, reason: null, source: 'twse_openapi' };
  } catch (err) {
    return {
      date: iso,
      isTradingDay: null,
      reason: `無法查證：TWSE 假日行事曆 API 呼叫失敗（${err.message}）。已知非週末，但實際是否臨時休市（例如颱風）無法確認`,
      source: 'fetch_failed',
    };
  }
}
