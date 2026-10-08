// 주문 가격/방향을 변경하거나 상계하지 않는 표시 전용 집계.
export function combineOrders(plans, sameBrokerAccount = false) {
  const groups = new Map();
  for (const plan of plans) {
    if (plan.archived || !plan.selected) continue;
    if(!["SOXL","TQQQ"].includes(plan.ticker)) throw Error(`${plan.label}: 종목을 확인하세요.`);
    for (const [index, order] of plan.orders.entries()) {
      if (!(Number.isInteger(order.qty) && order.qty > 0) || !["buy", "sell"].includes(order.side)
        || !["LOC", "LIMIT", "MOC"].includes(order.type)
        || (order.type !== "MOC" && !(Number.isFinite(order.price) && order.price > 0))) {
        throw new Error(`${plan.label}: 유효하지 않은 주문입니다.`);
      }
      const session = order.session || (order.type === "LIMIT" ? "프리·본·애프터" : "본장 종가");
      const key = JSON.stringify([sameBrokerAccount ? "shared" : plan.id, plan.ticker, order.side, order.type, order.price, session]);
      if (!groups.has(key)) groups.set(key, {key, ticker: plan.ticker, side: order.side,
        type: order.type, price: order.price, session, qty: 0, allocations: [], conflict: false});
      const row = groups.get(key);
      row.qty += order.qty;
      if(!Number.isSafeInteger(row.qty)) throw Error("합산 수량 범위를 초과했습니다.");
      row.allocations.push({accountId: plan.id, label: plan.label, qty: order.qty, orderIndex: index, orderLabel: order.label || "사다리"});
    }
  }
  const rows = [...groups.values()];
  if (sameBrokerAccount) for (const buy of rows.filter(o => o.side === "buy")) {
    for (const sell of rows.filter(o => o.side === "sell" && o.ticker === buy.ticker)) {
      // LIMIT는 장중 체결도 가능하므로 겹침은 보수적 경고이며 체결 예측이 아니다.
      if (buy.type === "MOC" || sell.type === "MOC" || buy.price >= sell.price) buy.conflict = sell.conflict = true;
    }
  }
  return rows.sort((a,b) => a.ticker.localeCompare(b.ticker) || a.side.localeCompare(b.side) || (b.price ?? 0)-(a.price ?? 0));
}
