# Friendword 3차 제품·보안·결제·성장 전수 감사 및 Claude 수정 핸드오프

> 최종 갱신: 2026-07-14 KST  
> 감사 기준: `main` / `0f9311f`  
> 감사 범위: 2차 감사 대응 전체 diff, 기존 제품 계약, DB/RLS/RPC, 외부 AI·비용 통제, RevenueCat, UGC·신원·개인정보, 모바일·웹 핵심 흐름, 디자인·접근성, 성장 루프·Grand Prize 데모, 자동화 테스트  
> 판정: **기능성 내부 베타. 외부 공개, 실결제, Grand Prize 제출 준비 완료가 아니다.**  
> 이 문서는 3차 감사의 correction brief이자 새 acceptance source of truth다. `docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`는 2차 감사 당시의 역사적 기준으로 유지한다. `docs/SESSION_HANDOFF.md`는 Claude 팀이 별도로 수정 중이므로 이 감사에서는 수정하지 않았다.

## 0. Claude Advisor가 가장 먼저 지켜야 할 것

1. **Green test를 완료 증거로 간주하지 않는다.** 이번 감사에서 unit, DB, audit, Playwright가 전부 통과했지만 일반 인증 사용자의 비용 cap 조작, AI 사전 동의 위반, Dater moderation 우회, public gate 무력화가 남아 있었다.
2. `docs/SESSION_HANDOFF.md:20`의 “실결제·외부 공개 서버 차단 유지”는 현재 사실이 아니다. `real_payments_enabled=off`는 결제를 막지만 `public_beta_enabled=off`는 관심 제출만 막고 publish와 public read는 허용한다.
3. 외부 키·벤더가 없다는 이유로 코드 결함을 사용자 게이트로 분류하지 않는다. provider RPC 권한, 동의 순서, Dater validation, read RPC account guard, storage DELETE policy, Campaign Pass 상태 기계는 모두 코드·schema 결함이다.
4. Worker 완료 보고를 그대로 승인하지 않는다. Advisor가 관련 migration의 최종 재정의와 모든 call site를 읽고 diff·테스트·manual QA를 직접 확인한다.
5. 새 DB 변경은 migration 하나로 끝나지 않는다. direct RPC 우회, RLS, concurrency, retry, failure accounting, 실제 UI 소비자를 모두 검증하는 회귀 테스트가 필요하다.
6. 수정과 같은 turn에서 `README.md`, `docs/PRODUCT.md`, `docs/COST_MODEL.md`, `docs/ANALYTICS_PLAN.md`, `docs/OPS.md`, `docs/REVENUECAT_SETUP.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/SESSION_HANDOFF.md`를 truth reset한다.
7. 이번 문서의 P0는 “더 좋으면 좋은 기능”이 아니다. 외부 공개·실결제 전 필수다. Grand Prize P0는 보안 출시 P0와 별도로 표시한다.
8. 소스 수정 전 Slice와 owned path를 `docs/TASKS.md`에 기록한다. 동일 migration·route·핵심 UI를 여러 Worker에게 동시에 맡기지 않는다.

## 1. 냉정한 최종 판정

2차 감사 이후 실제 개선된 부분은 분명하다.

- 익명 신고의 동일 reporter dedupe와 distinct identity 집계
- pitch 초기 문구, interest bio/note moderation ledger
- RevenueCat event type 분기, transaction lineage, review queue, 앱 auth identity 동기화
- Creator Launch·Campaign Pass의 순차 중복 결제 방어와 모바일 Campaign Pass 진입
- email invite contact binding의 서버 invariant
- typed identity evidence 골격과 승인 primary photo face binding
- provider usage ledger, kill switch, 월 cap이라는 기본 골격
- Dater의 headline/body, 사진 subset, location visibility, audience, 7/14일 통제 UI
- 공개 pitch의 실제 audio URL, body, transcript, segment 기반 caption, 브라우저 audio waveform
- fake play/timer 제거, 영어 기본 locale, contextual mobile sections, 서버 outcome analytics trigger
- 전역 reduced-motion과 chat log semantics

하지만 현재 제품은 네 가지 핵심 축에서 여전히 출시 계약을 충족하지 않는다.

1. **보안·비용:** 일반 인증 사용자가 비용 reservation/reconciliation RPC를 직접 조작할 수 있고, replay와 동시 요청이 provider 비용을 중복 발생시킬 수 있다.
2. **동의·안전:** 사진이 외부 OpenAI moderation에 전송된 뒤에 AI 동의를 기록한다. Dater 수정 문구·사진과 chat message는 authoritative moderation을 우회한다.
3. **공개·결제 상태 기계:** public beta off가 공개 페이지를 막지 않으며, Campaign Pass 만료 후 재구매와 restore 계약이 상태 기계와 충돌한다.
4. **Grand Prize 제품성:** Introducer의 무료 live pitch 공유 경로, 공개 pitch에서 새 Introducer로 이어지는 획득 경로, 진짜 음성 데모, 방어 가능한 referral/K-factor가 없다.

정확한 상태는 다음과 같다.

> 데이터 모델과 화면의 개수는 많아졌고 핵심 happy path의 모양도 갖춰졌다. 그러나 공격·실패·우회 경로에서 비용과 동의의 서버 invariant가 성립하지 않고, 제품의 성장 엔진인 “친구 음성 → Dater 승인 → 무료 공유 → 새 캠페인”이 실제 사용자 경로로 연결되지 않는다. 내부 시연용 기능성 베타이지 외부 사용자와 돈을 받을 수 있는 제품은 아니다.

### 출시·제출 판정표

| 영역                      | 3차 판정             | 해제 조건                                                         |
| ------------------------- | -------------------- | ----------------------------------------------------------------- |
| Anonymous reporting       | 원 acceptance 해결   | proxy trust·CAPTCHA/IP Sybil은 운영 hardening                     |
| Media/voice enforcement   | 부분 해결·회귀       | manual path 포함 정상 voice와 모든 Dater asset validation         |
| RevenueCat webhook        | 부분 해결            | aliases/transfer resolution, sandbox 실왕복                       |
| RevenueCat app identity   | 코드 해결·실증 미완  | 실제 dev build A→B/restore 검증                                   |
| Creator Launch commerce   | 부분 해결            | concurrency, refund/restore/value contract 확정                   |
| Campaign Pass commerce    | 상태 기계 충돌       | 만료 후 재구매·restore·scheduler-independent semantics            |
| Contact binding           | email MVP 해결       | confirmed email/phone 정책 확정                                   |
| Identity evidence         | 부분 해결            | non-null provider/checked/expiry + real provider                  |
| Provider cost hard cap    | **치명적 미해결**    | RPC service-only, lease/idempotency, conservative cost accounting |
| External AI consent       | **치명적 미해결**    | 모든 외부 전송 이전 consent + revision/scope binding              |
| Dater final control       | 부분 해결·안전 우회  | photo/text validation, real preview, profile/location/intent      |
| Public pitch              | 부분 해결            | 정직한 timing, structure scene, 실제 voice demo                   |
| Public beta gate          | **미해결**           | publish와 public read까지 authoritative 차단                      |
| Account status reads      | 부분 해결·회귀       | 모든 SECURITY DEFINER read RPC active guard                       |
| UGC moderation            | **미해결**           | Dater text/photo + chat authoritative gate                        |
| Growth evidence           | **미신뢰**           | referral chain, 실제 share, net revenue, 정확한 metric naming     |
| Deletion/expiration ops   | 부분 해결            | 실제 scheduler, privacy retention, lifecycle proof                |
| Free Introducer sharing   | **Grand Prize 차단** | live URL·무료 share·attribution·closure                           |
| Acquisition surface       | **Grand Prize 차단** | landing/public pitch → install/web create → publish               |
| Representative demo       | **Grand Prize 차단** | 권리 확보 real voice end-to-end demo                              |
| English-first             | 해결                 | 회귀 유지                                                         |
| Accessibility/Trust Layer | 부분 해결            | trust flow 강도·target·contrast·flow density 개선                 |

