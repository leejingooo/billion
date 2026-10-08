import { getOrders as singleOrders, buyTurnIncrement as singleTurn } from "../programs/mubaeSingle/App";
import { getOrders as multiOrders, buyTurnIncrement as multiTurn } from "../programs/mubaeMulti/App";

export function mubaeEngine(type) {
  if(type==="mubaeSingle") return {orders:singleOrders,classify:singleTurn};
  if(type==="mubaeMulti") return {orders:multiOrders,classify:multiTurn};
  throw Error("무한매수법 계좌만 지원합니다.");
}
