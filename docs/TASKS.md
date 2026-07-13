# 작업 소유권 및 상태

## 기록 형식

| Session   | Owned paths             | Dependency                        | Acceptance criteria               | Status                                                       | Updated    |
| --------- | ----------------------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------ | ---------- |
| 세션 이름 | 겹치지 않는 정확한 경로 | 승인되어야 할 선행 작업 또는 없음 | 관찰 가능한 완료 조건과 검증 명령 | 예정 / 진행 중 / Worker 완료·Advisor 검증 대기 / 승인 / 차단 | YYYY-MM-DD |

상태는 Worker의 자체 보고와 Advisor 승인을 구분합니다. Worker 완료는 Advisor가 diff, 동일 테스트와 matching-surface manual QA를 재실행하기 전까지 통합 승인이 아닙니다. 범위가 바뀌면 작업 전에 이 표를 갱신합니다.

## 2026-07-13 2차 감사 대응 (source of truth: docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md §7, 순서 Slice 0→10 고정)

운영 메모: Advisor(직접 구현 병행) + `friendword-codex-1` 2인 체제 유지. 제품 상태 판정은 "기능성 베타 — 실결제·외부 공개 차단"이며 launch gate(0023)가 서버에서 강제한다. audit2 스위트는 초기 FAIL이 정상(기대 동작 인코딩), Slice 10에서 CI 편입.

| Session              | 작업                                                                                               | Acceptance criteria                                                         | Status                                                           | Updated    |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| Advisor              | Slice 0: launch gates(0023)·seed 게이트·e2e 토글·audit2 러너·b09·문서 truth reset                  | b09 그린 + 기존 DB 스위트/audit 7/7 그린 유지 + 문서 5종 동기화             | 승인 (e9de0de, hosted 0023 배포·게이트 off 검증)                 | 2026-07-13 |
| `friendword-codex-1` | Slice 0: audit2 실패 회귀 스위트 b01~b08·b10 + 웹훅 실payload 테스트 (`.briefs/24`)                | 각 파일 단독 실행 가능, FAIL 사유가 감사 항목과 일치, lint/format 통과      | 승인 (7fe7c5a, Advisor 재실행 DB 4/10·웹 3/5 red-by-design 확인) | 2026-07-13 |
| Advisor              | Slice 1: 0024(신고 dedupe·distinct pause·restrictive read)·proxy trust·계정 가드·b11               | b01/b11 그린 + 기존 스위트 그린 유지 + E2E·브라우저 신고 QA                 | 승인 (236d5de, hosted 0024·E2E 21체크·브라우저 dedupe 실검증)    | 2026-07-13 |
| Advisor              | Slice 2: 0026 text_moderations·transcribe voice moderation·moderate-text API·모바일/웹 배선·b12    | b12 그린 + 16/b02 정합 + 라우트 QA + hosted 배포                            | 승인 (0d66cd7, hosted 0025~0026 배포·orphan dry-run 클린)        | 2026-07-13 |
| `friendword-codex-1` | Slice 2: 0025 길이·rate·quota, suite 18, orphan cleanup, 웹 interest cap/rollback (`.briefs/25`)   | suite 01~18 그린 + audit2 red set 불변 + build/lint 그린                    | 승인 (5a59b4e, Advisor 재실행 전체 그린)                         | 2026-07-13 |
| Advisor              | Slice 3: 0027 실이벤트 계약·review 큐·route 재작성·b03·구계약 테스트 4곳 갱신                      | b03 그린 + 웹 audit/audit2 그린 + DB 01~18 그린                             | 승인 (hosted 0027 배포)                                          | 2026-07-13 |
| `friendword-codex-1` | Slice 3: RevenueCat identity 동기화 서비스·auth 배선·구매 전 일치 보증 (`.briefs/26`)              | identity 시나리오 6종 테스트 + 모바일 35 테스트 그린                        | 승인 (Advisor 재실행 그린; sandbox 실기기는 사용자 게이트 잔존)  | 2026-07-13 |
| Advisor              | Slice 6: 0031 usage 원장·cap·kill switch·AI 동의·라우트 reserve/reconcile·H-2 FK·정기 ops 스크립트 | b07/b08 그린 + 전체 게이트 그린 + hosted 배포                               | 승인 (hosted 0031 배포)                                          | 2026-07-13 |
| `friendword-codex-1` | Slice 6: 모바일 AI 동의 disclosure·affirmative action·오류 표기 (`.briefs/28`)                     | 동의 전 transcribe 미호출 + 시나리오 테스트 + 게이트 그린                   | Worker 완료·Advisor 검증 대기                                    | 2026-07-13 |
| Advisor              | Slice 7 groundwork(WIP): 0032 dater 통제 RPC·transcript 스냅샷·whisper 세그먼트·공개 렌더 골격     | 다음 세션에서 UI·b13·문서와 함께 완결                                       | 진행 중 (서버 골격 그린, UI/테스트/문서 잔여)                    | 2026-07-13 |
| 예정                 | Slice 1~9: 감사 §7 순서대로 (신고→media→RevenueCat→유료가치→identity→비용→Dater→데모·영어→growth)  | 각 슬라이스의 audit2 테스트 그린 전환 + §12 승인 형식 보고                  | 예정                                                             | 2026-07-13 |
| 예정                 | Slice 10: release gate                                                                             | 감사 §7 Slice 10 체크리스트 전부 + audit2 CI 편입 + launch gate 해제 재판단 | 예정                                                             | 2026-07-13 |

