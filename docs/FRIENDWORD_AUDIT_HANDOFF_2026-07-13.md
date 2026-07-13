# Friendword 1차 제품 전수 감사 및 Claude 수정 핸드오프

> 감사 기준: `main` / `5c367ff` / 2026-07-13 KST  
> 감사 원칙: 제품 소스는 수정하지 않았으며, 현재 커밋·실행 화면·테스트 결과를 제품 원본과 대조했다.  
> Source of truth 우선순위: `FRIENDWORD_HANDOFF.md` → `docs/PRODUCT.md` → `docs/DATA_MODEL.md` → `docs/DESIGN.md` → 이 감사 문서.  
> 이 문서는 “이미 잘된 부분을 다시 만드는 문서”가 아니라, 출시와 Shipaton Grand Prize 증거를 막는 차이를 제거하기 위한 correction brief다.

## 1. 최종 판정

현재 Friendword는 **브랜드가 분명하고, 핵심 데이터 모델·RLS·공개 피치·동의·관심·채팅의 골격이 연결된 우수한 기능성 알파**다. 그러나 **실사용자에게 출시 가능한 1.0 또는 계획대로 완성된 P0라고 판정할 수는 없다.**

가장 큰 이유는 다음 네 가지다.

1. **신뢰 약속이 실제 검증보다 앞서 있다.** 이메일 로그인과 초대 링크 소지만으로 Dater를 claim하고 `dater_verified`를 기록하지만 전화 확인, 18+ 확인, liveness/face match, invitation contact 일치는 구현 경로에 없다.
2. **동의 대상 콘텐츠가 검토 시점에 고정되지 않는다.** AI 생성이 승인 요청 뒤 비동기로 실행되고, Introducer가 `consent_pending` 상태에서도 문구 수정·미디어 업로드를 할 수 있다.
3. **두 유료 상품은 결제 코드만 있고 상품 효익이 없다.** Creator Launch credit은 소비되지 않고 premium asset도 없으며, Campaign Pass는 구매 진입 경로와 entitlement-gated 기능이 없다. 무료 사용자가 90일을 선택할 수 있어 Campaign Pass의 30일 가치도 무너진다.
4. **공유·안전·운영의 P0 일부가 placeholder 또는 문서뿐이다.** 모든 실캠페인이 Blair OG 이미지를 사용하고 `/api/og`는 501이며, moderation·비용 cap·사용자 삭제·공개 피치 신고는 실제 경로에 연결되지 않았다.

### 점수표

| 축                    |   점수 | 판정                                                                                    |
| --------------------- | -----: | --------------------------------------------------------------------------------------- |
| 브랜드 차별성         | 8.5/10 | Hype Mixtape의 색·타입·파형·9:16 무대가 기억에 남는다.                                  |
| 공개 피치 시각 완성도 | 8.0/10 | 반응형과 모션은 좋지만 실제 사진·동적 OG·정확한 자막이 필요하다.                        |
| Trust Layer 반영      | 5.5/10 | 동의 화면은 차분해졌지만 account/safety/payment 전반에 스티커 강도가 그대로다.          |
| 접근성                | 5.0/10 | 구조와 reduced-motion 일부는 좋지만 CTA·danger·fine print 대비가 실패한다.              |
| 제품 계약 충실도      | 5.0/10 | 골격은 넓지만 identity, immutable consent, paid value, moderation이 핵심 계약과 다르다. |
| 보안·안전 출시 준비   | 3.5/10 | RLS 기반은 강하나 claim/verification/content-freeze 경계가 출시를 막는다.               |
| RevenueCat 출시 준비  | 2.5/10 | SDK·webhook scaffold는 있으나 돈을 받고 약속한 가치를 전달할 수 없다.                   |
| Grand Prize 준비      | 3.5/10 | 공유 가능한 데모는 있으나 유료 전환·실사용 성장 루프·증거 export가 없다.                |

**냉정한 결론:** “핵심 루프 완성”이 아니라 **“핵심 루프의 UI와 데이터 골격 완성, 신원·동의·결제·운영의 출시 경계 미완성”**으로 문서 상태를 바로잡아야 한다.

## 2. 직접 검증한 것

### 통과

- `pnpm lint`
- `pnpm typecheck` — sandbox의 기존 `tsconfig.tsbuildinfo` 쓰기 제한을 해제한 뒤 전 워크스페이스 통과
- `pnpm test` — 4개 패키지, 총 47개 테스트 통과
- `pnpm format:check`
- `pnpm --filter @friendword/web build` — Next.js production build 통과
- `pnpm test:db` — migration 0001~~0010, DB/RLS suite 01~~10 통과
- `pnpm --filter @friendword/web test:e2e` — Playwright 10/10 통과
- iOS Simulator에서 모바일 홈, Track 1~3를 직접 조작·시각 확인
- 공개 피치 375/768/1280px, 동의 리뷰 화면 스크린샷 직접 확인
- 작업 트리는 감사 전후 clean

### 실패 또는 미검증

