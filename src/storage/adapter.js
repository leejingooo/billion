/* ============================================================
   계좌인지 저장 어댑터
   - 무한매수법 두 파일은 무수정. 그들이 호출하는 전역 window.storage 를
     여기서 localStorage 기반으로 주입한다.
   - 호출 시점의 '활성 계좌 id' 를 prefix(acct:{id}:) 로 붙여 네임스페이스 격리.
     → 프로그램 내부의 고정 KEY 를 그대로 살리면서 복수 계좌가 충돌 없이 공존.
   - localStorage 는 동기지만 Promise 로 감싸 기존 await 호환.
   - 통합뷰는 활성계좌와 무관하게 모든 acct:* 를 raw 로 직접 읽는다.
   ============================================================ */

const LS = typeof window !== "undefined" ? window.localStorage : null;

let _activeAccount = null;
export function setActiveAccount(id) {
  _activeAccount = id;
}
export function getActiveAccount() {
  return _activeAccount;
}

function nsKey(key) {
  if (!_activeAccount) {
    // 활성 계좌가 없는데 프로그램이 저장을 시도하면, 잘못된 전역 키 오염을 막기 위해 차단.
    throw new Error("저장 차단: 활성 계좌가 설정되지 않았습니다.");
  }
  return `acct:${_activeAccount}:${key}`;
}

function lsGet(fullKey) {
  if (!LS) return null;
  const v = LS.getItem(fullKey);
  return v == null ? null : { value: v };
}
function lsSet(fullKey, value) {
  if (LS) LS.setItem(fullKey, value);
  return { ok: true };
}
function lsDel(fullKey) {
  if (LS) LS.removeItem(fullKey);
  return { ok: true };
}
function lsList(prefix) {
  if (!LS) return { keys: [] };
  const keys = [];
  for (let i = 0; i < LS.length; i++) {
    const k = LS.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return { keys };
}

/* 무한매수법 파일이 기대하는 전역 window.storage 인터페이스 (비동기) */
export function installStorageAdapter() {
  if (typeof window === "undefined") return;
  window.storage = {
    get: (key) => Promise.resolve(lsGet(nsKey(key))),
    set: (key, value) => Promise.resolve(lsSet(nsKey(key), value)),
    delete: (key) => Promise.resolve(lsDel(nsKey(key))),
    list: (prefix = "") => Promise.resolve(lsList(`acct:${_activeAccount}:${prefix}`)),
  };
}

/* ---- 통합뷰/오버레이용 raw 접근 (계좌 격리 무시, 직접 읽기) ---- */
export function rawGet(accountId, key) {
  const r = lsGet(`acct:${accountId}:${key}`);
  return r ? r.value : null;
}
export function rawSet(accountId, key, value) {
  lsSet(`acct:${accountId}:${key}`, value);
}
export function rawDelete(accountId, key) {
  lsDel(`acct:${accountId}:${key}`);
}
export function rawDeleteAccount(accountId) {
  if (!LS) return;
  const prefix = `acct:${accountId}:`;
  const toRemove = [];
  for (let i = 0; i < LS.length; i++) {
    const k = LS.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  toRemove.forEach((k) => LS.removeItem(k));
}