## 2026-07-13 감사 대응 (source of truth: docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md §7, 순서 A→J 고정)

운영 메모: 오후부터 사용자 지시로 2인 체제(Advisor 직접 구현 + codex-1). codex-2는 A·C-DB·D-DB·E-DB·G-DB 승인 후 대기, codex-3는 A-웹훅·E-Web·C-Mobile·D-Mobile 승인 후 대기.

| Session              | 작업                                                                                | Acceptance criteria                                 | Status                                      | Updated    |
| -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- | ---------- |
| Advisor+워커 3기     | Slice A~E (회귀 스위트, bootstrap, claim 바인딩, consent revision, 결제 원장)       | audit 회귀 그린 전환 + 프로덕션 E2E                 | 승인 (audit DB 7/7·웹훅 11/11, E2E 전 체크) | 2026-07-13 |
| Advisor              | Slice F(효익), G-Web(검증 API·신고·삭제), H-DB(사진 가드), I(대비), J(CI), evidence | suite 17, safety/kit Playwright, CI 3잡 그린        | 승인 (CI run 29230035650 success)           | 2026-07-13 |
| `friendword-codex-1` | E-Mobile(페이월 intent), H-Web(OG·랜딩)                                             | 페이월 intent·pending 확정, OG·랜딩·fixture 분리    | 승인                                        | 2026-07-13 |
| `friendword-codex-1` | Slice I-Mobile: Trust Layer primitive·강도 조정·킷 진입 (`.briefs/23`)              | 강도 표 구현 + 시뮬레이터 스크린샷 + 320pt 무클리핑 | 진행 중                                     | 2026-07-13 |
| 사용자 게이트        | identity 벤더, OPENAI 키, RevenueCat 셋업, Resend 도메인, EXPO_PUBLIC_WEB_ORIGIN    | 키 입력 후 enforcement 스위치 on + sandbox 검증     | 대기                                        | 2026-07-13 |
| 보류(사용자 결정)    | 18+ 온보딩·법적 문서 표면·App Store 메타데이터                                      | 스토어 준비 착수 시(7월 중하순 재판단) 일괄         | 보류                                        | 2026-07-13 |

## 2026-07-12 진행 중 작업

