import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createServer } from "vite";
import { addCycleFunds, canAddCycleFunds, captureManualAdjustment, MUBAE_KEYS } from "../features/cycleFunding.js";
import { mubaeCycles } from "../overlay/strategy.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const initial = { initialized: true, ticker: "SOXL", split: 20, principal: 1000, cash: 500, shares: 10, avg: 50,
  T: 10, mode: "general", revFirst: false, cycle: 1, realizedTotal: 0, cycleStartCash: 1000,
  closes: [50], lastClose: 50, bigPct: 10, history: [] };
function nativeEngine(type) {
  const source = readFileSync(new URL(`../programs/${type}/App.jsx`, import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source.split("/* ---------------- UI ---------------- */")[0].replace(/^import .*;\n/gm, ""), context);
  const undoBody = source.match(/  const undo = \(\) => \{([\s\S]*?)\n  \};/)[1];
  return {
    day: (s, buys, sells, close) => clone(vm.runInContext(`applyDay(${JSON.stringify(s)}, ${JSON.stringify({ date: "2026-09-23", close, filledBuys: buys, filledSells: sells })}).ns`, context)),
    undo: (s) => {
      let result;
      vm.runInNewContext(`(() => {${undoBody}})()`, { s: clone(s), persist: (v) => { result = clone(v); }, setFlash() {}, setTimeout() {} });
      return result;
    },
  };
}
for (const type of Object.keys(MUBAE_KEYS)) {
  test(`${type}: 전량매도 → 추가 입금 2회 → 매수 → 연속 되돌리기, JSON 복원`, () => {
    const engine = nativeEngine(type);
    const end = engine.day(initial, [], [{ qty: 10, fillPrice: 60, type: "LIMIT", label: "지정가" }], 60);
    assert.equal(end.cycle, 2); assert.equal(end.cash, 1100); assert.equal(end.realizedTotal, 100);
    assert.ok(canAddCycleFunds(end));
    const funded = clone(addCycleFunds(end, "200.25"));
    const twice = clone(addCycleFunds(funded, "99.75"));
    assert.equal(twice.cash, 1400); assert.equal(twice.cycleStartCash, 1400);
    assert.equal(twice.realizedTotal, 100); assert.equal(twice.cash - twice.realizedTotal, 1300);
    const bought = engine.day(twice, [{ qty: 1, fillPrice: 60, label: "", type: "LOC" }], [], 60);
    assert.equal(bought.cash, 1340); assert.equal(bought.shares, 1); assert.ok(!canAddCycleFunds(bought));
    assert.deepEqual(engine.undo(bought), twice);
    assert.deepEqual(engine.undo(twice), funded);
    assert.deepEqual(engine.undo(funded), end);
    assert.deepEqual(engine.undo(end), initial);
    const cycle = mubaeCycles(bought).find((c) => c.cycle === 2);
    assert.equal(cycle.error, null); assert.equal(cycle.capital, 1400); assert.equal(cycle.rows.at(-1).actual, 1400);
  });
  test(`${type}: 수동 잔고 보정은 이력에 추가되어 이전 매매를 취소하지 않고 복원`, () => {
    const engine = nativeEngine(type);
    const adjusted = captureManualAdjustment(initial, { ...initial, cash: 700, shares: 11, avg: 49, T: 12 });
    assert.equal(adjusted.history.length, 1);
    assert.deepEqual(engine.undo(clone(adjusted)), initial);
    assert.strictEqual(captureManualAdjustment(initial, initial), initial);
  });
}
test("잘못된 입금액/진행 중/첫 사이클/손상된 잔고는 변경 없이 차단", () => {
  const end = nativeEngine("mubaeSingle").day(initial, [], [{ qty: 10, fillPrice: 60, type: "LIMIT", label: "지정가" }], 60);
  const before = clone(end);
  for (const amount of ["", "0", "-1", "NaN", "Infinity", "1e3", "1.001", "12oops", "9007199254740991"]) assert.throws(() => addCycleFunds(end, amount));
  for (const s of [initial, { ...end, cycle: 1 }, { ...end, shares: 1 }, { ...end, cash: NaN }]) assert.throws(() => addCycleFunds(s, "100"));
  assert.deepEqual(end, before);
});

test("실제 저장 어댑터: 보정/입금 계좌 격리, 보관 합계 제외와 복원, 기록 유지", async () => {
  const values = new Map(); const events = [];
  globalThis.window = { localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: (k) => values.delete(k), key: (i) => [...values.keys()][i], get length() { return values.size; } }, dispatchEvent: (e) => events.push(e.detail) };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  try {
    const accounts = await server.ssrLoadModule("/src/storage/accounts.js");
    const adapter = await server.ssrLoadModule("/src/storage/adapter.js");
    const { buildSnapshot, portfolioTotals } = await server.ssrLoadModule("/src/overlay/snapshot.js");
    const a = accounts.createAccount("mubaeSingle", "A"); const b = accounts.createAccount("mubaeSingle", "B");
    const key = MUBAE_KEYS.mubaeSingle;
    adapter.installStorageAdapter(); adapter.setActiveAccount(a.id);
    await window.storage.set(key, JSON.stringify(initial));
    await window.storage.set(key, JSON.stringify({ ...initial, cash: 700 }));
    const saved = JSON.parse(adapter.rawGet(a.id, key));
    assert.equal(saved.history.at(-1).kind, "adjustment"); assert.equal(events.at(-1).reload, true);
    adapter.setActiveAccount(b.id); await window.storage.set(key, JSON.stringify(initial));
    assert.equal(JSON.parse(adapter.rawGet(b.id,key)).history.length, 0);
    adapter.rawSet(a.id, "asset_history_v1", '[{"date":"2026-09-22","assets":1200,"invested":1200}]');
    const stateBeforeArchive = adapter.rawGet(a.id, key);
    accounts.setAccountArchived(a.id, true);
    let snaps = accounts.listAccounts().map((a) => buildSnapshot(a, {SOXL: 60}));
    assert.equal(portfolioTotals(snaps).cash, 500); assert.equal(portfolioTotals(snaps).invested, 1000);
    assert.equal(adapter.rawGet(a.id, key), stateBeforeArchive);
    assert.ok(adapter.rawGet(a.id, "asset_history_v1"));
    assert.equal(accounts.listAccounts().filter((a) => !a.archived).length, 1);
    accounts.setAccountArchived(a.id, false);
    snaps = accounts.listAccounts().map((a) => buildSnapshot(a, {SOXL: 60}));
    assert.equal(portfolioTotals(snaps).cash, 1200); assert.equal(portfolioTotals(snaps).invested, 2200);
    accounts.setAccountArchived(a.id, true); accounts.setAccountArchived(b.id, true);
    assert.equal(portfolioTotals(accounts.listAccounts().map((a) => buildSnapshot(a, {}))).cash, 0);
  } finally { await server.close(); delete globalThis.window; delete globalThis.CustomEvent; }
});

