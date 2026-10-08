import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {previewTurnRepair,applyTurnRepair} from "../features/turnRepair.js";
import {independentCapitalState} from "../features/independentCapital.js";
import {combineOrders} from "../features/combinedOrders.js";
import {mubaeCycles} from "../overlay/strategy.js";
import {actualCycle} from "./operations-fixture.mjs";

const ctx=vm.createContext({});
const src=readFileSync(new URL("../programs/mubaeMulti/App.jsx",import.meta.url),"utf8");
vm.runInContext(src.split("/* ---------------- UI ---------------- */")[0].replace(/^import .*;\n/gm,""),ctx);
const {buyTurnIncrement:classify,getOrders}=vm.runInContext("({buyTurnIncrement,getOrders})",ctx);
test("실제 11거래: T 4.09375 → 3.53125, 모든 실체결/회계 보존·되돌리기",()=>{
  const s=actualCycle(), before=JSON.stringify(s);
  const p=previewTurnRepair(s,classify);
  assert.equal(p.ok,true,p.reason);assert.equal(p.after,3.53125);assert.equal(p.rows.length,11);
  const next=applyTurnRepair(s,classify,{},new Date("2026-10-08T09:00:00Z"));
  assert.equal(next.T,3.53125);
  for(const k of ["shares","avg","cash","realizedTotal","cycleStartCash","principal","mode","lastClose"]) assert.equal(next[k],s[k]);
  assert.deepEqual(next.history.slice(0,-1),s.history);
  assert.deepEqual(mubaeCycles(next),mubaeCycles(s));
  const last=next.history.at(-1);
  assert.deepEqual({...last.prevSnapshot,history:next.history.slice(0,-1)},s);
  assert.equal(previewTurnRepair(next,classify).ok,false);
  assert.equal(JSON.stringify(s),before);
});
test("불완전 이력·수동보정·리버스·잔고 불일치는 자동 보정 차단",()=>{
  const s=actualCycle();
  for(const mutate of [x=>x.history.shift(),x=>{x.history[3].kind="adjustment";},x=>{x.history[3].mode="reverse";},
    x=>{x.cash+=1;},x=>{x.history[4].buys[0].qty+=1;},x=>{x.history[4].prevSnapshot.T+=1;},x=>{x.history[7].sells[0].label="알수없음";}]) {
    const x=structuredClone(s);mutate(x);assert.equal(previewTurnRepair(x,classify).ok,false);
    assert.throws(()=>applyTurnRepair(x,classify));
  }
});
test("불명확한 과거 체결은 확인값 필요, 감사행에 보존",()=>{
  const s=actualCycle();let i=0;
  const uncertain=(p,b)=>p.T===1?null:classify(p,b);
  const result=previewTurnRepair(s,uncertain);assert.equal(result.ok,false);assert.equal(result.rows.at(-1).index,1);
  const next=applyTurnRepair(s,uncertain,{1:.5});
  assert.equal(next.T,3.53125);assert.equal(next.history.at(-1).turnCorrection.rows[1].needsChoice,true);
});
test("독립 $14600: 기존과 독립, T0/0주/현금14600/1회730",()=>{
  const s=independentCapitalState({amount:"14600",previousClose:"158.91",priceDate:"2026-10-08",ticker:"SOXL",split:20,sourceId:"a"});
  assert.equal(s.T,0);assert.equal(s.shares,0);assert.equal(s.cash,14600);assert.equal(s.realizedTotal,0);
  assert.equal(getOrders(s).info.per,730);assert.equal(s.capitalSource.amount,14600);
  for(const amount of ["-1","0","NaN","1.001","1e4"]) assert.throws(()=>independentCapitalState({amount,previousClose:158.91,priceDate:"2026-10-08",ticker:"SOXL",split:20}));
  assert.throws(()=>independentCapitalState({amount:14600,previousClose:0,priceDate:"2026-10-08",ticker:"SOXL",split:20}));
});
const order=(side,price,qty,type="LOC",session)=>({side,price,qty,type,session,label:"test"});
const plan=(id,orders,extra={})=>({id,label:id,ticker:"SOXL",selected:true,orders,...extra});
test("동일 종목/방향/가격/유형/시간만 합산, 배분과 총수량 보존",()=>{
  const plans=[plan("a",[order("buy",100,3),order("buy",90,2)]),plan("b",[order("buy",100,4),order("buy",100,1,"LIMIT"),order("buy",100,1,"LOC","別時間")])];
  const before=JSON.stringify(plans), rows=combineOrders(plans,true);
  assert.equal(rows.length,4);assert.equal(rows.find(r=>r.type==="LOC"&&r.price===100&&r.session==="본장 종가").qty,7);
  assert.equal(rows.reduce((n,r)=>n+r.qty,0),11);
  assert.equal(rows.flatMap(r=>r.allocations).reduce((n,a)=>n+a.qty,0),11);
  assert.equal(combineOrders(plans,false).length,5);assert.equal(JSON.stringify(plans),before);
});
test("충돌: 같은가격·교차가격·MOC 탐지, 미선택/보관 제외, 상계 금지",()=>{
  for(const sell of [order("sell",100,2),order("sell",99,2,"LIMIT"),order("sell",null,2,"MOC")]) {
    const rows=combineOrders([plan("a",[order("buy",100,3)]),plan("b",[sell])],true);
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.conflict));assert.equal(rows[0].qty+rows[1].qty,5);
  }
  assert.ok(combineOrders([plan("a",[order("buy",100,3)]),plan("b",[order("sell",101,2)])],true).every(r=>!r.conflict));
  assert.equal(combineOrders([plan("a",[order("buy",100,3)],{archived:true}),plan("b",[order("sell",99,2)],{selected:false})],true).length,0);
  assert.throws(()=>combineOrders([plan("a",[order("buy",100,-1)])],true));
});
