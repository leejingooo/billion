/* node CI 릴리스 게이트: npm run gate / npm run build 에서 먼저 실행.
   FAIL 이 하나라도 있으면 종료코드 1 → 빌드/배포 차단. */
import { runGate } from "../selftest/gate.js";

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
