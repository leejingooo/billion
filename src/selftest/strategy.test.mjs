import { test } from "node:test";
import assert from "node:assert/strict";
import { vrPoint, vrHistory, mubaeCycles } from "../overlay/strategy.js";
import { makeRecord } from "../overlay/history.js";

const start = { cycle: 1, cycleStartCash: 1000, lastClose: 100, shares: 0, cash: 1000, T: 0, ticker: "TQQQ" };
const day = (date, close, prevSnapshot, cash, shares) => ({ date, close, prevSnapshot, after: { cash, shares } });
test("단순 보유는 같은 시작금/직전종가, 전략은 잔금 포함", () => {
  const [cycle] = mubaeCycles({ initialized: true, ticker: "TQQQ", history: [day("2026-09-01", 110, start, 500, 5)] });
  assert.equal(cycle.rows[0].actual, 1000);
  assert.equal(cycle.rows[1].actual, 1050);
  assert.equal(cycle.rows[1].buyHold, 1100);
});
test("전량 매도일은 이전 사이클에 포함하며 다음 사이클 기준을 새로 설정", () => {
  const cycles = mubaeCycles({ initialized: true, ticker: "TQQQ", history: [
    day("2026-09-01", 110, start, 500, 5),
    day("2026-09-02", 120, { ...start, T: 1, shares: 5, cash: 500 }, 1100, 0),
    day("2026-09-03", 132, { ...start, cycle: 2, cycleStartCash: 1100, cash: 1100, lastClose: 120 }, 572, 4),
  ] });
  assert.equal(cycles[0].rows.at(-1).actual, 1100);
  assert.equal(cycles[0].rows.at(-1).buyHold, 1200);
  assert.equal(cycles[1].rows[0].actual, 1100);
  assert.equal(cycles[1].rows[1].buyHold, 1210);
});
test("단일 SOXL 종목 판별 및 소수점 주식 가정", () => {
  const [c] = mubaeCycles({ initialized: true, history: [day("2026-09-01", 60, { ...start, ticker: undefined, lastClose: 30 }, 700, 5)] }, "SOXL");
  assert.equal(c.ticker, "SOXL"); assert.equal(c.rows[1].buyHold, 2000);
});
test("불완전한 시작 이력과 잘못된 가격/날짜/시작금은 비교 차단", () => {
  const build = (h) => mubaeCycles({ initialized: true, ticker: "TQQQ", history: h })[0];
  assert.ok(build([day("2026-09-01", 110, { ...start, shares: 5 }, 500, 5)]).error);
  assert.ok(build([day("2026-09-01", 0, start, 500, 5)]).error);
  assert.ok(build([day("2026-09-02", 100, start, 500, 5), day("2026-09-01", 110, start, 500, 5)]).error);
  assert.ok(build([day("2026-09-01", 100, start, 500, 5), day("2026-09-02", 110, { ...start, cycleStartCash: 2000 }, 1500, 5)]).error);
  assert.deepEqual(mubaeCycles({ initialized: true, history: [] }), []);
});
test("VR 밴드는 V 기준이며 Pool은 평가액에 합산하지 않음", () => {
  const p = vrPoint({ V: 1000, band: .15, pool: 200, cycle: 3 }, 900);
  assert.equal(p.lower, 850); assert.equal(p.upper, 1150); assert.equal(p.marketValue, 900);
  assert.equal(p.pool, 200);
});
test("VR 같은 사이클의 여러 상태 보존, 과거 평가액은 추정하지 않음", () => {
  const s = { V: 1000, band: .15, pool: 200, cycle: 3 };
  const rows = vrHistory({ hist: [s, { ...s, pool: 150 }], state: s }, 1100);
  assert.equal(rows.length, 3); assert.equal(rows[0].marketValue, null); assert.equal(rows[2].marketValue, 1100);
  assert.equal(vrPoint({ ...s, band: NaN }), null);
});
test("일별 기록은 그날의 VR 상태를 보관", () => {
  const r = makeRecord({ started: true, cash: 200, marketValue: 900, invested: 1000, shares: 10, extra: { V: 1000, band: .15, cycle: 3, priceUsed: 90 } });
  assert.equal(r.assets, 1100); assert.equal(r.vr.marketValue, 900); assert.equal(r.vr.V, 1000);
});
