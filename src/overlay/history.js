import { vrPoint } from "./strategy.js";

export const HISTORY_KEY = "asset_history_v1";

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function readHistory(raw) {
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.some((r) => !r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)
    || !Number.isFinite(r.assets) || !Number.isFinite(r.invested))) {
    throw new Error("자산 기록을 읽을 수 없습니다. 기존 기록은 덮어쓰지 않습니다.");
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function makeRecord(snap, now = new Date()) {
  if (!snap.started) return null;
  if (![snap.cash, snap.marketValue, snap.invested, snap.shares].every(Number.isFinite)
    || (snap.shares > 0 && (!Number.isFinite(snap.extra?.priceUsed) || snap.extra.priceUsed <= 0))) {
    throw new Error(`${snap.label}: 유효한 평가 가격을 입력하세요.`);
  }
  return { date: localDate(now), savedAt: now.toISOString(), assets: snap.cash + snap.marketValue,
    invested: snap.invested, price: snap.extra?.priceUsed ?? null,
    priceSource: snap.extra?.priceIsLive ? "입력 현재가" : "저장 종가",
    ...(snap.extra?.V != null ? { vr: vrPoint({ ...snap.extra, pool: snap.cash }, snap.marketValue) } : {}) };
}

export function upsertRecord(rows, record) {
  return [...rows.filter((r) => r.date !== record.date), record].sort((a, b) => a.date.localeCompare(b.date));
}

// 합계는 선택 범위의 모든 계좌가 실제로 기록된 날짜만 사용한다.
export function aggregateHistory(histories) {
  if (!histories.length) return [];
  const maps = histories.map((rows) => new Map(rows.map((r) => [r.date, r])));
  return [...maps[0].keys()].sort().flatMap((date) => {
    const rows = maps.map((m) => m.get(date));
    if (rows.some((r) => !r)) return [];
    return [{ date, assets: rows.reduce((n, r) => n + r.assets, 0), invested: rows.reduce((n, r) => n + r.invested, 0) }];
  });
}

export function filterPeriod(rows, days, now = new Date()) {
  if (!days) return rows;
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  const from = localDate(start);
  return rows.filter((r) => r.date >= from && r.date <= localDate(now));
}