- `pnpm check:env` 실패: `EXPO_PUBLIC_WEB_ORIGIN` 누락. 현재 실기기 공유 링크는 `http://localhost:3000`으로 fallback한다.
- `react-doctor@latest`는 로컬 저장소에서 최신 미고정 third-party code를 실행하는 위험 때문에 환경 보안 정책이 거부했다. 프로젝트 의존성에는 저장하지 않았다.
- `node scripts/e2e-production.mjs`는 hosted Supabase에 테스트 사용자를 생성하는 외부 mutation이므로 이번 읽기 중심 감사에서는 재실행하지 않았다. 문서의 기존 39-check 기록과 스크립트 내용을 검토했지만, 실제 RevenueCat sandbox·identity provider·moderation·신규 웹 사용자 브라우저 흐름을 검증하는 테스트는 아니다.

### 테스트가 주는 실제 의미

현재 green test는 **SQL 불변조건과 일부 저장소 호출 계약, 공개 피치/동의 fixture UI**를 잘 보호한다. 다음은 보호하지 않는다.

- 신규 web magic-link 사용자의 `public.users`/`profiles` bootstrap
- 관심 표현, 인박스, Intro Room의 브라우저 E2E
- 모바일 사진 선택→실업로드→승인 링크 share의 실제 기기 E2E
- identity/phone/liveness/face match
- moderation 전후 차단
- RevenueCat sandbox purchase/restore/refund/expiration/transfer
- Creator credit reserve/consume/return
- Campaign Pass benefit gate
- 동의 검토와 동시 Introducer 수정 race
- 사용자 계정·미디어 삭제

## 3. 디자인 감사

### 잘 반영된 부분

- 공개 피치는 `Cream + ink stage + tangerine/pink/yellow + waveform`의 시그니처가 강하다.
- 9:16 stage, 실제 음성 재생, 사진 crossfade, sticky interest CTA, 반응형 레이아웃이 일관된다.
- Unbounded와 Bricolage Grotesque가 실제로 로드되며 generic SaaS 인상을 피한다.
- 공개 피치의 sticker field와 하드 섀도는 캠페인 표현 레이어에서 적절하다.
- consent 리뷰는 공개 피치보다 정보 중심이고 teal control note를 사용해 Trust Layer 방향을 일부 반영했다.
- 웹 공개 피치에는 `prefers-reduced-motion`, 모바일에는 `useReducedMotion` 경로가 있다.
- 375/768/1280px에서 수평 overflow가 없고 10개 E2E가 통과한다.

### 최종 디자인 평가가 반영되지 않은 부분

현재 `docs/DESIGN.md`는 모든 모바일 카드와 CTA에 동일한 sticker grammar를 지시한다. 우리가 합의한 **표면별 강도 레이어**와 **Brand Foundation / Campaign Expression / Trust Layer 분리**가 문서와 토큰에 없다.

확정해야 할 강도는 다음과 같다.

| 표면                                         | 표현 강도 | 규칙                                                          |
| -------------------------------------------- | --------: | ------------------------------------------------------------- |
| 공개 피치·social asset                       |      100% | hard shadow, tilt, sticker, bounce, Unbounded 허용            |
| Introducer 피치 제작                         |       70% | track metaphor와 선택 chip은 유지, form/card 반복은 절제      |
| 모바일 홈                                    |       40% | hero 1개만 강하게, 보조 탐색 버튼은 조용하게                  |
| Dater consent                                |       20% | horizontal·low motion·soft elevation, teal을 신뢰 신호로 사용 |
| Interest / inbox / chat                      |    10~20% | 사진·텍스트·판단이 주인공, tilt 제거                          |
| identity / phone / payment / report / delete |     0~10% | 장식보다 상태·위험·복구 가능성·명확한 hierarchy 우선          |

#### D-P0. 색 대비가 문서의 자체 기준을 위반한다

- `packages/ui-tokens/src/index.ts:44`의 `onPop #FFF9F2`와 `pop #FF5B2E` 대비는 **2.96:1**이다.
- `HypeButton`은 17px bold에 이 조합을 사용한다: `apps/mobile/src/components/HypeButton.tsx:48-83`.
- web primary도 동일하다: `apps/web/src/styles/flowCard.module.css:124-140`, `apps/web/app/consent/[token]/page.module.css:99-114`.
- `danger #E5484D` 위 white는 **3.91:1**, `textFaint #A2958A` on cream은 **2.72:1**이다.
- `docs/DESIGN.md:58-62`는 4.5:1 이상을 약속한다.

**결정:** saturated fill 위 기본 텍스트를 `ink #221B15`로 통일한다. 흰색을 유지하려면 배경을 충분히 어둡게 만든 별도 token과 실제 4.5:1 검증이 필요하다. `textFaint`는 placeholder/disabled 외의 fine print에 쓰지 않는다.

**Acceptance:** Story/showcase 또는 route별 자동 contrast check에서 normal text 4.5:1, large text 3:1; disabled 외 모든 설명문 통과.

#### D-P1. Trust Layer가 별도 primitive가 아니다

