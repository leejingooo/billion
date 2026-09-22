import { useState } from "react";
import { rawGet } from "../storage/adapter";
import { mubaeCycles, vrHistory } from "../overlay/strategy";
import { filterPeriod } from "../overlay/history";

const usd = (n) => Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";
const vrSeries = [
  { key: "lower", label: "하단 밴드", color: "#60a5fa", dash: true },
  { key: "V", label: "목표 V", color: "#fbbf24" },
  { key: "upper", label: "상단 밴드", color: "#f87171", dash: true },
  { key: "marketValue", label: "주식 평가액", color: "#c4b5fd" },
  { key: "pool", label: "Pool", color: "#a1a1aa", dash: true },
];

export default function StrategyHistory({ account, snap, daily, days }) {
  const [cycle, setCycle] = useState(null);
  const [view, setView] = useState("state");
  let data;
  try {
    const key = account.programType === "vr" ? "vr_state" : account.programType === "mubaeSingle" ? "mubae_v4_soxl40_state_v1" : "mubae_v4_multi_state_v1";
    data = JSON.parse(rawGet(account.id, key) || "null");
  } catch { return <p role="alert" className="mt-4 text-sm text-red-400">전략 이력을 읽을 수 없습니다.</p>; }

  if (account.programType === "vr") {
    const validPrice = snap.shares === 0 || (Number.isFinite(snap.extra?.priceUsed) && snap.extra.priceUsed > 0);
    const rows = view === "state" ? vrHistory(data, validPrice ? snap.marketValue : null)
      : filterPeriod(daily, days).map((r) => r.vr ? { ...r.vr, label: r.date } : null);
    const current = vrHistory(data, validPrice ? snap.marketValue : null).at(-1);
    const position = !Number.isFinite(current?.marketValue) ? "평가 가격 필요" : current.marketValue < current.lower ? "하단 밴드 아래" : current.marketValue > current.upper ? "상단 밴드 위" : "밴드 안";
    return <div className="mt-6 border-t border-zinc-800 pt-5">
      <h4 className="font-bold text-sm">VR · V와 밴드</h4>
      <p className="mt-2 text-xs text-zinc-400">현재 주식 평가액 {usd(current?.marketValue)} · {position} · Pool {usd(current?.pool)}</p>
      <div className="my-3 flex gap-2">{[["state", "전체 상태 이력"], ["daily", "일별 평가 기록"]].map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => setView(key)} className={`rounded-lg px-3 py-1.5 text-xs ${view === key ? "bg-zinc-700 text-amber-300" : "text-zinc-400"}`}>{label}</button>)}</div>
      <ReferenceChart key={view} rows={rows} series={vrSeries} title="VR 목표 V·밴드·주식 평가액·Pool 그래프" />
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">밴드 = V × (1 ± 설정 비율). 밴드와 비교하는 주식 평가액에는 Pool을 포함하지 않습니다. Pool은 별도 참고선입니다.</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{view === "state" ? "전체 상태 이력은 날짜가 아닌 저장 순서입니다. 같은 사이클에 여러 기록이 있을 수 있으며, 과거 평가 가격이 없어 주식 평가액은 현재 지점만 표시합니다. 위 기간 필터는 적용하지 않습니다." : "위 기간 필터를 적용합니다. ‘오늘 기록 저장’ 시점의 V·밴드·평가액을 사용합니다. 이 기능 추가 전 기록의 VR 값은 추정하지 않습니다."}</p>
    </div>;
  }

  const cycles = mubaeCycles(data, account.programType === "mubaeSingle" ? "SOXL" : null);
  const selected = cycles.find((c) => c.cycle === cycle) || cycles.at(-1);
  const last = selected?.rows.at(-1);
  const diff = last ? last.actual - last.buyHold : null;
  return <div className="mt-6 border-t border-zinc-800 pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold text-sm">무한매수법 vs {selected?.ticker || snap.ticker} Buy &amp; Hold</h4>
      {!!cycles.length && <select aria-label="비교 사이클" value={selected.cycle} onChange={(e) => setCycle(Number(e.target.value))} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs">{cycles.map((c) => <option key={c.cycle} value={c.cycle}>사이클 {c.cycle}</option>)}</select>}
    </div>
    {last && <div className="my-3 text-xs text-zinc-400">마지막 기록 {last.label} · 무한매수 {usd(last.actual)} · 단순 보유 {usd(last.buyHold)}<span className={diff >= 0 ? "text-red-400" : "text-blue-400"}> · 차이 {usd(diff)}</span></div>}
    {selected?.error ? <p className="py-6 text-xs text-amber-300">{selected.error}</p> : <ReferenceChart key={selected?.cycle} rows={selected?.rows || []} title="무한매수법과 동일 종목 단순 보유 비교 그래프" series={[
      { key: "actual", label: "무한매수 자산", color: "#fbbf24" },
      { key: "buyHold", label: `${selected?.ticker || snap.ticker} 단순 보유`, color: "#c4b5fd" },
      { key: "capital", label: "사이클 시작금", color: "#a1a1aa", dash: true },
    ]} />}
    <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">사이클 시작금 {usd(selected?.capital)} 전액을 시작 상태에 저장된 직전 종가 {usd(selected?.price)}에 매수했다고 가정합니다. 소수점 주식을 허용하며 수수료·세금·배당은 별도 반영하지 않습니다.</p>
    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">무한매수 자산은 확정 기록의 잔금 + 보유수 × 당일 종가입니다. 해당 계좌의 종가만 사용하며 자동 시세 수집은 아닙니다. 종료일은 종료된 사이클에 포함합니다. 사이클 전체를 비교하므로 위 기간 필터는 적용하지 않습니다. 가로축은 확정 기록 순서입니다.</p>
  </div>;
}