| Session              | Owned paths                                      | Dependency                                                                       | Acceptance criteria                                                                    | Status                     | Updated    |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | ---------- |
| `friendword-codex-1` | `apps/mobile/**`                                 | Advisor의 root contract/scaffold                                                 | Expo/React Native mobile scaffold가 해당 Worker brief의 검증을 통과함                  | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| `friendword-codex-2` | `supabase/**`                                    | `.briefs/02-supabase-schema.md`; root scaffold와 contract는 Advisor 통합 시 대조 | migration, RLS와 schema test가 brief의 invariant 및 검증을 통과함                      | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| `friendword-codex-3` | `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**` | `.briefs/03-docs-skeleton.md`, `FRIENDWORD_HANDOFF.md`                           | 15개 최종 문서 존재, 12개 docs 반영, 기존 `docs/shipaton-2026.md` 삭제, 필수 검증 통과 | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| Advisor              | 루트 scaffold·설정, `apps/web/**`, CI            | Worker 결과의 contract와 schema를 직접 재검증                                    | root lint/typecheck/test/CI와 web scaffold가 Advisor 검증 및 manual QA를 통과함        | 승인 (초기 스캐폴드 완료)  | 2026-07-12 |

## 2026-07-12 Slice 3 (디자인 시스템 "Hype Mixtape" + 핵심 표면)

| Session              | Owned paths                                                                               | Dependency                                   | Acceptance criteria                                                 | Status                                                         | Updated    |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| `friendword-codex-1` | `apps/mobile/**`                                                                          | `.briefs/04-mobile-pitch-flow.md`, ui-tokens | 5단계 피치 플로우 + 녹음, typecheck/lint/format 통과, 시뮬레이터 QA | 승인 (Advisor 시뮬레이터 QA 완료)                              | 2026-07-12 |
| `friendword-codex-2` | `packages/data\|adapters\|contracts/**`, `supabase/migrations/0003`, `scripts/test-db.sh` | `.briefs/05-data-layer.md`                   | 전체 테스트 + DB 하니스 통과                                        | 승인 (Advisor 재검증 + 원격 배포 완료)                         | 2026-07-12 |
| `friendword-codex-3` | `apps/web/**`                                                                             | `.briefs/06-web-pitch-page.md`, ui-tokens    | `/p/demo-blair` 완전 동작, build/E2E 통과                           | 승인 (usage limit로 최종 보고 누락 — Advisor가 직접 검증 완료) | 2026-07-12 |
| Advisor              | `packages/ui-tokens`, `docs/DESIGN.md`, `.env`, Supabase 링크·배포, ignore 정리           | 사용자 디자인 피드백(액티브·펑키)            | 디자인 시스템 확정, 원격 스키마 0001~0003 배포, 전체 그린           | 완료                                                           | 2026-07-12 |

## 2026-07-12 Slice 4 (모바일 실데이터 연결 — Advisor 단독, codex usage limit 폴백)

| Session | Owned paths                                                                                 | Dependency          | Acceptance criteria                                            | Status                                    | Updated    |
| ------- | ------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------- | ----------------------------------------- | ---------- |
| Advisor | `supabase/migrations/0004`, `packages/data`, `apps/mobile`(auth·서비스 계층), `.env` 심링크 | Slice 3 산출물 전부 | 전체 테스트+DB 하니스 그린, hosted Supabase 제출 경로 E2E 통과 | 완료 (프로덕션 E2E 8단계 검증, 커밋 예정) | 2026-07-12 |

알려진 한계: 무료 티어 기본 SMTP로는 OTP 코드 메일 템플릿 수정 불가 → 커스텀 SMTP(Resend 등) 연결 필요. 사용자 결정 대기.

## 2026-07-13 Slice 5A (동의 클레임·승인·발행 백엔드 — Advisor 단독)

| Session | Owned paths                                     | Dependency | Acceptance criteria                                                     | Status                  | Updated    |
| ------- | ----------------------------------------------- | ---------- | ----------------------------------------------------------------------- | ----------------------- | ---------- |
| Advisor | `supabase/migrations/0005`, `supabase/tests/05` | Slice 4    | 로컬 하니스 5/5 + 프로덕션 Flow A→B E2E 7단계 통과, campaigns.slug 도입 | 완료 (0005 원격 배포됨) | 2026-07-13 |

