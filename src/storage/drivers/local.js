/* ============================================================
   로컬 드라이버 — 현행(기본) 저장소.
   window.localStorage 를 직접 읽고 쓴다. 동기.
   서버 백엔드(Supabase)와 동일한 드라이버 인터페이스를 구현하되,
   캐시가 곧 localStorage 이므로 hydrate 는 no-op, 인증 불필요.
   ============================================================ */

const LS = typeof window !== "undefined" ? window.localStorage : null;

export const localDriver = {
  kind: "local",
  needsAuth: false,
  auth: null,

  get(fullKey) {
    return LS ? LS.getItem(fullKey) : null;
  },
  set(fullKey, value) {
    if (LS) LS.setItem(fullKey, value);
  },
  delete(fullKey) {
    if (LS) LS.removeItem(fullKey);
  },
  listKeys(prefix) {
    const out = [];
    if (!LS) return out;
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  },

  async hydrate() {},
  async flush() {},
};
