# PROJECT HANDOFF

> 갱신: 2026-07-19 KST. **acceptance source of truth = [`docs/FRIENDWORD_FOURTH_AUDIT_HANDOFF_2026-07-15.md`](FRIENDWORD_FOURTH_AUDIT_HANDOFF_2026-07-15.md)(4차 감사)** — 1~3차는 역사적 기준. 결정 이력 [`docs/DECISIONS.md`](DECISIONS.md), 작업 소유권 [`docs/TASKS.md`](TASKS.md).
>
> **새 머신(클론) 부트스트랩**: Node 22(.nvmrc)·corepack로 pnpm 11.12.0·`pnpm install`. **`.env`는 git에 없으므로 이전 머신에서 직접 복사**(변수 목록은 `.env.example`). DB 테스트는 brew Postgres 17 필요. hosted push는 supabase CLI(로그인 필요). 시뮬레이터 QA는 Xcode. Claude 메모리(~/.claude)는 머신 로컬이라 이 문서가 유일한 인계 수단이다.

## CURRENT STATE

- 판정: **기능성 내부 베타**. 3차 감사 Slice 0~7 해소 완료. **4차 감사가 새 기준이며 대응 미착수** — 새 P0 10건+GP-P0 4건+H 17건, 실행 계획 §10 Slice 0~9. 배포 판정: 본인 단독 내부 QA만 조건부 허용(테스트 계정·gate off), 외부 테스터 초대·공개·Grand Prize 제출 차단.
- 게이트: `real_payments_enabled=off`·`public_beta_enabled=off` (publish·공개 read·interest 차단). QA 예외는 draft 단위 `qa_preview_allowlist`뿐 — 운영 도구 `scripts/qa-preview-allowlist.mjs`(find/add/remove/list).
- 인프라 (전부 가동, 계정 소유는 사용자):
  - **DB**: Supabase hosted `oknolcxsvogrhnxnyosr`, migrations **0001~0042 배포**(0040은 의도적 미사용 갭 — c11 참조).
  - **웹**: Vercel `https://friendword-web-nmsi.vercel.app` — GitHub `wwdbsh/friendword` main push마다 자동 배포(Root=`apps/web`, `vercel.json`의 `buildCommand: next build`). env: Supabase 4종 등록됨, `OPENAI_API_KEY`·`REVENUECAT_WEBHOOK_AUTH_TOKEN`은 사용자 등록 상태 확인 필요.
  - **모바일**: EAS `@wwdbsh/friendword` → TestFlight 내부 배포 가동(실기기 설치 2회 성공). `eas.json`에 pnpm 11.12.0 핀 필수. 반복 릴리스 절차 `docs/OPS.md`.
  - **RevenueCat**: 프로젝트 연동 완료 — iOS 앱(`com.friendword.app`)+IAP 키, 상품 `creator_launch_credit_499`·`campaign_pass_30d_1999`(ASC 둘 다 **Consumable**), default offering 패키지 2개, 웹훅→`/api/revenuecat`, SDK 키 EAS env. ASC 샌드박스 테스터 생성됨.
  - **scheduled-ops cron**: GH Actions 시크릿(`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`) 등록 전까지 매시간 fail-fast 메일 — 등록 여부 미확인.
- 회귀: DB base · audit 7/7 · audit2 14/14 · **audit3 c01~c11(11/11)** · unit 219(mobile 106 포함) · web 유닛 49 · Playwright 46/46. green test ≠ 완료 증거.
- 작업 체제: Advisor(오케스트레이터)+Opus 워커(작업 단위 생성, 승인 후 종료). 워커 결과는 Advisor가 diff·동일 테스트 재실행으로 검증 후에만 승인.

## DONE

- **3차 감사 Slice 6**(`90e9516`, migration 0041): 데모 정직화(structure scene·segment 타이밍·age/vouch 제거), judge-safe flow(c09·c11, ON CONFLICT 우회 실증 기각), Dater 통제(실 프리뷰·18+ fail-closed·canonical location·voice 자동 포함), recap 이원화, 커머스 계약 단일화·kit/OG 가짜 waveform 제거.
- **3차 감사 Slice 7**(`69efcf3`): Trust Layer 수치 스펙·contrast matrix(red-first 2건 해소), consent 6단계+sticky rail, 44px 실측, §11 browser 회귀, app/ 테스트 라우트 번들 크래시(Expo Go 부팅 불가 잠복 결함) 수정.
- **TestFlight 채널 개통**: EAS 셋업(아이콘/스플래시 생성 포함)→빌드→제출→실기기 설치. 함정 해결: pnpm 핀, 크리덴셜 TTY, 암호화 면제 선언.
- **웹 프로덕션 배포**: Vercel + 스모크 전 통과(landing/demo 200, 404 게이트, OG png, noindex, transcribe 401 graceful).
- **RevenueCat/ASC 셋업**(위 상태 표) + **제품 ID rename**(`3dd6c1a`, migration 0042 — ASC ID 영구잠금 사고 대응, RPC 5개 재정의, 전 스위트 green).
- **모바일 사인인·헤더 수정**(`03a8adf`): signed-out 카드에 SignInSheet 연결 CTA(4차 H-6·CP-7 코드분 선반영), 미등록 화면 헤더·"index" 백라벨 누출 제거.
- 운영 도구: `scripts/qa-preview-allowlist.mjs`, 실기기 QA 체크리스트 `docs/DEVICE_QA.md`, 데모 실음성 seed `scripts/seed-demo-pitch.mjs`(파일 대기).

## IN PROGRESS