## 2. 3차 감사에서 직접 실행한 검증

### 기준과 작업 트리

- 기준 커밋: `0f9311f`
- 2차 감사 기준 이후 변경 규모: 145 files, 약 13,547 additions
- migration: `0001`~`0033`
- 감사 시작 시 clean worktree
- 테스트가 생성한 `apps/web/next-env.d.ts` 변경은 원래 `.next-build` 경로로 복구했다.
- 제품 소스는 수정하지 않았고, 이 3차 감사 문서만 추가했다.

### 통과

- `pnpm lint`
- `pnpm typecheck`
  - 최초 sandbox 실행은 `apps/web/tsconfig.tsbuildinfo` 쓰기 권한 `EPERM`으로 실패했으며, 동일 명령을 권한 허용 후 재실행해 통과했다. 코드·타입 실패가 아니다.
- `pnpm test`
  - domain 13
  - contracts 4
  - ui-tokens 12
  - adapters 8
  - data 47
  - mobile 59
  - 합계 143 tests 통과
- `pnpm format:check`
- `pnpm --filter @friendword/web build`
- `pnpm test:audit`
  - DB audit 7/7
  - RevenueCat web audit 11/11
- `pnpm test:audit2`
  - DB audit2 14/14
  - web audit2 8/8
- `pnpm test:db`
  - 기본 DB suite 전체 통과
- `pnpm --filter @friendword/web test:e2e`
  - Playwright 39/39, 1 worker, 약 1.1분
- 이전 QA 산출물의 landing/pitch/consent desktop·mobile screenshot 4종 시각 검토

### 실패·경고·검증 경계

- `pnpm check:env` 실패: `.env`에 `EXPO_PUBLIC_WEB_ORIGIN`이 없다.
- root `pnpm build` script는 존재하지 않는다. 웹 package의 production build를 별도로 실행했다.
- Next build는 통과했지만 Next.js ESLint plugin 미탐지 경고가 있다.
- in-app browser 실시간 연결은 browser runtime 초기화 오류 `Cannot redefine property: process`로 실패했다. 따라서 live DOM 수동 조작은 이번 run에서 추가 수행하지 못했다. 대신 Playwright 39개와 기존 실제 screenshot을 검토했다.
- RevenueCat sandbox, identity vendor, enforcement-on OpenAI, 실제 iOS device, Resend 도메인, scheduled production job은 이번 감사에서 검증하지 못했다.

### Green test가 놓친 실제 결함

- Dater photo E2E는 `/api/media/validate` 권한을 mock해 실제 403을 가린다.
- `b07_cost_control.sql`은 정상 RPC 사용만 확인하고, 일반 사용자가 임의 estimate로 cap을 소진하거나 reconcile로 해제하는 공격을 검사하지 않는다.
- `b08_ai_processing_consent.sql`은 transcribe/structure reservation을 검사하지만 media validation이 동의 전에 호출되는 client 순서를 검사하지 않는다.
- `b12_text_moderation_gate.sql`은 최초 `consent_pending` 전환을 검사하지만 이미 pending인 Dater revision을 검사하지 않는다.
- `b11_account_read_enforcement.sql`은 direct SELECT만 검사하고 SECURITY DEFINER read RPC를 검사하지 않는다.
- `b06_identity_evidence.sql`은 정상 provider ref/expiry fixture만 넣고 null provider/null expiry가 권한을 얻는지 검사하지 않는다.
- Playwright는 화면 계약과 mock happy path를 검증한다. DB 권한, RevenueCat 실결제, 외부 AI byte transfer 순서, scheduler를 보증하지 않는다.

## 3. 신규·재발견 출시 차단 P0

### P0-NEW-1. Provider 비용 hard cap을 일반 인증 사용자가 공격하거나 무력화할 수 있다

**증거**

- `supabase/migrations/0031_provider_cost_and_ai_consent.sql:98-137`의 `reserve_provider_usage`는 `usage_kind`, `request_ref`, `estimated_cents`를 caller에게 받는다.
- 같은 migration `:226-228`이 이 RPC를 `authenticated`에 직접 grant한다.
- 인증 사용자는 provider 호출 없이 `reserve_provider_usage('media_validate', 'evil', 20000, null)` 같은 direct RPC로 글로벌 $200 cap을 소진시킬 수 있다.
- `estimated_cents=0`도 허용하므로 provider 호출 예약을 비용 없이 만들 수 있다.
- `reconcile_provider_usage`도 `authenticated`에 grant된다(`:230-264`). 사용자가 자기 reservation을 `actual_cents=0`, `released`로 바꿔 cap과 회계를 무력화할 수 있다.
- 기존 `request_ref`는 상태가 `reserved` 또는 `succeeded`여도 같은 id를 반환한다(`:167-184`). media validation route는 반환 상태를 검사하지 않으므로 동일 object POST가 매번 OpenAI를 다시 호출하지만 원장에는 한 행·1 cent만 남을 수 있다.
- transcribe와 text moderation도 동일 request가 동시에 들어오면 각 요청이 `reserved`를 받고 provider를 중복 호출할 수 있다.
- provider 실패 catch가 `actual_cents=0`으로 reconcile한다: `apps/web/app/api/transcribe/route.ts:190-192`, `moderate-text/route.ts:142-149`, `media/validate/route.ts:150-157`. provider가 이미 과금한 timeout/5xx도 cap에서 사라진다.

**영향**

- 한 사용자가 전체 AI 기능을 DoS할 수 있다.
- 반대로 retry/concurrency를 이용해 hard cap보다 많은 실제 비용을 발생시킬 수 있다.
- 상헌 님의 핵심 요구인 “사용자가 앱을 써도 무제한 손실이 발생하지 않아야 한다”는 invariant가 성립하지 않는다.

**결정**

1. reserve/reconcile RPC는 service role 전용으로 바꾼다. 일반 client에 EXECUTE를 주지 않는다.
2. API route가 server-side allowlist로 operation, authoritative user, scope, estimate를 결정한다. client가 cents와 status를 고르지 못한다.
3. `request_ref`마다 atomic lease/owner/attempt state를 둔다. 하나의 active attempt만 provider를 호출할 수 있어야 한다.
4. `succeeded` replay는 저장된 결과를 반환하거나 409로 끝내고 provider를 재호출하지 않는다.
5. failed/timeout 비용은 0으로 확정하지 않는다. provider usage를 확인할 수 없으면 estimate 또는 보수적 최대치를 cap에 유지한다.
6. monthly cap, per-user quota, per-object rate, concurrency를 모두 DB transaction에서 강제한다.
7. cap 집계와 재무 원장은 분리하더라도 둘 다 audit 가능해야 한다.

