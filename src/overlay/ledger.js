/* ============================================================
   회계 오버레이 (순수, read-only)
   - 체결 원장 → 이동평균 평단 / 실현손익.
   - 센트(정수) 누적으로 부동소수 드리프트 차단.
   - 절대 주문 로직에 피드백하지 않는다 (관찰용 회계).
   ============================================================ */

export function accountingFromFills(fills) {
  let heldQty = 0;
  let costCents = 0;     // 보유분 원가 (센트)
  let realizedCents = 0;
  for (const f of fills || []) {
    const qty = f.qty || 1;
    const priceCents = Math.round(f.price * 100);
    if (f.side === "buy") {
      costCents += priceCents * qty;
      heldQty += qty;
    } else if (f.side === "sell") {
      const avgCents = heldQty > 0 ? costCents / heldQty : 0;
      realizedCents += (priceCents - avgCents) * qty;
      costCents -= Math.round(avgCents * qty);
      heldQty -= qty;
      if (heldQty <= 0) { heldQty = 0; costCents = 0; }
    }
  }
  return {
    heldQty,
    avgCost: heldQty > 0 ? costCents / 100 / heldQty : 0,
    realized: realizedCents / 100,
  };
}
