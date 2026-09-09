/* ============================================================
   1회성 로컬 → 서버 마이그레이션.
   - 서버 백엔드로 첫 로그인했고 아직 옮기지 않았다면, 기존 localStorage 의
     계좌 레지스트리/프로그램 상태/현재가를 그대로 서버로 복사한다.
   - 비파괴적: localStorage 는 그대로 둔다(롤백 안전판).
   - 옮길 키: "accounts:index", "ui:prices", "acct:*"
   ============================================================ */

const FLAG = "migrated:local-v1";
const PENDING = "migrating:local-v1";

export async function migrateLocalToServer(driver) {
  if (driver.kind !== "supabase") return { migrated: false, reason: "local backend" };
  if (driver.get(FLAG)) return { migrated: false, reason: "already migrated" };

  // 복사 도중 끊겨도 서버에 남긴 원본으로 재개한다. 이미 존재하는 키는 보존한다.
  const pending = driver.get(PENDING);
  if (pending) return finishMigration(driver, JSON.parse(pending));

  const LS = typeof window !== "undefined" ? window.localStorage : null;
  if (!LS) return { migrated: false, reason: "no localStorage" };

  const keys = [];
  for (let i = 0; i < LS.length; i++) {
    const k = LS.key(i);
    if (k && (k === "accounts:index" || k === "ui:prices" || k.startsWith("acct:"))) keys.push(k);
  }

  // 서버가 이미 비어있지 않으면(다른 기기에서 먼저 시작) 로컬을 덮어쓰지 않는다.
  const serverHasData = driver.listKeys("accounts:index").length > 0 || driver.listKeys("acct:").length > 0;
  if (serverHasData || keys.length === 0) {
    driver.set(FLAG, new Date().toISOString());
    await driver.flush();
    return { migrated: false, reason: serverHasData ? "server already has data" : "nothing local" };
  }

  const entries = keys.map((k) => [k, LS.getItem(k)]);
  driver.set(PENDING, JSON.stringify(entries));
  await driver.flush();
  return finishMigration(driver, entries);
}

async function finishMigration(driver, entries) {
  for (const [key, value] of entries) {
    if (driver.get(key) == null) driver.set(key, value);
  }
  await driver.flush();
  // 완료 표시는 데이터 저장을 확인한 뒤에만 기록한다.
  driver.set(FLAG, new Date().toISOString());
  await driver.flush();
  driver.delete(PENDING);
  await driver.flush();
  return { migrated: true, count: entries.length };
}