**Acceptance**

- authenticated direct RPC는 reserve/reconcile 모두 permission denied다.
- client가 임의 estimate/status/user/request_ref로 cap을 소진·해제할 수 없다.
- 동일 request 10개 동시 호출에서 provider adapter call은 정확히 1회다.
- succeeded replay, failed retry, timeout retry, process crash 후 stale lease 회수 테스트가 있다.
- provider timeout 이후 cap에는 최소 estimate가 남는다.
- cap 직전 concurrency에서도 총 reserved+charged가 cap을 넘지 않는다.
- kill switch on이면 모든 provider route가 byte transfer 전에 fail-closed한다.

### P0-NEW-2. 외부 AI 동의보다 먼저 사진을 OpenAI로 전송한다

**증거**

- `preparePitchReview`는 먼저 `service.prepareForReview()`를 호출한다: `apps/mobile/src/features/pitch/preparePitchReview.ts:55-67`.
- `HybridPitchDraftService.prepareForReview()`는 draft를 만들고 voice/photos를 upload한다: `apps/mobile/src/services/pitchDraftsSupabase.ts:158-184`.
- 각 upload는 즉시 `requestMediaValidation()`을 호출한다: 같은 파일 `:256-278`.
- `/api/media/validate`는 image를 OpenAI moderation에 전달한다: `apps/web/app/api/media/validate/route.ts:124-157`.
- AI consent 기록은 upload/validation이 끝난 뒤 `preparePitchReview.ts:66-72`에서 이뤄진다.
- DB consent gate는 `usage_kind IN ('transcribe', 'structure')`에만 적용되고 `media_validate`, `moderate_text`는 제외한다: migration 0031 `:147-165`.
- Dater가 추가하는 pitch photo와 Interested profile photo에도 해당 외부 provider에 대한 별도 affirmative consent가 없다.
- `record_ai_processing_consent`는 임의 non-empty revision 문자열을 허용하고, reservation은 현재 disclosure revision이 아니라 “해당 draft의 아무 consent row”만 확인한다.

**영향**

- UI가 “계속하면 전송된다”고 설명하지만 실제로는 동의 전에 전송된다.
- privacy disclosure와 서버 동작이 반대다.
- disclosure가 변경되어도 과거 임의 revision consent가 영구적으로 새 처리까지 허용한다.

**결정**

1. affirmative consent를 draft 생성·external validation·transcription보다 먼저 받는다.
2. upload 자체가 Supabase까지만 가는지, 외부 AI까지 가는지 UI에서 구분한다.
3. server가 허용하는 current disclosure revision을 app config 또는 versioned table로 관리한다. client 임의 문자열을 승인하지 않는다.
4. consent를 provider, purpose, media scope, disclosure revision에 bind한다.
5. manual/no-AI 경로에서는 외부 AI에 photo/audio/text를 한 byte도 보내지 않는다.
6. Dater·Interested photo moderation에 외부 AI를 쓰면 각 사용자에게 실제 전송 전에 동의를 받거나, AI를 쓰지 않는 local/managed safety path를 결정한다.

**Acceptance**

- 동의 전에는 provider adapter spy call 0회다.
- 거절 또는 `write_manually` 선택 후에도 image/text/audio 외부 call 0회다.
- 구 disclosure revision은 새 current revision을 충족하지 못한다.
- 임의 revision 문자열 direct RPC는 거부된다.
- Introducer, Dater, Interested 각 media 경로에 동의·거절·재동의 테스트가 있다.
- 네트워크 로그 또는 provider mock으로 “consent timestamp < first external request timestamp”를 증명한다.

### P0-NEW-3. Dater photo UI는 실패하고, direct path는 미검수 photo/text를 publish할 수 있다

**증거: 정상 UI 실패**

- ConsentFlow는 Dater upload 후 `/api/media/validate`를 호출한다: `apps/web/app/consent/[token]/ConsentFlow.tsx:431-500`.
- storage policy와 `uploadDaterPhoto`는 subject/Dater upload를 허용한다.
- 그러나 media route의 `pitch-media` 권한은 `pitch_drafts.created_by_user_id === callerId`만 허용한다: `apps/web/app/api/media/validate/route.ts:89-97`.
- Dater는 `subject_user_id`이므로 정상 업로드 뒤 validation에서 항상 403이다. E2E는 route를 mock해 이를 놓쳤다.

**증거: direct 우회**

- `create_dater_revision`은 asset이 draft 소속인지 확인할 뿐 `media_validations`의 structural/moderation pass를 요구하지 않는다: migration 0032 `:158-220`.
- `approve_and_publish_pitch`도 포함 photo인지 확인하지만 validation pass를 검사하지 않는다: 같은 migration `:350-400`.
- Dater가 직접 repo/RPC를 호출하면 unmoderated photo를 revision에 넣고 publish할 수 있다.
- Dater headline/body edit은 새 revision을 만들지만 text moderation을 요구하지 않는다.
- migration 0026 moderation trigger는 status가 처음 `consent_pending`으로 바뀔 때만 검사한다. 이미 pending 상태의 Dater edit에는 실행되지 않는다.
- `/api/moderate-text`의 `pitch_content`는 Introducer owner만 허용하고 draft의 현재 text만 읽는다. Dater revision text를 검수할 수 없다.
- Dater revision은 이전 `structure`와 `hard_claims_requiring_confirmation`를 그대로 복사한다. 새 사실 주장을 추가해도 확인 목록은 갱신되지 않는다.
- approval은 approved revision transcript를 `pitch_drafts.transcript`로 복사하지 않으며 public reader는 draft transcript를 읽는다. 승인 snapshot을 끝까지 소비한다는 invariant가 불완전하다.

**영향**

- 약속한 “Dater가 사진을 교체한다”는 대표 기능이 운영 경로에서 동작하지 않는다.
- UI를 우회하면 Dater가 미검수 이미지와 문구를 공개할 수 있다.
- hard claim confirmation과 immutable consent snapshot의 신뢰성이 깨진다.

**결정**

1. Dater를 명시적 authorized validator로 인정하되, draft subject membership·status·object path를 서버에서 검증한다.
2. Dater asset upload/register/validate/revision/approve를 하나의 명확한 state machine으로 만든다.
3. publish는 approved revision에 포함된 모든 photo의 structural+moderation pass를 authoritative DB trigger/RPC에서 요구한다.
4. Dater revision text는 content-addressed moderation verdict를 요구한다.
5. Dater edit 후 structure/hard claims를 재추출하거나, Dater가 직접 추가한 claim을 별도 확인 대상으로 계산한다.
6. public read는 approved revision snapshot의 headline/body/transcript/preferences/assets를 직접 소비하거나 approval 때 모두 atomic copy한다.

**Acceptance**

