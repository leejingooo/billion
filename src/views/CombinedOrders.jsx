import { useState, useEffect } from "react";
import { listAccounts } from "../storage/accounts";
import { rawGet, ACCOUNT_STATE_EVENT } from "../storage/adapter";
import { MUBAE_KEYS } from "../features/cycleFunding";
import { combineOrders } from "../features/combinedOrders";
import { getOrders as singleOrders } from "../programs/mubaeSingle/App";
import { getOrders as multiOrders } from "../programs/mubaeMulti/App";

export default function CombinedOrders() {
  const [selected, setSelected] = useState([]);
  const [sameBroker, setSameBroker] = useState(null);
  const [message,setMessage]=useState("");
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => {refresh(n => n+1);setSameBroker(null);};
    window.addEventListener(ACCOUNT_STATE_EVENT, update);
    return () => window.removeEventListener(ACCOUNT_STATE_EVENT, update);
  }, []);
  const errors = [];
  const plans = listAccounts().filter(a => !a.archived && MUBAE_KEYS[a.programType]).map(a => {
    try {
      const snapshot=rawGet(a.id, MUBAE_KEYS[a.programType]);
      const s = JSON.parse(snapshot || "null");
      if (!s?.initialized) return null;
      if (![s.cash,s.shares,s.avg,s.T,s.lastClose].every(Number.isFinite) || s.cash < 0 || s.shares < 0 || s.lastClose <= 0) throw Error("상태 확인 필요");
      const o = (a.programType === "mubaeSingle" ? singleOrders : multiOrders)(s);
      return {...a, snapshot, selected: selected.includes(a.id), ticker: a.programType === "mubaeSingle" ? "SOXL" : s.ticker,
        lastClose: s.lastClose, lastDate: s.history?.filter(h=>!h.kind).at(-1)?.date || s.orderPriceDate || "기준일 미확인", orders: [...o.buys,...o.sells], notes: o.notes};
    } catch (e) { if (selected.includes(a.id)) errors.push(`${a.label}: ${e.message}`); return {...a, selected: selected.includes(a.id), orders: [], error: true}; }
  }).filter(Boolean);
  let rows = [];
  try { rows = combineOrders(plans, sameBroker); } catch(e) { errors.push(e.message); }
  const active = plans.filter(p => p.selected && !p.error);
  const stale = active.some(p => p.lastDate === "기준일 미확인" || active.some(q => q.ticker === p.ticker && (q.lastClose !== p.lastClose || q.lastDate !== p.lastDate)));
  const conflict = rows.some(r => r.conflict);
  const copy = async () => {
    if(!rows.length || conflict || stale || errors.length || sameBroker === null) return;
    const current=listAccounts();
    if(active.some(p=>rawGet(p.id,MUBAE_KEYS[p.programType])!==p.snapshot || !current.some(a=>a.id===p.id&&!a.archived))) {
      setMessage("계좌가 변경됐습니다. 새로고침 후 다시 확인하세요.");return;
    }
    const body = rows.map(r => [r.ticker,r.side === "buy" ? "매수" : "매도",r.type,r.price ?? "MOC",r.qty,r.session,
      r.allocations.map(a=>`${a.label}:${a.qty}`).join(" / ")].join("\t")).join("\n");
    try { await navigator.clipboard.writeText("종목\t방향\t유형\t가격\t수량\t시간\t계좌별 배분\n"+body);setMessage("주문표를 복사했습니다. 증권사 주문은 전송하지 않았습니다."); }
    catch { window.alert("복사하지 못했습니다. 표에서 직접 확인하세요."); }
  };
  return <div className="max-w-5xl mx-auto p-4 text-zinc-100">
    <h2 className="text-xl font-bold mb-2">통합 주문표</h2>
    <p className="text-sm text-zinc-400 mb-3">원래 주문 가격·수량·유형 보존 · 조회/복사 전용 · 실제 주문 전송 및 체결 기록 자동 배분 없음</p>
    <p className="text-xs text-amber-200 mb-3">각 전략의 원금·잔금·평단·T는 독립 유지합니다. 실제 증권계좌의 합산 평단을 개별 전략에 덮어쓰지 마세요. 이 화면은 자금이나 과거 기록을 변경하지 않습니다.</p>
    <div className="flex flex-wrap gap-3 mb-3">{plans.map(p=><label key={p.id} className="border border-zinc-700 rounded p-2 text-sm">
      <input type="checkbox" checked={selected.includes(p.id)} onChange={e=>{setSelected(e.target.checked ? [...selected,p.id] : selected.filter(id=>id!==p.id));setSameBroker(null);}} /> {p.label}
      <span className="block text-xs text-zinc-500">{p.error ? "상태 확인 필요" : `${p.ticker} · ${p.lastDate} · $${p.lastClose}`}</span>
    </label>)}</div>
    {!plans.length && <p>운용 중인 무한매수법 계좌가 없습니다.</p>}
    <label className="block text-sm mb-3"><input type="checkbox" checked={sameBroker === true} onChange={e=>setSameBroker(e.target.checked ? true : null)} /> 선택한 전략은 최신 상태이며, 모두 동일한 실제 증권계좌에서 주문 시간·유효기간도 동일하게 운용함을 확인했습니다. 동일 조건 주문을 합산합니다.</label>
    <button onClick={()=>setSameBroker(false)} className="text-xs border border-zinc-600 rounded px-2 py-1 mb-3">각각 별도 증권계좌로 확인 (합산 안 함)</button>
    {sameBroker === null && <p className="text-xs text-amber-300 mb-2">선택한 전략의 실제 주문 계좌를 확인해야 복사할 수 있습니다.</p>}
    {sameBroker === false && <p className="text-xs text-zinc-400 mb-2">별도 증권계좌로 표시 중입니다. 같은 계좌의 전략이라면 위의 동일 계좌 확인을 선택하세요.</p>}
    <p className="text-xs text-zinc-400 mb-3">별도 증권계좌라면 합산하지 마세요. 다른 가격은 그대로 분리됩니다. 일부 체결 시 아래 배분표는 실제 배분 결과가 아니므로 전략별 체결을 확인하고 각각 장 마감 입력을 해야 합니다.</p>
    {active.flatMap(p=>p.notes.map((n,i)=><p className="text-xs text-amber-300" key={`${p.id}:${i}`}>{p.label}: {n}</p>))}
    {stale && <p className="text-amber-300 my-3">기준일이 없거나 같은 종목의 기준 날짜/종가가 다릅니다. 각 전략의 최신 상태를 확인하기 전 복사를 차단합니다.</p>}
    {conflict && <p className="text-red-300 my-3">매수·매도 가격 구간이 겹칩니다. 상계하거나 가격을 바꾸지 않았습니다. 한 증권계좌에서 그대로 제출하지 말고 충돌 주문을 검토하세요. 일괄 복사는 차단합니다.</p>}
    {errors.map((e,i)=><p key={i} className="text-red-300">{e}</p>)}
    <div className="overflow-x-auto my-3"><table className="w-full text-sm"><thead><tr>{["종목","방향","유형·시간","가격","수량","원래 계좌별 주문","확인"].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(r=><tr key={r.key} className="border-t border-zinc-800"><td className="p-2">{r.ticker}</td><td className={r.side === "buy" ? "text-red-300" : "text-blue-300"}>{r.side === "buy" ? "매수" : "매도"}</td><td>{r.type}<div className="text-xs">{r.session}</div></td><td>{r.price == null ? "MOC" : `$${r.price.toFixed(2)}`}</td><td>{r.qty}주</td><td className="text-xs">{r.allocations.map((a,i)=><div key={i}>{a.label}: {a.qty}주 ({a.orderLabel})</div>)}</td><td className="text-red-300">{r.conflict ? "충돌" : ""}</td></tr>)}</tbody></table></div>
    <button onClick={copy} disabled={!rows.length || conflict || stale || errors.length > 0 || sameBroker === null} className="px-4 py-2 bg-amber-400 text-zinc-950 rounded disabled:opacity-30">주문표 복사</button>
    <button onClick={()=>refresh(n=>n+1)} className="ml-3 px-4 py-2 border border-zinc-600 rounded">새로고침</button>
    {message && <p role="status" className="text-xs text-amber-300 mt-2">{message}</p>}
  </div>;
}
