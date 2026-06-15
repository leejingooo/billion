import { useMemo } from "react";
import { listAccounts } from "../storage/accounts";
import { buildSnapshot, portfolioTotals } from "../overlay/snapshot";

const usd = (x) => (x == null || isNaN(x) ? "—" : "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (x) => (x == null || isNaN(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(1) + "%");
const sign = (x) => (x == null || isNaN(x) ? "text-zinc-400" : x >= 0 ? "text-red-400" : "text-blue-400");

export default function UnifiedView({ priceMap, onPrice, tick }) {
  const accounts = useMemo(() => listAccounts(), [tick]);
  const snaps = useMemo(() => accounts.map((a) => buildSnapshot(a, priceMap)), [accounts, priceMap, tick]);
  const totals = useMemo(() => portfolioTotals(snaps), [snaps]);
  const started = snaps.filter((s) => s.started);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6" style={{ fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">통합뷰</h2>
            <p className="text-xs text-zinc-500 mt-0.5">모든 계좌 · 평가는 아래 종목별 현재가 기준 (종가 운용과 일치). 관찰 전용 — 주문에 영향 없음.</p>
          </div>
          <div className="flex items-end gap-3">
            {["TQQQ", "SOXL"].map((t) => (
              <label key={t} className="block">
                <div className="text-[10px] text-zinc-500 mb-0.5">{t} 현재가</div>
                <input value={priceMap[t] ?? ""} onChange={(e) => onPrice(t, e.target.value)} inputMode="decimal" placeholder="종가"
                  className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:border-amber-400 outline-none" />
              </label>
            ))}
          </div>
        </div>

        {/* 포트폴리오 합계 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 border border-zinc-800 rounded-xl overflow-hidden mb-5">
          <Cell k="총 평가금" v={usd(totals.marketValue)} />
          <Cell k="총 잔금" v={usd(totals.cash)} />
          <Cell k="총 자산" v={usd(totals.marketValue + totals.cash)} big />
          <Cell k="투입원금 누계" v={usd(totals.invested)} />
          <Cell k="미실현손익" v={usd(totals.unrealized)} tone={totals.unrealized} />
          <Cell k="실현손익 누계" v={usd(totals.realized)} tone={totals.realized} />
          <Cell k="실현수익률" v={pct(totals.realizedReturnPct)} tone={totals.realizedReturnPct} />
          <Cell k="총수익률" v={pct(totals.totalReturnPct)} tone={totals.totalReturnPct} big />
        </div>

        {accounts.length === 0 ? (
          <div className="border border-zinc-800 rounded-xl px-4 py-10 text-center text-sm text-zinc-500">
            아직 계좌가 없습니다. 위 탭에서 프로그램을 골라 계좌를 시작하세요.
          </div>
        ) : (
          <div className="border border-zinc-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-zinc-500 border-b border-zinc-800">
                  <th className="text-left font-medium px-3 py-2.5">계좌</th>
                  <th className="text-right font-medium px-2 py-2.5">종목</th>
                  <th className="text-right font-medium px-2 py-2.5">평단</th>
                  <th className="text-right font-medium px-2 py-2.5">보유</th>
                  <th className="text-right font-medium px-2 py-2.5">잔금</th>
                  <th className="text-right font-medium px-2 py-2.5">평가금</th>
                  <th className="text-right font-medium px-2 py-2.5">미실현</th>
                  <th className="text-right font-medium px-2 py-2.5">실현</th>
                  <th className="text-right font-medium px-2 py-2.5">실현률</th>
                  <th className="text-right font-medium px-3 py-2.5">총수익률</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {snaps.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-3 py-2.5 font-sans">
                      <div className="text-zinc-200">{s.label}</div>
                      <div className="text-[10px] text-zinc-500">
                        {s.started ? statusLine(s) : "미시작"}
                        {s.started && s.extra && !s.extra.priceIsLive && <span className="text-amber-500/70"> · 전일종가</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right text-zinc-400">{s.ticker}</td>
                    <td className="px-2 py-2.5 text-right">{s.started && s.shares > 0 ? usd(s.avgCost) : "—"}</td>
                    <td className="px-2 py-2.5 text-right">{s.started ? s.shares : "—"}</td>
                    <td className="px-2 py-2.5 text-right">{s.started ? usd(s.cash) : "—"}</td>
                    <td className="px-2 py-2.5 text-right">{s.started ? usd(s.marketValue) : "—"}</td>
                    <td className={`px-2 py-2.5 text-right ${sign(s.unrealized)}`}>{s.started && s.shares > 0 ? usd(s.unrealized) : "—"}</td>
                    <td className={`px-2 py-2.5 text-right ${sign(s.realized)}`}>{s.started ? usd(s.realized) : "—"}</td>
                    <td className={`px-2 py-2.5 text-right ${sign(s.realizedReturnPct)}`}>{s.started ? pct(s.realizedReturnPct) : "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${sign(s.totalReturnPct)}`}>{s.started ? pct(s.totalReturnPct) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-700 font-mono tabular-nums">
                  <td className="px-3 py-2.5 font-sans font-bold text-amber-300">포트폴리오 합계</td>
                  <td></td><td></td><td></td>
                  <td className="px-2 py-2.5 text-right text-zinc-300">{usd(totals.cash)}</td>
                  <td className="px-2 py-2.5 text-right text-zinc-300">{usd(totals.marketValue)}</td>
                  <td className={`px-2 py-2.5 text-right ${sign(totals.unrealized)}`}>{usd(totals.unrealized)}</td>
                  <td className={`px-2 py-2.5 text-right ${sign(totals.realized)}`}>{usd(totals.realized)}</td>
                  <td className={`px-2 py-2.5 text-right ${sign(totals.realizedReturnPct)}`}>{pct(totals.realizedReturnPct)}</td>
                  <td className={`px-3 py-2.5 text-right font-bold ${sign(totals.totalReturnPct)}`}>{pct(totals.totalReturnPct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {started.some((s) => s.extra && !s.extra.priceIsLive) && (
          <p className="text-[11px] text-amber-500/70 mt-3">※ 일부 계좌는 현재가 미입력 상태라 전일/직전 종가로 평가했습니다. 위 종목별 현재가를 입력하면 갱신됩니다.</p>
        )}
      </div>
    </div>
  );
}

function statusLine(s) {
  const e = s.extra || {};
  if (s.ticker === "TQQQ" && e.V != null && e.pv == null) return `사이클 ${e.cycle ?? "—"}`;
  if (e.V != null) return `VR · 사이클 ${e.cycle ?? "—"} · P/V ${e.pv != null ? e.pv.toFixed(1) + "%" : "—"}`;
  if (e.T != null) return `무한 · ${e.mode === "reverse" ? "리버스" : "일반"} · T ${Number(e.T).toFixed(2)}/${e.split} · 사이클 ${e.cycle ?? "—"}`;
  return "진행 중";
}

function Cell({ k, v, tone, big }) {
  const c = tone == null ? "text-zinc-100" : tone >= 0 ? "text-red-300" : "text-blue-300";
  return (
    <div className="bg-zinc-900 px-3 py-3">
      <div className="text-[10px] text-zinc-500 mb-0.5">{k}</div>
      <div className={`font-mono font-bold ${big ? "text-base" : "text-sm"} ${c}`}>{v}</div>
    </div>
  );
}