- 실제 Dater auth로 upload→validate→revision→reload→publish가 mock 없이 통과한다.
- Introducer도 Dater도 타 draft/object를 검수할 수 없다.
- direct RPC로 unvalidated/flagged/missing validation photo를 publish하지 못한다.
- Dater가 수정한 unsafe text는 revision 또는 publish에서 차단된다.
- Dater가 새 hard claim을 넣으면 새 확인 항목이 생성된다.
- stale revision, deleted asset, moderation timeout, concurrent revision 테스트가 있다.

### P0-NEW-4. `public_beta_enabled=off`가 외부 공개를 막지 않는다

**증거**

- migration 0023의 public beta trigger는 `interests` INSERT에만 붙어 있다: `supabase/migrations/0023_launch_gates.sql:91-113`.
- Dater approve/publish, campaign public read, public pitch view/report에는 gate가 없다.
- `getPublishedPitchBySlug`는 service client로 `status='published'`와 `ends_at`만 확인한다: `packages/data/src/publishedPitchRepo.ts:56-76`.
- 따라서 identity/media enforcement off 상태에서도 campaign은 publish되고 인터넷에 공개될 수 있다.
- `docs/SESSION_HANDOFF.md:20`과 `docs/TASKS.md:13`의 “외부 공개 서버 차단” 주장은 실제 코드와 다르다.

**결정**

- public beta off의 의미를 먼저 확정한다.
- 현재 문서 계약처럼 “외부 공개 차단”이면 initial publish/resume와 public reader 모두 server-side gate를 확인해야 한다.
- 내부 QA는 service-role bypass를 암묵적으로 쓰지 말고 명시적 QA allowlist 또는 signed preview surface를 사용한다.
- 이미 published row가 있어도 gate off 시 public route는 404/closed page를 반환한다.

**Acceptance**

- gate off에서 direct RPC approve/publish 또는 campaign published transition이 차단된다.
- gate off에서 기존 published slug public read가 차단된다.
- gate on에서만 normal public flow가 열린다.
- gate toggle race, pause/resume, internal preview, service-role misuse 테스트가 있다.

### GP-P0-1. Introducer가 무료로 live pitch를 공유하는 성장 루프가 끊겨 있다

**제품 계약**

- Free Starter는 share→interest→connection 전체 루프를 제공한다.
- 실제 소셜 공유 주체는 친구를 소개한 Introducer다.
- Creator Launch $4.99는 무료 공유를 여는 paywall이 아니라 premium social asset 상품이다.

**현재 구현**

- 게시 후 모바일 Introducer campaign card에는 `Open Creator Kit`만 있다: `apps/mobile/app/campaigns/index.tsx:249-259`.
- `apps/mobile/app/pitch/share.tsx:256-319`도 유료 Creator Launch/Creator Kit만 제공하고 무료 public campaign URL 공유가 없다.
- mobile draft/recovery type에 campaign slug가 없다: `apps/mobile/src/services/types.ts:48-57`, `pitchDraftsSupabase.ts:353-368`.
- campaign slug를 반환하는 `listMyOwnedCampaigns()`는 Dater-owned campaign용이다.
- Introducer는 publish 완료 알림, live URL, view/interest outcome, thank-you를 받지 못한다.

**영향**

- 핵심 viral actor가 공유할 수 없다.
- Free Starter가 사실상 Creator Launch 구매 전에는 완결되지 않은 것처럼 보인다.
- Creator Launch 가격 실험도 무료 baseline이 없어 의미가 왜곡된다.

**Acceptance**

- Dater publish 시 Introducer가 알림과 live URL을 받는다.
- Introducer mobile card에 `View live pitch`, native `Share`, copy link가 무료로 보인다.
- share link에는 campaign/referral attribution이 유지된다.
- Creator Launch는 motion/static premium asset과 captions의 선택적 구매로만 노출된다.
- 무료 share→view→interest→accepted→room까지 E2E가 있다.

### GP-P0-2. 공개 유입을 새 사용자·새 캠페인으로 바꾸는 surface가 없다

**증거**

- landing은 App Store `Coming soon`과 demo만 제공하고 waitlist, TestFlight, web creation, QR, universal/deep link가 없다: `apps/web/app/page.tsx:171-196`.
- public pitch footer는 landing anchor로 이동할 뿐 설치·가입·새 pitch 생성으로 이어지지 않는다: `apps/web/app/p/[campaignSlug]/page.tsx:204-212`.
- public view의 source가 mobile signup과 새 campaign publish까지 이어지는 durable referral chain이 없다.
- `docs/GROWTH_EVIDENCE.md`는 현재 users/campaigns/revenue 0을 명시한다.

**영향**

- traction을 만들기 위해 공유해도 신규 Introducer로 전환되지 않는다.
- Grand Prize가 보는 실제 성장 모멘텀을 제품이 수집할 수 없다.

**Acceptance**

- public pitch에서 `Pitch a friend`가 실제 배포 surface(TestFlight/App Store 또는 web creation)로 이어진다.
- referral id가 landing→install/login→draft→publish까지 서버에 보존된다.
- source campaign과 new campaign의 연결을 DB가 authoritative하게 기록한다.
- waitlist만 출시한다면 K-factor를 주장하지 않고 waitlist conversion 지표로 명확히 낮춘다.

### GP-P0-3. 대표 데모가 핵심 차별점을 체험시키지 못하고 미구현 정보를 보여준다

**해결된 부분**

- Blair demo의 fake play/timer는 제거됐다.
- landing은 demo에 voice recording이 없다고 정직하게 표시한다.

**남은 문제**

- “Start with a friend’s voice” 직후의 대표 demo에는 실제 음성이 없다. 핵심 차별점이 정적 텍스트로만 보인다.
- Blair fixture는 age 29와 `+2 friends vouch`를 표시하지만 실제 변환은 `age:null`, `vouches:[]`다: `apps/web/src/fixtures/pitch.ts`, `apps/web/src/pitch/view.ts:126-142`.
- Flow D는 P1 미구현인데 E2E가 demo의 `+2 friends vouch`를 정답으로 고정한다.
- demo interest CTA는 `This one’s just a demo`에서 끝나 interest→inbox→room을 심사자가 경험할 수 없다.

**Acceptance**

- 권리 확보된 실제 seed voice, transcript, structure, waveform, caption, photo scene을 대표 demo에 사용한다.
- 실제 제품이 만들지 못하는 age/vouch 표시는 제거하거나 실제 구현한다.
- judge-safe seeded flow로 interest→Dater inbox→accept→Intro Room을 시연할 수 있다.
- demo 데이터임을 명시하되 기능은 production path와 같은 renderer/state machine을 사용한다.

## 4. 2차 감사 항목별 재판정

### P0-1 Anonymous reporting — RESOLVED, 운영 hardening 잔존

- 동일 anonymous identity+target+reason dedupe와 distinct reporter 집계가 적용됐다.
- 원 감사 acceptance는 충족한다.
- 잔여 위험: rightmost `x-forwarded-for`가 trusted proxy append를 전제한다. 배포 플랫폼의 header overwrite/append 계약을 확인해야 한다.
- VPN/IP Sybil, CAPTCHA/device reputation, ops false-positive review는 외부 beta hardening으로 남는다.

### P0-2 Media/voice enforcement — PARTIAL/REGRESSION

