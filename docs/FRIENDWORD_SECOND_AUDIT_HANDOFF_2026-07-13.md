# Friendword 2차 제품·보안·결제 전수 감사 및 Claude 수정 핸드오프

> 최종 갱신: 2026-07-13 KST  
> 감사 기준: `main` / `941ef55`  
> 감사 범위: 이전 감사 대응 diff, 전체 제품 계약, DB/RLS, RevenueCat, UGC·신원·개인정보, 비용 통제, 모바일·웹 UI, 실제 브라우저 데모, 자동화 테스트  
> 판정: **기능성 베타. 외부 베타·실결제·Grand Prize 제출 준비 완료가 아니다.**  
> 이 문서는 2차 감사의 correction brief이자 acceptance source of truth다. `docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`는 1차 감사의 역사적 기준이다. `SESSION_HANDOFF.md`는 Claude 팀의 진행 상태를 기록하되, 완료 판정이 이 문서와 충돌하면 이 문서의 acceptance를 우선한다.

## 0. Claude Advisor가 가장 먼저 지켜야 할 것

1. 이 문서의 결함을 “외부 키가 없어서 남은 일”로 축소하지 않는다. RevenueCat, identity, media enforcement, 비용 cap에는 **코드·schema·테스트 수정이 필요한 결함**이 있다.
2. `P0 해소`, `결제 완료`, `verified`, `실오디오 데모`, `성장 지표 검증 완료`라고 다시 기록하기 전에 각 항목의 acceptance를 실제 diff, 테스트, sandbox 또는 브라우저 QA로 증명한다.
3. Worker 완료 보고를 그대로 승인하지 않는다. Advisor가 관련 schema와 모든 call site를 읽고 diff·테스트·manual QA를 직접 재실행한다.
4. 동일 파일을 여러 Worker에게 동시에 맡기지 않는다. session, owned paths, dependency, acceptance와 검증 결과는 `docs/TASKS.md`에 기록한다.
5. DB 변경에는 migration, RLS/회귀 테스트, 실제 API 소비자 검증이 모두 필요하다. 테스트 fixture가 실제 외부 payload를 임의로 단순화해서는 안 된다.
6. 제품 소스 외에 `README.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/OPS.md`, `docs/REVENUECAT_SETUP.md`도 구현과 같은 turn에서 truth reset한다.
7. 감사 시점 작업 트리에는 사용자/다른 팀의 `README.md` 변경이 존재했다. 내용을 확인하지 않고 덮어쓰거나 되돌리지 않는다.

## 1. 최종 판정

이전 감사 이후 다음은 실제로 좋아졌다.

- 신규 web auth 사용자의 `public.users`/`profiles` bootstrap
- AI 생성 후 consent 요청 순서와 immutable `consent_revisions`
- `consent_pending` 이후 Introducer 수정·추가 업로드 차단
- Dater가 승인한 revision과 사진 subset 저장
- 무료 캠페인 14일 고정과 승인 사진 최소 1장 publish guard
- campaign별 OG와 real campaign의 Blair 인물 fallback 제거
- RevenueCat transaction/original transaction 저장과 단일 DB transaction 기반 benefit 처리
- 신고·삭제 요청·이미지 validation·계정 mutation guard의 기본 골격
- 디자인 contrast token과 회귀 테스트

그러나 다음 네 축은 출시를 막는다.

1. **Trust/Safety:** 익명 신고 self-DoS, media enforcement 음성 deadlock, 불완전한 UGC moderation, 실제 identity/18+/face evidence 부재.
2. **Commerce:** RevenueCat 실제 payload·사용자 identity 전환 불일치, 무가치한 중복 결제, Creator 재구매 trap, Campaign Pass 구매 진입 부재.
3. **Core product:** Dater 통제권 부족, 공개 피치가 구조화된 friend voice를 충분히 표현하지 못함, Blair 데모에 실제 음성 없음.
4. **Operations/Growth:** provider cost hard cap 부재, 조작 가능한 analytics, 수동 삭제·만료 운영, 북미 영어권 타깃 불일치.

정확한 제품 상태는 다음과 같다.

> Introducer → Dater consent → public pitch → interest → intro room의 데이터 골격은 연결됐다. Consent revision 무결성은 크게 개선됐다. 그러나 신원, 실결제, 유료 가치 전달, UGC 안전성, 비용 통제, 실제 음성 데모와 성장 증거는 출시 계약을 충족하지 않는다. 실결제와 외부 공개 베타는 차단해야 한다.

### 출시 판정표

| 영역                    | 현재 판정     | 출시 게이트                                        |
| ----------------------- | ------------- | -------------------------------------------------- |
| Web user bootstrap      | 해결          | 회귀 테스트 유지                                   |
| Consent revision 불변성 | 해결          | race/변경요청 회귀 유지                            |
| Invite contact binding  | 부분 해결     | 모든 신규 요청에 verified contact 서버 필수화      |
| Dater control           | 부분 해결     | 문구·사진·audience·기간·profile 통제 완성          |
| Identity/18+/face       | 미해결        | evidence model+실 provider+sandbox 증명            |
| Public pitch            | 부분 해결     | 실제 transcript/caption/body/waveform/voice demo   |
| Anonymous reporting     | 출시 차단     | 동일 익명 신고자 distinct/dedupe/abuse 방어        |
| Media enforcement       | 출시 차단     | voice asset verdict 정책 또는 전사 moderation      |
| RevenueCat webhook      | 출시 차단     | 실제 event contract, alias/transfer/lifecycle 처리 |
| RevenueCat app identity | 출시 차단     | auth change마다 `logIn`/`logOut` 동기화            |
| Creator Launch          | 부분 구현     | 재구매 trap 제거+약속한 결과물 전달                |
| Campaign Pass           | 사실상 미완성 | 정상 진입+중복 방지+계약된 효익                    |
| 비용 통제               | 미해결        | quota, usage ledger, alert, hard kill switch       |
| Growth evidence         | 미신뢰        | server-authoritative attribution·지표 재설계       |
| 삭제·만료 운영          | 부분 구현     | 자동화, FK 순서, 상태 일관성                       |
| 북미 영어권 준비        | 미충족        | 모든 acquisition/core/paywall 영어 우선            |