- consent card도 hard shadow/tilt/bouncy hover를 사용한다: `apps/web/app/consent/[token]/page.module.css:23-52,99-119`.
- interest/inbox 공용 card도 동일하다: `apps/web/src/styles/flowCard.module.css:29-58,124-155`.
- 모바일 `HypeButton`과 `StickerCard`가 홈·제작·결제 모두 동일하다.

**결정:** `CampaignCard`, `TrustCard`, `PrimaryAction`, `SafetyAction`, `QuietNavAction`을 분리한다. TrustCard는 tilt 0, soft shadow 또는 1px border, motion ease-out, Bricolage 중심이다. identity/payment/report 화면에서는 Unbounded를 wordmark/단일 heading 외에 사용하지 않는다.

#### D-P1. 실제 사람과 목소리가 장식보다 우선되어야 한다

- demo fixture의 일러스트는 스타일 확인에는 좋지만 dating product의 감정적 설득력과 사진 crop을 검증하지 못한다.
- real campaign에 사진이 없으면 Blair placeholder를 쓴다: `apps/web/src/pitch/view.ts:43-62,102-120`.
- 실제 파형과 word-level transcript가 아니라 고정 waveform·단일 headline을 사용한다: `apps/web/src/pitch/view.ts:64-67,103-118`.

**결정:** production campaign은 승인된 실제 사진이 없으면 publish를 막거나 의도적인 non-person placeholder를 명시한다. demo용 Blair와 real fallback을 분리한다. waveform은 음원 분석 결과, caption은 timestamped transcript를 사용한다.

#### D-P1. motion accessibility가 account flow에 불완전하다

- 공개 피치는 reduced-motion을 처리하지만 `flowCard.module.css`와 consent의 hover/transition에는 reduce override가 없다.

**Acceptance:** 모든 animation/transition primitive가 system reduce setting에서 제거 또는 non-spatial fade로 축소된다.

### 디자인 최종 판단

Hype Mixtape 자체는 폐기할 이유가 없다. 오히려 Friendword의 가장 강한 자산이다. 문제는 **캠페인 포스터의 언어를 신원 확인, 결제, 신고, 채팅까지 같은 크기로 말하고 있다는 점**이다. “Gen Z처럼 보이기”보다 “친구의 실제 목소리와 당사자 통제가 믿을 만하게 느껴지기”를 우선해야 한다.

## 4. 제품 계약 대조표

| 계획                                                     | 현재 구현                                                                  | 판정                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| 단일 User, resource 관계 기반 역할                       | 전역 role 없음, membership/owner/sender 관계 사용                          | 충족                                      |
| Introducer 원본 30~60초 음성                             | 모바일 녹음·업로드·공개 재생                                               | 대체로 충족                               |
| AI 구조 JSON을 Introducer가 편집 후 승인 요청            | AI는 submit 뒤 fire-and-forget, 결과를 Introducer가 보지 못함              | 미충족                                    |
| invitation contact와 로그인 identity 일치                | 연락처·친구 이름이 server draft에 전달되지 않고 token possession으로 claim | 미충족                                    |
| Dater 18+·phone·liveness·face match                      | provider class만 있고 호출 경로 없음                                       | 미충족                                    |
| 콘텐츠별 승인·교체·삭제·수정 요청                        | 사진 제거와 기간만 가능; 교체·문구 수정·수정 요청 없음                     | 부분 충족                                 |
| 9:16 motion pitch + caption                              | 동적 web 9:16, photo crossfade, audio; caption/waveform은 placeholder 수준 | 부분 충족                                 |
| no-signup public link + noindex                          | 구현                                                                       | 충족                                      |
| campaign-specific OG                                     | 모든 campaign이 Blair OG, `/api/og` 501                                    | 미충족                                    |
| Verified Interest: adult·phone·photo·bio·intent·identity | self-declared birth date + 2 photo + bio + intent; phone/identity 없음     | 부분 충족                                 |
| Dater accept/decline/report                              | accept/decline 있음, inbox report 없음                                     | 부분 충족                                 |
| Intro Room + report/block/leave                          | 구현, DB/RLS 테스트 있음                                                   | 대체로 충족                               |
| Free Starter core loop                                   | identity/moderation 제외한 링크 기반 루프 존재                             | 부분 충족                                 |
| Creator Launch $4.99 효익                                | purchase scaffold만 있고 premium asset/credit consume 없음                 | 미충족                                    |
| Campaign Pass $19.99 효익                                | entitlement row만 있고 진입·gate·기능 없음                                 | 미충족                                    |
| moderation·delete·retention                              | adapter와 수동 ops 문서뿐; product 경로 없음                               | 미충족                                    |
| analytics / attribution                                  | event RPC와 주요 event 존재                                                | 부분 충족; verification event가 거짓 의미 |
| cost hard cap                                            | 상수·테이블·문서만 존재                                                    | 미충족                                    |
| growth evidence export                                   | script가 exit 1 placeholder                                                | 미충족                                    |

## 5. 출시 차단 P0