- AI generated path는 transcript moderation으로 voice validation을 `passed`로 올린다.
- 그러나 `Write it myself`는 transcription/voice moderation을 하지 않는다. enforcement on이면 필수 voice가 `skipped`라 정상 manual submission이 막힌다.
- Dater photo 정상 UI 실패와 direct publish 우회는 P0-NEW-3에 상세히 기록했다.
- manual path도 structural audio validation을 유지하면서 no-AI 약속과 enforcement를 동시에 만족하도록 별도 정책이 필요하다.

### P0-3 RevenueCat webhook — PARTIAL

- event-aware schema, transaction lineage, durable review queue, non-terminal error 처리는 개선됐다.
- aliases를 parse하지만 SQL benefit owner resolution에 실제 사용하지 않는다.
- TRANSFER는 review queue에 적재할 뿐 ownership을 해결하지 않는다.
- review item을 안전하게 resolve하는 RPC/admin tool과 concrete runbook이 없다.
- 공식 payload 기반 sandbox purchase→restore→refund→transfer 증거가 없다.

### P0-4 RevenueCat app identity — CODE RESOLVED / RUNTIME UNVERIFIED

- cold start, auth event, `Purchases.logIn`, `logOut`, 구매·restore 전 identity sync가 구현됐다.
- 단위 테스트 6개는 통과했다.
- 실제 dev build에서 anonymous→login, A→B, logout, restore와 webhook user resolution은 미검증이다.

### P0-5 Creator Launch paid value — PARTIAL

- available credit 또는 unlocked kit 재진입과 순차 중복 구매 guard는 개선됐다.
- `issue_purchase_intent`의 check-then-insert에는 advisory lock 또는 partial unique constraint가 없어 concurrent double tap이 sibling intent를 만들 수 있다: migration 0028 `:90-106`.
- refund는 available/reserved credit은 revoke하지만 consumed credit으로 이미 생성된 kit 접근·산출물의 계약은 불명확하다.
- Creator Launch 구매는 publish 후만 가능해 원 handoff의 “private draft에서 reserve” 계약과 달라졌지만, 현재 구조가 더 안전하다면 canonical contract를 명시적으로 바꿔야 한다.

### P0-6 Campaign Pass — PARTIAL / STATE MACHINE CONTRADICTION

- Dater-owned campaign entry와 active pass 중복 방지는 구현됐다.
- 문서는 pass lapse 후 재구매를 허용한다고 설명하지만, 만료 job은 campaign을 `expired`로 만들고 intent는 `status='published'`를 요구한다.
- expired→published resume는 금지되어 정상 만료 뒤 재구매로 되살릴 수 없다.
- scheduler가 늦으면 ends_at이 지난 published campaign에만 구매가 가능해 운영 timing에 따라 결과가 달라진다.
- restore flow는 restore 전에 새 purchase intent를 발급한다. 이미 active benefit이 있으면 intent 발급 단계에서 restore가 막힐 수 있다.
- “30일 추가”가 현재 ends_at 뒤 30일인지 구매 시점부터 30일인지 product copy와 DB를 하나로 확정해야 한다.

### P0-7 Invite contact binding — RESOLVED for email MVP

- 신규 claimable request의 channel/hash trigger, claim fail-closed, direct null RPC 방어가 구현됐다.
- phone invite는 미구현이다.
- auth email의 confirmed 상태를 claim 시 명시적으로 확인하는 정책은 재검토한다.

### P0-8 Identity/18+/face — PARTIAL

- typed evidence, adult/liveness, primary approved photo face binding 골격은 개선됐다.
- `provider_ref`, `checked_at`, `expires_at` column이 nullable다.
- `expires_at IS NULL`을 영구 유효로 인정한다: migration 0030 `:30-44`, `:112-120`.
- authorization은 provider_ref와 checked_at 존재를 요구하지 않는다.
- 실제 adapter는 `UnconfiguredIdentityVerificationProvider`이고 real sandbox가 없다.
- audience age filter는 Interested user의 self-declared `profiles.birth_date`에 의존한다. identity evidence는 18+만 보증하므로 정확한 age range filter는 우회 가능하다.

### P0-9 Provider cost cap — UNRESOLVED/CRITICAL

- ledger/cap/kill-switch 골격은 추가됐지만 P0-NEW-1 때문에 hard cap이라고 부를 수 없다.
- `docs/COST_MODEL.md`와 `SESSION_HANDOFF`의 완료 표현을 즉시 낮춰야 한다.

### P0-10 External AI consent — UNRESOLVED/CRITICAL

- disclosure UI와 consent table은 생겼지만 P0-NEW-2 때문에 실제 처리 순서는 사전 동의가 아니다.
- disclosure revision binding도 서버 invariant가 아니다.

## 5. High — 보안·개인정보·운영

### H-1. Suspended/deleted 사용자가 SECURITY DEFINER read RPC로 private data를 읽을 수 있다

- direct table SELECT RLS는 개선됐다.
- 그러나 `list_campaign_interests`(migration 0006), `list_my_intro_rooms`(0007), `get_campaign_pass_state`(0020) 같은 SECURITY DEFINER read RPC에 `private.assert_active_account`가 없다.
- `b11_account_read_enforcement.sql`은 direct SELECT만 검사한다.

**Acceptance**

- 모든 authenticated SECURITY DEFINER RPC를 inventory한다.
- private data를 읽거나 상태를 바꾸는 RPC는 active account/deletion guard를 공통 적용한다.
- active/suspended/deleted/deletion queued 각각 direct SELECT와 RPC 테스트를 둔다.

### H-2. Account deletion은 FK 순서는 해결됐지만 실제 운영·보존 정책은 미완성이다

- share_kits→credit ledger 삭제 순서는 수정됐다.
- 실제 production scheduler는 연결되지 않았고 command만 있다.
- 삭제 Introducer가 녹음한 voice/draft를 Dater-owned published campaign에 계속 보존·재귀속할지 정책이 필요하다.
- `purchase_event_reviews` payload의 PII scrub과 법적 보존 기간도 명시되지 않았다.

### H-3. Chat message proactive moderation이 없다

- `packages/data/src/introRoomRepo.ts`는 message body length만 검사한다.
- DB는 rate limit·participant guard와 reactive report를 제공한다.
- migration 0016 comment도 chat moderation이 fail-open이고 report가 enforcement path임을 명시한다.
- 2차 감사 H-3이 요구한 chat message moderation은 해결되지 않았다.

**결정**

- pre-send moderation, async quarantine, reactive-only 중 launch policy를 명시한다.
- pre-send 외부 AI를 쓰면 양쪽 사용자의 AI disclosure/consent와 cost quota를 함께 해결한다.
- 최소한 high-risk content detection, report/block, rate limit, moderator review SLA를 문서화한다.

### H-4. Raw consent token과 local media lifecycle이 불완전하다

- raw `consentToken`이 일반 AsyncStorage draft에 남는다: `apps/mobile/src/services/pitchDrafts.ts:140-160`.
- share screen은 raw contact만 purge한다.
- claim/decline/publish/expiry/account switch 후 token, local photo URI, voice URI를 purge하는 일관된 API가 없다.

### H-5. Interested photo upload rollback과 remove가 storage orphan을 남긴다

