/* ============================================================
   통합뷰 스냅샷 빌더 (read-only)
   - 마운트된 컴포넌트가 아니라 localStorage 의 acct:{id}:* 를 직접 읽어 집계.
   - 각 프로그램 타입을 공통 AccountSnapshot 으로 환산. 뷰는 내부구조에 의존 안 함.

   AccountSnapshot = {
     id, label, ticker, started,
     shares, avgCost, cash,
     marketValue, invested, unrealized,
     realized, realizedReturnPct, totalReturnPct
   }
   - 무한매수법: avg/realizedTotal native. invested = cash + shares*avg - realizedTotal (항등식).
   - VR: 평단/실현은 체결원장 이동평균. invested = 초기자본 + Σ적립금.
   ============================================================ */

import { rawGet } from "../storage/adapter";
import { accountingFromFills } from "./ledger";

const MUBAE_SINGLE_KEY = "mubae_v4_soxl40_state_v1";
const MUBAE_MULTI_KEY = "mubae_v4_multi_state_v1";
const VR_KEY = "vr_state";

function parse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function emptySnap(acct, ticker) {
  return {
    id: acct.id, label: acct.label, ticker, started: false,
    shares: 0, avgCost: 0, cash: 0,
    marketValue: 0, invested: 0, unrealized: 0,
    realized: 0, realizedReturnPct: null, totalReturnPct: null,
  };
}

export function buildSnapshot(acct, priceMap) {
  if (acct.programType === "vr") return vrSnap(acct, priceMap);
  if (acct.programType === "mubaeSingle") return mubaeSnap(acct, MUBAE_SINGLE_KEY, "SOXL", priceMap);
  if (acct.programType === "mubaeMulti") return mubaeSnap(acct, MUBAE_MULTI_KEY, null, priceMap);
  return emptySnap(acct, "—");
}

function mubaeSnap(acct, key, fixedTicker, priceMap) {
  const st = parse(rawGet(acct.id, key));
  const ticker = fixedTicker || (st && st.ticker) || "—";
  if (!st || !st.initialized) return emptySnap(acct, ticker);

  const shares = st.shares || 0;
  const avgCost = st.avg || 0;
  const cash = st.cash || 0;
  const realized = st.realizedTotal || 0;
  // 항등식: 외부 투입원금 = 현금 + 보유원가 - 실현누계 (복리에도 견고)
  const invested = cash + shares * avgCost - realized;

  const price = priceMap[ticker] ?? null;
  const marketValue = price != null ? shares * price : (st.lastClose != null ? shares * st.lastClose : 0);
  const unrealized = marketValue - shares * avgCost;

  return {
    id: acct.id, label: acct.label, ticker, started: true,
    shares, avgCost, cash,
    marketValue, invested, unrealized,
    realized,
    realizedReturnPct: invested > 0 ? (realized / invested) * 100 : null,
    totalReturnPct: invested > 0 ? ((marketValue + cash - invested) / invested) * 100 : null,
    extra: { T: st.T, mode: st.mode, cycle: st.cycle, split: st.split || 40, priceUsed: price != null ? price : st.lastClose, priceIsLive: price != null },
  };
}

function vrSnap(acct, priceMap) {
  const b = parse(rawGet(acct.id, VR_KEY));
  const ticker = "TQQQ";
  if (!b || !b.state) return emptySnap(acct, ticker);

  const st = b.state;
  const shares = st.shares || 0;
  const cash = st.pool || 0;            // VR 의 '잔금' = pool
  const invested = b.invested || 0;
  const a = accountingFromFills(b.ledger || []);
  const avgCost = a.avgCost;
  const realized = a.realized;

  const price = priceMap[ticker] ?? null;
  const marketValue = price != null ? shares * price : (b.px ? shares * Number(b.px) : 0);
  const unrealized = marketValue - shares * avgCost;

  return {
    id: acct.id, label: acct.label, ticker, started: true,
    shares, avgCost, cash,
    marketValue, invested, unrealized,
    realized,
    realizedReturnPct: invested > 0 ? (realized / invested) * 100 : null,
    totalReturnPct: invested > 0 ? ((marketValue + cash - invested) / invested) * 100 : null,
    extra: { V: st.V, pv: st.V ? (st.pool / st.V) * 100 : null, cycle: st.cycle, priceUsed: price != null ? price : (b.px ? Number(b.px) : null), priceIsLive: price != null },
  };
}

export function portfolioTotals(snaps) {
  const t = { marketValue: 0, cash: 0, invested: 0, unrealized: 0, realized: 0 };
  for (const s of snaps) {
    if (!s.started) continue;
    t.marketValue += s.marketValue;
    t.cash += s.cash;
    t.invested += s.invested;
    t.unrealized += s.unrealized;
    t.realized += s.realized;
  }
  t.totalReturnPct = t.invested > 0 ? ((t.marketValue + t.cash - t.invested) / t.invested) * 100 : null;
  t.realizedReturnPct = t.invested > 0 ? (t.realized / t.invested) * 100 : null;
  return t;
}
