import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { createServer } from "vite";

const text=n=>typeof n==="string"?n:(n.children||[]).map(text).join("");
test("실제 React/Vite: 정상 체결 자동 판정, 부분체결 차단·확인·기록",async()=>{
  const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:"custom"});
  let tree;
  try {
    for(const type of ["mubaeMulti","mubaeSingle"]) {
      let saved;
      const s={initialized:true,ticker:"SOXL",split:20,principal:46358.04,cash:44164.29,shares:15,avg:146.25,T:1,
        mode:"general",revFirst:false,cycle:2,cycleStartCash:46358.04,realizedTotal:0,
        closes:[146.25],lastClose:146.25,bigPct:10,history:[]};
      if(type==="mubaeSingle") s.cash*=39/19;
      globalThis.window={storage:{get:async()=>({value:JSON.stringify(s)}),set:async(k,v)=>{saved=JSON.parse(v);}}};
      const {default:App}=await server.ssrLoadModule(`/src/programs/${type}/App.jsx`);
      await act(async()=>{tree=create(React.createElement(App));});
      const button=label=>tree.root.findAllByType("button").find(b=>text(b)===label);
      await act(async()=>button("② 장 마감 입력").props.onClick());
      const price=tree.root.findAllByType("input").find(i=>i.props.placeholder==="예: 26.85");
      await act(async()=>price.props.onChange({target:{value:"146.33"}}));
      assert.equal(tree.root.findAllByType("select").length,0);
      assert.ok(text(tree.root).includes("T+0.5"));
      const qty=()=>tree.root.findAllByType("input").filter(i=>i.props.type==="number");
      await act(async()=>qty()[0].props.onChange({target:{value:"2"}}));
      assert.equal(button("이 내용으로 하루 확정").props.disabled,true);
      await act(async()=>button("이 내용으로 하루 확정").props.onClick());
      assert.equal(saved,undefined);
      await act(async()=>tree.root.findByType("select").props.onChange({target:{value:"0.5"}}));
      assert.equal(button("이 내용으로 하루 확정").props.disabled,false);
      await act(async()=>qty()[0].props.onChange({target:{value:"3"}}));
      assert.equal(button("이 내용으로 하루 확정").props.disabled,true);
      await act(async()=>tree.root.findByType("select").props.onChange({target:{value:"0.5"}}));
      await act(async()=>button("이 내용으로 하루 확정").props.onClick());
      assert.equal(saved.T,1.5);
      assert.equal(saved.history.at(-1).buyTurnOverride,.5);
      assert.equal(saved.history.at(-1).prevSnapshot.T,1);
      await act(async()=>tree.unmount()); tree=null;
    }
  } finally {if(tree) await act(async()=>tree.unmount());await server.close();delete globalThis.window;}
});

test("주문 상한 +30%로 미체결된 날의 애프터장 매수를 실제 체결가로 저장", async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  let tree;
  try {
    for (const type of ["mubaeMulti", "mubaeSingle"]) {
      let saved;
      const state = {
        initialized: true, ticker: "SOXL", split: 40, principal: 45000, cash: 43000,
        shares: 15, avg: 120, T: 1, mode: "general", revFirst: false, cycle: 1,
        cycleStartCash: 45000, realizedTotal: 0, closes: [100.01], lastClose: 100.01,
        bigPct: 10, history: [],
      };
      globalThis.window = {
        storage: {
          get: async () => ({ value: JSON.stringify(state) }),
          set: async (key, value) => { saved = JSON.parse(value); },
        },
      };
      const { default: App, getOrders } = await server.ssrLoadModule(`/src/programs/${type}/App.jsx`);
      const cappedBuy = getOrders(state).buys[0];
      assert.equal(cappedBuy.price, 130.01);
      assert.match(cappedBuy.label, /\+30%/);

      // 별지점·평단·사다리 모두 상한을 넘는 예에서 원래 체결 수량을 보존한다.
      for (const T of [1, 25]) {
        const capped = getOrders({ ...state, avg: 150, T });
        const original = getOrders({ ...state, avg: 150, T, lastClose: 200 }).buys;
        const qtyAt = (buys, price) => buys.filter(o => o.price >= price).reduce((sum, o) => sum + o.qty, 0);
        const cap = capped.buys[0].price;
        assert.equal(cap, 130.01);
        assert.equal(capped.buys[0].qty, qtyAt(original, cap));
        assert.deepEqual(capped.buys.slice(1), original.filter(o => o.price < cap));
        assert.equal(qtyAt(capped.buys, cap - 1), qtyAt(original, cap - 1));
      }
      await act(async () => { tree = create(React.createElement(App)); });
      const button = label => tree.root.findAllByType("button").find(b => text(b) === label);
      const enter = (placeholder, value) => act(async () => {
        tree.root.findByProps({ placeholder }).props.onChange({ target: { value } });
      });
      const confirm = () => button("이 내용으로 하루 확정");

      await act(async () => button("② 장 마감 입력").props.onClick());
      await enter("예: 26.85", "132");
      assert.match(text(tree.root), /상한으로 미체결된 원래 주문 수량: 3주/);
      assert.equal(tree.root.findAllByType("input").filter(i => i.props.type === "number").length, 0);
      await enter("예: 2", "2");
      assert.equal(confirm().props.disabled, true);
      await enter("예: 26.90", "30000");
      assert.equal(confirm().props.disabled, true);
      await enter("예: 26.90", "132.50");
      assert.equal(confirm().props.disabled, true);
      await act(async () => tree.root.findByType("select").props.onChange({ target: { value: "0.5" } }));
      await act(async () => confirm().props.onClick());

      assert.equal(saved.lastClose, 132);
      assert.equal(saved.cash, 42735);
      assert.equal(saved.shares, 17);
      assert.equal(saved.avg, (15 * 120 + 2 * 132.5) / 17);
      assert.equal(saved.T, 1.5);
      assert.deepEqual(saved.history.at(-1).buys, [{ qty: 2, price: 132.5, source: "afterHours" }]);
      await act(async () => tree.unmount());
      tree = null;
    }
  } finally {
    if (tree) await act(async () => tree.unmount());
    await server.close();
    delete globalThis.window;
  }
});
