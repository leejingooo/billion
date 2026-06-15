import { useState, useEffect, useMemo } from "react";
import { listAccounts, createAccount, PROGRAM_LABELS } from "./storage/accounts";
import { setActiveAccount } from "./storage/adapter";
import { runGate } from "./selftest/gate";
import UnifiedView from "./views/UnifiedView";
import MubaeSingle from "./programs/mubaeSingle/App";
import MubaeMulti from "./programs/mubaeMulti/App";
import VRTool from "./programs/vr/App";

const PROGRAMS = { mubaeSingle: MubaeSingle, mubaeMulti: MubaeMulti, vr: VRTool };
const TABS = [
  { key: "unified", label: "통합뷰", type: null },
  { key: "mubaeSingle", label: "무한 · SOXL40", type: "mubaeSingle" },
  { key: "mubaeMulti", label: "무한 · 멀티", type: "mubaeMulti" },
  { key: "vr", label: "VR 적립식", type: "vr" },
];

const PRICE_KEY = "ui:prices";

// 활성 계좌를 자식 effect 이전에 동기 확정한 뒤 프로그램을 마운트(remount=key).
function ProgramHost({ acct }) {
  setActiveAccount(acct.id);
  const Comp = PROGRAMS[acct.programType];
  return <Comp key={acct.id} />;
}

export default function App() {
  const gate = useMemo(runGate, []);
  const [tab, setTab] = useState("unified");
  const [tick, setTick] = useState(0);                  // 계좌 목록/상태 갱신 트리거
  const [selected, setSelected] = useState({});         // { [programType]: accountId }
  const [priceMap, setPriceMap] = useState({});

  // 현재가 영속 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRICE_KEY);
      if (raw) setPriceMap(JSON.parse(raw));
    } catch {}
  }, []);
  const onPrice = (t, v) => {
    setPriceMap((m) => {
      const next = { ...m, [t]: v === "" ? undefined : Number(v) };
      try { localStorage.setItem(PRICE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // 게이트 실패 시 전면 차단 — 매매 로직 무결성이 깨졌을 수 있으므로 사용 차단
  if (!gate.allPass) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
        <div className="max-w-lg w-full border border-red-900 rounded-xl p-6 bg-red-950/30">
          <h1 className="text-lg font-bold text-red-300 mb-2">릴리스 게이트 실패 — 사용 차단</h1>
          <p className="text-sm text-zinc-300 mb-4">매매 공식 검증(원문 수치 재현)에서 불일치가 발견되었습니다. 잘못된 주문을 막기 위해 앱을 차단합니다.</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {gate.results.filter((r) => !r.pass).map((r, i) => (
              <div key={i} className="text-xs font-mono border-b border-red-900/40 pb-1.5">
                <div className="text-red-400">FAIL · {r.name}</div>
                <div className="text-zinc-500">기대 {r.exp} · 결과 {r.got}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.key === tab);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* 셸 헤더 + 탭 */}
      <header className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3" style={{ fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" }}>
          <span className="text-sm font-extrabold text-zinc-100 tracking-tight whitespace-nowrap">매매 콘솔</span>
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition ${tab === t.key ? "bg-zinc-800 text-amber-300 font-semibold" : "text-zinc-500 hover:text-zinc-300"}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden sm:flex items-center gap-1.5 text-[11px] text-emerald-400 whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />게이트 {gate.results.length}/{gate.results.length}
          </span>
        </div>
      </header>

      {tab === "unified" ? (
        <UnifiedView priceMap={priceMap} onPrice={onPrice} tick={tick} onChange={() => setTick((n) => n + 1)} />
      ) : (
        <ProgramTab
          programType={active.type}
          selectedId={selected[active.type]}
          onSelect={(id) => setSelected((s) => ({ ...s, [active.type]: id }))}
          onChange={() => setTick((n) => n + 1)}
        />
      )}
    </div>
  );
}

function ProgramTab({ programType, selectedId, onSelect, onChange }) {
  const [accounts, setAccounts] = useState(() => listAccounts().filter((a) => a.programType === programType));
  const [newLabel, setNewLabel] = useState("");

  const refresh = () => {
    setAccounts(listAccounts().filter((a) => a.programType === programType));
    onChange?.();
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [programType]);

  const create = () => {
    const a = createAccount(programType, newLabel);
    setNewLabel("");
    refresh();
    onSelect(a.id);
  };

  const acct = accounts.find((a) => a.id === selectedId) || null;

  return (
    <div className="bg-zinc-950">
      {/* 계좌 바 */}
      <div className="max-w-5xl mx-auto px-4 py-3 border-b border-zinc-800/70" style={{ fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500 mr-1">{PROGRAM_LABELS[programType]} 계좌:</span>
          {accounts.map((a) => (
            <button key={a.id} onClick={() => onSelect(a.id)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition ${selectedId === a.id ? "bg-amber-400 text-zinc-950 border-amber-400 font-semibold" : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500"}`}>
              {a.label}
            </button>
          ))}
          {accounts.length === 0 && <span className="text-sm text-zinc-600">없음 — 새 계좌를 만드세요</span>}
          <div className="flex items-center gap-1.5 ml-1">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="새 계좌 이름(선택)"
              className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-400 outline-none" />
            <button onClick={create} className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 whitespace-nowrap">+ 계좌</button>
          </div>
        </div>
      </div>

      {/* 프로그램 본문 */}
      {acct ? (
        <ProgramHost acct={acct} />
      ) : (
        <div className="max-w-5xl mx-auto px-4 py-16 text-center text-sm text-zinc-500" style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
          계좌를 선택하거나 새로 만들면 도구가 열립니다.
        </div>
      )}
    </div>
  );
}
