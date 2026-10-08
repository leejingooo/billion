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