### P0-1. 신규 웹 사용자가 실제 core loop를 완료할 수 없다

**증거**

- web magic link는 `signInWithOtp`만 호출한다: `apps/web/src/components/EmailSignIn.tsx:20-37`, `ConsentFlow.tsx:196-213`.
- `ensureUserRow`는 모바일 OTP 성공 후에만 호출된다: `apps/mobile/src/services/authSession.ts:19-33`.
- `public.users.id`는 `auth.users.id` FK이고, web 신규 계정을 자동 provision하는 DB trigger가 없다.
- consent claim은 `pitch_drafts.subject_user_id`에 caller를 쓰므로 public user row가 없으면 FK 실패한다: `supabase/migrations/0005_consent_and_publish.sql:58-95`.
- production E2E는 admin으로 auth/public row를 미리 만들어 이 결함을 우회한다.

**결정**

DB trigger 또는 idempotent server bootstrap RPC 중 하나를 단일 표준으로 채택한다. web의 모든 authenticated flow가 action 전에 `users`와 최소 `profiles` 존재를 보장해야 한다. display name을 email local-part로 영구 확정하지 말고 onboarding에서 사용자가 승인하도록 한다.

**Acceptance**

- 처음 보는 이메일로 magic-link 가입 → consent claim → review가 수동 DB insert 없이 성공.
- 처음 보는 이메일로 interest flow → profile 저장 → interest submit 성공.
- 중복 callback/reload에 idempotent.
- E2E가 실제 bootstrap을 거치며 fixture seed를 쓰지 않는다.

### P0-2. Fake 소개 방어와 “verified” 의미를 실제로 구현한다

**증거**

- `claim_consent_request`는 token, 로그인 여부, Introducer와 다른 계정인지만 확인한다: `0005_consent_and_publish.sql:58-95`.
- 모바일에서 입력한 friend name/contact는 server `DraftInputs`에 포함되지 않는다: `apps/mobile/src/services/pitchDraftsSupabase.ts:46-50,99-108`.
- claim 직후 identity 없이 `dater_verified`를 기록한다: `ConsentFlow.tsx:116-121`.
- `verification_checks`, `phone_verified_at`는 schema에만 있고 production 호출 경로가 없다.
- public copy는 “Only verified profiles”라고 주장한다: `apps/web/app/p/[campaignSlug]/page.tsx:121-133`.

**결정**

1. invite contact를 canonicalized hash로 server에 저장한다. raw contact 보존·삭제 기간은 privacy 문서에 확정한다.
2. 로그인 identity와 invite contact를 OTP/verified channel로 연결한다.
3. Dater: 18+ gate → phone verification → liveness → 대표 승인 사진 face match → `verification_checks` 성공 뒤 claim/publish.
4. Interested Person도 submit 직전 동일한 최소 phone/face gate를 통과한다.
5. `dater_verified`는 provider-success transaction에서만 server-side로 기록한다. 준비 전에는 “signed in”만 표현하고 “verified”라는 카피·badge·event를 쓰지 않는다.

**Acceptance**

- 무관한 로그인 계정이 forwarded token을 열어도 claim 실패.
- Introducer 본인, 이미 다른 계정이 claim한 token, 미성년, phone 미확인, liveness 실패, face mismatch가 각각 테스트됨.
- verified state는 DB provider reference/status/timestamp로 증명되며 client 임의 변경 불가.

### P0-3. 동의 snapshot을 불변으로 만들고 AI 순서를 바로잡는다

**증거**

- 계획은 AI editable JSON을 Introducer가 검토한 뒤 요청하는 것이다: `docs/PRODUCT.md:36-42`.
- 실제는 consent submit 후 `requestDraftGeneration`을 fire-and-forget한다: `apps/mobile/app/pitch/new.tsx:180-195`, `draftGeneration.ts:4-33`.
- `/api/transcribe`는 `consent_pending`도 수정 가능하다: `apps/web/app/api/transcribe/route.ts:46-55,96-100`.
- authenticated Introducer는 consent_pending에서 headline/body를 update할 수 있다: `0002_rls.sql:139-146`, `0003_storage.sql:7-20`.
- storage upload도 consent_pending을 허용한다: `0003_storage.sql:41-54,77-89`.
- publish RPC는 Dater가 실제로 본 revision/asset set인지 검증하지 않는다: `0010_consent_controls.sql:51-114`.

**결정**

- 순서: local record → private server draft upload → AI transcription/structure 완료 → Introducer editable review → immutable consent revision 생성 → invite 발송.
- `consent_revision` 또는 content hash/revision number를 도입한다.
- consent_pending 이후 Introducer의 content/media mutation은 금지한다. 변경은 new revision + Dater 재승인으로만 가능하다.
- Dater는 사진 keep/remove뿐 아니라 replace, copy edit, request changes, reject를 할 수 있어야 한다.
- publish RPC는 Dater가 승인한 exact revision과 asset IDs를 원자적으로 publish한다.

**Acceptance**

