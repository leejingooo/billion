/* node CI 릴리스 게이트: npm run gate / npm run build 에서 먼저 실행.
   FAIL 이 하나라도 있으면 종료코드 1 → 빌드/배포 차단. */
import { runGate } from "../selftest/gate.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const locked = {
  mubaeSingle: "b9fc202cbb4a59146544e0c47dcf8f6db83e5c8d623ffe3b600ca1181f340caa",
  mubaeMulti: "312bfbb7c855ec6dcae547c7538aa9ccc61e54fdd710217cc7f26c04b6dece2d",
};
for (const [program, expected] of Object.entries(locked)) {
  const source = readFileSync(new URL(`../programs/${program}/App.jsx`, import.meta.url));
  if (createHash("sha256").update(source).digest("hex") !== expected) {
    console.error(`원본 보존 검증 실패: ${program}/App.jsx — 배포 차단.`);
    process.exit(1);
  }
}

const { allPass, results } = runGate();
for (const r of results) {
  const tag = r.pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${r.name}`);
  if (!r.pass) console.log(`        기대 ${r.exp} · 결과 ${r.got}`);
}
console.log(`\n게이트 결과: ${results.filter((r) => r.pass).length}/${results.length} 통과`);
if (!allPass) {
  console.error("릴리스 게이트 실패 — 배포 차단.");
  process.exit(1);
}
console.log("릴리스 게이트 통과.");