- upload cap, remove UI, batch rollback 코드는 추가됐다.
- storage.objects에는 client DELETE policy가 없어 `.remove()` rollback이 RLS로 실패할 수 있다.
- UI Remove는 local state/blob URL만 제거하고 storage object를 삭제하지 않는다.
- orphan cleanup job은 구현됐지만 actual scheduler가 없다.

### H-6. Expiration은 DB 함수가 생겼지만 production automation과 Pass 의미가 미완성이다

- expiration function, expired event, resume guard는 개선됐다.
- scheduler가 실제 배포에 연결되지 않았다.
- scheduler 실행 전/후에 Campaign Pass purchase 가능 여부가 달라지는 상태 기계 충돌을 해결해야 한다.

### H-7. 무료 활성 캠페인 1개 제한이 문서에만 있다

- `FRIENDWORD_HANDOFF.md:627`, `docs/COST_MODEL.md:93`은 verified Dater당 무료 활성 campaign 1개를 명시한다.
- migration과 RPC에는 이 수량을 강제하는 guard/constraint가 없다.
- 한 사용자가 여러 무료 campaign을 publish할 수 있어 운영비와 유료 전환 계약이 달라진다.

**Acceptance**

- “동시 활성 1개”의 active status 범위를 정의한다.
- transaction/advisory lock으로 concurrent publish도 1개만 성공한다.
- paid pass가 수량을 늘리는 상품이 아니라면 pass 유무와 무관하게 계약을 명확히 한다.

## 6. Growth evidence와 Grand Prize 신뢰성

### H-8. `k_factor_estimate`는 K-factor가 아니다

- `docs/ANALYTICS_PLAN.md:62`는 attributed view에서 시작한 새 published campaign ÷ source campaign을 K-factor로 정의한다.
- 실제 exporter는 `campaign_shared / published_campaigns`를 `k_factor_estimate`로 출력한다: `scripts/export-growth-evidence.mjs:79-112`.
- `campaign_shared`는 실제 native share completion이 아니라 Creator Kit의 card download/caption copy에서 기록된다.
- 진짜 source campaign→new user→new campaign 관계가 DB에 없다.

**결정**

- 현재 값은 `share_proxy_events_per_published_campaign`으로 재명명한다.
- 진짜 K를 주장하려면 stable referral id와 new campaign publish linkage를 구현한다.
- share intent, native share sheet open, confirmed share는 구분하고 플랫폼이 confirm을 제공하지 않으면 정직하게 proxy라 표시한다.

### H-9. Analytics exporter가 server-authoritative outcome만 세지 않는다

- `countEvents()`는 `recorded_by='server'`를 filter하지 않는다.
- authenticated client는 존재하는 임의 campaign에 `campaign_shared`를 기록할 수 있다.
- anonymous view/start도 임의 existing campaign에 spam 가능하다.
- `purchase_events` 전체 count는 refund/lifecycle/duplicate를 포함할 수 있다.
- RevenueCat webhook purchase insert와 benefit analytics trigger가 한 구매를 두 행으로 기록할 가능성이 있다.
- active_users는 verified/engaged user가 아니고, published_campaigns는 현재 status만 세므로 cohort/기간 비교가 왜곡된다.

**Acceptance**

- 모든 지표에 기간, UTC timezone, cohort, dedupe key, source of truth를 명시한다.
- net paid transactions와 refund를 transaction lineage로 계산한다.
- server outcomes는 `recorded_by='server'`와 resource uniqueness로 집계한다.
- public/client interaction은 방어 수준과 한계를 결과 JSON에 함께 출력한다.
- fabricated event가 headline metric을 바꾸지 못하는 회귀 테스트가 있다.

## 7. 전체 제품 기획 대비 추가 감사

### CP-1. Dater final control — PARTIAL

**구현된 것**

- headline/body 수정
- 기존 photo include/exclude와 Dater photo upload UI
- 7/14일 선택
- location visibility와 age/intent audience filter
- hard claim 확인

**부족하거나 잘못된 것**

- Dater photo는 실제 API 권한 충돌로 실패하고 direct path는 validation을 우회한다.
- consent의 `This is how your page will look`은 이름·위치 label·기간·사진 수 요약이지 실제 9:16 page preview가 아니다.
- cover/대표 photo, photo 순서, OG preview를 통제할 수 없다.
- Dater는 voice를 듣고 changes request만 할 수 있고 trim/segment exclude는 못 한다. 그런데 public trust copy는 recording을 포함해 “could edit any of it”이라고 읽힐 수 있다.
- Dater consent에서 본인의 birth date/age, approximate location, dating intent를 입력·확정하지 않는다.
- real pitch 변환은 `age:null`이다.
- `location_precision='region'`과 `'city'`가 같은 raw `approximate_location`을 반환한다. hidden만 다르다: `publishedPitchRepo.ts:160-169`.
- `Who can see this`와 landing의 “decide who can see it”은 부정확하다. public pitch는 누구나 보고, 설정은 누가 관심을 제출할 수 있는지만 제한한다.

**Acceptance**

- Dater가 실제 output snapshot에서 cover/order/copy/location/age/intent/audience/audio를 검토한다.
- region은 city를 제거한 canonical region으로 변환된다.
- copy를 `Who can reach out`로 수정한다.
- recording edit을 제공하지 않으면 trust copy도 정확히 낮춘다.

### CP-2. Voice → structured pitch — PARTIAL

**구현된 것**

- real audio URL
- transcript/segments/body/full transcript
- browser-decoded audio waveform
- segment 기반 caption

**부족한 것**

- word highlight는 실제 word timestamp가 아니라 segment duration을 단어 수로 균등 분할한 추정치다: `PitchPlayer.tsx:147-153`.
- segment가 없으면 headline과 극단적인 fallback timestamp를 사용한다.
- waveform fetch/decode 실패 시 고정 placeholder가 조용히 남는다.
- `relationship_context`, `qualities`, `anecdote`, `good_match_for` 구조 필드는 scene 구성에 쓰이지 않고 generic body+transcript만 표시된다.
- photo scene timing은 실제 audio duration/content가 아니라 60초 균등 분배다.
- “구조화된 친구 음성”보다 일반 audio slideshow에 가깝다.

**Acceptance**

- 실제 word timing이 없으면 segment-level caption이라고 정직하게 구현한다.
- structured JSON을 hook/quality/anecdote/good match scene에 매핑한다.
- actual audio duration과 segment timing으로 scene을 전환한다.
- waveform 실패 상태를 접근 가능하게 표시하고 fake signal을 사용하지 않는다.

### CP-3. Fake playback 제거 — RESOLVED, representative demo는 GP-P0

- fake timer/play 문제는 해결됐다.
- 그러나 실제 음성 없는 대표 demo는 Grand Prize 관점에서 여전히 미해결이다.

### CP-4. English-first — RESOLVED

- root `lang="en"`, landing, OG, core user-facing copy가 영어 기본이다.
- Playwright가 user-facing Korean 0을 검증한다.
- screenshot file picker의 한국어는 macOS locale이며 제품 결함이 아니다.

### CP-5. Creator Launch $4.99 — PARTIAL / CONTRACT RESET REQUIRED

