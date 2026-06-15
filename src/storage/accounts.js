/* ============================================================
   계좌 레지스트리
   - 전역(계좌 격리 밖) 키 "accounts:index" 에 계좌 메타 목록을 둔다.
   - 계좌 = { id, programType, label, createdAt }
   - programType: "mubaeSingle" | "mubaeMulti" | "vr"
   - 실제 매매 상태/원장은 각 프로그램이 acct:{id}:* 에 자체 저장.
   ============================================================ */

import { rawDeleteAccount } from "./adapter";

const INDEX_KEY = "accounts:index";
const LS = typeof window !== "undefined" ? window.localStorage : null;

export const PROGRAM_LABELS = {
  mubaeSingle: "무한매수법 · SOXL 40분할",
  mubaeMulti: "무한매수법 · 멀티(종목/분할 선택)",
  vr: "밸류리밸런싱 · 적립식",
};

export function listAccounts() {
  if (!LS) return [];
  try {
    const raw = LS.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIndex(arr) {
  if (LS) LS.setItem(INDEX_KEY, JSON.stringify(arr));
}

export function createAccount(programType, label) {
  const id = `${programType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const acct = {
    id,
    programType,
    label: label?.trim() || PROGRAM_LABELS[programType] || programType,
    createdAt: new Date().toISOString(),
  };
  const arr = listAccounts();
  arr.push(acct);
  saveIndex(arr);
  return acct;
}

export function renameAccount(id, label) {
  const arr = listAccounts().map((a) => (a.id === id ? { ...a, label } : a));
  saveIndex(arr);
}

export function deleteAccount(id) {
  const arr = listAccounts().filter((a) => a.id !== id);
  saveIndex(arr);
  rawDeleteAccount(id); // 해당 계좌의 모든 acct:{id}:* 상태 제거
}

export function getAccount(id) {
  return listAccounts().find((a) => a.id === id) || null;
}