test("VR 실제 핸들러: 사이클·체결·보정 되돌리기 시 원장·원금·설정·종가 복원", () => {
  const source = readFileSync(new URL("../programs/vr/App.jsx", import.meta.url), "utf8");
  const getFunction = (name) => source.match(new RegExp(`  function ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\}`))[0];
  const state = { cycle: 3, V: 9000, pool: 1000, shares: 150, G: 10, band: .15, usage: .25, deposit: 250 };
  const context = vm.createContext({ state, hist: [], ledger: [{ side: "buy", qty: 150, price: 50 }], invested: 8500, px: "60",
    params: { ...state, G: 12, deposit: 500 }, deposit: 500,
    r2: (v) => Math.round(v*100)/100, window: { alert() { throw Error("unexpected legacy checkpoint"); } },
    setNBuy() {}, setNSell() {}, setTouchedFill() {},
  });
  for (const key of ["State", "Hist", "Ledger", "Invested", "Px", "G", "Band", "Usage", "Deposit"]) {
    const variable = key[0].toLowerCase()+key.slice(1);
    context[`set${key}`] = (value) => { context[variable] = typeof value === "function" ? value(context[variable]) : value; };
  }
  vm.runInContext(source.match(/function advanceCycle\(st\) \{[\s\S]*?\n\}/)[0], context);
  vm.runInContext(["checkpoint", "nextCycle", "undo", "syncParams"].map(getFunction).join("\n"), context);
  const before = clone({ state, ledger: context.ledger, invested: context.invested });
  vm.runInContext("nextCycle()", context);
  assert.equal(context.invested, 9000); assert.equal(context.state.cycle, 4);
  context.px = "70";
  vm.runInContext("undo()", context);
  assert.deepEqual(clone({ state: context.state, ledger: context.ledger, invested: context.invested }), before);
  assert.equal(context.deposit, 250); assert.equal(context.g, 10); assert.equal(context.px, "60");
  vm.runInContext("syncParams(); undo()", context);
  assert.deepEqual(clone(context.state), state);
  // 체결/보정 핸들러가 사용하는 동일 checkpoint로 두 번의 원장·원금 변경을 복원한다.
  vm.runInContext('hist.push(checkpoint()); state = { ...state, pool: 950, shares: 151 }; ledger = [...ledger, {side:"buy", qty:1, price:50}]; hist.push(checkpoint()); state = {...state, pool:800}; invested = 9000;', context);
  vm.runInContext("undo(); undo()", context);
  assert.deepEqual(clone({ state: context.state, ledger: context.ledger, invested: context.invested }), before);
});
