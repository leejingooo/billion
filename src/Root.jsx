/* ============================================================
   부트 게이트 — 저장 백엔드 초기화 + (서버 백엔드일 때) 로그인/hydrate.
   - 로컬 백엔드(현행): 즉시 App 렌더. 무회귀.
   - Supabase 백엔드: 세션 확인 → 없으면 매직링크 로그인 화면,
     있으면 hydrate + 1회성 마이그레이션 후 App 렌더.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { initBackend, isServerConfigured, getDriver } from "./storage/backend";
import { migrateLocalToServer } from "./storage/migrate";
import App from "./App";

const FONT = { fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" };

export default function Root() {
  const [phase, setPhase] = useState("boot"); // boot | auth | ready | error
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const readied = useRef(false);

  useEffect(() => {
    let unsub;
    (async () => {
      const driver = await initBackend();
      if (!isServerConfigured || !driver.needsAuth) { setPhase("ready"); return; }
      unsub = await driver.auth.onChange(async (session) => {
        if (session) await toReady(driver);
        else { readied.current = false; setPhase("auth"); }
      });
      const session = await driver.auth.getSession();
      if (session) await toReady(driver);
      else setPhase("auth");
    })().catch((e) => { setErr(msg(e)); setPhase("error"); });
    return () => { if (unsub) unsub(); };
  }, []);

  async function toReady(driver) {
    if (readied.current) return;
    readied.current = true;
    try {
      await driver.hydrate();
      await migrateLocalToServer(driver);
      setPhase("ready");
    } catch (e) { setErr(msg(e)); setPhase("error"); }
  }

  const sendLink = async () => {
    setErr("");
    const addr = email.trim();
    if (!addr) return;
    try { await getDriver().auth.signInWithEmail(addr); setSent(true); }
    catch (e) { setErr(msg(e)); }
  };

  if (phase === "ready") {
    return (
      <>
        <App />
        {isServerConfigured && <><SaveStatus /><SignOutButton /></>}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4" style={FONT}>
      <div className="w-full max-w-sm">
        <div className="text-sm font-extrabold tracking-tight text-zinc-100 mb-1">매매 콘솔</div>

        {phase === "boot" && <p className="text-sm text-zinc-500">불러오는 중…</p>}

        {phase === "auth" && !sent && (
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/40">
            <h1 className="text-base font-bold mb-1">로그인</h1>
            <p className="text-xs text-zinc-500 mb-4">이메일로 로그인 링크를 보냅니다. 어느 기기에서 링크를 열든 같은 계좌 데이터가 동기화됩니다.</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com"
              onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-400 outline-none mb-3" />
            <button onClick={sendLink} className="w-full px-3 py-2 text-sm rounded-lg bg-amber-400 text-zinc-950 font-semibold hover:bg-amber-300">로그인 링크 받기</button>
            {err && <p className="text-xs text-red-400 mt-3">{err}</p>}
          </div>
        )}

        {phase === "auth" && sent && (
          <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/40">
            <h1 className="text-base font-bold mb-1">메일을 확인하세요</h1>
            <p className="text-xs text-zinc-500"><b className="text-zinc-300">{email}</b> 으로 로그인 링크를 보냈습니다. 링크를 열면 이 화면으로 돌아와 자동 로그인됩니다.</p>
            <button onClick={() => setSent(false)} className="text-xs text-zinc-500 hover:text-zinc-300 mt-4">다른 이메일로</button>
          </div>
        )}

        {phase === "error" && (
          <div className="border border-red-900 rounded-xl p-5 bg-red-950/30">
            <h1 className="text-base font-bold text-red-300 mb-1">저장소 연결 오류</h1>
            <p className="text-xs text-zinc-400 break-words">{err}</p>
            <button onClick={() => location.reload()} className="text-xs text-zinc-400 hover:text-zinc-200 mt-4 underline">새로고침</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SignOutButton() {
  const [error, setError] = useState("");
  const out = async () => {
    try {
      await getDriver().flush();
      await getDriver().auth.signOut();
    } catch (e) { setError(msg(e)); return; }
    location.reload();
  };
  return (
    <>
    {error && <p role="alert" className="fixed bottom-12 right-3 z-30 max-w-xs text-xs text-red-300 bg-zinc-950 p-2">{error}</p>}
    <button onClick={out} title="로그아웃"
      className="fixed bottom-3 right-3 z-30 px-2.5 py-1.5 text-[11px] rounded-lg border border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 backdrop-blur">
      로그아웃
    </button>
    </>
  );
}

function SaveStatus() {
  const [status, setStatus] = useState(() => getDriver().writeStatus());
  useEffect(() => getDriver().onWriteStatus(setStatus), []);
  if (!status.failed && !status.pending) return null;
  return (
    <div role="status" className="fixed bottom-3 left-3 z-30 max-w-sm rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-200">
      {status.failed ? "서버에 저장하지 못한 변경이 있습니다. 이 화면에서 다시 시도하세요." : "서버에 저장 중…"}
      {status.failed > 0 && <button disabled={status.pending > 0}
        onClick={() => getDriver().retryWrites().catch(() => {})}
        className="ml-2 text-amber-400 disabled:opacity-50">저장 재시도</button>}
    </div>
  );
}

function msg(e) {
  return String(e?.message || e || "알 수 없는 오류");
}
