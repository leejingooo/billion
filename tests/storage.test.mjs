import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { migrateLocalToServer } from "../src/storage/migrate.js";

const source = await readFile(new URL("../src/storage/drivers/supabase.js", import.meta.url), "utf8");

async function driverFor(server, failing = new Set()) {
  const mock = {
    auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ range: async () => ({
        data: [...server].map(([k, v]) => ({ k, v })), error: null,
      }) }) }),
      upsert: async ({ k, v }) => {
        if (failing.has(k)) return { error: new Error("injected write failure") };
        server.set(k, v);
        return { error: null };
      },
      delete: () => ({ eq: () => ({ eq: async (_field, k) => {
        if (failing.has(k)) return { error: new Error("injected delete failure") };
        server.delete(k);
        return { error: null };
      } }) }),
    }),
  };
  const context = vm.createContext({ console: { error() {} } });
  const dependency = new vm.SyntheticModule(["createClient"], function () {
    this.setExport("createClient", () => mock);
  }, { context });
  await dependency.link(() => {});
  await dependency.evaluate();
  const module = new vm.SourceTextModule(source, {
    context, importModuleDynamically: async () => dependency,
  });
  await module.link(() => {});
  await module.evaluate();
  const driver = module.namespace.createSupabaseDriver("test", "test");
  await driver.hydrate();
  return driver;
}

function local(entries) {
  const data = new Map(entries);
  globalThis.window = { localStorage: {
    length: data.size, key: (i) => [...data.keys()][i], getItem: (k) => data.get(k),
  } };
}

test("failed writes reject flush and can be retried without losing the queue", async () => {
  const server = new Map(), failing = new Set(["a"]);
  const d = await driverFor(server, failing);
  d.set("a", "1");
  d.set("b", "2");
  await assert.rejects(d.flush(), /서버 저장/);
  assert.equal(server.get("b"), "2");
  assert.equal(d.writeStatus().failed, 1);
  failing.clear();
  await d.retryWrites();
  assert.equal(server.get("a"), "1");
  assert.equal(d.writeStatus().failed, 0);
});

test("a newer successful write supersedes an older failed write", async () => {
  const server = new Map(), failing = new Set(["a"]);
  const d = await driverFor(server, failing);
  d.set("a", "old");
  await assert.rejects(d.flush());
  failing.clear();
  d.set("a", "new");
  await d.retryWrites();
  assert.equal(server.get("a"), "new");
});

test("failed delete is visible and retry removes the server value", async () => {
  const server = new Map([["a", "1"]]), failing = new Set(["a"]);
  const d = await driverFor(server, failing);
  d.delete("a");
  await assert.rejects(d.flush());
  assert.equal(server.get("a"), "1");
  failing.clear();
  await d.retryWrites();
  assert.equal(server.has("a"), false);
});

test("partial migration resumes after reload without overwriting newer server data", async () => {
  local([["accounts:index", "registry"], ["acct:a:state", "original"]]);
  const server = new Map();
  const d = await driverFor(server, new Set(["acct:a:state"]));
  await assert.rejects(migrateLocalToServer(d), /서버 저장/);
  assert.equal(server.has("migrated:local-v1"), false);
  assert.equal(server.has("migrating:local-v1"), true);
  server.set("accounts:index", "newer registry");
  local([]);
  const reloaded = await driverFor(server);
  assert.equal((await migrateLocalToServer(reloaded)).migrated, true);
  assert.equal(server.get("accounts:index"), "newer registry");
  assert.equal(server.get("acct:a:state"), "original");
  assert.equal(server.has("migrating:local-v1"), false);
  assert.equal((await migrateLocalToServer(reloaded)).reason, "already migrated");
});

test("failure to persist migration intent never starts copying data", async () => {
  local([["acct:a:state", "original"]]);
  const server = new Map();
  const d = await driverFor(server, new Set(["migrating:local-v1"]));
  await assert.rejects(migrateLocalToServer(d));
  assert.equal(server.size, 0);
});

test("existing server accounts are preserved and local mode is unchanged", async () => {
  local([["acct:a:state", "local"]]);
  const server = new Map([["acct:a:state", "server"]]);
  const d = await driverFor(server);
  assert.equal((await migrateLocalToServer(d)).reason, "server already has data");
  assert.equal(server.get("acct:a:state"), "server");
  assert.equal((await migrateLocalToServer({ kind: "local" })).reason, "local backend");
});
