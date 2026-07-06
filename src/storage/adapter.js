/* ============================================================
   계좌인지 저장 어댑터
   - 무한매수법 두 파일은 무수정. 그들이 호출하는 전역 window.storage 를
     여기서 주입한다.
   - 실제 저장은 backend.getDriver()(로컬 또는 Supabase) 를 통한다. 드라이버는
     동기 get/set/delete/listKeys 를 제공(서버 드라이버는 hydrate 된 메모리 캐시).
   - 호출 시점의 '활성 계좌 id' 를 prefix(acct:{id}:) 로 붙여 네임스페이스 격리.
     → 프로그램 내부의 고정 KEY 를 그대로 살리면서 복수 계좌가 충돌 없이 공존.
   - 동기 결과를 Promise 로 감싸 기존 await 호환.
   - 통합뷰는 활성계좌와 무관하게 모든 acct:* 를 raw 로 직접 읽는다.
   ============================================================ */

import { getDriver } from "./backend";

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

function dGet(fullKey) {
  const v = getDriver().get(fullKey);
  return v == null ? null : { value: v };
}
function dSet(fullKey, value) {
  getDriver().set(fullKey, value);
  return { ok: true };
}
function dDel(fullKey) {
  getDriver().delete(fullKey);
  return { ok: true };
}
function dList(prefix) {
  return { keys: getDriver().listKeys(prefix) };
}

/* 무한매수법 파일이 기대하는 전역 window.storage 인터페이스 (비동기) */
export function installStorageAdapter() {
  if (typeof window === "undefined") return;
  window.storage = {
    get: (key) => Promise.resolve(dGet(nsKey(key))),
    set: (key, value) => Promise.resolve(dSet(nsKey(key), value)),
    delete: (key) => Promise.resolve(dDel(nsKey(key))),
    list: (prefix = "") => Promise.resolve(dList(`acct:${_activeAccount}:${prefix}`)),
  };
}

/* ---- 통합뷰/오버레이용 raw 접근 (계좌 격리 무시, 직접 읽기) ---- */
export function rawGet(accountId, key) {
  const r = dGet(`acct:${accountId}:${key}`);
  return r ? r.value : null;
}
export function rawSet(accountId, key, value) {
  dSet(`acct:${accountId}:${key}`, value);
}
export function rawDelete(accountId, key) {
  dDel(`acct:${accountId}:${key}`);
}
export function rawDeleteAccount(accountId) {
  const prefix = `acct:${accountId}:`;
  getDriver().listKeys(prefix).forEach((k) => getDriver().delete(k));
}
