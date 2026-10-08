import { stateRecord } from "./cycleFunding.js";

const near = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < 1e-6;
const balanceMatches = (a,b) => a && b && ["cash","avg","shares","T"].every(k=>near(a[k],b[k])) && a.mode===b.mode;

// 과거 주문은 당시 실제 상태로 분류하고, T 변환만 누적한다. 가상 주문으로 실거래를 대체하지 않는다.
export function previewTurnRepair(state, classify, choices = {}) {
  const blocked = reason => ({ok:false, reason, rows:[]});
  if (!state?.initialized || state.mode !== "general" || !Array.isArray(state.history)) return blocked("일반모드의 완전한 거래 이력이 필요합니다.");
  const entries = state.history.map((h,index)=>({h,index})).filter(({h})=>h.prevSnapshot?.cycle===state.cycle);
  if (!entries.length) return blocked("현재 사이클의 시작 이력이 없습니다.");
  if (entries.some(({h})=>h.kind === "turn-correction")) return blocked("이 사이클에는 이미 T 보정 기록이 있습니다. 다시 보정하려면 해당 보정을 되돌린 뒤 검토하세요.");
  let T=0, previous=null, started=false;
  const rows=[];
  for (const {h,index} of entries) {
    const p=h.prevSnapshot;
    if (h.kind === "funding" && !started && p.T===0 && p.shares===0) continue;
    if (h.kind) return blocked("현재 사이클에 수동 보정 등 비매매 기록이 있어 자동 재계산할 수 없습니다.");
    if (!started && (p.T!==0 || p.shares!==0)) return blocked("첫 매수 전 T=0·보유 0부터의 이력이 필요합니다.");
    if (previous && !balanceMatches(previous,p)) return blocked("연속된 거래의 이전 상태가 일치하지 않습니다.");
    if (p.mode!=="general" || h.mode!=="general" || h.after?.mode!=="general") return blocked("리버스 전환이 있는 사이클은 별도 검토가 필요합니다.");
    if (![p.cash,p.shares,p.avg,p.T,h.after?.T,h.after?.avg,h.after?.cash,h.after?.shares].every(Number.isFinite)
        || !Array.isArray(h.buys) || !Array.isArray(h.sells)) return blocked("거래의 잔고 또는 체결 정보가 불완전합니다.");
    const trades=[...h.buys,...h.sells];
    if (trades.some(o=>!Number.isInteger(o.qty)||o.qty<=0||!Number.isFinite(o.price)||o.price<=0)) return blocked("체결 가격/수량을 확인하세요.");
    const bq=h.buys.reduce((a,o)=>a+o.qty,0), sq=h.sells.reduce((a,o)=>a+o.qty,0);
    const cost=h.buys.reduce((a,o)=>a+o.qty*o.price,0), proceeds=h.sells.reduce((a,o)=>a+o.qty*o.price,0);
    const shares=p.shares-sq+bq;
    const avg=shares>0 && bq>0 ? (p.avg*(p.shares-sq)+cost)/shares : p.avg;
    if(sq>p.shares || shares!==h.after.shares || !near(p.cash+proceeds-cost,h.after.cash)
       || (shares>0 && !near(avg,h.after.avg))) return blocked("체결 내역과 잔고가 일치하지 않습니다.");
    let quarter=false,limit=false;
    for(const o of h.sells) {
      if(o.label?.startsWith("쿼터매도")) quarter=true;
      else if(o.label?.includes("지정가")) limit=true;
      else return blocked("매도 종류를 판별할 수 없습니다.");
    }
    const before=T;
    if(quarter) T*=.75;
    if(limit) T*=.25;
    const fill=h.buys.map(o=>({...o,fillPrice:o.price}));
    const auto=classify(p,fill);
    const selected=choices[index] ?? h.buyTurnOverride;
    const increment=auto===null ? ([.5,1].includes(selected)?selected:null) : auto;
    if(increment!==null) T=p.shares===0 && bq>0 ? 1 : T+increment;
    rows.push({index,date:h.date,originalT:h.after.T,before,after:increment===null?null:T,
      increment,needsChoice:auto===null,buyQty:bq,sellQty:sq,quarter,limit});
    if(increment===null) return {ok:false,reason:"분류가 필요한 거래의 T 증가분을 확인하세요.",rows};
    if(T>(p.split || 40)-1) return {ok:false,reason:"보정 시 모드 전환에 영향을 줍니다. 별도 검토가 필요합니다.",rows};
    previous=h.after; started=true;
  }
  if(!started || !balanceMatches(previous,state)) return blocked("현재 상태와 마지막 거래가 일치하지 않습니다.");
  return {ok:true,rows,before:state.T,after:T,changed:!near(state.T,T)};
}

export function applyTurnRepair(state, classify, choices = {}, now = new Date()) {
  const preview=previewTurnRepair(state,classify,choices);
  if(!preview.ok || !preview.changed) throw Error(preview.reason || "보정할 T 차이가 없습니다.");
  const next={...state,T:preview.after};
  const record=stateRecord(state,next,"turn-correction",`T 보정 ${state.T} → ${next.T} (실제 거래·잔고 보존)`,now);
  record.turnCorrection={version:1,rows:preview.rows};
  next.history=[...state.history,record];
  return next;
}