- 현재 구현은 static 9:16 PNG 1개와 caption 3개다.
- 현재 paywall과 kit copy는 그 범위를 비교적 정직하게 설명한다.
- 원 계약의 premium motion theme, AI composition, MP4, end-card customization, one regeneration은 없다.
- kit waveform은 실제 voice-derived waveform이 아니라 decoration이다.
- 별도 social composition은 Dater에게 다시 preview/승인되지 않는다.

**결정 필요**

- 해커톤 MVP 상품을 static kit로 공식 축소하고 $4.99 지불 의사를 검증하거나,
- $4.99 원 계약을 유지하려면 premium motion/MP4/customization/regeneration을 구현한다.
- 두 계약을 문서마다 다르게 유지하지 않는다.

### CP-6. Campaign Pass $19.99 — PARTIAL / VALUE WEAK

- 현재 가치는 30일과 basic funnel count다.
- 원 계약의 최대 5 vouches, active version/dynamic update, scheduling, enhanced inbox/alerts는 없다.
- audience filter는 무료 Dater consent 기능이 되어 pass value가 아니다.
- mobile `Manage`는 사실상 pass purchase뿐이고 pause/resume/view/inbox/analytics가 web과 mobile에 분산된다.
- 결제 전 analytics teaser가 없다.
- 상태 기계 충돌은 P0-6에 별도 기록했다.

### CP-7. Single User / contextual roles — PARTIAL

- account type을 고정하지 않고 mobile에 `Campaigns about me`, `Pitches I’m making`, `My interests`가 분리된 점은 좋다.
- signed-out return user에게 명확한 sign-in CTA가 없다.
- Dater mobile card에서 view/inbox/pause/resume가 안 되고 Pass만 노출된다.
- accepted interest는 “Open intro rooms on web” 문구만 있고 실제 link가 없다.
- started/verification pending interest에는 continue/withdraw가 없다.
- server draft recovery는 media를 복구하지 못해 original device가 필요하다.

### CP-8. Voice-first 약속과 manual recap 의무가 충돌한다

- Recording step은 30초 voice와 `Text recap for captions`를 둘 다 요구한다.
- 사용자는 말한 내용을 다시 타이핑해야 다음 단계로 간다.
- “Say it once, AI handles the rest”를 훼손하고 가장 큰 초기 이탈점이 된다.

**결정**

- AI path는 transcript에서 recap/caption을 자동 생성하고 선택 수정만 받는다.
- manual/no-AI path에서만 recap을 요구한다.

### CP-9. Dating compatibility model이 부족하다

- audience control은 age+intent뿐이다.
- gender/orientation/“who I want to hear from”가 없다.
- Interested profile도 호환성 preference를 수집하지 않는다.
- 결과적으로 Dater가 원치 않는 관심을 다수 받을 수 있다.

**결정**

- inclusive preference model을 설계하거나 launch cohort를 명시적으로 제한한다.
- 공개 노출과 reach-out eligibility를 구분한다.
- 민감정보 최소 수집과 삭제 정책을 함께 설계한다.

### CP-10. Introducer reward와 closure가 없다

- 익명 introducer profile/ranking을 만들지 않은 결정은 안전 측면에서 타당하다.
- 그러나 게시 후 live URL, views, interests, match outcome, thank-you가 전혀 없어 반복 소개 동기가 약하다.
- global ranking 없이 private impact summary, milestones, Dater thank-you, optional badge로 보상할 수 있다.

## 8. 디자인·UX·접근성 최종 평가

### 잘 반영된 부분

- Gen Z용 Hype Mixtape의 coral/cream/ink, bold typography, sticker/outline language는 landing과 public pitch에서 정체성이 분명하다.
- 영어 기본화와 fake playback 제거로 제품 신뢰도가 올라갔다.
- reduced-motion 전역 처리와 chat `role=log`, block/leave confirmation이 추가됐다.
- core/public surface와 trust surface를 구분하려는 token·component 의도가 보인다.

### 부족한 부분

- consent, interest, report 같은 trust flow에도 thick sticker border, hard shadow, rotated badge, Unbounded가 과도하다. `docs/DESIGN.md`의 Trust Layer 0~20% 원칙보다 실제 강도가 높다.
- consent는 audio, text, photos, audience, claims, summary, approve를 긴 단일 페이지에 몰아 인지 부담이 크다.
- summary는 실제 output preview가 아니라 설정 요약이다.
- report link/submit, quiet action 등 일부 target은 44px 미만 가능성이 있다.
- mobile `TrustCard`의 `textFaint` border는 cream/white 위 3:1 non-text contrast를 충족하지 못할 가능성이 있고 현재 contrast test가 해당 조합을 검사하지 않는다.
- Gen Z 감성 자체는 맞지만, 안전·신원·동의 순간까지 같은 hype 강도를 쓰면 가벼워 보이고 중요한 결정을 놓치게 한다.

**Acceptance**

- trust flow를 단계화하거나 sticky progress/review를 제공한다.
- consent final step에 실제 public output preview를 보여준다.
- 모든 interactive target 44x44, focus visible, keyboard flow, screen reader label을 검사한다.
- Trust Layer token 조합의 WCAG non-text/text contrast를 test matrix에 추가한다.
- landing/public pitch의 활기는 유지하고 consent/report/delete/payment는 shadow/rotation/outline 강도를 더 낮춘다.

## 9. 문서 truth 충돌

다음 완료 주장은 수정 전까지 사용하면 안 된다.

- `SESSION_HANDOFF:20` “실결제·외부 공개 서버 차단 유지”
- `SESSION_HANDOFF:20` “코드·스키마·테스트 게이트는 전부 통과”
- `SESSION_HANDOFF:22` “분석은 server-authoritative”를 전체 funnel에 일반화한 표현
- `PRODUCT.md:3` “Dater는 문구·사진·audience·위치 정밀도·기간을 실제로 통제”
- `TASKS.md:13` “launch gate가 서버에서 강제”
- `COST_MODEL.md`의 one free active campaign이 구현된 것처럼 읽히는 표현
- `ANALYTICS_PLAN.md`의 current source string만으로 새 published campaign까지 연결된다는 표현

추가 불일치:

- `docs/TASKS.md:44`의 오래된 `Slice I-Mobile 진행 중`은 이후 완료 기록과 충돌한다.
- `FRIENDWORD_HANDOFF.md`의 Creator Launch/Campaign Pass 원 계약과 현재 paywall·`PRODUCT.md`의 축소 계약이 다르다.
- `PRODUCT.md:7,30,77`은 motion pitch를 현재 기능처럼 정의하지만 renderer는 structured motion composition보다 audio slideshow에 가깝다.
- landing `decide who can see it`, consent `Who can see this`, public `could edit any of it`은 실제 권한보다 넓게 약속한다.

## 10. 수정 실행 순서

### Slice 0 — 외부 노출 freeze와 truth reset

- `public_beta_enabled=off`를 publish/public read까지 authoritative하게 적용한다.
- real payments off 유지.
- SESSION/TASKS/PRODUCT/COST/ANALYTICS의 완료 주장을 이 문서 판정으로 낮춘다.
- 새 regression을 먼저 red로 만든다.

