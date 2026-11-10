// 큰수매수: 원래 주문표의 상한 이상 수량을 큰수 한 줄에 모은다.
export function mergeCappedBuys(buys, lastClose) {
  const cap = Math.floor(Math.round(lastClose * 100) * 130 / 100) / 100;
  if (!buys.some((order) => order.price > cap)) return buys;

  const qty = buys.reduce((sum, order) => sum + (order.price >= cap ? order.qty : 0), 0);
  return [
    { price: cap, qty, label: "큰수 (전일 종가 +30% 상한)", type: "LOC", side: "buy" },
    ...buys.filter((order) => order.price < cap),
  ];
}