- 검토 화면을 연 뒤 Introducer가 문구/사진을 바꾸려 하면 거부됨.
- AI 완료 전 invite 발송 불가; 실패 시 retry와 명확한 상태 제공.
- Dater가 승인한 revision hash와 published projection이 동일함을 DB test가 보장.
- hard claims가 Dater 확인 체크 없이 publish되지 않음.

### P0-4. 두 유료 상품을 서로 다른 고객·scope·효익으로 완성한다

**현재 가장 위험한 점**

- paywall은 context와 무관하게 모든 package를 노출한다: `apps/mobile/app/paywall.tsx:17-22,102-116`.
- Introducer draft에서만 paywall 진입이 있고 Campaign Pass 진입 경로가 없다: `apps/mobile/app/campaigns/index.tsx:92-112`.
- 어떤 상품을 사도 analytics는 creator event를 기록한다: `paywall.tsx:27-46`.
- Creator credit은 `available` insert 뒤 reserve/consume/return 경로가 없다.
- Campaign entitlement를 읽어 기능을 unlock하는 consumer가 없다.
- 무료 consent가 7/30/90일을 제공한다: `ConsentFlow.tsx:404-419`; 원본 Free Starter는 14일, Pass는 30일이다: `FRIENDWORD_HANDOFF.md:428-470`.
- 따라서 Campaign Pass 30일은 무료 90일보다 가치가 낮다.

**webhook correctness 문제**

- mutable subscriber attribute를 transaction scope로 신뢰한다: `api/revenuecat/route.ts:63-66`.
- transaction/original_transaction을 저장하지 않아 delay·다중 campaign·TRANSFER 시 잘못 귀속될 수 있다.
- purchase event insert 후 credit/entitlement write 실패를 무시한다. retry는 purchase unique violation에서 조기 성공해 missing benefit을 복구하지 못한다: `route.ts:92-131`.
- unknown product를 Campaign Pass처럼 취급한다: `route.ts:83-86`.
- Creator refund/cancellation은 credit을 회수하지 않는다: `route.ts:68-76`.
- RevenueCat 공식 문서는 consumable/non-renewing restore에 custom App User ID가 필요하며, webhook identity는 `app_user_id`뿐 아니라 `original_app_user_id`/`aliases`, transfer event를 고려하라고 안내한다.

**결정된 상품 경계**

| 상품                 | 구매자                         | 진입 위치                                  | scope                            | 제공 가치                                                                         |
| -------------------- | ------------------------------ | ------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------- |
| Creator Launch $4.99 | 해당 draft Introducer          | private draft의 “Create social launch kit” | pitch draft / immutable revision | premium theme, composition, approved-content MP4 1회, share kit, regeneration 1회 |
| Campaign Pass $19.99 | published campaign Dater owner | Dater campaign dashboard                   | campaign                         | 30-day operation, vouches, analytics, filters, scheduling, enhanced inbox         |

**구현 결정**

1. context-specific paywall route를 분리하거나 `productIntent` discriminated union을 강제한다. 잘못된 상품 package는 보이지 않고 구매할 수도 없어야 한다.
2. 서버가 signed purchase intent를 발급해 `user + product + scope + revision + nonce`를 고정한다. mutable subscriber attributes만으로 권한을 주지 않는다.
3. webhook 처리는 DB RPC 하나의 transaction으로 purchase event와 benefit ledger를 함께 기록한다.
4. `transaction_id`, `original_transaction_id`, environment, event type, aliases를 저장하고 idempotency를 transaction/event 양쪽에서 설계한다.
5. Creator: `available → reserved → consumed`; render 실패/승인 거절 전에는 release/refund. restore는 소비 credit을 재발급하지 않는다.
6. Campaign Pass: entitlement read path와 실제 feature gates를 만든다. 안전·관심 수락·채팅은 무료 유지.
7. Free Starter 기간은 원본대로 14일로 고정하고, 30/90일 선택 UI는 상품 정책과 다시 설계한다. 90일 무료는 제거한다.
8. RevenueCat purchase 성공을 UI 성공으로 즉시 단정하지 말고 server benefit confirmation까지 pending state를 보여준다.

**Acceptance**

- Introducer는 Campaign Pass를, Dater는 Creator Launch를 잘못 살 수 없다.
- 돈을 낸 모든 성공 transaction은 정확히 하나의 scope benefit 또는 조사 가능한 failed state를 가진다.
- webhook replay, out-of-order, duplicate, benefit-write failure, refund, expiration, transfer, restore를 자동 테스트한다.
- Creator 구매 후 승인된 MP4/share kit가 생성되고 credit이 한 번만 소비된다.
- Campaign Pass 없이/있을 때 gate 차이가 사용자에게 관찰된다.

공식 참고: [RevenueCat webhook event types](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields), [Restoring purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases), [Non-subscription purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions).

### P0-5. UGC moderation, 신고, 삭제를 제품 경로로 연결한다

**증거**