### Slice 1 — 비용 원장과 외부 AI 사전 동의

- provider reserve/reconcile service-only
- server authoritative estimate/status/user/scope
- lease/idempotency/concurrency/failure accounting
- consent-before-validation/transcription
- disclosure revision/provider/purpose binding
- manual no-AI zero-provider-call

이 Slice가 끝나기 전에 OPENAI enforcement를 켜지 않는다.

### Slice 2 — Dater authoritative validation과 UGC

- Dater media auth 수정
- Dater photo/text publish gate
- hard claim 재추출
- approved revision snapshot end-to-end
- chat moderation launch policy와 구현
- manual voice enforcement path

### Slice 3 — Account/privacy/storage

- SECURITY DEFINER RPC active guard inventory
- raw token/local media purge lifecycle
- profile-media DELETE/rollback policy
- deletion privacy retention 결정
- scheduled ops production 연결

### Slice 4 — Commerce state machine

- Creator intent concurrency uniqueness
- Creator refund/consumed kit contract
- Campaign Pass lapse/expired/re-purchase semantics
- restore without new purchase intent dependency
- RevenueCat alias/transfer resolution과 ops tool
- actual sandbox purchase→restore→refund→transfer

### Slice 5 — Core growth loop

- Introducer free live URL/share
- publish notification·closure
- landing/public pitch actual acquisition surface
- durable referral chain
- exporter metric truth reset
- one active free campaign server guard

### Slice 6 — Grand Prize demo와 product depth

- rights-cleared real voice seeded demo
- judge-safe interest→inbox→room
- actual structure-driven scenes
- Dater profile/location/intent/output preview
- recap friction 제거
- Creator Launch/Pass canonical value 확정

### Slice 7 — 디자인·접근성·실기기

- trust flow visual de-intensification
- consent step/progress/preview
- 44px, contrast, keyboard, screen reader
- iOS real device and small-screen QA

### Slice 8 — 외부 release proof

- identity vendor sandbox
- moderation enforcement on
- RevenueCat sandbox
- Resend/custom domain, `EXPO_PUBLIC_WEB_ORIGIN`
- production scheduler/alerts
- gate-on smoke, gate-off rollback drill

## 11. 반드시 추가할 회귀 테스트

### DB/security

- authenticated direct provider reserve/reconcile denied
- cap exhaustion/release forgery denied
- same request concurrent provider call exactly once
- failed/timeout conservative cost retention
- Dater unvalidated/flagged photo publish denied
- Dater unmoderated edited text publish denied
- Dater new hard claim confirmation required
- public beta off publish/read denied
- suspended/deleted account via every SECURITY DEFINER read RPC denied
- null provider_ref/checked_at/expires_at identity evidence denied
- one active free campaign concurrent publish guard
- profile-media failed upload cleanup succeeds

### App/API

- AI consent timestamp precedes first media moderation request
- write-manually generates zero external AI requests
- real Dater upload/validate/revision/publish without route mock
- manual voice path with enforcement on
- Creator double tap/concurrent intent one purchase scope
- Campaign Pass active/expired/restore/refund/rebuy matrix
- Introducer receives and shares free live URL
- public referral persists to new campaign publish

### Analytics

- client cannot forge server outcome
- arbitrary campaign `campaign_shared` does not enter headline metric
- refund/duplicate/lifecycle do not inflate paid transaction count
- source campaign→new campaign attribution fixture
- current share proxy metric never labeled K-factor

### Browser/device

- actual voice seeded demo with audio element and real timeline
- 320/375/768/1440 widths, no overflow
- consent keyboard-only and screen reader flow
- reduced motion
- trust surface 44px target/contrast
- signed-out return user sign-in
- accepted interest deep link to room

## 12. 사용자 게이트와 코드 게이트를 분리한다

### 코드로 먼저 해결할 것

- provider RPC authorization/idempotency/accounting
- external AI consent ordering/revision binding
- Dater validation/moderation
- public beta publish/read gate
- account read RPC guard
- Campaign Pass/restore state machine
- Creator intent concurrency
- storage DELETE/token lifecycle
- analytics/referral truth
- free live share/acquisition/demo

### 상헌 님 또는 외부 설정이 필요한 것

- RevenueCat project/products/entitlements/API keys와 sandbox 계정
- identity vendor 계약·키
- OpenAI production key와 budget alert 정책
- Resend domain/custom SMTP
- `EXPO_PUBLIC_WEB_ORIGIN`
- TestFlight/App Store 또는 공개 web creation 배포 결정
- production scheduler/hosting 환경
- 실제 demo voice/photo 사용 권리

코드 게이트가 끝나기 전에 사용자 게이트를 요청하며 “키만 넣으면 출시”라고 설명하지 않는다.

## 13. Claude 팀 최종 승인 형식

각 Slice 완료 보고는 최소 다음을 포함한다.

1. 변경 파일과 migration 목록
2. 해결한 감사 ID
3. 변경 전 재현과 변경 후 결과
4. 새 DB invariant와 권한 모델
5. 실행한 정확한 명령과 pass count
6. 실제 provider/RevenueCat/browser/device 증거 또는 미실행 이유
7. 남은 사용자 게이트
8. 문서 truth reset 목록
9. Advisor가 직접 확인한 diff와 test 결과
10. rollback/kill-switch 절차

다음 표현은 acceptance 증거 없이 금지한다.

- “hard cap 완료”
- “AI 사전 동의 완료”
- “Dater 사진 통제 완료”
- “외부 공개 서버 차단”
- “RevenueCat 완료”
- “identity verified”
- “server-authoritative growth”
- “K-factor”
- “Grand Prize ready”
- “launch ready”

## 14. 3차 감사 결론

이번 수정은 2차 감사의 표면적 체크리스트를 많이 닫았고, 코드 품질과 테스트 양도 분명히 좋아졌다. 그러나 가장 위험한 결함은 테스트 바깥의 경계에서 발견됐다. 비용 원장을 보호해야 할 RPC가 일반 사용자에게 열려 있고, AI 동의가 사진 전송보다 늦으며, Dater가 수정한 콘텐츠가 새 moderation과 hard-claim gate를 거치지 않는다. public beta off도 실제 public page를 닫지 않는다.

제품 측면에서도 Friendword의 차별점은 여전히 완전한 루프로 체험되지 않는다. 친구가 음성으로 소개하고 Dater가 승인한 뒤, 그 친구가 무료로 live pitch를 공유하고, 시청자가 새 Introducer가 되어 다음 campaign을 만드는 흐름이 핵심인데 현재는 무료 공유와 신규 획득 사이가 끊겨 있다. 대표 demo에는 실제 voice가 없고 K-factor라는 이름의 지표는 실제 referral growth를 측정하지 않는다.

따라서 다음 목표는 기능을 더 많이 추가하는 것이 아니다. **비용·동의·moderation·public gate의 서버 invariant를 먼저 완성하고, 그 다음 무료 share→acquisition→new campaign이라는 단일 성장 루프와 실제 음성 demo를 끝까지 연결하는 것**이다. 이 두 축이 해결되기 전에는 외부 공개와 실결제를 켜지 말고, Grand Prize 제출 준비 완료라고 선언하지 않는다.