## 2. 2차 감사에서 직접 실행한 검증

### 통과

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` — domain 13, contracts 4, ui-tokens 12, adapters 8, data 40, mobile 28
- `pnpm format:check`
- `pnpm --filter @friendword/web build`
- `pnpm test:audit` — DB audit 7/7, webhook 11/11
- `pnpm test:db` — DB suite 01~14, 16, 17
- `pnpm --filter @friendword/web test:e2e` — Playwright 35/35
- 실제 브라우저에서 `/`와 `/p/demo-blair` DOM·시각·상호작용 확인

### 실패 또는 중요한 경고

- `pnpm check:env` 실패: `EXPO_PUBLIC_WEB_ORIGIN` 누락.
- Next.js build는 통과했지만 Next.js ESLint plugin 미탐지 경고가 있다.
- `/p/demo-blair`에는 `<audio>` element가 0개였고 Play는 timer만 진행했다.
- 랜딩의 실제 DOM은 `lang="ko"`이며 주요 acquisition copy가 한국어다.

### Green test를 완료 증거로 오해하면 안 되는 이유

- webhook fixture가 실제 RevenueCat TRANSFER/lifecycle payload보다 필드를 더 많이 넣어 계약 오류를 가린다.
- E2E가 한국어 랜딩을 기대하므로 북미 영어권 요구사항 위반을 오히려 정답으로 고정한다.
- 실제 voice moderation enforcement-on, RevenueCat auth 전환, purchase/restore/refund/transfer, 중복 결제, 익명 신고 중복, Creator kit 재진입, Campaign Pass 진입, 외부 AI 동의를 검증하지 않는다.
- analytics가 이벤트를 받았는지는 검증하지만 해당 이벤트가 서버에서 신뢰 가능한 사실인지는 검증하지 않는다.

## 3. 출시 차단 P0 — 재현, 결정, acceptance

### P0-1. 동일 익명 사용자가 고위험 신고 2건으로 캠페인을 자동 중지할 수 있다

**증거**

- `supabase/migrations/0016_safety_paths.sql:283-307`은 익명 신고에서 `reporter_user_id` 대신 각 report의 `id`를 distinct identity로 사용한다.
- `apps/web/app/api/report/route.ts:58-90`은 한 IP에 시간당 5건을 허용한다. auto-pause 임계치 2보다 크다.
- `x-forwarded-for`의 첫 값을 그대로 사용하는 경로도 proxy trust 설정에 따라 spoofing 위험이 있다.

**영향**

- 공개 URL을 아는 한 사람이 `impersonation` 또는 `minor` 신고를 두 번 보내 정상 캠페인을 즉시 중지할 수 있다.
- 신고 기능이 피해자 보호보다 캠페인 공격 도구가 된다.

**결정**

- 익명 distinct reporter는 신뢰 가능한 `reporter_ip_hash` 또는 rate-limit identity를 사용한다.
- 같은 campaign+identity+reason에 dedupe/cooldown을 둔다.
- high-severity report 수만으로 영구 상태를 만들지 말고 CAPTCHA/device·IP reputation 또는 ops review와 결합한다.
- trusted proxy가 아닌 임의 client의 forwarding header를 identity로 신뢰하지 않는다.

**Acceptance / required verification**

- 동일 익명 identity의 고위험 신고 2건은 distinct reporter 1명으로 계산된다.
- 서로 다른 두 신뢰 identity는 정책대로 pause 또는 ops review를 유발한다.
- authenticated/anonymous 혼합, header spoof, 24시간 window, concurrency DB 테스트가 있다.
- 실제 공개 피치 report UI와 API를 브라우저에서 재검증한다.

### P0-2. `media_validation_enforcement=on`이면 필수 음성 때문에 모든 consent 제출이 막힌다

**증거**

- `apps/web/app/api/media/validate/route.ts:117-139`는 이미지에만 moderation을 수행하고 audio/mp4는 `skipped`로 남긴다.
- `supabase/migrations/0016_safety_paths.sql:607-627`은 모든 pitch asset에 `moderation_status='passed'`를 요구한다.
- voice는 pitch의 필수 asset이다.

**잘못된 기존 설명**

- OPENAI key를 넣고 switch만 켜면 완료되는 사용자 설정 게이트가 아니다. 현재 코드는 switch를 켜면 정상 제출을 차단한다.

**결정**

- asset kind별 authoritative validation policy를 둔다.
- image는 magic/decode/size+image moderation을 요구한다.
- voice는 magic/decode/size+전사 완료+transcript moderation 또는 별도로 승인된 audio verdict를 요구한다.
- `skipped`를 `passed`와 동일 취급하지 않는다. 지원하지 않는 asset kind는 fail-closed하되 정상 voice가 영구적으로 불가능해져서는 안 된다.

**Acceptance**

- enforcement on 상태에서 정상 image+voice 피치가 제출된다.
- invalid MIME/magic/oversize/decode failure/rejected image/rejected transcript는 각각 차단된다.
- provider timeout·키 누락·중복 validation·재시도 정책 테스트가 있다.

### P0-3. RevenueCat webhook이 실제 이벤트 계약과 맞지 않는다

**증거**

- `apps/web/app/api/revenuecat/route.ts:10-24`는 모든 이벤트에 `app_user_id`, `product_id`를 필수로 둔다.
- 실제 TRANSFER는 일반 purchase lifecycle과 다른 `transferred_from`/`transferred_to` 중심 payload이며 현재 Zod에서 400이 된다.
- `supabase/migrations/0014_commerce_state_machine.sql:281` 이후는 `subscriber_attributes.purchase_intent_id`를 사실상 모든 이벤트에 요구한다.
- RevenueCat의 `subscriber_attributes`, aliases, original identity 관련 필드는 이벤트에 따라 누락될 수 있다.
- route는 intent 관련 RPC 오류를 HTTP 200 terminal response로 바꾸므로 돈은 결제됐지만 benefit이 없는 상태가 재시도 없이 영구화될 수 있다.
- route가 aliases/original_app_user_id를 파싱하지만 SQL의 실제 귀속은 current `app_user_id === intent.user_id`에 의존한다.

**결정**

- event type별 discriminated schema를 만든다. TRANSFER에 purchase-only 필드를 요구하지 않는다.
- 최초 NON_RENEWING_PURCHASE attribution에서만 purchase intent를 사용한다.
- 이후 refund/lifecycle은 `original_transaction_id`/transaction lineage로 기존 ledger를 찾는다.
- aliases, `original_app_user_id`, transfer를 명시적 identity resolution 정책으로 처리한다.
- 돈은 받았지만 자동 귀속하지 못한 이벤트를 durable `needs_review` 상태로 저장하고 ops가 복구할 수 있게 한다. terminal 200으로 버리지 않는다.

**Acceptance**

- RevenueCat 공식 형태에 가까운 purchase, duplicate, refund, expiration, restore, transfer, missing optional attributes fixture가 통과한다.
- malformed/forged event는 거부하고 valid un-attributed event는 durable review queue에 남는다.
- 동일 transaction replay는 idempotent하고 benefit 중복 지급이 없다.
- 실제 RevenueCat sandbox에서 purchase→restore→refund→transfer를 검증한다.

### P0-4. RevenueCat SDK 사용자 identity가 Supabase auth와 동기화되지 않는다

**증거**

- `apps/mobile/src/services/purchases.ts:73-103`은 module global `configured`로 최초 한 번만 configure한다.
- 로그인·로그아웃·계정 전환 시 `Purchases.logIn()`/`logOut()` 호출부가 없다.

**영향**

- logged-out configure 후 로그인하면 anonymous RevenueCat user에 결제가 귀속될 수 있다.
- 사용자 A→B 전환 시 A identity가 남거나 webhook UUID 검증이 실패할 수 있다.

**결정 / Acceptance**

- auth session lifecycle과 RevenueCat customer lifecycle을 단일 service에서 동기화한다.
- 로그인 시 UUID로 `logIn`, anonymous-mode logout 정책에 따라 `logOut`, 계정 전환 시 새 UUID로 `logIn`한다.
- cold start, 로그인 전 configure, 로그인, 로그아웃, A→B 전환, restore를 단위·실기기 sandbox에서 검증한다.
- purchase intent의 user와 webhook resolved user가 항상 일치해야 한다.

### P0-5. Creator Launch 구매 후 재구매 trap과 무가치한 중복 결제가 가능하다

**증거**

- `packages/data/src/purchasesRepo.ts:51-64`는 creator credit이 `available`일 때만 confirmed benefit으로 본다.
- `supabase/migrations/0020_paid_benefits.sql:164-170`에서 credit을 소비하고 permanent `share_kits`를 생성한다.
- `apps/mobile/app/pitch/share.tsx:86-96,244-260`은 소비 후 benefit이 없다고 판단해 다시 “Get Creator Launch”를 노출할 수 있다.
- `supabase/migrations/0022_creator_intent_after_publish.sql`은 동일 draft에 unused credit 또는 unlocked kit이 있어도 새 intent를 발급할 수 있다.
- `share_kits`는 draft당 하나라 추가 purchase의 실질 가치가 없다.

**결정**

- confirmed benefit은 `available credit OR unlocked share_kit`이다.
- unlocked 상태는 “Open Creator Kit”로 진입한다.
- unused credit 또는 kit이 있으면 동일 scope의 새 intent/purchase를 서버에서 거부한다.
- purchase 버튼은 campaign/draft 상태와 기존 benefit을 확인한 뒤에만 보인다.

**Acceptance**

- 구매 전→pending→available→consume→unlocked→재진입 상태 테스트.
- kit unlock 이후 앱 재시작·다른 기기에서도 Open kit이 보인다.
- 동일 draft 중복 intent, webhook replay, double tap, concurrent consume가 금전·효익 1:1을 보존한다.

### P0-6. Campaign Pass가 정상 구매 불가능하며 중복 구매 가치도 보존하지 않는다

**증거**

- 웹 `apps/web/app/inbox/InboxView.tsx`는 앱에서 구매하라고 안내한다.
- 모바일에 `intent:'campaign_pass'` paywall로 이동시키는 실제 Dater-owned campaign call site가 없다.
- 활성 Pass가 있어도 새 intent를 발급할 수 있다.
- benefit은 `greatest(current, purchase_time+30d)`에 가까워 즉시 두 번 구매해도 두 번째 30일이 온전히 추가되지 않는다.

**결정**

- 모바일에 서버 기반 Dater-owned campaign 목록과 명확한 Campaign Pass CTA를 만든다.
- active pass 중 재구매를 막거나, 의도적으로 판매한다면 `max(current_ends_at, now)+30 days`로 가치가 누적돼야 한다.
- 상품 계약을 먼저 확정한다. 단순 30일 연장만 출시할지, 원래 기획의 vouch/filter/schedule/version/enhanced inbox를 포함할지 Advisor가 결정하고 문서화한다.

**Acceptance**

- Dater가 campaign context에서만 Pass를 구매할 수 있다.
- Introducer draft에는 Pass가 노출되지 않는다.
- 활성/만료/환불/restore/중복 구매 각각의 entitlement와 UI가 일치한다.
- 구매 1건당 약속된 기간 또는 기능이 정확히 1회 전달된다.

### P0-7. Invite contact binding은 정상 UI에서만 동작하고 서버 invariant가 아니다

**증거**

- `supabase/migrations/0012_claim_binding_and_evidence.sql:127-157` 및 후속 재정의는 invite channel/contact를 optional로 둔다.
- `claim_consent_request`는 contact hash가 존재할 때만 caller contact를 비교한다.
- direct RPC caller는 contact 없는 신규 consent request를 만들고 token possession만으로 임의 계정이 claim하게 할 수 있다.
- 회귀 테스트가 contact 없는 legacy invitation을 정상 claim 가능으로 보존한다.

**결정**

- 모든 **신규 최초 consent request**는 verified channel+contact를 필수로 한다.
- legacy null request는 claim 가능 상태로 두지 말고 재발급 또는 명시적 migration 정책을 사용한다.
- changes-request resubmission에서 contact 생략을 허용하려면 이미 contact-bound된 기존 request를 서버가 참조하는 경우로만 제한한다.
- raw contact 보존 기간과 삭제 시점을 privacy/ops 문서에 확정한다.

**Acceptance**

- null channel/contact, 한쪽만 null, unsupported phone, 다른 email, forwarded token이 모두 서버에서 실패한다.
- 대소문자·공백·email canonicalization과 verified email 변경 정책 테스트.
- UI를 우회한 direct RPC 테스트가 반드시 포함된다.

### P0-8. Identity·18+·liveness·face match가 실제 출시 gate가 아니다

**증거**

- `identity_enforcement` 기본값은 off다.
- `packages/adapters/src/factory.ts`, `packages/adapters/src/openAi.ts`의 real identity provider는 Unconfigured다.
- enforcement를 켜도 `phone_verified_at`과 과거 `passed` verification row 존재만 확인한다.
- verification type, provider reference, subject photo/revision hash, liveness, face match, DOB/18+ evidence, 유효기간·폐기·재검증 규칙이 없다.
- Dater/Interested의 birth date는 self-declared다.

**결정**

- `verification_checks`에 verification type, provider, provider reference, evidence subject, photo/content revision hash, result, risk/reason, checked_at, expires_at을 모델링한다.
- Dater publish 전: 18+ evidence + phone + liveness + 대표 승인 사진 face match.
- Interested submit 전: 확정한 최소 gate를 동일하게 server-side enforce한다.
- 오래됐거나 다른 사진에 대한 pass row는 현재 제출을 승인하지 못한다.
- provider 미설정·timeout·inconclusive는 fail-closed하고 복구 UI를 제공한다.

**Acceptance**

- 미성년, self-declared DOB만 존재, expired check, wrong check type, 다른 사진 hash, face mismatch, liveness fail, provider timeout이 각각 차단된다.
- passed evidence만 server-side event/badge를 생성한다.
- 실제 provider sandbox와 사용자 개인정보 삭제 경로를 검증한다.

### P0-9. Provider 비용 hard cap과 무료 사용량 통제가 없다

**증거**

- `packages/config/src/constants.ts`의 budget 상수와 `provider_usage_events`/`cost_ledger` schema는 실제 provider 호출에 연결되지 않았다.
- `apps/web/app/api/transcribe/route.ts`는 반복 호출 rate limit, idempotency, per-user quota, usage write, kill switch가 없다.
- media validation/moderation도 같은 비용 통제 경로가 없다.
- suspended/deletion-requested 사용자가 service-role API를 통해 provider 비용을 발생시킬 여지도 있다.

**결정**

- 제품의 무료 allowance를 server-authoritative하게 확정한다. 예: 계정/피치별 전사·구조화 횟수, 이미지 validation 횟수, regeneration 횟수.
- provider call 전에 atomic reserve, 성공 후 actual reconcile, 실패 후 release를 수행한다.
- global monthly hard cap, daily alert threshold, per-user/per-IP rate limit, emergency kill switch를 구현한다.
- 서비스 API는 active account와 resource ownership을 service-role 사용 전에 확인한다.

**Acceptance**

- 같은 request id replay가 provider를 재호출하지 않는다.
- quota 초과, global cap 초과, suspended/deletion-requested account는 provider 호출 전에 차단된다.
- success/failure/timeout/retry의 usage와 예상 비용이 ledger에 기록된다.
- 운영자가 현재 burn과 남은 cap을 조회하고 switch를 끌 수 있다.

### P0-10. 외부 AI 처리 동의가 없다

**증거**

- Introducer가 녹음한 음성과 업로드한 Dater 사진이 전사·구조화·moderation을 위해 외부 provider로 전달될 수 있다.
- 모바일 recording/photo/review UI에 외부 AI 처리, 목적, provider 범주, 보존/삭제에 대한 명시적 동의가 없다.
- Dater가 자신의 캠페인을 claim·승인하기 전에 제3자인 Introducer가 Dater 사진을 provider에 보낼 수 있다.

**결정**

- 업로드/처리 전에 Introducer가 해당 자료를 제공할 권한과 외부 AI 처리에 동의하도록 명확한 disclosure+affirmative action을 둔다.
- Dater claim 후 본인의 사진·음성 처리 내역과 삭제/거절 권한을 확인할 수 있게 한다.
- privacy policy와 실제 provider retention 설정을 일치시킨다.

**Acceptance**

- 동의 revision/version/timestamp가 서버에 기록되고 동의 없이는 provider call이 발생하지 않는다.
- disclosure 문구가 영어권 타깃과 App Store privacy disclosure에 일치한다.
- 동의 철회·campaign decline·account deletion 시 처리 정책을 테스트한다.

## 4. Core product 계약 미충족

### CP-1. Dater가 “모든 단어·사진·audience”를 통제하지 못한다

현재 `ConsentFlow`는 claim, display name, audio review, 사진 include/exclude, hard claim 확인, 14일, request changes/decline/approve를 제공한다. 다음은 없다.

- 소개문 headline/body 직접 수정 또는 합의 revision 생성
- 기존 사진 교체와 Dater 본인의 새 사진 업로드
- 위치 정밀도와 공개 범위
- 본인 age/profile/dating intent 확인
- 관심 표현자의 audience/age/location/intent filter
- 무료/유료 정책 안에서 campaign 공개 기간 선택

공개 카피가 실제보다 넓은 통제권을 주장하지 않도록 기능과 카피를 동시에 고친다.

**Acceptance:** Dater가 본 최종 revision, asset set, profile fields, audience policy, 기간이 hash/revision으로 고정되고 publish RPC가 정확히 그 snapshot만 발행한다.

### CP-2. 공개 피치가 “voice → structured pitch” 차별점을 충분히 표현하지 않는다

- `apps/web/src/pitch/view.ts`는 승인 body를 공개 결과물에 거의 사용하지 않는다.
- caption은 headline 하나를 전체 audio 구간에 적용하고 end가 `Number.MAX_SAFE_INTEGER`다.
- `PitchPlayer` word highlight는 실제 timestamp가 없어 사실상 첫 단어에 머문다.
- waveform은 고정 placeholder다.
- vouch 데이터가 비어 있다.

**결정:** 실제 transcript segment/word timestamp, audio-derived waveform, 승인된 structured body/claims, 접근 가능한 전체 transcript를 공개 pitch contract에 포함한다. AI가 만든 표현보다 Introducer 원본 음성과 Dater 승인 내용이 중심이어야 한다.

### CP-3. Blair 대표 데모가 실제 음성을 포함한다는 인상을 주지만 audio가 없다

- 랜딩은 Blair demo에 friend voice가 있다고 설명한다.
- fixture의 `audioUrl`은 null이며 실제 브라우저 DOM에 `<audio>`가 없다.
- Play 버튼은 0:00~1:00 timer만 움직인다.

**출시 게이트:** 권리 확보된 실제 demo audio+timestamp transcript를 제공하거나, audio가 없음을 정직하게 표시하고 Play를 제거한다. Grand Prize 제출용 대표 demo에서 가짜 재생은 허용하지 않는다.

### CP-4. 북미·서양권 영어 우선 전략이 구현되지 않았다

- 랜딩 DOM은 `lang="ko"`이고 acquisition copy가 한국어다.
- 모바일 paywall/review/share에 한국어 문자열이 섞여 있다.
- dynamic OG에도 한국어가 있다.
- E2E가 한국어를 기대해 잘못된 방향을 고정한다.

**결정:** 첫 출시 locale은 영어다. 모든 public acquisition, consent, interest, trust/safety, payment, email, OG, App Store copy를 영어 기준으로 완결한다. 한국어는 별도 locale로 유지할 수 있지만 기본값이 되어서는 안 된다.

### CP-5. Creator Launch $4.99의 계약된 가치가 일부만 구현됐다

현재 확인 가능한 효익은 정적 9:16 PNG와 generic caption pack이다. 원래 계약의 premium motion theme, approved-content composition, MP4 export, end-card customization, 1회 regeneration은 없다. caption의 공유 URL도 완전한 public URL이어야 하며 identity 미출시 상태에서 `Friend-verified` 같은 과장 표현을 쓰지 않는다.

Advisor는 두 선택지 중 하나를 명시적으로 결정해야 한다.

1. $4.99 상품을 현재 전달 가능한 static share kit로 축소하고 모든 카피·가격 가치 제안을 정직하게 수정한다.
2. 원래 계약을 유지하고 실제 motion/MP4/customization/regeneration을 구현한다.

어느 경우든 결제 전에 정확한 결과물 preview와 scope를 보여주고, 결제 후 즉시 재진입 가능한 permanent benefit을 전달한다.

### CP-6. Campaign Pass의 계약된 가치가 일부만 구현됐다

현재는 30일과 단순 funnel에 가깝다. 원래 기획의 여러 친구 vouch, 관심 표현 필터, 일정 관리, version 선택, 추가 추천 반영, enhanced inbox/alert는 없다. 구현하지 않을 기능을 판매 카피로 약속하지 않는다. 최종 MVP scope와 가격을 다시 문서화한다.

### CP-7. 단일 User·다중 contextual role은 DB보다 UI가 뒤처진다

- 모바일 `My dating campaigns`는 실제로 Introducer local draft 중심이다.
- Dater-owned campaign은 web inbox에만 있다.
- 모바일 `My interests`는 placeholder 수준이다.
- local draft는 새 기기/재설치에서 서버 draft를 자연스럽게 복구하지 못한다.

전역 `users.role`을 만들지 않는다. 대신 resource relation으로 Introducer work, My campaigns(Dater), My interests를 별도 context로 명확히 탐색하고 서버에서 복구 가능하게 한다.

## 5. High — 외부 beta 전에 해결

### H-1. 계정 상태 enforcement가 service-role API와 read path에서 불완전하다

- `/api/transcribe`, `/api/media/validate`는 auth와 ownership을 보지만 account status를 확인하지 않고 service role로 write/provider call을 수행한다.
- 기존 RLS SELECT에는 suspended/deletion-requested account의 read를 일괄 철회하는 조건이 부족하다.

**Acceptance:** suspended/deletion-requested/deleted 사용자는 비용 호출, mutation, 민감 data read가 정책대로 차단되고 active 복구 정책이 테스트된다.

### H-2. Creator kit 구매자의 deletion processor가 FK 순서로 실패할 수 있다

- `share_kits.credit_ledger_id`는 restrict FK다.
- `scripts/process-deletions.mjs`가 draft/share kit보다 purchase ledger를 먼저 지우는 순서여서 kit 보유 계정은 cleanup에서 실패할 수 있다.

삭제 순서를 FK graph에 맞게 바꾸고 paid/no-paid, room/message, reports, media를 포함한 end-to-end deletion fixture를 만든다.

### H-3. UGC moderation이 이미지 일부에만 적용된다

음성 transcript, pitch headline/body, profile bio, interest note, chat message의 proactive moderation·authoritative length/rate limit이 부족하다. rejected/unreferenced upload cleanup과 per-user storage quota도 없다. 신고·차단만으로 launch-ready moderation이라고 주장하지 않는다.

### H-4. Analytics와 Grand Prize growth evidence가 조작 가능하다

- anon caller도 `pitch_approved`, `campaign_published`, `interest_submitted`, `interest_accepted`, purchase outcome 등 일부 사실 이벤트를 보낼 수 있다.
- arbitrary campaign/source property와 resource relation 검증이 부족하다.
- Campaign Pass funnel이 이 client event를 집계한다.
- `campaign_shared`는 public campaign 공유가 아니라 consent invite 공유에서 기록된다.
- Creator kit download/copy/share attribution이 없다.
- `pitch_viewed_unique`는 sessionStorage 수준이고 K-factor는 attributed new campaign이 아니다.
- purchase_events는 lifecycle/refund를 구매로 섞을 수 있다.

**결정:** 서버가 이미 알고 있는 outcome은 RPC/trigger/webhook에서만 기록한다. client는 intent/interaction 이벤트만 보낼 수 있다. referral/campaign/public share/creator-kit source를 immutable attribution으로 연결하고 지표 정의, 기간, timezone, dedupe를 문서화한다.

### H-5. 만료 캠페인의 DB/UI/public 상태가 불일치한다

- public reader는 `ends_at`으로 404를 반환하지만 campaign status는 `published`로 남는다.
- `set_campaign_status`는 만료 여부 없이 paused→published를 허용한다.
- inbox는 Live/Resume인데 public page는 404일 수 있다.
- `campaign_expired` event가 발생하지 않는다.

만료 job 또는 읽기 시 authoritative transition을 결정하고 status, UI, analytics, Pass renewal을 일치시킨다.

### H-6. Consent token과 local draft lifecycle이 불완전하다

raw contact purge는 개선됐지만 raw consent token은 일반 AsyncStorage의 draft와 함께 완료·만료·철회 후에도 남을 수 있다. token은 secure storage 또는 최소 수명 저장으로 이동하고 share/claim/decline/expiry 뒤 purge한다. local photo/voice URI와 orphan upload의 삭제 lifecycle도 확정한다.

### H-7. Interested photo upload에 orphan 가능성이 있다

선택 파일을 모두 upload한 뒤 UI에서 6개로 slice하는 경로는 extra object를 남길 수 있다. 선택 전 cap, remove UI, 실패 rollback, orphan cleanup, object quota를 구현한다.

### H-8. 접근성과 Trust Layer가 부분 반영이다

- web consent/interest/inbox/chat에 hard border, sticker shadow, badge, Unbounded, bounce가 과하게 남아 있다.
- chat message list 전체 `aria-live=polite`는 새 메시지마다 과도하게 재낭독될 수 있다. `role=log`와 새 메시지 단위 announcement를 검토한다.
- block/leave에 명확한 confirmation이 부족하다.
- report/cancel touch target 일부가 44px 미만이다.
- TrustCard의 faint border는 비텍스트 3:1 기준에 근접하거나 미달할 수 있다.

공개 campaign은 Hype Mixtape 표현을 유지하되 identity/payment/report/delete/consent는 quiet Trust Layer를 사용한다. 실제 기기, keyboard, screen reader, reduced motion QA가 필요하다.

## 6. 운영·법적·비용 경계

### 자동화되지 않은 운영

- account deletion은 `scripts/process-deletions.mjs` 수동 실행에 의존한다.
- campaign expiration 자동화가 없다.
- moderation/review를 위한 충분한 operator UI가 없고 DB/manual ops에 의존한다.
- ops alert가 생성되어도 누가 언제 처리하는지 SLA와 escalation이 불명확하다.

### 법적/정책 문서에서 확정해야 할 것

- 18+ only 및 미성년 의심 신고 처리
- Introducer가 제3자 사진·음성을 제공할 권한
- 외부 AI/provider 처리 목적과 보존
- raw invite contact와 hash 보존 기간
- voice/photo/profile/chat/report/payment record의 보존·삭제 예외
- account deletion 처리 기한과 법적 결제 기록 보존
- 북미 타깃 개인정보·UGC·dating/App Store disclosure

“법률적으로 완전하다”는 표현은 법률 검토 전 사용하지 않는다.

## 7. 수정 실행 순서

각 slice는 vertical하게 schema→server/API→client→test→manual QA→문서까지 끝낸다. 아래 순서를 바꾸려면 `docs/DECISIONS.md`에 이유와 위험을 남긴다.

### Slice 0 — Truth reset과 failing regression 추가

- 이 문서를 `docs/TASKS.md`, README, OPS, RevenueCat setup과 동기화한다.
- 현재 버그를 재현하는 실패 테스트를 먼저 추가한다.
- P0가 해결되기 전 real payments/public beta를 feature flag로 차단한다.

### Slice 1 — Report abuse와 account enforcement

- anonymous distinct identity/dedupe/proxy trust
- service-role API active account guard
- suspended/deletion read policy

### Slice 2 — Media/UGC enforcement

- asset-kind validation matrix
- voice transcript moderation
- text/chat/profile moderation·rate/length
- upload quota/orphan cleanup

### Slice 3 — RevenueCat identity와 실제 webhook state machine

- mobile auth lifecycle `logIn`/`logOut`
- event-specific schema, transaction lineage, aliases/transfer
- durable review/reconciliation
- actual sandbox purchase/restore/refund/transfer

### Slice 4 — Paid product 1:1 value delivery

- Creator unlocked-state 재진입과 duplicate prevention
- Campaign Pass Dater entry, duplicate/extension semantics
- 최종 상품 scope와 카피 확정

### Slice 5 — Contact binding과 identity evidence

- mandatory verified contact
- legacy request migration/reissue
- identity schema/provider/expiry/photo revision binding
- 18+/phone/liveness/face gates

### Slice 6 — Cost and privacy control

- provider idempotency/quota/usage ledger/global cap/kill switch
- external AI affirmative consent
- retention/deletion automation과 paid-account FK 수정

### Slice 7 — Dater control과 structured voice pitch

- Dater text/photo/profile/audience/duration controls
- immutable final snapshot
- transcript/timestamp/waveform/body/vouch public rendering

### Slice 8 — Grand Prize demo와 영어권 launch surface

- 권리 확보된 실제 Blair/demo voice 또는 정직한 non-audio demo
- 영어 기본 locale, OG/email/payment/safety 포함
- Creator 결과물과 공개 공유 CTA end-to-end

### Slice 9 — Growth evidence, contextual role UX, expiration, accessibility

- server-authoritative events와 referral attribution
- User의 Introducer/Dater/Interested context navigation
- expiration state machine
- Trust Layer와 접근성 실제 QA

### Slice 10 — Release gate

- 전체 CI와 production build
- clean DB에서 migration 0001~latest
- 실제 새 사용자 full loop
- real device iOS flow
- RevenueCat sandbox lifecycle
- identity/moderation enforcement on
- provider cap/kill switch drill
- deletion/expiration/abuse drill
- 영어 public demo와 Devpost evidence 재검증

## 8. Worker brief에 반드시 포함할 회귀 테스트

1. 동일 익명 reporter 두 번으로 auto-pause되지 않음.
2. enforcement on에서 정상 voice+image consent submit 성공.
3. 실제 형태 TRANSFER가 400이 아니며 review/transfer 정책 실행.
4. subscriber attributes 없는 refund/expiration이 original transaction으로 reconcile.
5. 로그인 전 configure→로그인→A/B 전환의 RevenueCat app user 일치.
6. Creator kit unlock 후 “Open kit”, 재구매 버튼 없음.
7. 활성 Pass의 duplicate intent 처리와 30일 가치 보존.
8. contact 없는 direct consent RPC 실패.
9. wrong/expired identity check와 다른 photo revision이 publish/interest를 승인하지 못함.
10. provider request replay가 비용을 한 번만 사용하고 hard cap 이후 호출 0회.
11. 외부 AI 동의 전 provider 호출 0회.
12. 유료 kit 보유자의 account deletion 완료.
13. suspended/deletion-requested account의 API mutation·provider call·sensitive read 차단.
14. public pitch가 실제 audio, transcript timestamp, approved body를 렌더링.
15. Blair demo Play 시 실제 audio가 재생되거나 Play 자체가 없음.
16. 영어 기본 locale과 한국어 문자열 회귀 검사.
17. client가 server outcome analytics를 위조하지 못함.
18. 만료 campaign이 inbox/public/status/event에서 일관됨.

## 9. 외부 사용자 설정 게이트와 코드 게이트를 구분한다

### 사용자/인프라 설정이 필요한 것

- Resend production domain/sender
- `OPENAI_API_KEY`
- RevenueCat project, products, entitlements, webhook token, iOS API key
- identity vendor account와 API credentials
- `EXPO_PUBLIC_WEB_ORIGIN`
- App Store/EAS credentials와 metadata

### 키를 넣기 전에 코드가 먼저 고쳐져야 하는 것

- media voice validation deadlock
- RevenueCat event contract와 SDK auth identity
- purchase duplicate/value state
- mandatory contact binding
- identity evidence schema와 binding
- provider quota/usage/hard cap
- external AI consent
- deletion/expiration automation

키 입력만으로 위 코드 게이트를 완료 처리하지 않는다.

## 10. 현행 프로젝트 사실

- 모노레포: `apps/mobile`, `apps/web`, `packages/{domain,contracts,config,ui-tokens,data,adapters}`, `supabase`.
- Supabase migrations: `0001`~`0022`가 repository에 존재한다. 배포 여부는 실제 hosted migration history로 다시 확인한다.
- 핵심 관계 모델: 전역 account role이 아니라 resource ownership/membership/interest sender 관계. `users.role`을 추가하지 않는다.
- public no-signup pitch, Dater consent, interest, inbox, intro room의 기본 surface는 존재한다.
- identity provider는 실제 미설정이고 enforcement는 launch-ready하지 않다.
- RevenueCat SDK/webhook/ledger scaffold는 존재하지만 real-money ready가 아니다.
- Creator Launch는 현재 static kit 중심의 부분 구현이다.
- Campaign Pass는 정상 product entry와 계약된 효익이 미완성이다.
- `EXPO_PUBLIC_WEB_ORIGIN` 누락으로 `pnpm check:env`가 실패한다.

## 11. 완료 주장 금지 목록

다음 acceptance가 충족되기 전에는 README, Devpost, 앱 카피, handoff에서 아래 표현을 사용하지 않는다.

- “All P0 resolved”
- “RevenueCat complete” 또는 “real payments ready”
- “Identity verified”, “Friend-verified”, “only verified profiles”
- “Moderation complete” 또는 “safe from impersonation/minors”
- “Every photo, word, and audience choice approved”
- “Blair demo contains a friend voice”
- “Campaign Pass available”
- “Creator Launch delivers a motion pitch/MP4”
- “Growth/K-factor proven”
- “Costs are capped at $200”
- “Account deletion automated”
- “North America launch ready”

## 12. Advisor 최종 승인 형식

각 slice 완료 보고는 다음을 포함한다.

```text
SLICE / COMMIT

