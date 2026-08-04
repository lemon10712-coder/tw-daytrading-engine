// 三大法人「動向解讀」——純規則式計算，輸入只用 fetch-institutional.mjs 已經抓到、
// 交叉驗證過的 trend 陣列（近期已結算交易日的外資/投信/自營商/合計淨額），不呼叫任何
// AI/LLM、不臆測未來，所有文字都是從實際數字直接衍生出來的。
//
// trend 陣列格式（來自 fetch-institutional.mjs 的 buildTrend）：
// [{ date, foreignNet, trustNet, dealerNet, totalNet }, ...]，已按日期由舊到新排序。

const GROUPS = [
  { key: 'foreignNet', label: '外資' },
  { key: 'trustNet', label: '投信' },
  { key: 'dealerNet', label: '自營商' },
  { key: 'totalNet', label: '三大法人合計' },
];

const MIN_TREND_DAYS_FOR_CONFIDENCE = 5;

function sign(v) {
  if (v == null) return null;
  if (v > 0) return 'buy';
  if (v < 0) return 'sell';
  return 'flat';
}

function directionLabel(prevSign, curSign) {
  if (curSign == null) return '無資料';
  if (prevSign == null) return curSign === 'buy' ? '買超（無前一日可比較）' : curSign === 'sell' ? '賣超（無前一日可比較）' : '持平（無前一日可比較）';
  if (prevSign === curSign) return curSign === 'buy' ? '維持買超' : curSign === 'sell' ? '維持賣超' : '維持持平';
  if (curSign === 'buy') return prevSign === 'sell' ? '由賣轉買' : '轉為買超';
  if (curSign === 'sell') return prevSign === 'buy' ? '由買轉賣' : '轉為賣超';
  return '轉為持平';
}

// 從最新一天往回數，同方向（buy/sell，不含flat）連續幾天。
function streakLength(series) {
  if (series.length === 0) return 0;
  const latestSign = sign(series[series.length - 1]);
  if (latestSign == null || latestSign === 'flat') return latestSign === 'flat' ? 1 : 0;
  let count = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (sign(series[i]) === latestSign) count++;
    else break;
  }
  return count;
}

function groupAnalysis(label, values) {
  const cur = values[values.length - 1] ?? null;
  const prev = values.length >= 2 ? values[values.length - 2] : null;
  const curSign = sign(cur);
  const prevSign = sign(prev);
  const streak = streakLength(values);
  return {
    label,
    latest_net: cur,
    previous_net: prev,
    direction: directionLabel(prevSign, curSign),
    streak_days: streak,
    streak_note: streak >= 2 ? `已連續 ${streak} 個已結算交易日${curSign === 'buy' ? '買超' : curSign === 'sell' ? '賣超' : '持平'}` : null,
  };
}

// 主函式：輸入 trend（近期已結算交易日陣列，由舊到新），輸出結構化分析結果。
export function analyzeInstitutionalTrend(trend) {
  const days = Array.isArray(trend) ? trend : [];
  const dataPointCount = days.length;
  const dataLimitationNote =
    dataPointCount < MIN_TREND_DAYS_FOR_CONFIDENCE
      ? `目前只累積了 ${dataPointCount} 個已結算交易日的資料，樣本數過少，連續買賣超天數與方向判斷僅供參考，至少累積 ${MIN_TREND_DAYS_FOR_CONFIDENCE} 天以上才有比較穩定的趨勢意義。`
      : null;

  const groups = GROUPS.map((g) => groupAnalysis(g.label, days.map((d) => d[g.key])));
  const [foreign, trust, dealer, total] = groups;

  let headline;
  if (dataPointCount === 0) {
    headline = '目前沒有任何已結算的三大法人資料，無法產生解讀。';
  } else if (dataPointCount === 1) {
    headline = `目前只有單一交易日（${days[0].date}）資料，尚無法比較方向變化，僅列出當日數字：三大法人合計${total.latest_net > 0 ? '買超' : total.latest_net < 0 ? '賣超' : '持平'}。`;
  } else {
    const parts = [`三大法人合計${total.direction}`];
    if (total.streak_note) parts.push(total.streak_note);
    const buyGroups = groups.slice(0, 3).filter((g) => sign(g.latest_net) === 'buy').map((g) => g.label);
    const sellGroups = groups.slice(0, 3).filter((g) => sign(g.latest_net) === 'sell').map((g) => g.label);
    if (buyGroups.length > 0) parts.push(`今日買超方為：${buyGroups.join('、')}`);
    if (sellGroups.length > 0) parts.push(`今日賣超方為：${sellGroups.join('、')}`);
    headline = parts.join('；') + '。';
  }

  return {
    data_point_count: dataPointCount,
    data_limitation_note: dataLimitationNote,
    headline,
    groups: { foreign, trust, dealer, total },
  };
}
