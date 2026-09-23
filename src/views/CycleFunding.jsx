import { useEffect, useState } from "react";
import { rawGet, rawSet, ACCOUNT_STATE_EVENT } from "../storage/adapter";
import { MUBAE_KEYS, canAddCycleFunds, addCycleFunds } from "../features/cycleFunding";

export default function CycleFunding({ acct, onReload }) {
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [, refresh] = useState(0);
  const key = MUBAE_KEYS[acct.programType];
  useEffect(() => {
    const update = (e) => { if (e.detail.accountId === acct.id) refresh((n) => n + 1); };
    window.addEventListener(ACCOUNT_STATE_EVENT, update);
    return () => window.removeEventListener(ACCOUNT_STATE_EVENT, update);
  }, [acct.id]);
  if (!key) return null;
  let state;
  try { state = JSON.parse(rawGet(acct.id, key)); } catch { return <p role="alert">계좌 상태를 읽을 수 없습니다.</p>; }
  if (!state?.initialized) return null;
  const eligible = canAddCycleFunds(state);
  const submit = (e) => {
    e.preventDefault();
    try {
      const latest = JSON.parse(rawGet(acct.id, key));
      rawSet(acct.id, key, JSON.stringify(addCycleFunds(latest, amount)));
      setAmount(""); setMessage("추가 금액을 반영했습니다. 설정의 되돌리기로 취소할 수 있습니다.");
      onReload();
    } catch (err) { setMessage(err.message); }
  };
  return <section className="max-w-4xl mx-auto px-4 pt-4 text-zinc-200">
    <form onSubmit={submit} className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold text-amber-300">다음 사이클 금액 추가</h2>
      <p className="my-2 text-xs text-zinc-400">{eligible ? `사이클 ${state.cycle - 1} 종료 · 사이클 ${state.cycle} 첫 매수 전입니다.` : "사이클 종료 후 다음 사이클의 첫 매수 전에 추가할 수 있습니다."} 추가 금액은 잔금과 투입원금에 반영됩니다.</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="추가 금액 (USD)" value={amount} disabled={!eligible} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="추가 금액 (USD)" className="w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40" />
        <button disabled={!eligible || !amount.trim()} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">금액 추가</button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">실제 입금이 완료된 금액을 입력하세요. 이 기능은 증권사로 자금을 이체하지 않습니다.</p>
      {message && <p role="status" className="mt-2 text-xs text-amber-300">{message}</p>}
    </form>
  </section>;
}
