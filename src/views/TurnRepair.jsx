import { useState } from "react";
import { rawGet, rawSet, ACCOUNT_STATE_EVENT } from "../storage/adapter";
import { MUBAE_KEYS } from "../features/cycleFunding";
import { mubaeEngine } from "../features/mubaeEngine";
import { previewTurnRepair, applyTurnRepair } from "../features/turnRepair";

export default function TurnRepair({acct,onReload}) {
  const [open,setOpen]=useState(false),[snapshot,setSnapshot]=useState(null),[choices,setChoices]=useState({}),[message,setMessage]=useState("");
  const key=MUBAE_KEYS[acct.programType];
  if(!key) return null;
  const inspect=()=>{try { const raw=rawGet(acct.id,key);JSON.parse(raw);setSnapshot(raw);setChoices({});setMessage("");setOpen(true); }catch {setMessage("상태를 읽을 수 없습니다.");}};
  const classify=mubaeEngine(acct.programType).classify;
  let preview;
  try {if(snapshot) preview=previewTurnRepair(JSON.parse(snapshot),classify,choices);}catch(e){preview={ok:false,reason:e.message,rows:[]};}
  const apply=()=>{try {
    if(rawGet(acct.id,key)!==snapshot) throw Error("미리보기 이후 계좌가 변경됐습니다. 다시 조회하세요.");
    const next=applyTurnRepair(JSON.parse(snapshot),classify,choices);
    rawSet(acct.id,key,JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_EVENT,{detail:{accountId:acct.id,reload:true}}));
    setSnapshot(null);setMessage("T 보정을 적용했습니다. 계좌 설정의 마지막 기록 되돌리기로 취소할 수 있습니다.");onReload();
  }catch(e){setMessage(e.message);}};
  return <section className="max-w-4xl mx-auto px-4 pt-3 text-zinc-200">
    <button onClick={inspect} className="text-sm border border-zinc-700 rounded px-3 py-2">현재 사이클 T 보정 미리보기</button>
    {open && preview && <div className="mt-2 p-3 border border-zinc-700 rounded text-xs">
      <p className="mb-2">과거 실제 체결과 당시 주문 예산으로 매수분을 판정하고 T 변환만 다시 계산합니다. 보유·평단·잔금·실현손익·과거 주문을 바꾸지 않습니다. 원문에 없는 부분체결은 확인이 필요합니다.</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{["거래일","매수/매도","기존 T","보정 T","매수분"].map(t=><th className="p-1" key={t}>{t}</th>)}</tr></thead><tbody>{preview.rows.map(r=><tr key={r.index} className="border-t border-zinc-800"><td>{r.date}</td><td>{r.buyQty} / {r.sellQty}주</td><td>{r.originalT}</td><td>{r.after ?? "확인 필요"}</td><td>{r.needsChoice ? <select aria-label={`${r.index} 거래 T 증가분`} value={choices[r.index] ?? r.increment ?? ""} onChange={e=>setChoices({...choices,[r.index]:e.target.value?Number(e.target.value):undefined})} className="bg-zinc-900 p-1"><option value="">확인 필요</option><option value="0.5">+0.5</option><option value="1">+1</option></select> : `+${r.increment}`}</td></tr>)}</tbody></table></div>
      {!preview.ok && <p role="alert" className="text-amber-300 mt-2">{preview.reason}</p>}
      {preview.ok && <p className="mt-2">현재 T {preview.before} → {preview.after}{!preview.changed && " (차이 없음)"}</p>}
      <button onClick={apply} disabled={!preview.ok||!preview.changed} className="mt-3 rounded bg-amber-400 text-zinc-950 px-3 py-2 disabled:opacity-30">확인한 T 보정 적용</button>
    </div>}
    {message && <p role="status" className="text-xs text-amber-300 mt-2">{message}</p>}
  </section>;
}
