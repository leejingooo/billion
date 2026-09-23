import { useMemo, useState } from "react";
import { rawGet, rawSet } from "../storage/adapter";
import { HISTORY_KEY, readHistory, makeRecord, upsertRecord, aggregateHistory, filterPeriod } from "../overlay/history";
import StrategyHistory from "./StrategyHistory";

const money = (n) => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const tone = (n) => n == null ? "text-zinc-100" : n >= 0 ? "text-red-400" : "text-blue-400";
const periods = [[30, "1개월"], [90, "3개월"], [365, "1년"], [0, "전체"]];

export default function AssetHistory({ snaps, accounts = [] }) {
  const [account, setAccount] = useState("all");
  const [days, setDays] = useState(0);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const started = snaps.filter((s) => s.started);
  const active = started.filter((s) => !s.archived);
  const selected = started.some((s) => s.id === account) ? account : "all";
  const history = useMemo(() => {
    try {
      return { byId: Object.fromEntries(snaps.filter((s) => s.started).map((s) => [s.id, readHistory(rawGet(s.id, HISTORY_KEY))])) };
    } catch (e) { return { byId: {}, error: e.message }; }
  }, [snaps, revision]);
  const allRows = selected === "all"
    ? aggregateHistory(active.map((s) => history.byId[s.id] || []))
    : history.byId[selected] || [];
  const rows = filterPeriod(allRows, days);
  const first = rows[0];
  const last = rows.at(-1);
  const change = rows.length > 1 ? last.assets - first.assets : null;
  const profit = last ? last.assets - last.invested : null;

  const save = () => {
    setSaving(true);
    try {
      const now = new Date();
      // 모든 계좌 검증을 마친 뒤 쓰기 시작해 잘못된 가격으로 일부만 저장하지 않는다.
      const pending = active.map((s) => ({ id: s.id, record: makeRecord(s, now), rows: readHistory(rawGet(s.id, HISTORY_KEY)) }));
      pending.forEach(({ id, rows: previous, record }) => rawSet(id, HISTORY_KEY, JSON.stringify(upsertRecord(previous, record))));
      setRevision((r) => r + 1);
      setMessage(`오늘 ${pending.length}개 계좌 기록을 반영했습니다. 같은 날짜는 최신 값으로 갱신됩니다.`);
    } catch (e) { setMessage(`저장 실패: ${e.message}`); }
    finally { setSaving(false); }
  };

  return (
    <section aria-labelledby="asset-history-title" className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-amber-400 mb-1">ASSET GROWTH</div>
          <h3 id="asset-history-title" className="text-lg font-bold">자산 성장</h3>
          <p className="mt-1 text-xs text-zinc-400">평가금 + 잔금의 변화와 투입원금을 함께 확인하세요. USD 기준.</p>
        </div>
        <button onClick={save} disabled={!active.length || saving || !!history.error}
          className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-40">오늘 기록 저장</button>
      </div>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <select aria-label="그래프 계좌" value={selected} onChange={(e) => setAccount(e.target.value)}
          className="max-w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
          <option value="all">총자산 · 운용 계좌</option>
          {started.map((s) => <option key={s.id} value={s.id}>{s.label}{s.archived ? " (보관)" : ""}</option>)}
        </select>
        <div className="flex gap-1" aria-label="그래프 기간">
          {periods.map(([value, label]) => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}
            className={`rounded-lg px-3 py-1.5 text-xs ${days === value ? "bg-zinc-700 text-amber-300" : "text-zinc-400 hover:bg-zinc-800"}`}>{label}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Metric label="마지막 기록 자산" value={money(last?.assets)} />
        <Metric label="기간 내 자산 증감 · 입출금 포함" value={money(change)} color={tone(change)} />
        <Metric label="마지막 기록 손익 · 자산 − 원금" value={money(profit)} color={tone(profit)} />
      </div>
      {history.error ? <p role="alert" className="py-8 text-sm text-red-400">{history.error}</p> : rows.length ? <GrowthChart key={`${selected}-${days}-${revision}`} rows={rows} /> : (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-zinc-700 p-6 text-center">
          <div><p className="text-sm text-zinc-300">{allRows.length ? "선택한 기간에 기록이 없습니다." : "아직 자산 기록이 없습니다."}</p>
            <p className="mt-2 text-xs text-zinc-500">현재가를 확인하고 ‘오늘 기록 저장’을 누르세요.<br />날짜별 기록이 쌓이면 성장 곡선이 나타납니다.</p></div>
        </div>
      )}
      <div className="mt-4 space-y-1 text-[11px] leading-relaxed text-zinc-500">
        <p>기록은 기기의 날짜 기준 하루 1개이며 저장 버튼을 누른 시점의 값입니다. 현재가 미입력 시 저장된 종가를 사용합니다. 과거 데이터와 미접속일은 자동 생성하지 않습니다.</p>
        <p>총자산은 현재 운용 중인 계좌 모두가 기록된 날짜만 표시합니다. 보관 계좌는 합계와 오늘 기록 저장에서 제외되며 개별 기록은 조회할 수 있습니다. 계좌 추가·보관·복원·삭제로 과거 합계의 조회 범위도 달라지며, 삭제한 계좌의 기록도 함께 삭제됩니다.</p>
        <p>투입원금은 앱에 저장된 회계 기준입니다. 실제 증권사 손익과 다를 수 있으며, 자산 증감에는 입출금도 포함됩니다.</p>
      </div>
      {message && <p role="status" className="mt-3 text-xs text-amber-300">{message}</p>}
      {selected !== "all" && accounts.find((a) => a.id === selected) && <StrategyHistory key={selected}
        account={accounts.find((a) => a.id === selected)} snap={started.find((s) => s.id === selected)} daily={history.byId[selected] || []} days={days} />}
      {selected === "all" && started.length > 0 && <p className="mt-4 text-xs text-amber-300">개별 계좌를 선택하면 VR 밴드 또는 무한매수법의 단순 보유 비교가 표시됩니다.</p>}
    </section>
  );
}

function Metric({ label, value, color = "text-zinc-100" }) {
  return <div className="rounded-xl bg-zinc-950/60 px-4 py-3"><div className="text-[10px] text-zinc-500">{label}</div><div className={`mt-1 font-mono text-lg font-bold ${color}`}>{value}</div></div>;
}

function GrowthChart({ rows }) {
  const [hover, setHover] = useState(null);
  const width = 800, height = 260, left = 72, right = 22, top = 20, bottom = 34;
  const values = rows.flatMap((r) => [r.assets, r.invested]);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * 0.15, Math.abs(max) * 0.02, 1);
  const low = min - padding, high = max + padding;
  const timestamp = (r) => Date.parse(`${r.date}T00:00:00Z`);
  const start = timestamp(rows[0]), end = timestamp(rows.at(-1));
  const x = (r) => end === start ? (width + left - right) / 2 : left + (timestamp(r) - start) / (end - start) * (width - left - right);
  const y = (value) => top + (high - value) / (high - low) * (height - top - bottom);
  const line = (key) => rows.map((r) => `${x(r)},${y(r[key])}`).join(" ");
  const index = hover == null ? rows.length - 1 : Math.min(hover, rows.length - 1);
  const point = rows[index];
  const pickPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * width;
    let closest = 0;
    rows.forEach((r, i) => { if (Math.abs(x(r) - px) < Math.abs(x(rows[closest]) - px)) closest = i; });
    setHover(closest);
  };

  return <div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-2" aria-live="polite">
      <span className="text-zinc-400">{point.date}</span>
      <span className="text-amber-300">● 자산 {money(point.assets)}</span>
      <span className="text-zinc-400">┄ 투입원금 {money(point.invested)}</span>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-lg bg-zinc-950/30" role="img" aria-label="날짜별 자산 및 투입원금 그래프" onPointerMove={pickPoint} onPointerLeave={() => setHover(null)}>
      {[0, 1, 2, 3].map((i) => {
        const v = low + (high - low) * i / 3;
        return <g key={i}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="#27272a" />
          <text x={left - 8} y={y(v) + 4} textAnchor="end" fill="#a1a1aa" fontSize="11">{new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}</text></g>;
      })}
      <polyline points={line("invested")} fill="none" stroke="#a1a1aa" strokeWidth="2" strokeDasharray="6 5" />
      <polyline points={line("assets")} fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinejoin="round" />
      <line x1={x(point)} x2={x(point)} y1={top} y2={height - bottom} stroke="#52525b" strokeDasharray="3 4" />
      <circle cx={x(point)} cy={y(point.invested)} r="4" fill="#a1a1aa" />
      <circle cx={x(point)} cy={y(point.assets)} r="5" fill="#fbbf24" stroke="#18181b" strokeWidth="2" />
      <text x={left} y={height - 8} fill="#a1a1aa" fontSize="11">{rows[0].date}</text>
      {rows.length > 1 && <text x={width - right} y={height - 8} textAnchor="end" fill="#a1a1aa" fontSize="11">{rows.at(-1).date}</text>}
    </svg>
    {rows.length === 1 ? <p className="mt-2 text-xs text-zinc-400">첫 기록을 저장했습니다. 다른 날짜의 기록이 추가되면 선으로 연결됩니다.</p> : <label className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400">기록 탐색<input className="min-w-0 flex-1 accent-amber-400" type="range" min="0" max={rows.length - 1} value={index} onChange={(e) => setHover(Number(e.target.value))} aria-label="기록 날짜 탐색" aria-valuetext={`${point.date}, 자산 ${money(point.assets)}, 원금 ${money(point.invested)}`} /></label>}
    <details className="mt-3 text-xs text-zinc-400"><summary className="cursor-pointer">기록 표 보기 ({rows.length}일)</summary>
      <div className="mt-2 max-h-60 overflow-auto"><table className="w-full text-right"><thead><tr><th className="p-2 text-left">날짜</th><th className="p-2">자산</th><th className="p-2">투입원금</th><th className="p-2">손익</th></tr></thead><tbody>{rows.map((r) => <tr key={r.date} className="border-t border-zinc-800"><td className="p-2 text-left">{r.date}</td><td className="p-2">{money(r.assets)}</td><td className="p-2">{money(r.invested)}</td><td className={`p-2 ${tone(r.assets - r.invested)}`}>{money(r.assets - r.invested)}</td></tr>)}</tbody></table></div>
    </details>
  </div>;
}
