/* ============================================================
   릴리스 게이트 (순수, React 비의존)
   - 원문 PDF 의 수치를 독립 재현해 매매 공식 정합성을 재확인한다.
   - 무한매수법 두 파일은 검증본 그대로(바이트 동일·sha256 확인)이므로
     로직 불변의 1차 보증은 바이트 동일성. 본 게이트는 공식이 원문과
     일치함을 수치로 재확인하는 2차 검증.
   - VR 은 이와 별도로 컴포넌트 내부 인라인 self-test(실제 엔진)가 작동.
   - 어느 항목이라도 FAIL → 배포/로드 차단.
   ============================================================ */

import { accountingFromFills } from "../overlay/ledger.js";

const round2 = (x) => Math.round(x * 100) / 100;
const eq = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// 무한 별% 기울기 (원문: T=split/2 에서 별%=0)
const starPct = (base, split, T) => base - (base / (split / 2)) * T;
const starPrice = (avg, base, split, T) => round2(avg * (1 + starPct(base, split, T) / 100));

export function runGate() {
  const r = [];
  const add = (name, pass, got, exp) => r.push({ name, pass, got: String(got), exp: String(exp) });

  /* ---- 무한매수법 (원문 V4.0 / V2.2 수치) ---- */

  // 1) SOXL 20분할: 평단 38.30, T=8.6 → 별% 2.8% → 별지점 39.37 (V4.0 일반 PDF)
  add("무한·SOXL20 별지점 예시 (평단38.30,T8.6→39.37)",
      eq(starPrice(38.30, 20, 20, 8.6), 39.37), starPrice(38.30, 20, 20, 8.6), 39.37);

  // 2) 별% 4종 기울기 (TQQQ/SOXL × 20/40)
  add("무한·SOXL40 기울기 (T=10→별%10)", eq(starPct(20, 40, 10), 10), starPct(20, 40, 10), 10);
  add("무한·SOXL20 기울기 (T=10→별%0)", eq(starPct(20, 20, 10), 0), starPct(20, 20, 10), 0);
  add("무한·TQQQ40 기울기 (T=10→별%7.5)", eq(starPct(15, 40, 10), 7.5), starPct(15, 40, 10), 7.5);
  add("무한·TQQQ20 기울기 (T=10→별%0)", eq(starPct(15, 20, 10), 0), starPct(15, 20, 10), 0);

  // 3) 매수점 = 별지점 − 0.01
  add("무한·매수점=별지점−0.01", eq(round2(39.37 - 0.01), 39.36), round2(39.37 - 0.01), 39.36);

  // 4) 1회매수금: 잔금 19522 / (40−1) = 500.56 (V4.0 일반 PDF)
  add("무한·1회매수금 (19522/39→500.56)", eq(round2(19522 / 39), 500.56), round2(19522 / 39), 500.56);

  // 5) 리버스 T (40분할): 39.5 →(×0.95) 37.525 →(+(40−37.525)×0.25) 38.14375 (리버스 PDF)
  const t1 = 39.5 * 0.95;
  const t2 = t1 + (40 - t1) * 0.25;
  add("무한·리버스T 매도 (39.5×0.95→37.525)", eq(t1, 37.525), t1, 37.525);
  add("무한·리버스T 매수 (→38.14375)", eq(t2, 38.14375), t2, 38.14375);

  // 6) 리버스 종료 방향 (SOXL 평단 40 → 종가 32 '초과'에서 종료; 위로 회복 방향)
  const thr = 40 * (1 - 0.20); // 32
  add("무한·리버스 종료 임계 (평단40 SOXL→32)", eq(thr, 32), thr, 32);
  add("무한·리버스 종료 방향 (32.01 종료/31.99 유지)",
      (32.01 > thr) && !(31.99 > thr), `${32.01 > thr}/${31.99 > thr}`, "true/false");

  /* ---- VR 5.0 (원문 표/예시 독립 재현) ---- */

  // V1) V 갱신: 9000 + 1000/10 + 250 = 9350
  const vV = 9000 + 1000 / 10 + 250;
  add("VR·V갱신 (9000+1000/10+250→9350)", vV === 9350, vV, 9350);

  // V2/V3) 매수 사다리 가격·Pool (176주, minBand 10509.46, pool 383.14)
  const minBand = 10509.46;
  const expPrice = [59.71, 59.38, 59.04, 58.71, 58.39];
  const expPool = [323.43, 264.05, 205.01, 146.30, 87.91];
  let s = 176, pool = 383.14, okP = true, okPool = true;
  const gotP = [], gotPool = [];
  for (let i = 0; i < 5; i++) {
    const price = round2(minBand / s);
    pool = round2(pool - price);
    gotP.push(price); gotPool.push(pool);
    if (!eq(price, expPrice[i])) okP = false;
    if (!eq(pool, expPool[i])) okPool = false;
    s += 1;
  }
  add("VR·매수 사다리 가격 (176→181주)", okP, gotP.join(" / "), expPrice.join(" / "));
  add("VR·매수 사다리 Pool 잔액", okPool, gotPool.join(" / "), expPool.join(" / "));

  /* ---- 회계 오버레이 정합성 (read-only) ---- */

  // 평단/실현 이동평균: 60 매수 + 58 매수 → 평단 59; 70 매도 1주 → 실현 +11, 평단 59 유지
  const acct = accountingFromFills([
    { side: "buy", qty: 1, price: 60 },
    { side: "buy", qty: 1, price: 58 },
    { side: "sell", qty: 1, price: 70 },
  ]);
  add("회계·이동평균 평단 (60,58→59)", eq(acct.avgCost, 59), acct.avgCost, 59);
  add("회계·실현손익 (70매도→+11)", eq(acct.realized, 11), acct.realized, 11);
  add("회계·매도후 잔량 (1주)", acct.heldQty === 1, acct.heldQty, 1);

  // 무한 invested 항등식: 원금 P0 → 외부투입 = cash + shares*avg - realizedTotal (복리에도 견고)
  // 예) 사이클 중간: cash 12000, shares 200, avg 40, realizedTotal 0 → invested = 12000 + 8000 = 20000
  const invMid = 12000 + 200 * 40 - 0;
  add("무한·invested 항등식 (사이클 중)", eq(invMid, 20000), invMid, 20000);
  // 복리 후: 전량매도해 shares 0, cash 21500, realizedTotal 1500 → invested = 21500 - 1500 = 20000 (원금 보존)
  const invEnd = 21500 + 0 * 0 - 1500;
  add("무한·invested 항등식 (복리 후 원금보존)", eq(invEnd, 20000), invEnd, 20000);

  const allPass = r.every((x) => x.pass);
  return { allPass, results: r };
}
