export const MUBAE_KEYS = {
  mubaeSingle: "mubae_v4_soxl40_state_v1",
  mubaeMulti: "mubae_v4_multi_state_v1",
};

export function canAddCycleFunds(s) {
  if (!s?.initialized || s.cycle <= 1 || s.shares !== 0 || s.T !== 0 || s.mode !== "general") return false;
  const history = Array.isArray(s.history) ? s.history : [];
  const last = history.filter((h) => h.kind !== "funding").at(-1);
  return last?.prevSnapshot?.cycle === s.cycle - 1 && last.after?.shares === 0;
}

export function stateRecord(previous, next, kind, message, now = new Date()) {
  const { history, ...prevSnapshot } = previous;
  return {
    kind, date: now.toISOString().slice(0, 10), close: previous.lastClose,
    mode: previous.mode, buys: [], sells: [], realizedDay: 0, events: [], modeMsg: message,
    after: { T: next.T, avg: next.avg, shares: next.shares, cash: next.cash, mode: next.mode },
    prevSnapshot,
  };
}

export function addCycleFunds(s, input, now = new Date()) {
  if (!canAddCycleFunds(s)) throw new Error("사이클 종료 후 다음 사이클의 첫 매수 전에만 추가할 수 있습니다.");
  const text = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("추가 금액은 소수 둘째 자리까지 입력하세요.");
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("추가 금액은 0보다 큰 유효한 금액이어야 합니다.");
  const next = { ...s };
  for (const key of ["cash", "principal", "cycleStartCash"]) {
    const total = Math.round(s[key] * 100) + cents;
    if (!Number.isFinite(s[key]) || !Number.isSafeInteger(total) || total < 0) throw new Error("잔고를 확인하세요.");
    next[key] = total / 100;
  }
  const entry = stateRecord(s, next, "funding", `사이클 ${s.cycle} 추가 입금 $${(cents / 100).toFixed(2)} — 수익이 아닌 투입원금`, now);
  entry.amount = cents / 100;
  next.history = [...s.history, entry];
  return next;
}

// 원본 UI의 수동 보정은 이력을 만들지 않으므로 저장 경계에서 보완한다.
export function captureManualAdjustment(previous, next) {
  if (!previous?.initialized || !next?.initialized || !Array.isArray(previous.history)
    || JSON.stringify(previous.history) !== JSON.stringify(next.history)
    || !["cash", "shares", "avg", "T"].some((k) => previous[k] !== next[k])) return next;
  return { ...next, history: [...next.history, stateRecord(previous, next, "adjustment", "수동 잔고 보정 — 되돌리기 가능")] };
}
