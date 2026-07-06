# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침이다.
구성: **① 범용 지침 → ② 프로젝트 특화 지침 → ③ 모델별 지침** (Fable / Opus / Sonnet).

---

## ① 범용 지침 (모든 작업 공통)

### 작업 원칙
- **무결성 > 편의.** 요청받지 않은 리팩토링, 추상화 추가, "김에 정리"를 하지 않는다. 버그 수정에 주변 정리를 끼워넣지 않는다.
- 요구사항이 애매하면 가정을 명시하고 진행하되, **되돌리기 어려운 결정**(데이터 스키마 변경, 파일 삭제, 외부 배포)은 먼저 확인한다.
- 변경 후에는 반드시 검증한다. 이 저장소에서는 최소 `npm run gate`가 통과해야 하고, 로직 변경 시 실제 앱 흐름(dev 서버)으로 확인한다.
- 결과 보고는 사실 그대로: 테스트가 실패하면 실패했다고 출력과 함께 말한다. 건너뛴 단계가 있으면 명시한다.

### 코드 스타일
- 주변 코드의 스타일(주석 밀도, 네이밍, 관용구)을 따른다. 이 프로젝트는 한국어 주석/한국어 UI 문자열을 사용한다.
- 주석은 코드가 표현할 수 없는 **제약**을 적을 때만 쓴다. "이 줄은 X를 한다" 식의 서술 주석 금지.
- 새 의존성 추가는 최소화한다. 현재 스택(Vite + React 18 + Tailwind)으로 해결 가능한지 먼저 검토.

### Git
- 커밋 메시지는 변경의 **의도**를 담아 명확하게. 관련 없는 변경을 한 커밋에 섞지 않는다.
- main에 직접 푸시하지 않는다. 작업 브랜치에서 개발 후 PR 또는 지정된 브랜치 사용.
- 게이트(FAIL)를 우회하는 커밋/배포는 절대 금지.

---

## ② 프로젝트 특화 지침

### 프로젝트 개요
라오어 **무한매수법(V4.0) + 밸류리밸런싱(VR5.0)** 통합 정적 웹앱.
목적: 매일 넣을 주문 · 진행상태 · 수익상태를 빠르게 확인.
스택: Vite 5 + React 18 + Tailwind 3.4, 저장은 localStorage, 배포는 GitHub Pages (Actions).

### 명령어
```bash
npm install
npm run dev      # 개발 서버
npm run gate     # 릴리스 게이트 단독 실행 (19개 어서션)
npm run build    # 게이트 먼저 실행 → 통과 시에만 dist/ 생성
```

### 절대 불변 원칙 (위반 금지 — 이 섹션이 이 문서에서 가장 중요하다)

1. **무한매수법 두 파일은 바이트 그대로 보존.** 한 글자도 수정 불가.
   - `src/programs/mubaeSingle/App.jsx` — sha256 `b9fc202cbb4a59146544e0c47dcf8f6db83e5c8d623ffe3b600ca1181f340caa`
   - `src/programs/mubaeMulti/App.jsx` — sha256 `312bfbb7c855ec6dcae547c7538aa9ccc61e54fdd710217cc7f26c04b6dece2d`
   - 계좌 격리·저장 방식 변경 등 모든 확장은 **전역 `window.storage` 어댑터 주입**(`src/storage/adapter.js`)으로만 처리한다.
   - 이 파일들을 건드려야만 해결되는 것처럼 보이는 요구가 오면, 수정하지 말고 어댑터/래퍼 레이어 해법을 제시하거나 사용자에게 보고한다.
   - 작업 후 `sha256sum`으로 두 파일의 해시가 위 값과 일치하는지 확인한다.

2. **VR 엔진 6함수는 verbatim 보존** (`src/programs/vr/App.jsx` 내):
   `r2`, `buildBuyLadder`, `buildSellLadder`, `initState`, `advanceCycle`, `runSelfTests`
   — 함수 본체 수정 금지. 영속성/체결캡처/원장은 컴포넌트 레이어에만 추가한다.

3. **회계 오버레이는 read-only.** 평단/실현손익 계산(`src/overlay/`)은 표시 전용이며, VR 주문 로직(밴드/사다리)이나 무한매수법 로직에 절대 피드백하지 않는다. 원문 근거: "VR 진행은 평단과 관계없기 때문에 매도."

