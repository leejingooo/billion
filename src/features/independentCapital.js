export function independentCapitalState({ amount, previousClose, priceDate, ticker, split, bigPct = 10, sourceId }) {
  const text=String(amount).trim();
  if(!/^\d+(\.\d{1,2})?$/.test(text)) throw Error("증액은 소수 둘째 자리까지 입력하세요.");
  const cents=Math.round(Number(text)*100), close=Number(previousClose);
  if(!Number.isSafeInteger(cents)||cents<=0) throw Error("증액은 0보다 큰 금액이어야 합니다.");
  if(!(Number.isFinite(close)&&close>0)) throw Error("직전 거래일 종가를 입력하세요.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)||Number.isNaN(Date.parse(priceDate))||new Date(priceDate).toISOString().slice(0,10)!==priceDate) throw Error("기준 거래일을 확인하세요.");
  if(!["SOXL","TQQQ"].includes(ticker)||![20,40].includes(split)) throw Error("종목/분할 설정을 확인하세요.");
  const cash=cents/100;
  return {initialized:true,ticker,split,principal:cash,cash,shares:0,avg:0,T:0,mode:"general",revFirst:false,
    cycle:1,realizedTotal:0,cycleStartCash:cash,closes:[close],lastClose:close,bigPct:Number(bigPct)||10,history:[],
    orderPriceDate:priceDate,capitalSource:{kind:"new-external-capital",amount:cash,sourceId}};
}
