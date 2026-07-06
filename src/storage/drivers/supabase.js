/* ============================================================
   Supabase 드라이버 — 서버 저장(다기기 동기화).
   패턴: 로그인 시 사용자 KV 행 전체를 메모리 캐시로 hydrate →
        읽기는 캐시에서 동기 반환(listAccounts/통합뷰 raw 읽기 호환) →
        쓰기는 캐시 즉시 반영 + 서버 write-through(순차 큐, last-write-wins).
   테이블: public.user_kv (user_id uuid, k text, v text, PK(user_id,k)), RLS로 본인 행만.
   인증: 이메일 매직링크(signInWithOtp).

   ⚠️ 이 드라이버는 VITE_SUPABASE_URL/ANON_KEY 가 설정된 빌드에서만 활성화된다.
      creds 없는 로컬/CI 빌드에서는 로드조차 되지 않는다(코드 스플릿).
   ============================================================ */

const TABLE = "user_kv";

export function createSupabaseDriver(url, anonKey) {
  let client = null;
  let userId = null;
  const cache = new Map();
  let writeChain = Promise.resolve(); // 순차 write-through 큐

  async function getClient() {
    if (!client) {
      const { createClient } = await import("@supabase/supabase-js");
      client = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    return client;
  }

  function enqueue(fn) {
    writeChain = writeChain.then(fn).catch((e) => {
      // 서버 쓰기 실패는 콘솔에만 — 캐시는 이미 반영되어 UI는 진행. 다음 hydrate 시 정정.
      console.error("[supabase write]", e);
    });
    return writeChain;
  }

  return {
    kind: "supabase",
    needsAuth: true,

    get(fullKey) {
      return cache.has(fullKey) ? cache.get(fullKey) : null;
    },
    set(fullKey, value) {
      cache.set(fullKey, value);
      enqueue(async () => {
        if (!userId) return;
        const c = await getClient();
        const { error } = await c.from(TABLE).upsert({ user_id: userId, k: fullKey, v: value });
        if (error) throw error;
      });
    },
    delete(fullKey) {
      cache.delete(fullKey);
      enqueue(async () => {
        if (!userId) return;
        const c = await getClient();
        const { error } = await c.from(TABLE).delete().eq("user_id", userId).eq("k", fullKey);
        if (error) throw error;
      });
    },
    listKeys(prefix) {
      const out = [];
      for (const k of cache.keys()) if (k.startsWith(prefix)) out.push(k);
      return out;
    },

    async hydrate() {
      const c = await getClient();
      const { data: sess } = await c.auth.getUser();
      userId = sess?.user?.id || null;
      cache.clear();
      if (!userId) return;
      // 사용자 행 전체 로드 (KV 규모가 작아 페이지네이션 불필요, 안전상 range 반복)
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await c
          .from(TABLE)
          .select("k,v")
          .eq("user_id", userId)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data) cache.set(row.k, row.v);
        if (!data || data.length < PAGE) break;
      }
    },

    async flush() {
      return writeChain;
    },

    auth: {
      async getSession() {
        const c = await getClient();
        const { data } = await c.auth.getSession();
        return data?.session || null;
      },
      async signInWithEmail(email) {
        const c = await getClient();
        const { error } = await c.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
      },
      async signOut() {
        const c = await getClient();
        await c.auth.signOut();
        userId = null;
        cache.clear();
      },
      async onChange(cb) {
        const c = await getClient();
        const { data } = c.auth.onAuthStateChange((_evt, session) => cb(session));
        return () => data?.subscription?.unsubscribe();
      },
    },
  };
}
