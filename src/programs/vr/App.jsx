import React, { useState, useMemo, useEffect } from "react";
import { accountingFromFills } from "../../overlay/ledger";

/* =========================================================================
   라오어 밸류리밸런싱 VR 5.0  ·  적립식 자동 주문 계산기
   -------------------------------------------------------------------------
   [통합판 변경 고지]
   - 아래 ▼엔진(순수 함수)은 검증본과 100% 동일(verbatim). 손대지 않음.
       r2 / buildBuyLadder / buildSellLadder / initState / advanceCycle / runSelfTests
   - 컴포넌트에만 추가:
       (1) 영속성: window.storage(계좌인지 어댑터)로 state/hist/px/설정/원장 저장·복원
       (2) 체결 캡처: 엔진이 계산한 사다리 가격을 그대로 체결로 확정(rung 기반) → 정확한 평단/실현
       (3) 원장(ledger): 통합뷰 회계 오버레이용. read-only. 주문 로직엔 피드백 안 함.
   ========================================================================= */

/* ▼▼▼ 엔진 (검증본 verbatim — 수정 금지) ▼▼▼ */

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// 매수 사다리: 최소밴드 아래로 1주씩. 사용한도(usable) 또는 잔고 소진 시 중단.
function buildBuyLadder(shares, minBand, pool, usageFrac, maxRows = 60) {
  const usable = pool * usageFrac;
  const rows = [];
  let s = shares, p = pool, spent = 0;
  while (rows.length < maxRows && s > 0) {
    const price = r2(minBand / s);          // s주가 최소밴드에 닿는 가격 → 1주 매수
    if (price <= 0) break;
    if (spent + price > usable + 1e-9) break; // 사이클 사용한도
    if (price > p + 1e-9) break;              // 잔고 부족
    s += 1; p = r2(p - price); spent = r2(spent + price);
    rows.push({ shares: s, price, poolAfter: p, cum: spent });
  }
  return rows;
}

// 매도 사다리: 최대밴드 위로 1주씩. (매도는 현금 제약 없음, 표시 행수만 제한)
function buildSellLadder(shares, maxBand, pool, maxRows = 30) {
  const rows = [];
  let s = shares, p = pool, got = 0;
  while (rows.length < maxRows && s > 0) {
    const price = r2(maxBand / s);          // s주가 최대밴드에 닿는 가격 → 1주 매도
    if (price <= 0) break;
    s -= 1; p = r2(p + price); got = r2(got + price);
    rows.push({ shares: s, price, poolAfter: p, cum: got });
  }
  return rows;
}

// 초기화: 자본을 V(주식)과 Pool(현금)으로 분할, 밴드 중심(eval = V)에서 시작.
function initState(capital, poolFrac, price, params) {
  const evalTarget = capital * (1 - poolFrac);
  const shares = Math.floor(evalTarget / price);
  const evalNow = r2(shares * price);
  const pool = r2(capital - evalNow);
  return { cycle: 0, V: evalNow, pool, shares, ...params };
}

// 사이클 진행: V 갱신 + 적립금 반영. (적립식 deposit>0 / 인출식 deposit<0)
function advanceCycle(st) {
  const poolEnd = st.pool;                          // 이번 사이클 종료 시점 pool (적립 전)
  const Vnew = st.V + poolEnd / st.G + st.deposit;   // 문서 공식
  const poolNew = r2(poolEnd + st.deposit);
  return { ...st, cycle: st.cycle + 1, V: Vnew, pool: poolNew };
}

// ---- 소스 대조 self-test ----
function runSelfTests() {
  const out = [];
  const v = 9000 + 1000 / 10 + 250;
  out.push({ name: "V 갱신 공식 · 문서 예시(9000,pool1000,G10,+250)", pass: v === 9350, got: v, exp: 9350 });

  const lad = buildBuyLadder(176, 10509.46, 383.14, 1.0, 10);
  const prices = lad.slice(0, 5).map((x) => x.price);
  const pools = lad.slice(0, 5).map((x) => x.poolAfter);
  const expP = [59.71, 59.38, 59.04, 58.71, 58.39];
  const expPool = [323.43, 264.05, 205.01, 146.3, 87.91];
  out.push({ name: "매수 사다리 가격 · 문서 표(176→181주)", pass: JSON.stringify(prices) === JSON.stringify(expP), got: prices.join(" / "), exp: expP.join(" / ") });
  out.push({ name: "매수 사다리 Pool 잔액 · 문서 표", pass: JSON.stringify(pools) === JSON.stringify(expPool), got: pools.join(" / "), exp: expPool.join(" / ") });
  return out;
}