- `OpenAiModerationProvider` class는 있지만 호출자가 없다: `packages/adapters/src/openAi.ts:111-155`.
- pitch/profile upload에 MIME sniffing, byte limit, image decode, moderation gate가 없다.
- Dater inbox에는 accept/decline만 있고 report가 없다: `InboxView.tsx:280-345`.
- 공개 pitch에는 report/revoke contact가 없다.
- 계정 삭제는 `docs/OPS.md`의 수동 SQL 절차뿐이다.
- `apps/mobile/src/safety/README.md`는 3줄 placeholder다.

**결정**

- 업로드 전 client hint + 업로드 후 server authoritative MIME/size/decode/moderation.
- pitch text/audio/image, profile text/image, message에 표면별 moderation policy와 fail-closed/fail-review 결정을 기록한다.
- public pitch report, interest report, room report를 모두 제공한다.
- account deletion, campaign deletion, media lifecycle deletion을 self-service + queued backend job으로 구현한다.
- report queue SLA와 high-severity auto-pause를 실제 job/alert로 연결한다.

**Acceptance**

- 금지 MIME/oversize/flagged content가 publish/submit되지 않는다.
- report가 운영 큐에 도달하고 high-severity campaign을 숨긴다.
- 사용자 삭제가 DB와 storage를 정해진 SLA 안에 제거하고 audit exception만 남긴다.

### P0-6. 공유 루프와 public truth를 완성한다

- 모든 실캠페인 metadata가 `/fixtures/blair-og.svg`를 사용한다: `apps/web/app/p/[campaignSlug]/page.tsx:36-55`.
- `/api/og`는 501: `apps/web/app/api/og/route.ts:1-6`.
- public footer의 두 CTA가 모두 `/`로 가며 root는 plain text뿐이다: `page.tsx:137-149`, `apps/web/app/page.tsx:1-12`.
- `seed-demo`와 `export-growth-evidence`는 exit 1 placeholder다.

**결정**

- Dater-approved photo/copy로 campaign-specific OG를 생성하고 pause/archive/delete 즉시 접근 차단.
- `Pitch a friend`는 app universal link 또는 mobile web creation onboarding, `Create my Friendword`는 Dater-as-introducer가 되는 명확한 flow로 연결.
- root landing을 Trust Layer 기반 acquisition surface로 완성.
- attribution에 campaign/referrer/source를 보존하고 새 campaign creation까지 연결해 K-factor를 계산.

**Acceptance**

- 두 CTA가 서로 다른 의도와 실제 완료 가능한 destination을 가진다.
- iMessage/Instagram/WhatsApp link preview가 campaign별 승인 콘텐츠를 보인다.
- pause/archive 후 OG/media URL도 더 이상 노출하지 않는다.

### P0-7. 환경·출시 gate

- `EXPO_PUBLIC_WEB_ORIGIN`을 production HTTPS origin으로 설정하고 `pnpm check:env` 통과.
- Resend domain, OpenAI key, RevenueCat products/key/webhook, identity/phone provider를 실제 sandbox에서 확인.
- Expo dev build에서 native purchase를 검증.
- 18+ onboarding, Privacy/Terms/Community Guidelines/support/child-safety contact, App Store privacy manifest를 사용자 표면에 연결.
- CI에 web production build와 Playwright E2E를 추가한다. 현재 CI는 lint/type/unit/DB만 실행한다: `.github/workflows/ci.yml:8-48`.

### P0-8. “Verified Interest”를 self-assertion이 아닌 서버 증거로 만든다

현재 사용자는 자신의 `profiles.birth_date`와 `dating_profiles.photos` 문자열 배열을 직접 쓸 수 있고, submit RPC는 생년월일과 배열 길이만 확인한다: `supabase/migrations/0002_rls.sql:72-75,118-130`, `0010_consent_controls.sql:159-170`. 실제 storage object 존재, MIME, moderation, phone, liveness, face match를 확인하지 않는다. 과거 DOB와 임의 경로 두 개만으로 “Verified Interest”를 만들 수 있다.

**Acceptance**

- verified age assertion은 service/provider-owned record로 분리한다.
- photo는 본인 prefix의 실제 object, 허용 MIME/size, moderation, 현재 얼굴 검증을 통과해야 한다.
- `submit_interest`는 phone과 유효한 verification check를 server-side로 검사한다.
- 실패 조건별 DB test와 browser E2E를 추가한다.

### P0-9. 실제 캠페인에 다른 사람처럼 보이는 fixture를 절대 사용하지 않는다

승인 사진이 0장이면 real campaign도 Blair 인물 일러스트를 사용한다: `apps/web/src/pitch/view.ts:43-62,86-120`. Dater가 모든 사진을 제거하고 publish하면 공개 페이지와 고정 OG에 다른 인물처럼 보이는 이미지가 나타날 수 있다.

**결정:** 최소 승인 사진이 제품 필수라면 publish RPC가 1장 이상을 강제한다. 사진 없는 campaign을 허용한다면 인물로 오인되지 않는 branded abstract visual을 사용하고 “photo verified” 표현을 하지 않는다. demo fixture는 production fallback과 완전히 분리한다.