## 2026-07-13 Slice 5B-1 (웹 /consent/[token] 동의·발행 플로우 — Advisor 단독)

| Session | Owned paths                                                                          | Dependency | Acceptance criteria                                                                                                           | Status                                     | Updated    |
| ------- | ------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| Advisor | `packages/data`(consentRepo·web client), `apps/web/app/consent/**`, `apps/web/tests` | Slice 5A   | anon preview → 매직링크 로그인 → claim → 음성 검토 → approve → `/p/[slug]` 리다이렉트, Playwright 10/10 + 프로덕션 E2E 12단계 | 완료 (프로덕션 E2E 12/12, Playwright 그린) | 2026-07-13 |

## 2026-07-13 Slice 5B-2 (/p/[slug] 실데이터화 — Advisor 단독)

| Session | Owned paths                                                                                               | Dependency | Acceptance criteria                                                                                                       | Status                                       | Updated    |
| ------- | --------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------- |
| Advisor | `packages/data`(publishedPitchRepo·campaigns 타입), `apps/web/src/pitch`, `apps/web/app/p`, `PitchPlayer` | Slice 5B-1 | 서버 컴포넌트가 service role로 published 캠페인 조회 + 음성 signed URL 실재생, fixture fallback 유지, 프로덕션 E2E 14단계 | 완료 (E2E 14/14 + 실캠페인 렌더 스크린샷 QA) | 2026-07-13 |

## 2026-07-13 Slice 6~12 (코어 루프 완성 — Advisor 단독, goal 지시로 연속 진행)

| Session | Owned paths                                                                                          | Dependency | Acceptance criteria                                           | Status                                                    | Updated    |
| ------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| Advisor | 6A/6B: `apps/mobile`(사진 업로드·share), `pitch_assets` 소비부                                       | 5B         | 사진 업로드+자산 등록, 동의·공개 페이지 사진 렌더, E2E 15     | 완료 (`52e00c9`)                                          | 2026-07-13 |
| Advisor | 7: `supabase/migrations/0006`, `interestRepo`, `/p/[slug]/interest`, `/inbox`                        | 6          | 프로필 게이트 제출·인박스·accept/decline, DB 6/6, E2E 23      | 완료 (`dd5f072`)                                          | 2026-07-13 |
| Advisor | 8: `0007`, `introRoomRepo`, `/rooms/**`                                                              | 7          | 1:1 채팅+신고·차단·나가기, DB 7/7, E2E 31                     | 완료 (`259eaac`)                                          | 2026-07-13 |
| Advisor | 9: `0008`, inbox 캠페인 관리, `docs/OPS.md`                                                          | 7          | pause/resume/archive RPC 전용화, 운영 런북, E2E 34            | 완료 (`919b0f9`)                                          | 2026-07-13 |
| Advisor | 11: `0009`, `analytics.ts`, 전 표면 이벤트                                                           | —          | track_event 화이트리스트 ingest + 퍼널 이벤트, E2E 35         | 완료 (`7667cad`)                                          | 2026-07-13 |
| Advisor | 12: `openAi.ts` 어댑터, `/api/transcribe`, `0010`(사진 제외·공개 기간), `scripts/e2e-production.mjs` | 6~9        | 실전사 파이프라인(키 게이트 501), 동의 심화, DB 10/10, E2E 39 | 완료 (`5000951`)                                          | 2026-07-13 |
| Advisor | 10: `purchases.ts`, `/paywall`, `/api/revenuecat`, `docs/REVENUECAT_SETUP.md`                        | —          | SDK·페이월·멱등 웹훅·크레딧/엔타이틀먼트, mock 결제 경로 없음 | 코드 완료 (`2eb67e7`) — sandbox 활성화는 사용자 셋업 대기 | 2026-07-13 |
