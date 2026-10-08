// 사용자 제공 실체결을 재구성한다. 과거 T는 당시 기록값이며 수정하지 않는다.
export function actualCycle() {
  let s={initialized:true,ticker:"SOXL",split:20,principal:46358.04,cash:46358.04,shares:0,avg:0,T:0,
    mode:"general",revFirst:false,cycle:2,cycleStartCash:46358.04,realizedTotal:0,closes:[151.95],lastClose:151.95,bigPct:10,history:[]};
  const rows=[
    ["2026-09-24",146.25,15,0,1],["2026-09-25",146.33,7,0,2],
    ["2026-09-28",151.45,7,0,2.5],["2026-09-29",142.29,16,0,3.5],
    ["2026-09-30",147,8,0,4.5],["2026-10-01",147.86,7,0,5],
    ["2026-10-02",153.69,7,0,5.5],["2026-10-05",163.71,0,16,4.125],
    ["2026-10-06",164.27,0,12,3.09375],["2026-10-06",164.26,7,0,3.59375],
    ["2026-10-08",158.91,7,0,4.09375],
  ];
  for(const [date,close,buy,sell,T] of rows) {
    const {history,...prevSnapshot}=s;
    const shares=s.shares-sell+buy, cost=buy*close;
    const next={...s,shares,avg:buy?(s.avg*(s.shares-sell)+cost)/shares:s.avg,cash:s.cash+sell*close-cost,T,
      lastClose:close,closes:[...s.closes,close].slice(-10),realizedTotal:s.realizedTotal+sell*(close-s.avg)};
    next.history=[...history,{date,close,mode:"general",buys:buy?[{qty:buy,price:close}]:[],
      sells:sell?[{qty:sell,price:close,label:"쿼터매도 (별지점)"}]:[],prevSnapshot,
      after:{T,shares,avg:next.avg,cash:next.cash,mode:"general"}}];
    s=next;
  }
  return s;
}