4. **릴리스 게이트가 배포를 지킨다.** `npm run build`는 게이트(`src/ci/run-gate.mjs` → `src/selftest/gate.js`, 19개 어서션)를 먼저 실행하고 하나라도 실패하면 빌드를 중단한다. 게이트 어서션의 기대값을 코드에 맞추어 고치는 것은 금지 — 게이트가 실패하면 **코드가 틀린 것**이다. 어서션 추가는 환영, 완화/삭제는 사용자 승인 필요.

### 아키텍처 요점
```
src/
  storage/adapter.js    # 전역 window.storage 계좌인지 어댑터 (핵심 격리 메커니즘)
  storage/accounts.js   # 계좌 레지스트리 (키: accounts:index / acct:{id}:*)
  programs/             # mubaeSingle·mubaeMulti(무수정 LOCKED) + vr(엔진 verbatim)
  overlay/              # ledger.js(체결원장→평단/실현, 순수함수), snapshot.js(AccountSnapshot)
  views/UnifiedView.jsx # 통합뷰 (계좌 집계 + 계좌 관리/삭제)
  selftest/gate.js      # 릴리스 게이트 (순수, React 비의존)
  ci/run-gate.mjs       # node CI 진입점 (FAIL 시 exit 1)
  App.jsx               # 탭 라우팅 + ProgramHost + 게이트 차단 화면
  main.jsx              # installStorageAdapter() 먼저 → App 렌더
```
- **프로그램 = 로직, 계좌 = 인스턴스.** 같은 programType으로 복수 계좌 가능. 계좌별 데이터는 `acct:{id}:` prefix로 격리. 계좌 전환은 `setActiveAccount(id)` 후 `<Program key={acct.id}/>` remount.
- 무한 회계는 원장 없이 항등식으로 역산: `invested = cash + shares×avg − realizedTotal` (native 값 읽기만). 원장(ledger)은 VR 전용이며 센트(정수) 누적으로 드리프트를 차단한다.
- VR 체결 캡처는 rung 기반(엔진 계산가를 그대로 체결 확정). 절대값 보정은 안전 해치로만.

### 이미 확정된 설계 결정 (재논의 불필요)
- `brokerCap = lastClose × 1.18` (증권사 ±20% 거부 대응)
- 리버스 종료 방향: `close > avg × (1 − 0.20)` — 평단−20% **위로 회복** 시 종료
- n1=0 억제: `floor(half/topPrice) = 0`이면 별지점 매수 줄 자체가 안 뜸 (정상 동작)
- `reconBaseRealized`: VR 평단 직접 보정 시 이전 실현손익 보존용, 영속성 bundle에 포함
- 계좌 삭제 UI는 통합뷰로 일원화 (프로그램 탭에 삭제 UI 없음), 삭제 시 confirm 필수

### UI 컨벤션
- 다크 테마 통일, zinc/amber 팔레트
- **수익 = 빨강(red), 손실 = 파랑(blue)** — 한국 주식시장 관행. 뒤집지 말 것.
- 탭: `[통합뷰] [무한 · SOXL40] [무한 · 멀티] [VR 적립식]`

### 개선 로드맵 (진행 예정 — 착수 시 불변 원칙 준수)
1. **무한매수법 섹션 통일** — 현재 두 탭(SOXL40 단일/멀티)로 분리된 것을 하나의 섹션으로. 단, LOCKED 파일은 무수정이므로 통합은 라우팅/호스트 레이어에서만 (예: 하나의 탭 아래 서브 선택, 두 프로그램을 그대로 호스팅).
2. **계좌 생성/관리 UX 개선** — 더 사용자 친화적인 생성 플로우/이름 변경/정리.
3. **서버 저장 전환** — localStorage → 서버 저장으로 다기기 동기화. 방식: `window.storage` 어댑터의 구현만 교체하고 인터페이스(get/set/delete/list, Promise 반환)는 유지하면 LOCKED 파일 무수정 원칙이 지켜진다. 백엔드 선택(예: Supabase/Firebase/자체 API)·인증·충돌 처리 방침은 사용자와 합의 후 진행.
4. **기타 UX 개선** — 무결성 원칙을 해치지 않는 범위에서만.

### 작업 후 검증 체크리스트
1. `sha256sum src/programs/mubaeSingle/App.jsx src/programs/mubaeMulti/App.jsx` — 위 해시와 일치
2. `npm run gate` — 19/19 통과
3. 계좌 격리: 같은 programType 두 계좌가 같은 KEY를 써도 충돌 없음
4. 새로고침 후 상태 복원 (VR: state/hist/px/ledger/invested)
5. 계좌 삭제 시 레지스트리 + `acct:{id}:*` 전부 제거
6. 오버레이 피드백 없음: avgCost가 사다리/별지점 계산에 쓰이지 않음