- **실기기 풀 플로우 QA**: 준비 완료(도구·체크리스트·계정), 실행 전. `03a8adf` 반영 재빌드+submit이 됐는지부터 확인 필요(마지막 설치 빌드는 그 이전).

## TODO

1. (P0) `03a8adf` 반영 **재빌드+submit** 확인 → `docs/DEVICE_QA.md` 체크리스트로 실기기 QA 실행(draft 생성 시 allowlist 등록은 Advisor가 스크립트로).
2. (P0) **OpenAI 키**: platform.openai.com 키+budget alert → Vercel `OPENAI_API_KEY` → Redeploy (ChatGPT 구독으로는 API 호출 불가 — 별도 과금, 최소 $5 크레딧). 미등록 시 AI 플로우 501.
3. (P0) **GH Actions 시크릿** 등록 확인(`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`) → scheduled-ops 수동 트리거로 green 확인(실패 메일 중단 + 만료/삭제 runtime 가동).
4. (P0) **sandbox 결제 드릴**: Advisor 주도 — `real_payments_enabled` on(SQL) → 앱에서 sandbox 구매/복원 왕복 → 웹훅·원장 검증 → off 원복·기록. 그 전까지 구매 버튼 금지.
5. (P0) **4차 감사 대응 착수**: §10 Slice 0(기준 동결·truth reset)부터. GP-P0-1(structured motion 원계약 복원 vs 07-13 축소 유지)은 사용자 재결정 필요.
6. (P0) **데모 실음성**: 권리 확보 30~60초 영어 녹음(TTS 금지) → seed 1회 실행.
7. (P1) 실기기 QA 발견사항을 4차 Slice 8 입력으로 정리.
8. (P1) prod Supabase 분리 결정은 4차 Slice 9에서(신규 prod 프로젝트 A안 우선 검토 — DECISIONS 예정).
9. (P2) identity 벤더·Resend 도메인은 Slice 9 시점.

## IMPORTANT DECISIONS

- **4차 감사 = acceptance 기준** 승격. TestFlight 내부 QA 허용 / 외부 노출 전면 차단 판정 준수.
- **RevenueCat은 단일 프로젝트 + Apple sandbox**: 환경 구분은 이벤트의 SANDBOX/PRODUCTION 태그, 서버 게이트가 PRODUCTION 효익만 차단(SANDBOX 처리) — 개발용 별도 프로젝트 없음. H-14(sandbox/production namespace 분리)는 4차 대응에서 하드닝.
- **상품 계약 스토어 반영**: 두 상품 모두 ASC **Consumable**(신 UI에 갱신 안 함 구독 없음, 기간은 서버 상태기계 전담, 자동 갱신 금지). Campaign Pass ID는 `campaign_pass_30d_1999`(구 ID는 ASC 영구잠금 — migration 0042).
- **운영 교훈(불변)**: ASC IAP ID는 삭제 시 영구 소각 — 삭제 금지 / EAS는 eas.json에 pnpm 버전 핀 / EAS·Vercel 크리덴셜 1회 셋업은 진짜 TTY 필요 / Vercel은 `buildCommand: next build`(로컬 `.next-build` 리다이렉트는 dev 서버 충돌 방지용이므로 유지).
- (기존 유지) TTS/합성 데모 음성 금지 · 게이트 전역 토글 금지(allowlist만) · 키·시크릿 값은 사용자 직접 입력(Claude 미수신) · 감사 §13 금지 표현 준수.

## ISSUES / RISKS

- **4차 감사 P0 미해소**: 승인 snapshot 불일치(공개 structure 미검토·moderation 우회), verified interest 프로필 교체 우회, 미디어 검증 경로 신뢰, provider retry 비용 누락, 음성 길이 서버 invariant 부재, RevenueCat 복구·Pass 이중 시간축 — 외부 노출 차단의 근거이므로 QA 중 실사용자 유입 금지.
- scheduled-ops 시크릿 미등록이면 매시간 실패 메일 지속(의도된 fail-fast).
- OPENAI/identity/Resend 키 부재 플로우는 mock/차단 상태 — 완료로 기록 금지.
- hosted 실계정 `wwdbsh@gmail.com` 삭제·조작 금지.
- 운영 함정: DB push는 클린 트리에서만 · :3000 dev 서버 중 `web build` 금지 · Playwright는 편집 멈춘 창에서 · RPC 재정의는 최신본(0042 포함) 통째 복사 · `apps/mobile/app/` 하위 `*.test.*` 금지(라우트로 번들됨 — 가드 테스트 존재) · plpgsql `NOT IN`+NULL · 웹 수동 QA 인증은 localStorage `friendword-web-auth`.

## LOG SUMMARY

- 2026-07-14: 3차 감사 Slice 0~5(`358a2ae`)에 이어 **Slice 6·7 완주**(`90e9516`·`69efcf3`, 0041 배포, 프로덕션 E2E 2연속 PASS). 워커 5명 체제, Advisor 검증이 voice 보존 구멍·E2E 18+ 파손·우회 의혹 실증 기각 등을 처리.
- 2026-07-15: **TestFlight 개통**(첫 빌드→설치). **4차 감사 수령**.
- 2026-07-16: **Vercel 웹 프로덕션 배포**+스모크(`35c60aa`), scheduled-ops 시크릿 안내.
- 2026-07-18: **RevenueCat/ASC 전체 셋업**, 제품 ID rename+0042(`3dd6c1a`), allowlist 도구(`84efa8b`), 모바일 사인인 CTA·헤더 수정(`03a8adf`) — 실기기 QA 직전 상태로 인계.
