import { useRef, useState } from "react";
import { createAccount, deleteAccount } from "../storage/accounts";
import { rawGet, rawSet, ACCOUNT_STATE_EVENT } from "../storage/adapter";
import { MUBAE_KEYS } from "../features/cycleFunding";
import { independentCapitalState } from "../features/independentCapital";
import { mubaeEngine } from "../features/mubaeEngine";

export default function IndependentCapital({acct,onCreated}) {
  const [open,setOpen]=useState(false),[amount,setAmount]=useState("14600"),[close,setClose]=useState(""),[date,setDate]=useState("");
  const [label,setLabel]=useState(`${acct.label} · 추가자금`),[confirmed,setConfirmed]=useState(false),[preview,setPreview]=useState(null),[message,setMessage]=useState("");
  const busy=useRef(false);
  const key=MUBAE_KEYS[acct.programType];
  if(!key) return null;
  const inspect=e=>{e.preventDefault();try {
    const source=rawGet(acct.id,key), s=JSON.parse(source);
    if(!s?.initialized) throw Error("기존 전략을 먼저 설정하세요.");
    if(!label.trim()) throw Error("새 전략 이름을 입력하세요.");
    const state=independentCapitalState({amount,previousClose:close,priceDate:date,
      ticker:acct.programType==="mubaeSingle"?"SOXL":s.ticker,split:acct.programType==="mubaeSingle"?40:s.split,bigPct:s.bigPct,sourceId:acct.id});
    setPreview({source,state,label:label.trim(),orders:mubaeEngine("mubaeMulti").orders(state)});setConfirmed(false);setMessage("");
  }catch(e){setMessage(e.message);}};
  const create=()=>{
    if(!preview || !confirmed || busy.current) return;
    busy.current=true;
    let a;
    try {
      if(rawGet(acct.id,key)!==preview.source) throw Error("기존 전략 상태가 변경됐습니다. 미리보기를 다시 만드세요.");
      a=createAccount("mubaeMulti",preview.label);
      rawSet(a.id,MUBAE_KEYS.mubaeMulti,JSON.stringify(preview.state));
      window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_EVENT,{detail:{accountId:a.id,reload:true}}));
      setPreview(null);setMessage("새 자금 전략을 만들었습니다. 자금 이체나 주문 전송은 하지 않았습니다.");
      onCreated(a.id);
    }catch(e){if(a) deleteAccount(a.id);setMessage(e.message);busy.current=false;}
  };
  const edit=set=>e=>{set(e.target.value);setPreview(null);setConfirmed(false);};
  return <section className="max-w-4xl mx-auto px-4 pt-3 text-zinc-200">
    <button onClick={()=>setOpen(!open)} className="text-sm border border-zinc-700 rounded px-3 py-2">추가 자금으로 독립 전략 시작 {open?"▲":"▼"}</button>
    {open && <div className="mt-2 p-3 border border-zinc-700 rounded text-sm">
      <p className="text-xs text-zinc-400 mb-3">기존 사이클 원금·평단·T에 섞지 않고 같은 종목·분할의 새 사이클을 만듭니다. 실제 증권계좌를 개설하거나 돈을 이체하는 기능은 아닙니다. 통합 주문표에서 두 전략을 함께 볼 수 있습니다.</p>
      <form onSubmit={inspect} className="flex flex-wrap gap-2">
        <label>전략 이름<input aria-label="새 자금 전략 이름" value={label} onChange={edit(setLabel)} className="block bg-zinc-950 border border-zinc-700 p-2 rounded" /></label>
        <label>추가 자금 (USD)<input aria-label="독립 전략 원금" value={amount} onChange={edit(setAmount)} inputMode="decimal" className="block bg-zinc-950 border border-zinc-700 p-2 rounded" /></label>
        <label>직전 종가<input aria-label="독립 전략 직전 종가" value={close} onChange={edit(setClose)} inputMode="decimal" className="block bg-zinc-950 border border-zinc-700 p-2 rounded" /></label>
        <label>종가의 미국 거래일<input aria-label="독립 전략 기준 거래일" type="date" value={date} onChange={edit(setDate)} className="block bg-zinc-950 border border-zinc-700 p-2 rounded" /></label>
        <button className="border border-amber-500 rounded px-3 py-2">독립 전략 미리보기</button>
      </form>
      {preview && <div className="mt-3 text-xs">
        <p>{preview.state.ticker} {preview.state.split}분할 · 원금 ${preview.state.cash.toFixed(2)} · T=0 · 보유 0주 · 첫 1회매수금 ${preview.orders.info.per.toFixed(2)}</p>
        <p className="mt-1">등록 직후 자동매수 없음. 아래 첫 주문은 입력한 직전 종가 기준이며 거래 전 확인해야 합니다.</p>
        <div className="my-2">{preview.orders.buys.map((o,i)=><div key={i}>LOC ${o.price.toFixed(2)} · {o.qty}주</div>)}</div>
        <label className="block my-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> 실제 입금 완료된 별도 자금이며, 기존 전략 잔금에 이미 포함된 돈이 아님을 확인했습니다.</label>
        <button onClick={create} disabled={!confirmed} className="rounded bg-amber-400 text-zinc-950 px-3 py-2 disabled:opacity-30">독립 전략 생성</button>
      </div>}
      {message && <p role="status" className="text-amber-300 mt-2">{message}</p>}
    </div>}
  </section>;
}
