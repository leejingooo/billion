import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("Supabase hydration starts after the auth notification returns", async () => {
  const mockId = "\0mock-supabase-startup";
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    ssr: { noExternal: ["@supabase/supabase-js"] },
    plugins: [{
      name: "mock-supabase-startup",
      enforce: "pre",
      resolveId(id) {
        if (id === "@supabase/supabase-js") return mockId;
      },
      load(id) {
        if (id === mockId) return "export const createClient = () => globalThis.mockStartupClient;";
      },
    }],
  });
  try {
    let notify;
    let notifying = false;
    let unsubscribed = false;
    globalThis.mockStartupClient = {
      auth: {
        onAuthStateChange(callback) {
          notify = callback;
          return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } };
        },
        async getUser() {
          assert.equal(notifying, false);
          return { data: { user: { id: "user" } } };
        },
      },
      from() { return this; },
      select() { return this; },
      eq() { return this; },
      range() { return { data: [{ k: "accounts:index", v: "saved" }] }; },
    };

    const { createSupabaseDriver } = await server.ssrLoadModule("/src/storage/drivers/supabase.js");
    const driver = createSupabaseDriver("https://example.com", "key");
    const session = { user: { id: "user" } };
    let hydration;
    const unsubscribe = await driver.auth.onChange(() => {
      hydration = driver.hydrate();
      return hydration;
    });
    notifying = true;
    const result = notify("TOKEN_REFRESHED", session);
    notifying = false;
    await new Promise(resolve => setTimeout(resolve, 0));
    await hydration;
    assert.equal(result, undefined);
    assert.equal(driver.get("accounts:index"), "saved");

    notify("SIGNED_OUT", null);
    unsubscribe();
    const completed = hydration;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(hydration, completed);
    assert.equal(unsubscribed, true);
  } finally {
    delete globalThis.mockStartupClient;
    await server.close();
  }
});