---

## ③ 모델별 지침

Anthropic 공식 지침 기반: [Claude Fable 5 / Mythos 5 발표](https://www.anthropic.com/news/claude-fable-5-mythos-5),
[모델 마이그레이션 가이드](https://platform.claude.com/docs/en/about-claude/models/migration-guide),
[모델 개요](https://platform.claude.com/docs/en/about-claude/models/overview).
모델 계층: **Fable 5** (Mythos급, 최상위) > **Opus 4.8** > **Sonnet 5** > Haiku 4.5.

### Claude Fable 5 (`claude-fable-5`)로 실행 중일 때
- 가장 까다로운 추론·장기 자율(long-horizon) 작업용 모델. 이 프로젝트에서는 서버 저장 전환 같은 아키텍처 변경, 무결성이 걸린 대규모 마이그레이션에 적합.
- **충분한 정보가 있으면 즉시 실행한다.** 이미 확정된 설계 결정(위 섹션)을 재논의하거나, 선택지를 나열만 하고 끝내지 않는다. 저울질 중이면 권고안 하나를 제시한다.
- **요청 범위를 넘는 정리/리팩토링 금지.** 높은 effort에서 주변 코드를 "개선"하려는 경향이 있음 — 이 저장소의 LOCKED 파일/verbatim 함수 원칙과 정면 충돌하므로 특히 주의.
- **진행 보고는 증거 기반으로.** 이 세션의 도구 실행 결과로 확인한 것만 완료로 보고한다. 미검증 상태면 미검증이라고 말한다.
- 독립적인 하위 작업은 서브에이전트에 병렬 위임해도 좋다. 단, LOCKED 파일을 건드릴 수 있는 작업은 위임 전 제약을 명시할 것.
- 사용자가 문제를 설명하거나 질문하는 중이면 진단만 보고하고 멈춘다. 고쳐달라고 하기 전에 수정하지 않는다.

### Claude Opus (opus 4.6/4.7/4.8)로 실행 중일 때
- 코딩/에이전트 작업의 기본 상위 모델. 이 프로젝트의 기능 개발·버그 수정 대부분에 적합.
- **지시를 문자 그대로 따르는 경향** (4.7+): 이 문서의 불변 원칙을 정확히 지키는 데 유리하다. 반대로, 애매한 요청은 확대 해석하지 않으므로 범위가 넓은 지시는 명시적으로 준다.
- 4.7+는 도구(검색·파일 읽기)를 덜 쓰는 경향 — 추측하지 말고 **코드를 실제로 읽고 게이트를 실제로 실행해서** 확인할 것.
- 사소한 선택(변수명, 동등한 두 접근 중 하나)은 묻지 말고 합리적으로 정한 뒤 언급만 한다. 파괴적 작업·범위 변경은 먼저 묻는다.
- 코드 리뷰 시: 발견한 문제를 심각도와 무관하게 전부 보고하고, 필터링은 그 다음 단계에서.

### Claude Sonnet (sonnet 4.6/5)로 실행 중일 때
- 속도-지능 균형 모델. 작은 버그 수정, UI 문구/스타일 조정, 문서 갱신 등 범위가 명확한 작업에 적합.
- Sonnet 5는 지시를 문자 그대로 해석한다 — 지시가 여러 파일/섹션에 적용돼야 하면 범위를 명시적으로 말해줘야 한다.
- 기본적으로 에이전틱 성향이 강해 도구를 적극적으로 쓴다. 단, 이 저장소에서는 **수정 전에 반드시 불변 원칙 섹션을 확인**하고, LOCKED 파일이 diff에 포함되면 즉시 중단·보고.
- 아키텍처 판단이 필요한 작업(저장 레이어 교체, 게이트 어서션 변경 등)은 스스로 결정하지 말고 사용자 확인 또는 상위 모델 권장을 보고한다.

### 모든 모델 공통
- 모델 ID는 정확한 문자열만 사용: `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` (날짜 suffix 임의 부착 금지).
- 이 앱 코드에 Claude API를 통합할 일이 생기면 최신 문서를 먼저 확인할 것 (파라미터가 모델 세대별로 다름: Fable 5/Opus 4.8은 `thinking` 수동 설정·sampling 파라미터를 거부).
