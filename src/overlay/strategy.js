const finite = Number.isFinite;
const positive = (n) => finite(n) && n > 0;

export function vrPoint(state, marketValue = null) {
  if (!state || !positive(state.V) || !finite(state.band) || state.band < 0 || state.band >= 1 || !finite(state.pool)) return null;
  return { V: state.V, lower: state.V * (1 - state.band), upper: state.V * (1 + state.band),
    pool: state.pool, marketValue: finite(marketValue) ? marketValue : null, cycle: state.cycle };
}

export function vrHistory(bundle, marketValue = null) {
  if (!bundle?.state) return [];
  const history = Array.isArray(bundle.hist) ? bundle.hist : [];
  return [...history, bundle.state].map((s, i) => {
    const current = i === history.length;
    const point = vrPoint(s, current ? marketValue : null);
    return point ? { ...point, label: `${current ? "현재" : `기록 ${i + 1}`} · 사이클 ${s.cycle}` } : null;
  });
}

export function mubaeCycles(state, fixedTicker = null) {
  if (!state?.initialized) return [];
  const ticker = fixedTicker || state.ticker;
  if (!["SOXL", "TQQQ"].includes(ticker)) return [];
  const groups = new Map();
  for (const h of Array.isArray(state.history) ? state.history : []) {
    const cycle = h.prevSnapshot?.cycle;
    if (!Number.isInteger(cycle)) continue;
    if (!groups.has(cycle)) groups.set(cycle, []);
    groups.get(cycle).push(h);
  }
  return [...groups].map(([cycle, entries]) => {
    const start = entries[0].prevSnapshot;
    const capital = start.cycleStartCash, price = start.lastClose;
    const error = !positive(capital) || !positive(price) || start.shares !== 0 || start.T !== 0
      || !finite(start.cash) || Math.abs(start.cash - capital) > 0.01
      ? "사이클 시작 잔고·기준 종가가 확인되지 않아 비교할 수 없습니다." : null;
    if (error) return { cycle, ticker, rows: [], error };
    let previousDate = "";
    const rows = [{ label: "시작 기준", actual: capital, buyHold: capital, capital, close: price }];
    for (const h of entries) {
      const p = h.prevSnapshot;
      if (typeof h.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || h.date < previousDate
        || !positive(h.close) || !finite(h.after?.cash) || !finite(h.after?.shares)
        || p.cycleStartCash !== capital || (p.ticker && p.ticker !== ticker)) {
        return { cycle, ticker, rows: [], error: "종가·잔고·날짜 또는 시작금이 일관되지 않아 비교를 표시하지 않습니다." };
      }
      previousDate = h.date;
      rows.push({ label: h.date, actual: h.after.cash + h.after.shares * h.close,
        buyHold: Math.round(capital * (h.close / price) * 100) / 100, capital, close: h.close });
    }
    return { cycle, ticker, capital, price, rows, error: null };
  });
}
