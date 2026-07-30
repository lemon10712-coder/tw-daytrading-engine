// 大盤方向判斷引擎：規則式，分兩層（第一層國際市場、第二層台股整體），
// 依規格書「不得只看個股就直接給方向」的原則，只有兩層訊號一致時才給出
// 偏多／偏空，任何缺資料或訊號衝突的狀況都保守輸出「觀望」或「資料不足」，
// 不會為了畫面好看硬掰一個方向。

function classifyReturn(pctChange, flatBandPct) {
  if (pctChange == null) return null;
  if (pctChange > flatBandPct / 100) return 'up';
  if (pctChange < -flatBandPct / 100) return 'down';
  return 'flat';
}

// intlSignals: [{ name, pctChange }]，pctChange 是小數（0.01 = 1%）
export function classifyInternational(intlSignals, thresholds = {}) {
  const { flat_band_pct = 0.3, min_intl_signals_for_valid = 1 } = thresholds;
  const valid = (intlSignals || []).filter((s) => s.pctChange != null);
  if (valid.length < min_intl_signals_for_valid) {
    return {
      direction: '資料不足',
      reason: `有效國際指標樣本數 ${valid.length} 項，低於門檻 ${min_intl_signals_for_valid} 項`,
      avgReturn: null,
      signals: valid,
    };
  }
  const classified = valid.map((s) => ({ ...s, state: classifyReturn(s.pctChange, flat_band_pct) }));
  const upCount = classified.filter((s) => s.state === 'up').length;
  const downCount = classified.filter((s) => s.state === 'down').length;
  const avgReturn = valid.reduce((sum, s) => sum + s.pctChange, 0) / valid.length;

  let direction;
  if (upCount > downCount && avgReturn > 0) direction = '偏多';
  else if (downCount > upCount && avgReturn < 0) direction = '偏空';
  else direction = '中性';

  return {
    direction,
    reason: `${valid.length} 項國際指標中 ${upCount} 項上漲、${downCount} 項下跌，平均漲跌幅 ${(avgReturn * 100).toFixed(2)}%`,
    avgReturn,
    signals: classified,
  };
}

export function classifyTaiwanMarket({ taiexPctChange, tpexPctChange, txFuturesBasisPct } = {}, thresholds = {}) {
  const { flat_band_pct = 0.3 } = thresholds;
  const signals = [];
  if (taiexPctChange != null) {
    signals.push({ name: '加權指數', pctChange: taiexPctChange, state: classifyReturn(taiexPctChange, flat_band_pct) });
  }
  if (tpexPctChange != null) {
    signals.push({ name: '櫃買指數', pctChange: tpexPctChange, state: classifyReturn(tpexPctChange, flat_band_pct) });
  }

  if (signals.length === 0) {
    return { direction: '資料不足', reason: '加權指數與櫃買指數皆無有效資料', avgReturn: null, signals: [], txBasisNote: null };
  }

  const upCount = signals.filter((s) => s.state === 'up').length;
  const downCount = signals.filter((s) => s.state === 'down').length;
  const avgReturn = signals.reduce((sum, s) => sum + s.pctChange, 0) / signals.length;

  let direction;
  if (upCount > downCount && avgReturn > 0) direction = '偏多';
  else if (downCount > upCount && avgReturn < 0) direction = '偏空';
  else direction = '中性';

  // 台指期對現貨的基差只當輔助資訊，不單獨決定方向（法人期貨部位是落後/間接指標）
  let txBasisNote = null;
  if (txFuturesBasisPct != null) {
    if (Math.abs(txFuturesBasisPct) >= flat_band_pct / 100) {
      txBasisNote = txFuturesBasisPct > 0
        ? `台指期正價差 ${(txFuturesBasisPct * 100).toFixed(2)}%`
        : `台指期逆價差 ${(txFuturesBasisPct * 100).toFixed(2)}%`;
    } else {
      txBasisNote = `台指期基差 ${(txFuturesBasisPct * 100).toFixed(2)}%，接近平盤`;
    }
  }

  return {
    direction,
    reason: signals.map((s) => `${s.name} ${(s.pctChange * 100).toFixed(2)}%`).join('、'),
    avgReturn,
    signals,
    txBasisNote,
  };
}

// 整合國際 + 台股兩層判斷。只有兩層方向一致才輸出偏多/偏空，
// 缺資料或訊號衝突一律保守輸出觀望/資料不足。
export function classifyMarketState({ intl, taiwan }) {
  const intlMissing = intl.direction === '資料不足';
  const twMissing = taiwan.direction === '資料不足';

  if (intlMissing && twMissing) {
    return { state: '資料不足', reason: '國際與台股資料皆不足，無法判斷', intl, taiwan };
  }
  if (twMissing) {
    return {
      state: '觀望',
      reason: `台股本身資料不足（僅國際指標可判斷為${intl.direction}），不足以單獨決定方向`,
      intl,
      taiwan,
    };
  }
  if (intlMissing) {
    return {
      state: '觀望',
      reason: `國際指標資料不足（僅台股本身可判斷為${taiwan.direction}），保守起見不單獨依賴台股本身判斷方向`,
      intl,
      taiwan,
    };
  }
  if (taiwan.direction === '中性') {
    return { state: '震盪', reason: '台股本身處於平盤區間，尚未確認方向', intl, taiwan };
  }
  if (intl.direction === taiwan.direction) {
    return { state: taiwan.direction, reason: `國際與台股方向一致（${taiwan.direction}）`, intl, taiwan };
  }
  return {
    state: '觀望',
    reason: `國際方向為${intl.direction}、台股方向為${taiwan.direction}，兩層訊號衝突`,
    intl,
    taiwan,
  };
}