## 6. P1 — Grand Prize 경쟁력

1. timestamped word captions, real waveform, photo-aware composition을 완성한다.
2. Creator Launch의 MP4/social kit을 실제 Instagram/TikTok 공유에 최적화한다. 이 항목을 P2로 미루면 $4.99 상품과 바이럴 성장 가설이 동시에 사라진다.
3. 최대 5개 승인 Vouch Card와 추가 친구 초대 loop를 구현한다.
4. Dater campaign analytics/source/interest funnel과 filter를 Campaign Pass에 연결한다.
5. `My interests` 모바일 placeholder를 실제 web deep link 또는 native list로 교체한다: `apps/mobile/app/interests/index.tsx:1-5`.
6. 모바일 “My dating campaigns”는 현재 Introducer draft catalog다. contextual dashboard로 이름과 정보 구조를 분리한다.
7. `export-growth-evidence`를 익명 집계 export로 구현하고 실제 사용자/매출/공유 증거를 축적한다.
8. provider usage/cost ledger와 75%/90% kill switch를 실제로 연결한다. 현재 $200 cap은 문서와 상수뿐이다.

### 추가 P1 하드닝

- **Authoritative analytics 분리:** `track_event`는 anon도 whitelist의 모든 event를 호출할 수 있다. `dater_verified`, purchase, accept 같은 outcome event는 해당 RPC/webhook transaction 내부에서만 생성하고, client event는 `*_attempted` 또는 UI intent로 분리한다. `sessionStorage` 기반 `pitch_viewed_unique`는 “session view”로 이름을 바로잡거나 서버 dedupe를 설계한다.
- **Upload quota:** bucket MIME/size 제한, magic-byte 검증, 개수 quota, rate limit, orphan cleanup을 추가한다. 현재 path ownership만 있고 비용·악성 파일 방어가 없다.
- **Expiration consistency:** public reader는 `ends_at` 만료를 숨기지만 campaign status는 published로 남고 resume RPC가 기간을 확인하지 않는다. scheduled expiration과 entitlement 상태를 동기화한다.
- **민감 local storage:** invitation contact와 raw consent token을 일반 AsyncStorage 전체 draft에 장기 저장하지 않는다. token 만료/철회, SecureStore 또는 민감 필드 분리, 공유 완료 후 purge를 구현한다.
- **파괴적 행동:** archive, decline, block, leave에 영향 범위·되돌릴 수 없음·확인 dialog를 제공하고 focus trap/Escape/focus return을 테스트한다.
- **Chat accessibility:** 전체 message list의 단순 `aria-live` 대신 `role="log"`, `aria-relevant="additions text"`로 신규 메시지만 알린다.
- **작은 화면과 Dynamic Type:** 모바일 홈을 ScrollView 기반으로 만들고 320×568, 375×667, 430×932, iOS 200% text에서 clipping 없이 핵심 행동에 도달해야 한다.
- **Demo truth:** `demo-blair`는 `audioUrl: null`이라 재생 버튼이 실제 음성 없이 timer만 움직인다. Grand Prize 제출 demo는 권리 확보된 실제 음성·사진 또는 명확한 synthetic demo disclosure와 함께 실제 audio element/caption timing을 검증해야 한다.
- **Metaphor restraint:** “Release day”, “Launch it louder”, “This link doesn’t play” 같은 표현은 campaign surface에만 제한하고 identity/payment/error/safety에서는 직접적인 문구를 우선한다.
- **Dev capture hygiene:** 현재 모바일 캡처의 우측 상단 파란 도구 버튼은 Expo 개발 오버레이다. 제출물과 디자인 승인 캡처는 release/production-like build로 다시 만든다.

## 7. Claude 실행 순서

순서를 바꾸지 않는다. 결제나 디자인 polish 전에 신뢰 경계를 고정한다.

| Slice | 결과                                        | 주요 owned paths                           | 선행 조건               |
| ----- | ------------------------------------------- | ------------------------------------------ | ----------------------- |
| A     | 문서 truth reset + failing regression tests | `docs/**`, tests only                      | 없음                    |
| B     | web user bootstrap                          | auth/data/migration/web auth tests         | A                       |
| C     | invite contact + identity/phone/18+         | migration, provider, consent/interest      | B                       |
| D     | immutable consent revision + AI-before-send | mobile draft, API, migration, consent      | B                       |
| E     | RevenueCat purchase intent + atomic ledger  | purchases, webhook, migration, tests       | B                       |
| F     | Creator/Campaign paid benefit consumers     | media-worker, campaign dashboard           | D,E                     |
| G     | moderation/report/delete                    | adapters, upload APIs, safety, ops         | C,D                     |
| H     | OG/CTA/growth loop                          | public web, OG, universal links, analytics | D,G                     |
| I     | Trust Layer + contrast + responsive QA      | DESIGN/tokens/UI                           | B~H의 화면 계약 고정 후 |
| J     | sandbox/release/evidence                    | CI, E2E, App Store, docs                   | 전체                    |

### 각 Worker brief 공통 금지

