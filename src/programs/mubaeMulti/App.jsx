import { useState, useEffect } from "react";

/* ============================================================
   무한매수법 V4.0 — TQQQ/SOXL · 20/40분할 선택 일일 주문 도우미
   라오어 V4.0 방법론 (일반모드 + 소진후 리버스모드) 구현
   - 매일 종가/체결 입력 → 상태 갱신 → 다음날 주문표 산출
   - window.storage 로 영구 저장
   ============================================================ */

const KEY = "mubae_v4_multi_state_v1";
const r2 = (x) => Math.round(x * 100) / 100;
const fmt$ = (x) => (x == null ? "—" : "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtN = (x, d = 4) => (x == null ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: d }));

/* 종목·분할별 파라미터 (원문 V4.0 대조 확정)
   별% 20분할: TQQQ (15−1.5T) / SOXL (20−2T)
   별% 40분할: TQQQ (15−0.75T) / SOXL (20−T)
   지정가매도·리버스종료 기준: TQQQ 15% / SOXL 20%
   리버스 T매도배수: 20분할 ×0.9 / 40분할 ×0.95
   리버스 매도등분: 20분할 10등분 / 40분할 20등분 */
function cfg(s) {
  const split = s.split;          // 20 | 40
  const ticker = s.ticker;        // "TQQQ" | "SOXL"
  // 무결성 가드: 손상/구버전 데이터로 NaN 주문이 조용히 생성되는 것을 원천 차단
  if ((split !== 20 && split !== 40) || (ticker !== "TQQQ" && ticker !== "SOXL")) {
    throw new Error(`설정 손상: ticker=${ticker}, split=${split} (TQQQ/SOXL · 20/40만 허용). 초기화 후 다시 시작하세요.`);
  }
  const base = ticker === "TQQQ" ? 15 : 20;          // 별% 절편 = 지정가매도 %
  // 별% 기울기: split·ticker 조합. 20분할 SOXL=2, 40분할 SOXL=1, 20분할 TQQQ=1.5, 40분할 TQQQ=0.75
  const slope = base / (split / 2);                    // T=split/2 에서 별%=0 이 되도록 (전후반 경계)
  return {
    split, ticker,
    base,                          // 지정가매도 % & 리버스 종료 % (정수, 예: 15 or 20)
    starPct: (T) => (base - slope * T) / 100,
    sellTie: base / 100,           // 최종 지정가매도 = 평단×(1+base%)
    revExit: base / 100,           // 리버스 종료: 종가 > 평단×(1−base%)
    half: split / 2,               // 전후반 경계
    exhaust: split - 1,            // 소진 임계 (T > split−1)
    revMul: split === 20 ? 0.9 : 0.95,   // 리버스 매도 T배수
    revDiv: split === 20 ? 10 : 20,      // 리버스 매도 등분
  };
}

/* ---------------- 핵심 로직 ---------------- */

function starGeneral(s) {
  const c = cfg(s);
  return r2(s.avg * (1 + c.starPct(s.T)));
}
function starReverse(s, override) {
  if (override && override > 0) return r2(override);
  const c = s.closes.slice(-5);
  if (c.length === 0) return null;
  return r2(c.reduce((a, b) => a + b, 0) / c.length);
}
// 아래쪽 사다리: 1회매수액/k 가격에 1주씩 (큰 하락 대비, 1회매수액 소진용)
function ladder(amt, startK, rungs = 8) {
  const out = [];
  for (let k = startK; k < startK + rungs; k++) {
    const p = r2(amt / k);
    if (p > 0) out.push({ price: p, qty: 1, label: "", type: "LOC", side: "buy" });
  }
  return out;
}

// 모든 LOC 매수주문에 대해, 어떤 종가 X에서도 체결총액 ≤ budget 이 되도록 보장.
// LOC는 종가 X ≤ 지정가면 X에 체결. 최악 종가는 주문가격 중 하나(그 가격 이하 모든 주문이 체결).
// budget 초과 시 가장 낮은 가격 사다리부터 1주씩 제거 (별지점/평단 핵심주문은 보존).
function capBuys(orders, budget) {
  const worst = (list) => {
    let max = 0;
    const prices = [...new Set(list.map((o) => o.price))].sort((a, b) => a - b);
    for (const X of prices) {
      const cost = list.reduce((a, o) => a + (o.price >= X ? o.qty * X : 0), 0);
      if (cost > max) max = cost;
    }
    return max;
  };
  let work = orders.map((o) => ({ ...o }));
  let guard = 0;
  while (worst(work) > budget + 1e-9 && guard++ < 500) {
    const lads = work.map((o, i) => ({ i, p: o.price, lad: o.label === "" })).filter((x) => x.lad);
    if (lads.length === 0) {
      // 사다리가 없는데도 초과 → 핵심 주문 수량을 1주씩 줄임 (최후의 안전장치)
      const core = work.map((o, i) => ({ i, p: o.price })).sort((a, b) => a.p - b.p)[0];
      if (!core || work[core.i].qty <= 1) { work = work.filter((_, i) => i !== core.i); }
      else work[core.i].qty -= 1;
      continue;
    }
    // 가장 낮은 가격 사다리 제거
    lads.sort((a, b) => a.p - b.p);
    work.splice(lads[0].i, 1);
  }
  return work;
}

function getOrders(s, revStarOverride) {
  const c = cfg(s);
  const buys = [], sells = [], notes = [];
  const info = {};

  if (s.mode === "general") {
    // 1회매수금 = 잔금/(split−T). 안전장치: 어떤 비정상 상태에서도 잔금 초과 주문 금지
    const per = Math.min(s.cash, s.cash / Math.max(c.split - s.T, 1e-6));
    info.per = per;

    if (s.shares === 0) {
      // 처음매수: 큰수 LOC + 아래 사다리
      const big = r2(s.lastClose * (1 + s.bigPct / 100));
      const q = Math.max(1, Math.floor(per / big));
      buys.push({ price: big, qty: q, label: `큰수 (전일종가 +${s.bigPct}%)`, type: "LOC", side: "buy" });
      buys.push(...ladder(per, q + 1));
      notes.push("새 사이클 첫 매수 — 무조건 1회분 매수 의도");
    } else {
      const star = starGeneral(s);
      info.star = star;
      const buyTop = r2(star - 0.01);
      const brokerCap = r2(s.lastClose * 1.18);
      const topPrice = buyTop > brokerCap ? brokerCap : buyTop;
      const topLabel = buyTop > brokerCap ? `큰수 (별지점 ${fmt$(buyTop)}가 ±20% 초과)` : "별지점 −0.01";

      if (s.T < c.half) {
        // 전반전: 절반 별지점, 나머지 평단, 아래 사다리
        const half = per / 2;
        const n1 = Math.floor(half / topPrice);
        const n2 = Math.floor((per - n1 * topPrice) / s.avg);
        if (n1 > 0) buys.push({ price: topPrice, qty: n1, label: topLabel, type: "LOC", side: "buy" });
        if (n2 > 0) buys.push({ price: r2(s.avg), qty: n2, label: "평단", type: "LOC", side: "buy" });
        buys.push(...ladder(per, n1 + n2 + 1));
      } else {
        // 후반전: 전액 별지점, 아래 사다리
        const n1 = Math.floor(per / topPrice);
        if (n1 > 0) buys.push({ price: topPrice, qty: n1, label: topLabel, type: "LOC", side: "buy" });
        buys.push(...ladder(per, n1 + 1));
      }

      // 매도 (전·후반 공통)
      const q = Math.floor(s.shares / 4);
      if (q > 0) sells.push({ price: star, qty: q, label: "쿼터매도 (별지점)", type: "LOC", side: "sell" });
      const rest = s.shares - q;
      if (rest > 0) sells.push({ price: r2(s.avg * (1 + c.sellTie)), qty: rest, label: `+${c.base}% 지정가 (프리장부터)`, type: "LIMIT", side: "sell" });
    }
    // 안전 상한: 어떤 종가에서도 일일 매수 체결총액 ≤ 잔금 (현금 음수 원천 차단).
    // per(1회매수액)는 의도 목표치이며 원문도 사다리가 그 부근에서 약간 넘칠 수 있게 표시 — 잔금까지는 허용.
    const capped = capBuys(buys, s.cash);
    buys.length = 0; buys.push(...capped);
  } else {
    // 리버스모드
    const star = starReverse(s, revStarOverride);
    info.star = star;
    // 원문: revDiv 등분, "자연수로 안 떨어지면 내림"
    const q = Math.floor(s.shares / c.revDiv);
    if (q === 0 && s.shares > 0) notes.push(`보유 ${c.revDiv}주 미만 — 내림 규칙상 정규 매도수량 0주`);

    if (s.revFirst) {
      // 원문: 처음매도 = 무조건 MOC. revDiv 등분이 0이 되는 소량은 잔량 전체를 MOC로 정리
      const fq = q > 0 ? q : s.shares;
      if (fq > 0) sells.push({ price: null, qty: fq, label: "처음매도 — MOC 무조건", type: "MOC", side: "sell" });
      notes.push("소진 첫날: 매수 없음, MOC 매도만" + (q === 0 ? ` (보유<${c.revDiv}주라 잔량 전체 MOC)` : ""));
    } else {
      if (star == null) notes.push("⚠ 직전 종가 데이터 부족 — 별지점을 직접 입력하세요");
      if (q > 0 && star != null) sells.push({ price: star, qty: q, label: "리버스 매도 (별지점=5일 종가평균)", type: "LOC", side: "sell" });
      else if (q === 0 && star != null && s.shares > 0) {
        sells.push({ price: star, qty: s.shares, label: `리버스 잔량 정리 (보유<${c.revDiv}, 별지점 위 전량)`, type: "LOC", side: "sell" });
      }
      const amt = s.cash / 4; // 쿼터매수
      info.quarterBuyAmt = amt;
      if (star != null && amt > 0) {
        const topB = r2(star - 0.01);
        const n1 = Math.floor(amt / topB);
        if (n1 > 0) buys.push({ price: topB, qty: n1, label: "쿼터매수 (별지점 −0.01)", type: "LOC", side: "buy" });
        buys.push(...ladder(amt, n1 + 1));
        // 안전 상한: 어떤 종가에서도 쿼터매수 체결총액 ≤ 잔금 (현금 음수 차단)
        const capped = capBuys(buys, s.cash);
        buys.length = 0; buys.push(...capped);
      }
    }
  }
  return { buys: buys.filter((o) => o.qty > 0 && (o.price === null || o.price > 0)), sells, info, notes };
}

// 종가 기준 체결 시뮬레이션
function simulateFills(s, orders, close, limitFilled) {
  const fb = orders.buys
    .filter((o) => close <= o.price)
    .map((o) => ({ ...o, fillPrice: close }));
  const fs = [];
  for (const o of orders.sells) {
    if (o.type === "MOC") fs.push({ ...o, fillPrice: close });
    else if (o.type === "LOC" && close >= o.price) fs.push({ ...o, fillPrice: close });
    else if (o.type === "LIMIT" && limitFilled) fs.push({ ...o, fillPrice: o.price });
  }
  return { fb, fs };
}

// 하루 확정 → 새 상태
function applyDay(s, { date, close, filledBuys, filledSells, revStarOverride }) {
  const { history: _hist, ...core } = s;
  const ns = JSON.parse(JSON.stringify(core));
  const events = [];

  const buyQty = filledBuys.reduce((a, o) => a + o.qty, 0);
  const buyCost = filledBuys.reduce((a, o) => a + o.qty * o.fillPrice, 0);
  const sellQty = filledSells.reduce((a, o) => a + o.qty, 0);
  const sellAmt = filledSells.reduce((a, o) => a + o.qty * o.fillPrice, 0);
  const realizedDay = filledSells.reduce((a, o) => a + (o.fillPrice - s.avg) * o.qty, 0);

  const sharesAfterSell = s.shares - sellQty;
  ns.shares = sharesAfterSell + buyQty;
  ns.cash = s.cash + sellAmt - buyCost;
  if (ns.shares > 0) {
    ns.avg = buyQty > 0 ? (s.avg * sharesAfterSell + buyCost) / ns.shares : s.avg;
  }
  ns.realizedTotal = (s.realizedTotal || 0) + realizedDay;

  // T 갱신
  const c = cfg(s);
  const quarterF = filledSells.some((o) => o.label.startsWith("쿼터매도"));
  const limitF = filledSells.some((o) => o.type === "LIMIT");
  const mocF = filledSells.some((o) => o.type === "MOC");
  const revSellF = filledSells.some((o) => o.label.startsWith("리버스"));

  if (s.mode === "general") {
    let T = s.T;
    if (quarterF) { T *= 0.75; events.push("쿼터매도 체결 → T×0.75"); }
    if (limitF) { T *= 0.25; events.push(`+${c.base}% 지정가매도 체결 → T×0.25`); }
    if (buyQty > 0) {
      if (s.shares === 0) { T = 1; events.push("첫 매수 체결 → T=1"); }
      else if (s.T < c.half) {
        const fullBuy = filledBuys.some((o) => o.label === "평단" || o.label === "");
        const inc = fullBuy ? 1 : 0.5;
        T += inc; events.push(`매수 체결 (전반전 ${fullBuy ? "1회분" : "절반분"}) → T+${inc}`);
      } else { T += 1; events.push("매수 체결 (후반전) → T+1"); }
    }
    ns.T = T;
  } else {
    let T = s.T;
    if (mocF || revSellF) { T *= c.revMul; events.push(`리버스 매도 → T×${c.revMul}`); }
    if (buyQty > 0) { T = T + (c.split - T) * 0.25; events.push(`쿼터매수 → T+(${c.split}−T)×0.25`); }
    ns.T = T;
    ns.revFirst = false;
  }

  // 모드 전환 / 사이클 종료
  let modeMsg = null;
  if (ns.shares === 0) {
    const cycleProfit = ns.cash - s.cycleStartCash;
    modeMsg = `🎉 사이클 ${s.cycle} 종료 — 손익 ${fmt$(cycleProfit)} (복리로 다음 사이클 시작)`;
    ns.cycle = s.cycle + 1;
    ns.cycleStartCash = ns.cash;
    ns.principal = ns.cash;
    ns.T = 0; ns.avg = 0; ns.mode = "general"; ns.revFirst = false;
  } else if (ns.mode === "general" && ns.T > c.exhaust) {
    ns.mode = "reverse"; ns.revFirst = true;
    modeMsg = `⚠ T > ${c.exhaust} — 소진 발생, 내일부터 리버스모드 (첫날 MOC 매도)`;
  } else if (ns.mode === "reverse" && ns.avg > 0 && close > ns.avg * (1 - c.revExit)) {
    // 종료조건: 종가가 평단 −base% 레벨 "위로" 회복 (원문: 32$를 '넘어서면')
    if (ns.T > c.exhaust) {
      ns.revFirst = true;
      modeMsg = `종가 ${fmt$(close)} > 평단−${c.base}% (${fmt$(r2(ns.avg * (1 - c.revExit)))}) 회복했으나 T=${fmtN(ns.T, 3)} > ${c.exhaust} — 재소진, 내일 MOC 처음매도부터 리버스 재시작`;
    } else {
      ns.mode = "general";
      modeMsg = `리버스모드 종료 — 종가 ${fmt$(close)}가 평단−${c.base}% (${fmt$(r2(ns.avg * (1 - c.revExit)))}) 위로 회복 확인. 내일부터 일반모드 (T=${fmtN(ns.T, 3)} 그대로 연결)`;
    }
  }

  ns.closes = [...s.closes, close].slice(-10);
  ns.lastClose = close;

  ns.history = [
    ...s.history,
    {
      date, close, mode: s.mode,
      buys: filledBuys.map((o) => ({ qty: o.qty, price: o.fillPrice })),
      sells: filledSells.map((o) => ({ qty: o.qty, price: o.fillPrice, label: o.label })),
      realizedDay, events, modeMsg,
      after: { T: ns.T, avg: ns.avg, shares: ns.shares, cash: ns.cash, mode: ns.mode },
      prevSnapshot: { ...s, history: undefined },
      revStarOverride: revStarOverride || null,
    },
  ];
  return { ns, modeMsg, events };
}

/* ---------------- UI ---------------- */

export default function App() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("orders");

  // 설정 폼
  const [fTicker, setFTicker] = useState("SOXL");
  const [fSplit, setFSplit] = useState(40);
  const [fPrincipal, setFPrincipal] = useState("20000");
  const [fPrevClose, setFPrevClose] = useState("");
  const [fBigPct, setFBigPct] = useState("10");

  // 일일 입력
  const [dDate, setDDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dClose, setDClose] = useState("");
  const [dLimitFilled, setDLimitFilled] = useState(false);
  const [revStarOv, setRevStarOv] = useState("");
  const [editFills, setEditFills] = useState(null); // {fb, fs} 편집본
  const [flash, setFlash] = useState(null);

  const [corrupt, setCorrupt] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(KEY);
        if (res?.value) {
          const loaded = JSON.parse(res.value);
          // 무결성 검증: 필수 필드 + cfg 유효성. 손상 시 자동 적용 거부.
          const validTicker = loaded.ticker === "TQQQ" || loaded.ticker === "SOXL";
          const validSplit = loaded.split === 20 || loaded.split === 40;
          const validNums = ["cash", "shares", "avg", "T"].every((k) => typeof loaded[k] === "number" && !Number.isNaN(loaded[k]));
          if (loaded.initialized && (!validTicker || !validSplit || !validNums)) {
            setCorrupt(true);
          } else {
            setS(loaded);
          }
        }
      } catch (e) { /* 첫 사용 또는 파싱 실패 → 시작 화면 */ }
      setLoading(false);
    })();
  }, []);

  const persist = async (state) => {
    setS(state);
    try { await window.storage.set(KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
  };

  const startProgram = () => {
    const p = parseFloat(fPrincipal), pc = parseFloat(fPrevClose), bp = parseFloat(fBigPct);
    if (!(p > 0) || !(pc > 0)) return;
    persist({
      initialized: true, ticker: fTicker, split: fSplit,
      principal: p, cash: p, shares: 0, avg: 0, T: 0,
      mode: "general", revFirst: false, cycle: 1, realizedTotal: 0,
      cycleStartCash: p, closes: [pc], lastClose: pc, bigPct: bp || 10, history: [],
    });
  };

  if (loading) return <Shell><div className="text-center py-24 text-zinc-500 text-sm tracking-widest">불러오는 중…</div></Shell>;

  if (corrupt) return (
    <Shell>
      <div className="max-w-md mx-auto mt-8 border border-red-900 rounded-xl p-6 bg-red-950/30">
        <h2 className="text-lg font-bold mb-2 text-red-300">저장 데이터 손상 감지</h2>
        <p className="text-sm text-zinc-300 mb-4 leading-relaxed">저장된 설정(종목/분할) 또는 수치가 유효하지 않아, 잘못된 주문이 표시되는 것을 막기 위해 자동 적용을 중단했습니다. 데이터를 초기화하고 처음부터 다시 시작하세요.</p>
        <button onClick={async () => { try { await window.storage.delete(KEY); } catch (e) {} setCorrupt(false); }}
          className="w-full py-2.5 rounded-lg bg-red-500 text-white font-bold text-sm hover:bg-red-400">초기화하고 다시 시작</button>
      </div>
    </Shell>
  );

  if (!s || !s.initialized) {
    const previewSlope = (fTicker === "TQQQ" ? 15 : 20) / (fSplit / 2);
    return (
      <Shell>
        <div className="max-w-md mx-auto mt-8 border border-zinc-800 rounded-xl p-6 bg-zinc-900/60">
          <h2 className="text-lg font-bold mb-1 text-amber-300">시작 설정</h2>
          <p className="text-xs text-zinc-400 mb-5 leading-relaxed">V4.0 기준. 원금은 이 전략 전용으로 격리하며, 사이클 종료 시 복리로 이어집니다. 한 번 정한 종목·분할은 시작 후 바꿀 수 없습니다 (새로 시작해야 함).</p>
          <Field label="종목">
            <div className="grid grid-cols-2 gap-2">
              {["TQQQ", "SOXL"].map((t) => (
                <button key={t} onClick={() => setFTicker(t)}
                  className={`py-2 rounded-lg text-sm font-bold border transition ${fTicker === t ? "bg-amber-400 text-zinc-950 border-amber-400" : "bg-zinc-900 border-zinc-700 text-zinc-400"}`}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="분할 수">
            <div className="grid grid-cols-2 gap-2">
              {[20, 40].map((n) => (
                <button key={n} onClick={() => setFSplit(n)}
                  className={`py-2 rounded-lg text-sm font-bold border transition ${fSplit === n ? "bg-amber-400 text-zinc-950 border-amber-400" : "bg-zinc-900 border-zinc-700 text-zinc-400"}`}>{n}분할{n === 20 ? " (공격적)" : " (안정적)"}</button>
              ))}
            </div>
          </Field>
          <div className="text-[11px] text-zinc-500 mb-3 -mt-1">
            적용 별% = ({fTicker === "TQQQ" ? 15 : 20} − {previewSlope % 1 === 0 ? previewSlope : previewSlope.toFixed(2)}T)% · 최종 지정가매도 +{fTicker === "TQQQ" ? 15 : 20}% · 리버스 매도 {fSplit === 20 ? "10등분 ×0.9" : "20등분 ×0.95"}
          </div>
          <Field label="원금 (USD)"><Inp v={fPrincipal} set={setFPrincipal} ph="20000" /></Field>
          <Field label={`${fTicker} 전일 종가 (USD)`}><Inp v={fPrevClose} set={setFPrevClose} ph="예: 28.40" /></Field>
          <Field label="첫매수 큰수 % (전일종가 대비)"><Inp v={fBigPct} set={setFBigPct} ph="10~15" /></Field>
          <button onClick={startProgram} className="w-full mt-3 py-2.5 rounded-lg bg-amber-400 text-zinc-950 font-bold text-sm hover:bg-amber-300 transition">{fTicker} {fSplit}분할 · 사이클 1 시작</button>
        </div>
      </Shell>
    );
  }

  const C = cfg(s);

  const orders = getOrders(s, parseFloat(revStarOv) || null);
  const close = parseFloat(dClose);
  const hasClose = !isNaN(close) && close > 0;
  // 종가 ≥ 지정가면 장중 체결이 보장되므로 자동 체결 처리 (수동 토글은 종가 미달 + 장중 터치 케이스용)
  const limitOrder = orders.sells.find((o) => o.type === "LIMIT");
  const limitAuto = hasClose && limitOrder != null && close >= limitOrder.price;
  const effLimitFilled = limitAuto || dLimitFilled;
  const sim = hasClose ? simulateFills(s, orders, close, effLimitFilled) : null;
  const fills = editFills || sim;

  const confirmDay = () => {
    if (!hasClose || !fills) return;
    const fb = fills.fb.filter((o) => o.qty > 0);
    const fs = fills.fs.filter((o) => o.qty > 0);
    const { ns, modeMsg } = applyDay(s, { date: dDate, close, filledBuys: fb, filledSells: fs, revStarOverride: parseFloat(revStarOv) || null });
    persist(ns);
    setDClose(""); setDLimitFilled(false); setEditFills(null); setRevStarOv("");
    setFlash(modeMsg || "기록 완료 — 내일 주문이 갱신되었습니다");
    setTimeout(() => setFlash(null), 6000);
    setTab("orders");
  };

  const undo = () => {
    if (!s.history.length) return;
    const last = s.history[s.history.length - 1];
    const prev = { ...last.prevSnapshot, history: s.history.slice(0, -1) };
    persist(prev);
    setFlash("마지막 기록을 되돌렸습니다");
    setTimeout(() => setFlash(null), 4000);
  };

  const reset = async () => {
    if (!confirm("모든 데이터를 삭제하고 처음부터 시작할까요?")) return;
    try { await window.storage.delete(KEY); } catch (e) {}
    setS(null);
  };

  const star = orders.info.star;
  const unreal = s.shares > 0 && s.lastClose ? (s.lastClose - s.avg) * s.shares : 0;

  return (
    <Shell label={`${C.ticker} · ${C.split}분할 · LOC`}>
      {/* 상태 보드 */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-zinc-800 border border-zinc-800 rounded-xl overflow-hidden mb-4">
        <Stat k="모드" v={s.mode === "general" ? (s.T < C.half ? "일반·전반전" : "일반·후반전") : (s.revFirst ? "리버스·첫날" : "리버스")} accent={s.mode === "reverse"} />
        <Stat k="진행 T" v={`${fmtN(s.T, 3)} / ${C.split}`} />
        <Stat k="평단" v={s.shares > 0 ? fmt$(s.avg) : "—"} />
        <Stat k="보유" v={`${s.shares}주`} />
        <Stat k="잔금" v={fmt$(s.cash)} />
        <Stat k={`별% / 별지점`} v={s.mode === "general" && s.shares > 0 ? `${fmtN(C.starPct(s.T) * 100, 2)}% · ${fmt$(star)}` : s.mode === "reverse" && star ? fmt$(star) : "—"} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500 mb-4 px-1">
        <span>사이클 <b className="text-zinc-300">#{s.cycle}</b></span>
        <span>사이클 시작금 <b className="text-zinc-300">{fmt$(s.cycleStartCash)}</b></span>
        <span>누적 실현손익 <b className={s.realizedTotal >= 0 ? "text-red-400" : "text-blue-400"}>{fmt$(s.realizedTotal)}</b></span>
        <span>미실현 (전일종가 기준) <b className={unreal >= 0 ? "text-red-400" : "text-blue-400"}>{fmt$(unreal)}</b></span>
        <span>전일 종가 <b className="text-zinc-300">{fmt$(s.lastClose)}</b></span>
      </div>

      {flash && <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-400/10 border border-amber-400/40 text-amber-200 text-sm">{flash}</div>}

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        {[["orders", "① 오늘 걸 주문"], ["close", "② 장 마감 입력"], ["log", "기록"], ["set", "설정"]].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-sm rounded-t-lg transition ${tab === k ? "bg-zinc-800 text-amber-300 font-semibold" : "text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
        ))}
      </div>

      {tab === "orders" && (
        <div>
          {s.mode === "reverse" && !s.revFirst && (
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
              <span>리버스 별지점 (직전 5거래일 종가평균: {fmt$(starReverse(s))}) — 직접 수정:</span>
              <input value={revStarOv} onChange={(e) => setRevStarOv(e.target.value)} placeholder="자동" className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100" />
            </div>
          )}
          {orders.notes.map((n, i) => <div key={i} className="mb-2 text-xs text-amber-300/90">※ {n}</div>)}
          <div className="grid md:grid-cols-2 gap-4">
            <OrderTable title="매수 주문 (LOC)" rows={orders.buys} color="red" empty="오늘 매수 주문 없음" />
            <OrderTable title="매도 주문" rows={orders.sells} color="blue" empty="보유 없음 — 매도 주문 없음" />
          </div>
          <div className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
            {s.mode === "general" && <>오늘 1회매수액 시도: <b className="text-zinc-300">{fmt$(orders.info.per)}</b> = 잔금 ÷ ({C.split} − T) · 매수는 전부 LOC. 지정가매도는 프리장 시작(서머타임 저녁 5시 / 비서머 6시)에 걸어 프리·본·애프터장 전체에 효력. 주간장 미사용.</>}
            {s.mode === "reverse" && !s.revFirst && <>쿼터매수 시도액: <b className="text-zinc-300">{fmt$(orders.info.quarterBuyAmt)}</b> = 잔금 ÷ 4</>}
          </div>
        </div>
      )}

      {tab === "close" && (
        <div className="max-w-2xl">
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <Field label="날짜"><input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100" /></Field>
            <Field label={`${C.ticker} 종가`}><Inp v={dClose} set={(v) => { setDClose(v); setEditFills(null); }} ph="예: 26.85" /></Field>
            {s.mode === "general" && s.shares > 0 && (
              <Field label={`+${C.base}% 지정가매도 체결?`}>
                <button onClick={() => { if (!limitAuto) { setDLimitFilled(!dLimitFilled); setEditFills(null); } }}
                  className={`w-full py-2 rounded-lg text-sm font-semibold border transition ${effLimitFilled ? "bg-blue-500/20 border-blue-400 text-blue-300" : "bg-zinc-900 border-zinc-700 text-zinc-500"}`}>
                  {limitAuto ? "자동 체결 (종가 ≥ 지정가)" : effLimitFilled ? "체결됨" : "미체결"}
                </button>
              </Field>
            )}
          </div>

          {hasClose && fills && (
            <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/50">
              <div className="text-xs text-zinc-400 mb-3">종가 {fmt$(close)} 기준 자동 산출 체결 — 실제와 다르면 수량을 수정하세요 (LOC는 종가 체결, 지정가는 지정가 체결로 계산)</div>
              <FillEditor title="매수 체결" list={fills.fb} color="red"
                onQty={(i, q) => { const c = { fb: fills.fb.map((o, j) => j === i ? { ...o, qty: q } : o), fs: fills.fs }; setEditFills(c); }} />
              <FillEditor title="매도 체결" list={fills.fs} color="blue"
                onQty={(i, q) => { const c = { fb: fills.fb, fs: fills.fs.map((o, j) => j === i ? { ...o, qty: q } : o) }; setEditFills(c); }} />
              <PreviewSummary s={s} fills={fills} close={close} />
              <button onClick={confirmDay} className="w-full mt-4 py-2.5 rounded-lg bg-amber-400 text-zinc-950 font-bold text-sm hover:bg-amber-300 transition">이 내용으로 하루 확정</button>
            </div>
          )}
          {!hasClose && <div className="text-sm text-zinc-500">종가를 입력하면 체결 결과를 미리 보여드립니다.</div>}
        </div>
      )}

      {tab === "log" && (
        <div className="space-y-2">
          {[...s.history].reverse().map((h, i) => (
            <div key={i} className="border border-zinc-800 rounded-lg px-4 py-3 bg-zinc-900/40 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-zinc-300 font-semibold">{h.date} <span className="text-zinc-500 font-normal">종가 {fmt$(h.close)} · {h.mode === "general" ? "일반" : "리버스"}</span></span>
                <span className={`${h.realizedDay >= 0 ? "text-red-400" : "text-blue-400"}`}>{h.sells.length ? `실현 ${fmt$(h.realizedDay)}` : ""}</span>
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                {h.buys.reduce((a, o) => a + o.qty, 0) > 0 && <span className="mr-3">매수 {h.buys.reduce((a, o) => a + o.qty, 0)}주 @ {fmt$(h.buys[0].price)}</span>}
                {h.sells.map((o, j) => <span key={j} className="mr-3">매도 {o.qty}주 @ {fmt$(o.price)} ({o.label.split(" ")[0]})</span>)}
                {h.buys.length === 0 && h.sells.length === 0 && <span>체결 없음</span>}
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">→ T {fmtN(h.after.T, 3)} · 평단 {h.after.shares > 0 ? fmt$(h.after.avg) : "—"} · 보유 {h.after.shares}주 · 잔금 {fmt$(h.after.cash)}</div>
              {h.modeMsg && <div className="text-[11px] text-amber-300 mt-1">{h.modeMsg}</div>}
            </div>
          ))}
          {s.history.length === 0 && <div className="text-sm text-zinc-500">아직 기록이 없습니다.</div>}
        </div>
      )}

      {tab === "set" && (
        <div className="max-w-md space-y-3">
          <button onClick={undo} disabled={!s.history.length} className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 disabled:opacity-40">마지막 하루 기록 되돌리기</button>
          <ManualAdjust s={s} persist={persist} setFlash={setFlash} />
          <button onClick={reset} className="w-full py-2.5 rounded-lg border border-red-900 text-red-400 text-sm hover:bg-red-950/40">전체 초기화 (모든 데이터 삭제)</button>
          <div className="text-[11px] text-zinc-500 leading-relaxed pt-2">
            구현 기준: {C.ticker} {C.split}분할 V4.0. 별% = ({C.base}−{C.base / (C.split / 2)}T)%, 1회매수금 = 잔금/({C.split}−T), 쿼터매도 = 보유 1/4 별지점 LOC, 나머지 +{C.base}% 지정가. T: 1회매수 +1 / 절반매수 +0.5 / 쿼터매도 ×0.75 / 지정가매도 후 매수 시 ×0.25+증분. 소진(T&gt;{C.exhaust}) 시 리버스모드: 첫날 보유 1/{C.revDiv} MOC, 이후 별지점(직전 5거래일 종가평균) 위 1/{C.revDiv} 매도·아래 잔금/4 쿼터매수, T는 매도 ×{C.revMul} / 매수 +({C.split}−T)×0.25. <b className="text-zinc-400">리버스 종료 = 종가가 평단−{C.base}% 레벨 위로 회복 확인</b> 후 T 그대로 일반모드 복귀. 사이클 종료(보유 0) 시 복리.
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ---------------- 보조 컴포넌트 ---------------- */

function ManualAdjust({ s, persist, setFlash }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ cash: "", shares: "", avg: "", T: "" });
  const apply = () => {
    const ns = { ...s };
    if (v.cash !== "" && !isNaN(parseFloat(v.cash))) ns.cash = parseFloat(v.cash);
    if (v.shares !== "" && !isNaN(parseInt(v.shares))) ns.shares = Math.max(0, parseInt(v.shares));
    if (v.avg !== "" && !isNaN(parseFloat(v.avg))) ns.avg = parseFloat(v.avg);
    if (v.T !== "" && !isNaN(parseFloat(v.T))) ns.T = parseFloat(v.T);
    if (ns.mode === "general" && ns.T > cfg(ns).exhaust) { ns.mode = "reverse"; ns.revFirst = true; }
    persist(ns); setV({ cash: "", shares: "", avg: "", T: "" }); setOpen(false);
    setFlash("상태를 수동 보정했습니다 (T>39이면 자동으로 리버스모드 전환)");
    setTimeout(() => setFlash(null), 5000);
  };
  return (
    <div className="border border-zinc-800 rounded-lg p-3">
      <button onClick={() => setOpen(!open)} className="w-full text-left text-sm text-zinc-300">⚙ 상태 수동 보정 (액면병합·체결오차 누적 시) {open ? "▲" : "▼"}</button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[["cash", `잔금 (현재 ${fmt$(s.cash)})`], ["shares", `보유주수 (현재 ${s.shares})`], ["avg", `평단 (현재 ${fmt$(s.avg)})`], ["T", `T (현재 ${fmtN(s.T, 4)})`]].map(([k, label]) => (
            <div key={k}>
              <div className="text-[10px] text-zinc-500 mb-0.5">{label}</div>
              <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder="변경 시만 입력"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-700" />
            </div>
          ))}
          <button onClick={apply} className="col-span-2 py-2 rounded-lg bg-zinc-700 text-zinc-100 text-sm font-semibold hover:bg-zinc-600">보정 적용</button>
        </div>
      )}
    </div>
  );
}

function Shell({ children, label }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" }}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <header className="flex items-baseline justify-between mb-5">
          <h1 className="text-xl font-extrabold tracking-tight">무한매수법 <span className="text-amber-400">V4.0</span></h1>
          <span className="text-xs text-zinc-500 font-mono">{label || "V4.0"}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
function Stat({ k, v, accent }) {
  return (
    <div className={`px-3 py-2.5 ${accent ? "bg-red-950/60" : "bg-zinc-900"}`}>
      <div className="text-[10px] text-zinc-500 mb-0.5">{k}</div>
      <div className={`text-sm font-bold font-mono ${accent ? "text-red-300" : "text-zinc-100"}`}>{v}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <div className="mb-3"><div className="text-xs text-zinc-400 mb-1">{label}</div>{children}</div>;
}
function Inp({ v, set, ph }) {
  return <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} inputMode="decimal"
    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-400 outline-none" />;
}
function OrderTable({ title, rows, color, empty }) {
  const c = color === "red" ? "text-red-400" : "text-blue-400";
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <div className={`px-4 py-2 text-sm font-bold bg-zinc-900 ${c}`}>{title}</div>
      {rows.length === 0 ? <div className="px-4 py-4 text-xs text-zinc-500">{empty}</div> : (
        <table className="w-full text-sm font-mono">
          <tbody>
            {rows.map((o, i) => (
              <tr key={i} className="border-t border-zinc-800/70">
                <td className="px-4 py-1.5 text-zinc-100">{o.type === "MOC" ? "MOC" : fmt$(o.price)}</td>
                <td className="px-2 py-1.5 text-right text-zinc-100 w-16">{o.qty}주</td>
                <td className="px-3 py-1.5 text-[11px] text-zinc-500 font-sans">{o.type}{o.label ? ` · ${o.label}` : " · 사다리"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function FillEditor({ title, list, color, onQty }) {
  const c = color === "red" ? "text-red-400" : "text-blue-400";
  return (
    <div className="mb-3">
      <div className={`text-xs font-bold mb-1.5 ${c}`}>{title}</div>
      {list.length === 0 ? <div className="text-xs text-zinc-600">체결 없음</div> : list.map((o, i) => (
        <div key={i} className="flex items-center gap-2 text-sm font-mono mb-1">
          <span className="text-zinc-300 w-20">{fmt$(o.fillPrice)}</span>
          <input type="number" value={o.qty} min="0" onChange={(e) => onQty(i, Math.max(0, parseInt(e.target.value) || 0))}
            className="w-16 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-zinc-100" />
          <span className="text-[11px] text-zinc-500 font-sans">{o.label || "사다리"}</span>
        </div>
      ))}
    </div>
  );
}
function PreviewSummary({ s, fills, close }) {
  const { ns, events, modeMsg } = applyDay(s, { date: "preview", close, filledBuys: fills.fb.filter((o) => o.qty > 0), filledSells: fills.fs.filter((o) => o.qty > 0) });
  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-400 leading-relaxed">
      <div className="font-bold text-zinc-300 mb-1">확정 시 상태</div>
      T {fmtN(s.T, 3)} → <b className="text-amber-300">{fmtN(ns.T, 3)}</b> · 평단 {ns.shares > 0 ? fmt$(ns.avg) : "—"} · 보유 {ns.shares}주 · 잔금 {fmt$(ns.cash)}
      {events.map((e, i) => <div key={i}>· {e}</div>)}
      {modeMsg && <div className="text-amber-300 mt-1">{modeMsg}</div>}
    </div>
  );
}