function ReferenceChart({ rows, series, title }) {
  const [selected, setSelected] = useState(null);
  const valid = rows.filter(Boolean);
  if (!valid.length) return <p className="rounded-xl border border-dashed border-zinc-700 my-3 p-6 text-center text-xs text-zinc-400">비교 가능한 기록이 아직 없습니다.</p>;
  const index = selected == null ? valid.length - 1 : Math.min(selected, valid.length - 1);
  const point = valid[index];
  const numbers = valid.flatMap((r) => series.map((s) => r[s.key])).filter(Number.isFinite);
  if (!numbers.length) return <p className="text-xs text-zinc-400">유효한 평가 값이 없습니다.</p>;
  const min = numbers.reduce((a, b) => Math.min(a, b), Infinity), max = numbers.reduce((a, b) => Math.max(a, b), -Infinity);
  const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.01, 1);
  const x = (i) => rows.length === 1 ? 430 : 75 + i / (rows.length - 1) * 700;
  const y = (n) => 20 + (max + pad - n) / (max - min + 2 * pad) * 200;
  const path = (key) => {
    let active = false;
    return rows.map((r, i) => {
      if (!Number.isFinite(r?.[key])) { active = false; return ""; }
      const segment = `${active ? "L" : "M"}${x(i)},${y(r[key])}`;
      active = true;
      return segment;
    }).join(" ");
  };
  return <div className="mt-3">
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px]"><span className="text-zinc-300">{point.label}</span>{series.map((s) => <span key={s.key} style={{ color: s.color }}>{s.dash ? "┄" : "●"} {s.label} {usd(point[s.key])}</span>)}</div>
    <svg viewBox="0 0 800 255" role="img" aria-label={title} className="w-full rounded-lg bg-zinc-950/40">
      {[0, 1, 2, 3].map((i) => { const n = min - pad + (max - min + 2 * pad) * i / 3; return <g key={i}><line x1="75" x2="775" y1={y(n)} y2={y(n)} stroke="#27272a" /><text x="67" y={y(n) + 4} textAnchor="end" fill="#a1a1aa" fontSize="11">{new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)}</text></g>; })}
      {series.map((s) => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash ? "6 5" : undefined} />)}
      {series.map((s) => Number.isFinite(point[s.key]) && <circle key={s.key} cx={x(rows.indexOf(point))} cy={y(point[s.key])} r="4" fill={s.color} />)}
      <text x="75" y="245" fill="#a1a1aa" fontSize="11">{valid[0].label}</text><text x="775" y="245" textAnchor="end" fill="#a1a1aa" fontSize="11">{valid.at(-1).label}</text>
    </svg>
    {valid.length > 1 && <label className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400">기록 탐색<input type="range" min="0" max={valid.length - 1} value={index} onChange={(e) => setSelected(Number(e.target.value))} aria-label={`${title} 기록 탐색`} aria-valuetext={point.label} className="min-w-0 flex-1 accent-amber-400" /></label>}
    <details className="mt-3 text-xs text-zinc-400"><summary className="cursor-pointer">비교 기록 표 보기</summary><div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-right whitespace-nowrap"><thead><tr><th className="p-2 text-left">기록</th>{series.map((s) => <th key={s.key} className="p-2">{s.label}</th>)}</tr></thead><tbody>{valid.map((r, i) => <tr key={i} className="border-t border-zinc-800"><td className="p-2 text-left">{r.label}</td>{series.map((s) => <td key={s.key} className="p-2">{usd(r[s.key])}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
