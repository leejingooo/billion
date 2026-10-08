import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const initial = {initialized:true,ticker:"SOXL",split:20,cash:44164.29,shares:15,avg:146.25,T:1,
  mode:"general",revFirst:false,cycle:2,cycleStartCash:46358.04,realizedTotal:0,
  closes:[146.25],lastClose:146.25,bigPct:10,history:[]};
function engine(type) {
  const src=readFileSync(new URL(`../programs/${type}/App.jsx`,import.meta.url),"utf8");
  const ctx=vm.createContext({});
  vm.runInContext(src.split("/* ---------------- UI ---------------- */")[0].replace(/^import .*;\n/gm,""),ctx);
  return vm.runInContext("({getOrders,simulateFills,applyDay,buyTurnIncrement})",ctx);
}
for(const type of ["mubaeMulti","mubaeSingle"]) {
  const e=engine(type);
  const state=type==="mubaeSingle"?{...initial,cash:initial.cash*39/19}:initial;
  const fill=(qty,price,label="")=>({qty,fillPrice:price,label,type:"LOC"});
  const day=(s,buys,sells=[],override)=>e.applyDay(s,{date:"test",close:buys[0]?.fillPrice || 160,
    filledBuys:buys,filledSells:sells,buyTurnOverride:override}).ns;
  test(`${type}: 9/25 기존 주문가격 보존, 6+사다리1주 → +0.5`,()=>{
    const o=e.getOrders(state);
    assert.equal(o.buys.find(x=>x.label==="").price,154.96);
    const f=e.simulateFills(state,o,146.33,false);
    if(type==="mubaeMulti") assert.equal(f.fb.reduce((n,o)=>n+o.qty,0),7);
    assert.equal(e.buyTurnIncrement(state,[fill(6,146.33,"별지점"),fill(1,146.33)]),.5);
    const ns=day(state,[fill(6,146.33,"별지점"),fill(1,146.33)]);
    assert.equal(ns.T,1.5); assert.equal(ns.shares,22);
    assert.ok(Math.abs(ns.cash-(state.cash-1024.31))<1e-8);
  });
  test(`${type}: 9/30 7+사다리1주 → +0.5`,()=>{
    const s={...state,T:3.5,shares:45,avg:145.66333333333336,cash:39803.19,lastClose:142.29};
    if(type==="mubaeSingle") s.cash*=36.5/16.5;
    assert.equal(e.getOrders(s).buys.find(o=>o.label==="").price,150.77);
    assert.equal(day(s,[fill(7,147,"별지점"),fill(1,147)]).T,4);
  });
  test(`${type}: 체결 라벨 아닌 수량으로 판정`,()=>{
    for(const label of ["평단","별지점","",undefined]) {
      assert.equal(e.buyTurnIncrement(state,[fill(7,146.33,label)]),.5);
      assert.equal(e.buyTurnIncrement(state,[fill(15,146.33,label)]),1);
    }
    assert.equal(e.buyTurnIncrement(state,[fill(1,146.33,"평단")]),null);
    assert.equal(e.buyTurnIncrement(state,[fill(0,146.33,"평단")]),0);
  });
  test(`${type}: 정상 별지점 정수 내림 수량 및 원문 p.6 예시`,()=>{
    const split=type==="mubaeSingle"?40:20, T=split/5;
    const s={...state,T,cash:539.23*(split-T),avg:69.75,lastClose:70};
    const o=e.getOrders(s);
    assert.deepEqual(Array.from(o.buys.slice(0,4),o=>[o.price,o.qty]),[[78.11,3],[69.75,4],[67.4,1],[59.91,1]]);
    for(const [price,expected] of [[70,.5],[69.75,1],[65,1]]) {
      const f=e.simulateFills(s,o,price,false);
      assert.equal(e.buyTurnIncrement(s,f.fb),expected);
    }
  });
  test(`${type}: 불명확한 부분/다중가격 체결은 차단, 확인 기록`,()=>{
    const before=JSON.stringify(state);
    const fills=[fill(3,146.33)];
    assert.equal(e.buyTurnIncrement(state,fills),null);
    assert.throws(()=>day(state,fills),/확인/);
    assert.throws(()=>day(state,fills,[],.7),/확인/);
    assert.equal(e.buyTurnIncrement(state,[fill(3,146.33),fill(4,146.34)]),null);
    for(const inc of [.5,1]) {
      const ns=day(state,fills,[],inc);
      assert.equal(ns.T,state.T+inc);
      assert.equal(ns.history.at(-1).buyTurnOverride,inc);
      assert.equal(ns.history.at(-1).prevSnapshot.T,state.T);
    }
    assert.equal(JSON.stringify(state),before);
  });
  test(`${type}: 매도 곱셈·후반전·첫매수·리버스 불변`,()=>{
    const sell=(type,label)=>({qty:3,fillPrice:170,type,label});
    assert.equal(day(state,[],[sell("LOC","쿼터매도")]).T,.75);
    assert.equal(day(state,[fill(7,146.33)],[sell("LIMIT","지정가")]).T,.75);
    const split=type==="mubaeSingle"?40:20;
    assert.equal(day({...state,T:split/2},[fill(1,100)]).T,split/2+1);
    assert.equal(day({...state,shares:0,T:0,avg:0},[fill(1,100)]).T,1);
    const rev=day({...state,mode:"reverse",T:split-1.5},[fill(1,90)]);
    assert.equal(rev.T,split-1.5+1.5*.25);
  });
}

test("멀티: TQQQ/SOXL ×20/40 전반전 수량 판정",()=>{
  const e=engine("mubaeMulti");
  for(const ticker of ["TQQQ","SOXL"]) for(const split of [20,40]) {
    const s={...initial,ticker,split,T:2,cash:2000*(split-2),avg:100};
    for(const [qty,inc] of [[10,.5],[20,1]]) assert.equal(e.buyTurnIncrement(s,[{qty,fillPrice:100,label:""}]),inc);
  }
});