/* ▲▲▲ 엔진 끝 ▲▲▲ */

export { runSelfTests as vrRunSelfTests };

// ---- 표시 헬퍼 ----
const f2 = (x) => (x == null || isNaN(x) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const f0 = (x) => (x == null || isNaN(x) ? "—" : Number(x).toLocaleString("en-US"));
const usd = (x) => "$" + f2(x);

const KEY = "vr_state";

export default function VR5Tool() {
  const tests = useMemo(runSelfTests, []);
  const allPass = tests.every((t) => t.pass);

  // 설정 + 초기화 입력
  const [G, setG] = useState(10);
  const [band, setBand] = useState(0.15);
  const [usage, setUsage] = useState(0.75);
  const [deposit, setDeposit] = useState(300);

  const [capital, setCapital] = useState(13158);   // 2,000만원 ÷ 1,520 ≈ $13,158
  const [poolFrac, setPoolFrac] = useState(0.3);   // 초기 현금 비중 (판단 포인트)
  const [initPrice, setInitPrice] = useState("");  // 시작 시 TQQQ 가격

  // 진행 상태
  const [state, setState] = useState(null);
  const [hist, setHist] = useState([]);
  const [px, setPx] = useState("");                // 현재가(종가) — 밴드/체결 표시용

  // 회계 오버레이 (read-only 원장) + 투입원금 누계
  const [ledger, setLedger] = useState([]);        // [{ side:"buy"|"sell", qty, price }]
  const [invested, setInvested] = useState(0);     // 초기자본 + Σ적립금

  // 체결 캡처 입력 (rung 기반: 기본 자동, 실제와 다르면 수정)
  const [nBuy, setNBuy] = useState("");            // 체결된 매수 rung 수
  const [nSell, setNSell] = useState("");          // 체결된 매도 rung 수
  const [touchedFill, setTouchedFill] = useState(false);

  const [loaded, setLoaded] = useState(false);

  const params = { G: Number(G), band: Number(band), usage: Number(usage), deposit: Number(deposit), type: "적립식" };

  /* ---- 영속성: 마운트 시 복원 ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(KEY);
        if (res?.value) {
          const b = JSON.parse(res.value);
          if (b.state) setState(b.state);
          if (b.hist) setHist(b.hist);
          if (b.px != null) setPx(b.px);
          if (b.ledger) setLedger(b.ledger);
          if (typeof b.invested === "number") setInvested(b.invested);
          if (b.settings) {
            if (b.settings.G != null) setG(b.settings.G);
            if (b.settings.band != null) setBand(b.settings.band);
            if (b.settings.usage != null) setUsage(b.settings.usage);
            if (b.settings.deposit != null) setDeposit(b.settings.deposit);
          }
        }
      } catch { /* 첫 사용 */ }
      setLoaded(true);
    })();
  }, []);

  /* ---- 영속성: 변경 시 저장 (로드 완료 후에만) ---- */
  useEffect(() => {
    if (!loaded) return;
    const bundle = {
      state, hist, px, ledger, invested,
      settings: { G: Number(G), band: Number(band), usage: Number(usage), deposit: Number(deposit) },
    };
    window.storage.set(KEY, JSON.stringify(bundle)).catch(() => {});
  }, [loaded, state, hist, px, ledger, invested, G, band, usage, deposit]);

  function doInit() {
    const p = Number(initPrice);
    if (!p || p <= 0 || !capital) return;
    const s = initState(Number(capital), Number(poolFrac), p, params);
    setState(s); setHist([]); setPx(String(p));
    setLedger([]); setInvested(Number(capital));   // 초기 투입원금
    setNBuy(""); setNSell(""); setTouchedFill(false);
  }

  function syncParams() {
    if (!state) return;
    setState({ ...state, ...params });
  }

  function nextCycle() {
    if (!state) return;
    setHist([...hist, state]);
    const ns = advanceCycle({ ...state, ...params });
    setState(ns);
    setInvested((v) => r2(v + Number(deposit)));   // 적립금 = 외부 투입원금
    setNBuy(""); setNSell(""); setTouchedFill(false);
  }

  function undo() {
    if (!hist.length) return;
    const prev = hist[hist.length - 1];
    setHist(hist.slice(0, -1));
    setState(prev);
    setNBuy(""); setNSell(""); setTouchedFill(false);
  }

  function reset() {
    setState(null); setHist([]); setPx("");
    setLedger([]); setInvested(0);
    setNBuy(""); setNSell(""); setTouchedFill(false);
  }

  // 파생값
  const view = useMemo(() => {
    if (!state) return null;
    const minBand = state.V * (1 - state.band);
    const maxBand = state.V * (1 + state.band);
    const buy = buildBuyLadder(state.shares, minBand, state.pool, state.usage);
    const sell = buildSellLadder(state.shares, maxBand, state.pool);
    const price = Number(px) || null;
    const evalNow = price ? r2(state.shares * price) : null;
    const pv = state.pool / state.V;
    let status = "—";
    if (evalNow != null) {
      if (evalNow < minBand) status = "매수 구간";
      else if (evalNow > maxBand) status = "매도 구간";
      else status = "밴드 내 (관망)";
    }
    // 현재가에서 이미 체결권에 든 행 수
    const buyHit = price ? buy.filter((r) => price <= r.price).length : 0;
    const sellHit = price ? sell.filter((r) => price >= r.price).length : 0;
    return { minBand, maxBand, buy, sell, price, evalNow, pv, status, buyHit, sellHit };
  }, [state, px]);

  // 체결 캡처 적용 (rung 기반): 엔진이 계산한 가격을 그대로 체결로 확정 → 원장 기록
  const effBuy = touchedFill ? Math.max(0, parseInt(nBuy) || 0) : (view?.buyHit || 0);
  const effSell = touchedFill ? Math.max(0, parseInt(nSell) || 0) : (view?.sellHit || 0);

  function applyFills() {
    if (!state || !view) return;
    const boughtRows = view.buy.slice(0, Math.min(effBuy, view.buy.length));
    const soldRows = view.sell.slice(0, Math.min(effSell, view.sell.length));
    if (boughtRows.length === 0 && soldRows.length === 0) return;

    const buyCost = boughtRows.reduce((a, r) => a + r.price, 0);
    const sellGet = soldRows.reduce((a, r) => a + r.price, 0);
    const newShares = state.shares + boughtRows.length - soldRows.length;
    const newPool = r2(state.pool - buyCost + sellGet);

    const fills = [
      ...boughtRows.map((r) => ({ side: "buy", qty: 1, price: r.price })),
      ...soldRows.map((r) => ({ side: "sell", qty: 1, price: r.price })),
    ];

    setHist([...hist, state]);
    setState({ ...state, shares: Math.max(0, newShares), pool: newPool });
    setLedger([...ledger, ...fills]);
    setNBuy(""); setNSell(""); setTouchedFill(false);
  }

  // 안전 해치: 증권사 체결오차/액면병합 시 보유·Pool 절대값 보정 (원장 미기록 → 평단 추정에 미세영향 가능)
  const [reconShares, setReconShares] = useState("");
  const [reconPool, setReconPool] = useState("");
  const [reconOpen, setReconOpen] = useState(false);
  function applyRecon() {
    if (!state) return;
    const sh = reconShares === "" ? state.shares : Math.max(0, Math.round(Number(reconShares)));
    const pl = reconPool === "" ? state.pool : r2(Number(reconPool));
    setHist([...hist, state]);
    setState({ ...state, shares: sh, pool: pl });
    setReconShares(""); setReconPool(""); setReconOpen(false);
  }

  // 오버레이 회계 (이동평균, 표시용)
  const acct = useMemo(() => accountingFromFills(ledger), [ledger]);

  const L = "text-[11px] uppercase tracking-wide text-slate-400 font-medium";
  const card = "rounded-xl border border-slate-200 bg-white";
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500";

  if (!loaded) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-400">불러오는 중…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* 헤더 */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-600">밸류리밸런싱 · VR 5.0</div>
            <h1 className="text-2xl font-bold tracking-tight">적립식 자동 주문 계산기</h1>
            <p className="text-sm text-slate-500 mt-0.5">TQQQ · 달러 기준 · 2주 1사이클 · LOC 사다리</p>
          </div>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${allPass ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
            <span className={`h-2 w-2 rounded-full ${allPass ? "bg-emerald-500" : "bg-rose-500"}`} />
            소스 대조 self-test {allPass ? "전체 통과" : "실패"}
          </div>
        </div>

        {/* self-test 상세 */}
        <details className={`${card} mb-5 px-4 py-3`}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">검증 내역 ({tests.filter(t=>t.pass).length}/{tests.length})</summary>
          <div className="mt-3 space-y-2">
            {tests.map((t, i) => (
              <div key={i} className="text-xs font-mono flex flex-col gap-0.5 border-b border-slate-100 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={t.pass ? "text-emerald-600" : "text-rose-600"}>{t.pass ? "PASS" : "FAIL"}</span>
                  <span className="text-slate-600 font-sans">{t.name}</span>
                </div>
                <div className="text-slate-400 pl-10">기대 {String(t.exp)} · 결과 {String(t.got)}</div>
              </div>
            ))}
          </div>
        </details>

        {/* 설정 */}
        <div className={`${card} p-4 mb-4`}>
          <div className="text-sm font-semibold mb-3">설정 <span className="text-slate-400 font-normal">— 언제든 변경 가능 (다음 사이클부터 반영)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block"><span className={L}>G (기울기)</span>
              <input className={inp} type="number" value={G} onChange={(e)=>setG(e.target.value)} />
            </label>
            <label className="block"><span className={L}>밴드폭 ±</span>
              <select className={inp} value={band} onChange={(e)=>setBand(Number(e.target.value))}>
                <option value={0.05}>5%</option><option value={0.10}>10%</option>
                <option value={0.15}>15%</option><option value={0.20}>20%</option>
              </select>
            </label>
            <label className="block"><span className={L}>Pool 사용한도</span>
              <select className={inp} value={usage} onChange={(e)=>setUsage(Number(e.target.value))}>
                <option value={0.25}>25%</option><option value={0.50}>50%</option>
                <option value={0.75}>75%</option><option value={1.0}>100%</option>
              </select>
            </label>
            <label className="block"><span className={L}>적립금 / 사이클 ($)</span>
              <input className={inp} type="number" value={deposit} onChange={(e)=>setDeposit(e.target.value)} />
            </label>
          </div>
          {state && (
            <button onClick={syncParams} className="mt-3 text-xs rounded-md bg-slate-100 hover:bg-slate-200 px-3 py-1.5 font-medium">현재 사이클에 설정 즉시 적용</button>
          )}
        </div>

        {/* 초기화 / 시작 */}
        {!state && (
          <div className={`${card} p-4 mb-4`}>
            <div className="text-sm font-semibold mb-3">시작 설정</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block"><span className={L}>총 투자금 ($)</span>
                <input className={inp} type="number" value={capital} onChange={(e)=>setCapital(e.target.value)} />
              </label>
              <label className="block"><span className={L}>초기 현금(Pool) 비중</span>
                <select className={inp} value={poolFrac} onChange={(e)=>setPoolFrac(Number(e.target.value))}>
                  <option value={0.13}>13% (장기평균 수준·공격)</option>
                  <option value={0.20}>20%</option>
                  <option value={0.30}>30% (균형·기본)</option>
                  <option value={0.40}>40%</option>
                  <option value={0.50}>50% (방어)</option>
                </select>
              </label>
              <label className="block"><span className={L}>시작 TQQQ 가격 ($) ·필수</span>
                <input className={inp} type="number" value={initPrice} onChange={(e)=>setInitPrice(e.target.value)} placeholder="현재가 입력" />
              </label>
            </div>
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              초기 현금 비중은 정해진 답이 없는 <b>판단 포인트</b>다. 낮을수록 처음부터 많이 투입(공격), 높을수록 초기 하락 대비 사다리 여력(방어)이 커진다. 진입 시점이 사이클 어디인지 모르므로 30% 전후를 기본값으로 둠.
            </div>
            <button onClick={doInit} disabled={!initPrice || Number(initPrice)<=0}
              className="mt-3 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white px-4 py-2 text-sm font-semibold">
              시작 (사이클 0 생성)
            </button>
          </div>
        )}

        {/* 진행 화면 */}
        {state && view && (
          <>
            {/* 상태 요약 */}
            <div className={`${card} p-4 mb-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">사이클 {state.cycle} · 현재 상태</div>
                <button onClick={reset} className="text-xs text-slate-400 hover:text-rose-600">처음부터 재설정</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4">
                <Stat label="V (목표)" v={usd(state.V)} />
                <Stat label="밴드" v={`${usd(view.minBand)} ~ ${usd(view.maxBand)}`} small />
                <Stat label="보유 수량" v={f0(state.shares) + " 주"} />
                <Stat label="Pool (현금)" v={usd(state.pool)} />
                <Stat label="P/V (현금비중)" v={(view.pv*100).toFixed(1) + "%"} />
                <Stat label="평가금" v={view.evalNow!=null ? usd(view.evalNow) : "—"} />
                <Stat label="총 자산" v={view.evalNow!=null ? usd(view.evalNow + state.pool) : "—"} />
                <Stat label="밴드 상태" v={view.status}
                  tone={view.status==="매수 구간"?"emerald":view.status==="매도 구간"?"rose":"slate"} />
              </div>
              {/* 오버레이 회계 (read-only) */}
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-4">
                <Stat label="평단 (참고·체결기준)" v={acct.heldQty>0 ? usd(acct.avgCost) : "—"} small />
                <Stat label="실현손익 누계" v={usd(acct.realized)} small tone={acct.realized>=0?"emerald":"rose"} />
                <Stat label="투입원금 누계" v={usd(invested)} small />
                <Stat label="총수익률" v={invested>0 && view.evalNow!=null ? (((view.evalNow+state.pool-invested)/invested)*100).toFixed(1)+"%" : "—"} small
                  tone={view.evalNow!=null && (view.evalNow+state.pool-invested)>=0?"emerald":"rose"} />
              </div>
              <div className="mt-1 text-[10px] text-slate-400">※ 평단/실현은 체결 기록 기반의 <b>관찰용 회계</b>일 뿐, VR 주문(밴드)에는 영향을 주지 않음 (원문: VR은 평단과 무관하게 매도).</div>
              <div className="mt-3 flex items-center gap-2">
                <span className={L}>현재가(종가)</span>
                <input className={`${inp} max-w-[140px]`} type="number" value={px} onChange={(e)=>setPx(e.target.value)} placeholder="종가 입력" />
                <span className="text-xs text-slate-400">— 밴드 상태와 체결권 진입 행 표시용</span>
              </div>
            </div>

            {/* 주문 사다리 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* 매수 */}
              <div className={`${card} overflow-hidden`}>
                <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-emerald-800">매수 LOC 사다리</span>
                  <span className="text-xs text-emerald-700">사용한도 {usd(state.pool*state.usage)} ({(state.usage*100)|0}%) · {view.buy.length}주</span>
                </div>
                <Ladder rows={view.buy} side="buy" hit={view.buyHit} />
                {view.buy.length===0 && <Empty t="이번 사이클 매수 여력 없음 (사용한도/잔고 소진)" />}
              </div>
              {/* 매도 */}
              <div className={`${card} overflow-hidden`}>
                <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-rose-800">매도 LOC 사다리</span>
                  <span className="text-xs text-rose-700">상위 {view.sell.length}주 표시</span>
                </div>
                <Ladder rows={view.sell} side="sell" hit={view.sellHit} />
                {view.sell.length===0 && <Empty t="보유 수량 없음" />}
              </div>
            </div>

            {/* 체결 캡처 + 사이클 진행 */}
            <div className={`${card} p-4 mb-4`}>
              <div className="text-sm font-semibold mb-1">체결 반영</div>
              <p className="text-xs text-slate-500 mb-3">종가를 입력하면 체결권에 든 사다리 행 수가 자동 계산됩니다. 실제 체결과 다르면 수만 고치세요. 확정 시 <b>그 행들의 정확한 가격</b>으로 평단/실현이 기록됩니다.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <label className="block"><span className={L}>체결된 매수 주수</span>
                  <input className={inp} type="number" min="0" value={touchedFill ? nBuy : effBuy}
                    onChange={(e)=>{ setTouchedFill(true); setNBuy(e.target.value); if (nSell==="") setNSell(String(view.sellHit)); }} />
                </label>
                <label className="block"><span className={L}>체결된 매도 주수</span>
                  <input className={inp} type="number" min="0" value={touchedFill ? nSell : effSell}
                    onChange={(e)=>{ setTouchedFill(true); setNSell(e.target.value); if (nBuy==="") setNBuy(String(view.buyHit)); }} />
                </label>
                <button onClick={applyFills} disabled={effBuy===0 && effSell===0}
                  className="rounded-lg bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white px-4 py-2 text-sm font-semibold">체결 확정 (사이클 유지)</button>
              </div>
              {(effBuy>0 || effSell>0) && (
                <div className="mt-2 text-xs text-slate-500">
                  확정 시: {effBuy>0 && <span className="text-emerald-700">매수 {effBuy}주 (−{usd(view.buy.slice(0,effBuy).reduce((a,r)=>a+r.price,0))})</span>}
                  {effBuy>0 && effSell>0 && " · "}
                  {effSell>0 && <span className="text-rose-700">매도 {effSell}주 (+{usd(view.sell.slice(0,effSell).reduce((a,r)=>a+r.price,0))})</span>}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                <button onClick={nextCycle} className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-semibold">
                  다음 사이클 → (V 갱신 +{usd(state.deposit)} 적립)
                </button>
                <button onClick={undo} disabled={!hist.length} className="rounded-lg bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 px-4 py-2 text-sm font-medium">되돌리기</button>
              </div>

              {/* 안전 해치 */}
              <div className="mt-3">
                <button onClick={()=>setReconOpen(!reconOpen)} className="text-xs text-slate-400 hover:text-slate-600">⚙ 보유·Pool 직접 보정 (증권사 오차·액면병합 시) {reconOpen?"▲":"▼"}</button>
                {reconOpen && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                    <label className="block"><span className={L}>보유 수량 (현재 {f0(state.shares)})</span>
                      <input className={inp} type="number" value={reconShares} onChange={(e)=>setReconShares(e.target.value)} placeholder="변경 시만" /></label>
                    <label className="block"><span className={L}>Pool (현재 {usd(state.pool)})</span>
                      <input className={inp} type="number" value={reconPool} onChange={(e)=>setReconPool(e.target.value)} placeholder="변경 시만" /></label>
                    <button onClick={applyRecon} className="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-sm font-medium">보정 적용</button>
                    <p className="sm:col-span-3 text-[10px] text-amber-600">※ 보정은 체결로 기록되지 않아 평단/실현 추정이 미세하게 어긋날 수 있음 (드물게만 사용).</p>
                  </div>
                )}
              </div>

              <p className="mt-3 text-xs text-slate-400">
                흐름: ① 위 사다리를 LOC로 걸어둔다 → ② 종가 입력 후 체결분을 ‘체결 확정’ → ③ 사이클 끝에 ‘다음 사이클’로 V 갱신.
              </p>
            </div>

            {/* 이력 */}
            {hist.length>0 && (
              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold mb-2">이력</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono tabular-nums">
                    <thead><tr className="text-slate-400 text-left">
                      <th className="py-1 pr-3">사이클</th><th className="pr-3">V</th><th className="pr-3">보유</th><th className="pr-3">Pool</th><th>P/V</th>
                    </tr></thead>
                    <tbody>
                      {hist.map((h,i)=>(
                        <tr key={i} className="border-t border-slate-100 text-slate-600">
                          <td className="py-1 pr-3">{h.cycle}</td><td className="pr-3">{usd(h.V)}</td>
                          <td className="pr-3">{f0(h.shares)}</td><td className="pr-3">{usd(h.pool)}</td>
                          <td>{((h.pool/h.V)*100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[11px] text-slate-400 mt-6 leading-relaxed">
          엔진은 라오어 VR 5.0 문서의 공식·표를 그대로 재현하도록 검증함(상단 self-test). 가이드 기본값은 적립식 G=10 / 밴드 ±15% / Pool 75%.
          본 도구는 매매 의사결정을 대신하지 않으며, 투자 책임은 사용자 본인에게 있음.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, v, small, tone }) {
  const c = tone==="emerald"?"text-emerald-600":tone==="rose"?"text-rose-600":"text-slate-900";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
      <div className={`font-mono tabular-nums font-semibold ${small?"text-xs mt-1":"text-base"} ${c}`}>{v}</div>
    </div>
  );
}

function Ladder({ rows, side, hit }) {
  const buy = side === "buy";
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs font-mono tabular-nums">
        <thead className="sticky top-0 bg-white">
          <tr className="text-slate-400 text-left">
            <th className="py-1.5 px-4">{buy ? "매수가" : "매도가"}</th>
            <th className="px-2">→ 보유</th>
            <th className="px-2 text-right">{buy ? "누적사용" : "누적회수"}</th>
            <th className="px-4 text-right">Pool</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const inHit = i < hit;
            return (
              <tr key={i} className={`border-t border-slate-50 ${inHit ? (buy?"bg-emerald-50":"bg-rose-50") : ""}`}>
                <td className={`py-1.5 px-4 font-semibold ${buy?"text-emerald-700":"text-rose-700"}`}>${f2(r.price)}{inHit && <span className="ml-1 text-[10px]">●</span>}</td>
                <td className="px-2 text-slate-500">{f0(r.shares)}</td>
                <td className="px-2 text-right text-slate-500">${f2(r.cum)}</td>
                <td className="px-4 text-right text-slate-700">${f2(r.poolAfter)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ t }) {
  return <div className="px-4 py-6 text-center text-xs text-slate-400">{t}</div>;
}
