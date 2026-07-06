/* ============================================================
   저장 백엔드 선택기.
   - 기본은 로컬 드라이버(현행 localStorage). 무회귀.
   - VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY 가 빌드에 있으면
     Supabase 드라이버를 코드-스플릿으로 로드해 활성화한다.
   - adapter/accounts/App 는 getDriver() 를 통해서만 저장소에 접근한다.
   ============================================================ */

import { localDriver } from "./drivers/local";

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

// supabase-js 는 프로젝트 base URL(scheme+host)을 기대한다. 사용자가 콘솔에서
// 복사한 `.../rest/v1/` 형태를 넣어도 동작하도록 origin 으로 정규화한다.
function normalizeUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

export const SUPA_URL = normalizeUrl(ENV.VITE_SUPABASE_URL);
export const SUPA_KEY = (ENV.VITE_SUPABASE_ANON_KEY || "").trim();
export const isServerConfigured = Boolean(SUPA_URL && SUPA_KEY);

let active = localDriver;
export function getDriver() {
  return active;
}

// 부트 시 1회 호출(memoize). 서버 설정이 있으면 드라이버를 교체한다.
// 로그인/hydrate 는 Root 가 담당.
let initPromise = null;
export function initBackend() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isServerConfigured) return active; // 로컬 유지
    const { createSupabaseDriver } = await import("./drivers/supabase");
    active = createSupabaseDriver(SUPA_URL, SUPA_KEY);
    return active;
  })();
  return initPromise;
}