- global `users.role`, Creator/Dater account type 추가 금지.
- identity가 없는데 `verified`라고 쓰거나 event를 기록하는 fallback 금지.
- mock identity/moderation/payment으로 production success 처리 금지.
- 안전 기능을 paywall 뒤에 두지 않기.
- Introducer 구매가 Dater control을 변경하지 않기.
- premium feature 없이 purchase UI만 활성화하지 않기.
- service role을 client bundle에 넣지 않기.
- 기존 green test만 통과했다는 이유로 acceptance 완료 처리하지 않기.

### 필수 반환 형식

각 slice 완료 시 Claude는 다음을 보고한다.

```text
CHANGED FILES
DIFF SUMMARY
PRODUCT CONTRACT SATISFIED
SECURITY / PRIVACY IMPACT
TESTS RUN + EXACT RESULT
MANUAL QA SURFACES
RESIDUAL RISKS
```

## 8. 최종 출시 승인 기준

다음이 모두 충족되기 전에는 “1.0 complete”, “verified dating”, “RevenueCat complete”라고 문서에 쓰지 않는다.

- [ ] 신규 Introducer/Dater/Interested Person이 수동 DB 작업 없이 가입·onboarding 완료
- [ ] invite contact + adult + phone + liveness/face 성공 뒤에만 Dater publish
- [ ] Interested Person도 필요한 verification 뒤에만 submit
- [ ] consent revision이 immutable하고 승인 projection과 동일
- [ ] AI structure를 Introducer가 보고 편집한 뒤 invite
- [ ] Dater가 사진·문구·음성·공개 범위를 실제로 승인/수정/거절
- [ ] Creator Launch가 premium asset을 만들고 credit을 정확히 소비/반환
- [ ] Campaign Pass가 Dater campaign에만 적용되고 30일 benefit이 실제 gate됨
- [ ] sandbox purchase/restore/refund/expiration/transfer/replay 통과
- [ ] moderation/report/block/delete/retention 경로 통과
- [ ] campaign-specific OG와 유효한 acquisition CTA
- [ ] 모든 normal text WCAG AA, reduced-motion, 320px~desktop QA
- [ ] lint/type/unit/DB/build/E2E가 CI에서 자동 통과
- [ ] `pnpm check:env` 통과, production secrets/client separation 검증
- [ ] growth evidence export와 실제 dashboard 수치 재현 가능

## 9. 보존해야 할 강점

수정 과정에서 다음은 훼손하지 않는다.

- 원본 친구 음성이 중심인 가치 제안
- public feed/swipe가 아닌 campaign URL 기반 발견
- 하나의 User와 contextual role 모델
- Dater가 공개·중지·삭제를 소유하는 구조
- no-signup viewing, verified-before-interest 원칙
- text-only Intro Room과 contact privacy
- cream/ink/Bricolage/waveform의 Brand Foundation
- 공개 피치에서의 Hype Mixtape 고강도 표현
- RLS와 SECURITY DEFINER RPC를 통한 server-owned state transition
- 결제 여부와 무관한 신고·차단·삭제·채팅

## 10. 독립 검토 메모

두 개의 읽기 전용 독립 검토를 사용했고, 추가 에이전트는 생성하지 않았다.

### 제품·보안 검토

독립 검토도 **P0 미달, 외부 beta와 실결제 차단**으로 판정했다. 특히 다음을 재확인했다.

- 신규 web user provisioning이 없어 consent/interest가 실제 첫 사용자에게 실패한다.
- token-possession claim, 조기 `dater_verified`, self-asserted Verified Interest는 원본 fake-intro 방어를 충족하지 않는다.
- consent TOCTOU는 publish 뒤 늦은 AI update까지 허용할 수 있다.
- Creator credit과 Campaign entitlement는 효익 consumer가 없고 webhook 부분 실패가 영구 benefit 누락으로 이어진다.
- `account_status`가 주요 RPC/RLS에서 강제되지 않아 suspended user 제어도 완결되지 않았다.
- moderation, 데이터 삭제, report operation은 schema/문서보다 실제 제품 경로가 뒤처져 있다.

### 디자인·QA 검토

독립 검토는 **REVISE**로 판정했다.

- 공개 피치는 Gen Z 타깃과 소셜 공유성에 잘 맞고, Friendword의 가장 강한 시각 자산이다.
- Trust Layer 목표 강도보다 consent가 약 40~50%, account/payment surface가 더 높다.
- contrast P0, dead growth CTA, `My interests` placeholder, 실제 음성이 없는 demo가 제출 완성도를 막는다.
- account flow responsive/keyboard/reduced motion/screen reader와 mobile Dynamic Type coverage가 부족하다.
- Unbounded와 mixtape metaphor를 trust surface에서 줄여야 한다.

두 검토 모두 본문의 우선순위와 일치한다. 따라서 Claude는 디자인 리스킨이나 paywall 활성화부터 시작하지 않고 **web bootstrap → verification → immutable consent → commerce state machine → safety → growth → Trust Layer** 순서로 진행한다.
