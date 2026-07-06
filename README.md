# 매매 콘솔 — 무한매수법 + 밸류리밸런싱 통합

무한매수법(V4.0)과 밸류리밸런싱(VR5.0)을 **하나의 정적 웹앱**으로 묶었습니다.
매일 (1) 넣을 주문 · (2) 각 방법의 진행상태 · (3) 내 수익상태를 빠르게 봅니다.

**대원칙은 무결성.** 매매 로직은 검증본 그대로이고, 회계 표시는 주문에 절대 영향을 주지 않습니다.

---

## 무엇이 들어있나

- **통합뷰** — 모든 계좌의 평단·보유·잔금·평가금·미실현·실현·총수익률 + 포트폴리오 합계. (종목별 현재가만 입력)
- **무한 · SOXL40** — 무한매수법 V4.0 SOXL 40분할 단일.
- **무한 · 멀티** — 무한매수법 V4.0, TQQQ/SOXL × 20/40 선택.
- **VR 적립식** — 밸류리밸런싱 VR5.0 적립식.

각 프로그램은 **계좌(account)를 여러 개** 둘 수 있습니다(같은 방법으로 본계좌/서브 등). 프로그램=로직, 계좌=인스턴스.

## 매일 쓰는 흐름

1. 프로그램 탭 → 계좌 선택(또는 새로 만들기) → 시작 설정 1회 입력.
2. **오늘 걸 주문** 탭의 표를 그대로 LOC/지정가로 걸기.
3. 장 마감 후 **종가 입력** → 자동 산출된 체결을 확인(실제와 다르면 수량만 수정) → 확정.
4. **통합뷰**에서 종목별 현재가를 넣으면 전 계좌 수익이 한눈에.

데이터는 기본적으로 브라우저 **localStorage**에 저장됩니다(기기/브라우저 로컬). 새로고침해도 유지됩니다. **Supabase를 연결하면 로그인 기반 서버 저장으로 전환되어 여러 기기에서 같은 데이터를 동기화**할 수 있습니다(아래 "서버 저장(Supabase)" 참고).

---

## 무결성 설계 (요약)

- **무한매수법 두 파일은 바이트 그대로(무수정).** 계좌별 저장은 전역 `window.storage`를 계좌인지 어댑터로 주입해 처리 — 호출부/로직 0 변경.
- **VR은 엔진 6함수(verbatim) 보존**, 컴포넌트에만 영속성·체결캡처·원장을 추가. 엔진 인라인 self-test 유지.
- **회계 오버레이는 read-only.** 평단/실현은 표시용일 뿐 주문(밴드/별지점)에 피드백하지 않음.
- **릴리스 게이트**: 원문 PDF 수치 재현 + 회계 정합성 19개 어서션. `npm run build`가 게이트를 먼저 실행하고 **하나라도 실패하면 빌드/배포를 막습니다.** 앱 로드 시에도 실패하면 전면 차단.

게이트 단독 실행: `npm run gate`

---

## 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 게이트 통과 시 dist/ 생성
npm run preview  # 빌드 결과 미리보기
```

## GitHub Pages 배포 (Codespaces)

1. 이 폴더를 GitHub 저장소로 올립니다(새 repo 생성 후 push, 또는 Codespaces에서 커밋).
2. Codespaces 터미널에서:
   ```bash
   npm install
   npm run build
   ```
   `dist/`가 생성됩니다(게이트 통과 필수).
3. **GitHub Pages로 publish.** 가장 간단한 방법은 Actions 워크플로:
   - repo의 **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택.
   - 아래 `.github/workflows/deploy.yml`를 추가하고 push하면 자동 빌드·배포됩니다.
4. `vite.config.js`의 `base: './'`는 프로젝트 경로(`/저장소이름/`)에서도 상대경로로 동작하도록 둔 것입니다. 그대로 두면 됩니다.

### `.github/workflows/deploy.yml` (예시)

```yaml
name: Deploy to Pages
on:
  push: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build   # 게이트 실패 시 여기서 배포 중단
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

배포 후 주소: `https://<사용자>.github.io/<저장소이름>/`

---

## 서버 저장(Supabase) — 다기기 동기화 (선택)

환경변수 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`가 **둘 다 있으면** 앱이 자동으로
Supabase 백엔드로 동작합니다(이메일 매직링크 로그인 → 로그인하면 어느 기기에서든 같은 계좌
데이터). **없으면 기존 localStorage로 동작**(무회귀)하므로, 설정 전까지는 아무것도 바뀌지 않습니다.

무결성: 저장 방식 교체는 **`window.storage` 어댑터 뒤의 드라이버 구현만** 바꿉니다.
무한매수법 두 파일과 VR 엔진 6함수는 무수정 그대로입니다.

**설정 순서**

1. [supabase.com](https://supabase.com)에서 프로젝트 생성.
2. **SQL Editor**에 `supabase/schema.sql` 내용을 붙여넣고 실행(테이블 `user_kv` + RLS).
3. **Authentication → Providers → Email** 활성화(매직링크). Site URL / Redirect URL에
   앱 주소(`http://localhost:5173`, 배포 주소 `https://<사용자>.github.io/<저장소>/`)를 추가.
4. **Project Settings → API**에서 `Project URL`과 `anon public` 키를 복사.
5. 로컬 개발: `.env.example`를 `.env.local`로 복사해 두 값을 채움(`.env.local`은 git 무시).
6. 배포: 저장소 **Settings → Secrets and variables → Actions**에
   `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`를 등록하고, 배포 워크플로의 빌드 스텝에서
   `env:`로 주입.

> `anon` 키는 공개돼도 안전한 키입니다(RLS로 본인 행만 접근). `service_role` 키는 절대 넣지 마세요.

**기존 로컬 데이터**: 첫 로그인 시, 이 브라우저의 localStorage에 있던 계좌·상태·현재가를
서버로 **1회 자동 복사**합니다(비파괴적 — localStorage는 그대로 둠). 별도 수동 이전 불필요.

---

## 주의

- 본 도구는 매매 의사결정을 대신하지 않으며, 투자 책임은 사용자 본인에게 있습니다.
- 기본(localStorage) 모드는 **다른 기기/브라우저와 동기화되지 않습니다.** 다기기로 쓰려면 위
  "서버 저장(Supabase)"을 설정하세요.
