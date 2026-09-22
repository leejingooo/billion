import { test } from "node:test";
import assert from "node:assert/strict";
import { readHistory, makeRecord, upsertRecord, aggregateHistory, filterPeriod } from "../overlay/history.js";

const a = { date: "2026-09-01", assets: 1200, invested: 1000 };
const b = { date: "2026-09-22", assets: 1700, invested: 1500 };
test("하루 한 기록으로 교체하고 과거 날짜는 보존", () => {
  assert.deepEqual(upsertRecord([a, b], { ...b, assets: 1800 }), [a, { ...b, assets: 1800 }]);
});
test("총자산은 모든 계좌가 기록된 날짜만 합산", () => {
  assert.deepEqual(aggregateHistory([[a, b], [b]]), [{ ...b, assets: 3400, invested: 3000 }]);
  assert.deepEqual(aggregateHistory([[a], []]), []);
  assert.deepEqual(aggregateHistory([]), []);
});
test("빈 기록은 허용하고 손상된 기록은 덮어쓰지 않음", () => {
  assert.deepEqual(readHistory(null), []);
  for (const raw of ["{}", "invalid", '[{"date":"2026-09-01","assets":null,"invested":1}]']) assert.throws(() => readHistory(raw));
});
test("평가액은 현금 포함, 보유 주식의 가격 누락은 저장 차단", () => {
  const snap = { started: true, label: "VR", cash: 200, marketValue: 1000, invested: 1000, shares: 10, extra: { priceUsed: 100 } };
  assert.equal(makeRecord(snap).assets, 1200);
  assert.throws(() => makeRecord({ ...snap, extra: {} }));
  assert.throws(() => makeRecord({ ...snap, extra: { priceUsed: -1 } }));
  assert.throws(() => makeRecord({ ...snap, invested: NaN }));
  assert.equal(makeRecord({ ...snap, shares: 0, marketValue: 0, extra: {} }).assets, 200);
});
test("30일 필터는 기기 날짜 기준 경계를 포함", () => {
  const rows = ["2026-08-23", "2026-08-24", "2026-09-22", "2026-09-23"].map((date) => ({ ...a, date }));
  assert.deepEqual(filterPeriod(rows, 30, new Date(2026, 8, 22)).map((r) => r.date), ["2026-08-24", "2026-09-22"]);
});