DECISIONS
- 변경한 제품·보안·결제 정책과 선택 이유

CHANGED FILES
- Worker별 owned path와 실제 diff 요약

INVARIANTS PROVEN
- 어떤 공격·중복·race·비용·권한 경계를 서버가 보장하는지

VERIFICATION
- Advisor가 직접 재실행한 명령과 exact 결과
- 실제 브라우저/기기/sandbox QA surface와 관찰 결과

DOCUMENT TRUTH RESET
- README/TASKS/DECISIONS/OPS/setup/copy 변경

RESIDUAL RISKS
- 미해결 외부 의존성, 법적 검토, 측정 한계
```

Worker의 “tests pass”만으로 승인하지 않는다. 실제 외부 payload, auth 전환, 돈을 받은 뒤 효익, 신고 abuse, provider 비용, Dater가 본 최종 콘텐츠가 모두 end-to-end로 일치해야 한다.

## 13. 이번 감사의 냉정한 결론

Friendword의 아이디어와 기본 consent architecture는 버릴 상태가 아니다. 오히려 immutable revision과 friend-led voice라는 중심은 강하다. 그러나 현재 가장 큰 위험은 기능 부족 자체보다 **제품이 실제로 증명한 것보다 문서와 카피가 더 많이 완료됐다고 말하는 것**이다.

다음 개발의 목표는 기능 수를 늘리는 것이 아니다.

1. 한 사람이 다른 사람을 몰래 소개하기 어렵고,
2. Dater가 실제 공개될 모든 내용을 통제하며,
3. 실제 친구 목소리가 구조화된 공개 피치로 살아 있고,
4. 관심 표현자는 성인·실재 사용자라는 증거를 갖고,
5. 결제 1건마다 정확히 한 번의 분명한 가치가 전달되고,
6. 사용량이 늘어도 상헌 님의 비용이 통제되며,
7. Grand Prize에 제출하는 공유·전환 지표가 조작되지 않는 상태를 만드는 것이다.

이 일곱 조건이 충족되기 전까지 상태는 **기능성 베타 / 실결제 및 외부 공개 차단**으로 유지한다.
