# Decision Log

## 기록 형식

각 결정은 다음 형식을 사용합니다.

```text
날짜: YYYY-MM-DD
결정: 채택한 선택
이유: 해결하려는 제약과 근거
검토 대안: 검토했지만 채택하지 않은 선택
영향: 제품, 데이터, 비용, 안전, 일정과 관련 brief에 미치는 영향
```

## 2026-07-12: 기술 스택 기본안 채택

- **결정**: Mobile은 Expo/React Native/TypeScript, web pitch는 Next.js/TypeScript, backend는 Supabase, media는 FFmpeg 또는 Remotion, 구매는 RevenueCat, analytics는 PostHog 또는 동등 도구를 기본안으로 채택합니다. AI, identity와 moderation 공급자는 adapter 뒤에 격리합니다. iOS를 우선 출시합니다.
- **이유**: 솔로 개발 범위를 줄이고 8주 성장 기간 안에 모바일, 무가입 web pitch, DB/RLS, media와 수익화를 연결하기 위함입니다.
- **검토 대안**: Android 동시 우선 출시, 공급자별 구현 직접 결합, 앱 내부 pitch 전용 구현.
- **영향**: provider interface, public web boundary, RevenueCat webhook과 Supabase RLS가 초기 구조의 필수 경계가 됩니다.

## 2026-07-12: 단일 계정·컨텍스트 역할 모델

- **결정**: 한 사람은 하나의 User와 RevenueCat App User ID를 가지며 Introducer, Dater, Interested Person 역할은 resource relationship에서 파생합니다. 전역 role/account type과 역할 전환 API를 만들지 않습니다.
- **이유**: 한 User가 서로 다른 캠페인에서 여러 역할을 수행하고 identity와 `dating_profile`을 안전하게 재사용해야 하기 때문입니다.
- **검토 대안**: Creator/Dater 별도 계정, 가입 시 고정 역할, 전역 role switch.
- **영향**: authorization은 membership·ownership·sender 관계를 사용합니다. published campaign에는 `DATER_OWNER` 한 명만 두고 동일 campaign에서 Dater/Introducer 겸임을 금지합니다.

## 2026-07-12: 독립적인 두 유료 상품 구조

- **결정**: Introducer가 pitch draft 하나에 사용하는 $4.99 `Creator Launch` consumable과 Dater가 campaign 하나에 사용하는 $19.99 30-day non-renewing `Campaign Pass`를 독립 상품으로 둡니다.
- **이유**: 제작·공유 개선과 캠페인 운영 권한의 구매자·scope·혜택이 다르며, 무료 Starter에서도 전체 연결·안전 루프가 가능해야 하기 때문입니다.
- **검토 대안**: 자동 갱신 구독 하나, 공개/연결 기능 paywall, 두 상품의 번들·상호 할인, Introducer의 Gift a Pass.
- **영향**: Creator Launch는 `PITCH_DRAFT` scope의 server credit ledger로 `available → reserved → consumed`를 idempotent하게 처리하고, Campaign Pass는 `CAMPAIGN` scope의 30일 entitlement를 webhook과 서버에서 검증합니다.

## 2026-07-13: 워커 운용 2인 체제 축소 (사용자 지시)

- **결정**: codex 토큰 과소모로, 진행 중이던 작업(codex-1 E2E 갱신, codex-2 G-DB, codex-3 D-Mobile) 완료 후 codex-2/3는 추가 지시 없이 대기시키고, 이후 감사 대응은 **Advisor(직접 구현 병행) + codex-1 2인**으로 진행합니다.
- **이유**: 워커 3기 병렬 운용이 codex 사용량 한도를 과속 소진.
- **검토 대안**: 3기 유지(토큰 고갈 시 전면 중단 위험), Advisor 단독(처리량 부족).
- **영향**: 슬라이스 F~J의 분해 단위가 커지고 Advisor 직접 구현 비중 증가. brief는 codex-1 전용으로 발행.

## 2026-07-13: 1차 전수 감사 채택과 실행 순서 고정

- **결정**: `docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`(외부 전수 감사, `5c367ff` 기준)를 현행 개발의 source of truth로 채택하고, 실행 순서를 감사 §7의 A→J로 고정합니다. 문서의 "핵심 루프 완성" 표현을 "핵심 루프의 UI·데이터 골격 완성, 신원·동의·결제·운영의 출시 경계 미완성"으로 정정합니다.
- **이유**: 감사와 두 독립 검토가 일치되게 P0 미달(신규 웹 사용자 bootstrap 부재, token-possession claim, 동의 snapshot 가변, 유료 효익 부재, moderation 미연결 등)을 판정했습니다. 신뢰 경계를 고정하기 전의 결제 활성화·디자인 폴리시는 재작업을 만듭니다.
- **검토 대안**: 기존 TODO 우선순위 유지(사용자 키 게이트 우선), 디자인 Trust Layer 선행, App Store 준비 병행.
- **영향**: Slice A~J가 `docs/TASKS.md`에 추가되고 워커 brief(`.briefs/07~`)가 이 순서를 따릅니다. "1.0 complete", "verified dating", "RevenueCat complete" 표현은 감사 §8 기준 충족 전 문서 사용 금지.

## 2026-07-13: 감사 회귀 스위트는 기대 동작을 인코딩 (초기 FAIL 정상)

- **결정**: `supabase/tests/audit/`(DB)와 `apps/web/tests-audit/`(웹훅 유닛)에 감사 P0 acceptance를 **수정 완료 후 기대 동작** 기준으로 작성합니다. 전용 러너 `scripts/test-db-audit.sh`와 `pnpm test:audit`로 실행하며 기본 `pnpm test`/CI에는 포함하지 않고, 전부 그린이 되는 Slice J에서 CI에 편입합니다.
- **이유**: 기존 하니스(ON_ERROR_STOP 순차 실행)를 그린으로 유지하면서 다음 감사의 합격 기준을 실행 가능한 형태로 먼저 고정하기 위함입니다.
- **검토 대안**: 슬라이스별 테스트 후행 작성(감사 §7 Slice A 지시 위반), `it.fails` 마킹(그린 전환 시점 추적이 불명확).
- **영향**: 각 슬라이스의 완료 정의가 "해당 audit 테스트 그린 전환"으로 관찰 가능해집니다.

## 2026-07-13: 웹 사용자 bootstrap 표준은 DB 트리거

- **결정**: `auth.users` AFTER INSERT 트리거(`private.handle_new_auth_user`, SECURITY DEFINER, 예외 비전파)로 `public.users`+`profiles`를 자동 생성하고 기존 계정은 백필합니다. display_name은 email local-part로 영구 확정하지 않고 `profiles.display_name_confirmed`를 도입해 온보딩에서 사용자가 승인합니다. `ensureUserRow`는 폴백으로 유지합니다.
- **이유**: 웹 매직링크·모바일 OTP·향후 OAuth 등 모든 auth 진입 경로를 클라이언트 코드 협조 없이 커버하는 유일한 지점이 DB이기 때문입니다(감사 P0-1).
- **검토 대안**: idempotent bootstrap RPC를 각 웹 플로우 선두에 호출(호출 누락 위험 상존), 서버 미들웨어 provisioning(모바일 미커버).
- **영향**: migration 0011, suite 11, E2E의 수동 upsert 제거. claim/interest RPC는 public row 존재를 전제할 수 있게 됩니다.

## 2026-07-13: 무료 공개 기간 14일 고정, 90일 폐지

- **결정**: 동의 승인 시 공개 기간은 무료(Free Starter) 14일 고정으로 되돌리고, 30일은 활성 Campaign Pass 엔타이틀먼트가 있을 때만, 90일 선택지는 제거합니다.
- **이유**: 무료 90일이 존재하면 Campaign Pass(30일, $19.99)의 가치가 성립하지 않습니다(감사 P0-4). 원본 제품 계약(`FRIENDWORD_HANDOFF.md`)도 Free 14일/Pass 30일입니다.
- **검토 대안**: 현행 7/30/90 유지(상품 붕괴), Pass를 기간 연장이 아닌 기능 전용으로 재정의(원본 계약 이탈).
- **영향**: `approve_consent_request` 검증 변경(Slice E), ConsentFlow 기간 UI 재설계, audit 테스트 a04에 인코딩.

## 2026-07-12: 로컬 PostgreSQL 17 + plain-SQL 스키마 테스트 하니스

- **결정**: 초기 schema 테스트를 Docker/pgTAP 대신 로컬 PostgreSQL 17과 plain-SQL 하니스로 실행합니다.
- **이유**: 개발 환경에 Docker가 없고 Homebrew에 `pgtap` formula가 없습니다.
- **검토 대안**: Supabase local Docker stack, pgTAP 기반 테스트.
- **영향**: 현재 DB 검증은 로컬 PostgreSQL 17에서 실행합니다. Supabase local stack을 도입할 때 pgTAP과 실행 하니스를 재검토합니다.

## 2026-07-13: 2차 전수 감사 채택과 실행 순서 고정 (Slice 0→10)

- **결정**: `docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`(2차 전수 감사, `941ef55` 기준)를 acceptance source of truth로 채택하고 실행 순서를 감사 §7의 Slice 0→10으로 고정합니다. 제품 상태 판정은 "기능성 베타 — 외부 베타·실결제·Grand Prize 제출 준비 미완"입니다. 완료 판정이 기존 문서와 충돌하면 2차 감사가 우선합니다.
- **이유**: 2차 감사가 1차 대응에서 해소된 것(웹 bootstrap, consent 불변성 등)과 여전히 출시를 막는 네 축(Trust/Safety, Commerce, Core product, Operations/Growth)을 증거 라인 단위로 판별했고, Advisor가 해당 코드를 직접 재확인해 전부 재현됨을 검증했습니다.
- **검토 대안**: 1차 감사 잔여 목록 기준 진행(2차가 코드 게이트로 재분류한 결함을 사용자 키 게이트로 오분류하게 됨).
- **영향**: `docs/TASKS.md`에 Slice 0~10 원장 추가. 감사 §11 완료 주장 금지 목록이 README·Devpost·앱 카피·핸드오프에 적용됩니다.

## 2026-07-13: Launch gate 스위치 도입 (real payments·public beta 서버 차단)

- **결정**: migration 0023이 `app_config`에 `real_payments_enabled`/`public_beta_enabled`(기본 `off`, service role 전용)를 추가하고 BEFORE INSERT 트리거로 강제합니다: `purchase_intents`(구매 시작 자체 차단), `purchase_events`(PRODUCTION environment 이벤트 차단 — SANDBOX는 허용), `interests`(공개 베타 전 관심 표현 차단). RPC 수정이 아닌 트리거인 이유는 후속 슬라이스의 RPC 재정의에도 게이트가 살아남고 direct insert 경로까지 잡기 위함입니다.
- **이유**: 2차 감사 §7 Slice 0 "P0가 해결되기 전 real payments/public beta를 feature flag로 차단한다".
- **검토 대안**: 웹훅 route에서 environment 차단(클라이언트 우회 가능, DB가 authoritative해야 함), `issue_purchase_intent`/`submit_interest` RPC 수정(후속 재정의 시 게이트 소실 위험).
- **영향**: 로컬 테스트 DB는 `seed.sql`에서 두 게이트를 켭니다(hosted는 seed 미적용이라 기본 off 유지). `scripts/e2e-production.mjs`는 실행 창 동안 게이트를 열고 종료 시 원복합니다. 게이트 해제는 Slice 10 release gate 통과 후에만 합니다(`docs/OPS.md` 절차).

## 2026-07-13: 2차 감사 회귀 스위트(audit2)는 기대 동작 인코딩 (초기 FAIL 정상)

- **결정**: `supabase/tests/audit2/`(DB, `b*.sql`)와 `apps/web/tests-audit2/`(웹훅 route 계약)에 2차 감사 P0/CP/H acceptance를 수정 완료 후 기대 동작으로 작성합니다. 러너는 `scripts/test-db-audit2.sh`/`pnpm test:audit2`이며, 전부 그린이 되는 Slice 10에서 CI에 편입합니다. `b09_launch_gates.sql`만 Slice 0부터 그린입니다.
- **이유**: 1차와 동일한 패턴 — 합격 기준을 실행 가능한 형태로 먼저 고정하고 슬라이스 완료 정의를 "해당 테스트 그린 전환"으로 관찰 가능하게 만듭니다.
- **검토 대안**: 슬라이스별 테스트 후행 작성(감사 §7 Slice 0 지시 위반).
- **영향**: b06(identity evidence schema), b07(provider usage RPC), b08(ai consent), b10(만료 상태 기계)은 Advisor가 확정한 미래 계약(테이블·RPC 시그니처)을 선인코딩하며, 해당 슬라이스 설계가 계약을 바꾸면 테스트와 이 기록을 함께 갱신합니다.

## 2026-07-13: 신고 남용 방어 정책 (P0-1) — distinct identity·dedupe·restrictive read

- **결정**: (1) auto-pause는 신고 행 수가 아니라 **신뢰 가능한 distinct reporter identity**(authenticated user id, 익명은 salted IP hash)를 셉니다. hash 없는 legacy 익명 행은 카운트에서 제외합니다. (2) 같은 target+reason+identity의 24시간 내 반복 신고는 BEFORE INSERT 트리거로 dedupe하며, authenticated에게는 정직한 오류를, 익명 경로는 oracle 방지를 위해 조용히 스킵합니다. (3) `x-forwarded-for`는 신뢰 프록시가 append한 **마지막 값**만 identity로 사용합니다. (4) suspended/deleted 계정의 민감 테이블 SELECT는 테이블별 RESTRICTIVE 정책(`private.account_is_active`)으로 일괄 철회합니다(users/profiles/deletion_requests는 상태 표시를 위해 유지). (5) `/api/transcribe`·`/api/media/validate`는 provider 비용 발생 전 active account를 확인합니다.
- **이유**: 2차 감사 P0-1(익명 신고 2건 self-DoS)·H-1(계정 상태 read 미강제). 임계치 2 distinct는 유지하되 identity 위조 비용을 올리는 것이 목적입니다.
- **검토 대안**: 익명 전용 CAPTCHA(무가입 신고 마찰 증가, 후속 검토 가능), 익명 2건은 pause 대신 ops review만(피해자 보호 지연 — 서로 다른 IP 2건은 pause 유지로 결정), 기존 permissive 정책 개별 수정(누락 위험, RESTRICTIVE가 전 정책에 AND로 걸림).
- **영향**: migration 0024, 신고 라우트 proxy trust 수정, audit2 b01(워커)·b11(Advisor) 그린 전환. 두 identity가 같은 NAT 뒤에 있으면 1명으로 계산되는 한계는 수용(잔여 위험으로 기록).

## 2026-07-13: UGC 텍스트·음성 moderation과 사용량 경계 (Slice 2)

- **결정**: (1) voice의 moderatable form은 transcript다 — `/api/transcribe`가 전사 직후 transcript를 moderation하고 그 verdict로 voice object의 `media_validations`를 `skipped→passed/flagged`로 승격한다(구조 검증은 계속 `/api/media/validate` 소유). flagged voice는 draft에 쓰이지 않고 422로 정직하게 반환된다. (2) 텍스트 moderation은 content-addressed 원장(`text_moderations`, scope+sha256 유니크)이며 `/api/moderate-text`가 service role로만 기록한다. enforcement on에서 BEFORE 트리거가 pitch text(consent 진입 시)와 interest bio/note(제출 시)에 정확한 내용의 passed verdict를 요구한다 — 편집하면 hash가 바뀌어 재moderation이 필요하다. (3) 길이 제한(headline 120·body 2000·bio/note 500·message 2000·display name 60), 메시지 rate limit(20건/60초/room), storage quota(prefix당 12개)는 DB가 강제한다. (4) 채팅 메시지는 proactive provider moderation을 하지 않는다 — 길이·rate 제한+신고·차단+운영 조치로 커버하며, 이를 "moderation complete"라고 주장하지 않는다.
- **이유**: 2차 감사 P0-2(enforcement 음성 deadlock)·H-3·H-7. 전사는 pitch 파이프라인에서 이미 필요하므로 moderation을 그 транscript에 얹으면 provider 이중 지출이 없다. content-addressed 원장은 재호출을 무료로 만들고(P0-9 대비) 클라이언트 편집 우회를 구조적으로 막는다.
- **검토 대안**: 별도 audio moderation provider(비용·중복), submit RPC 재정의로 게이트(후속 재정의 시 소실 위험 — 트리거 채택), 채팅 실시간 provider moderation(비용·지연 대비 효과 낮음, 잔여 위험으로 기록).
- **영향**: migration 0025(워커)·0026(Advisor), suite 18 그린, audit2 b12 그린, suite 16·b02는 enforcement-on 성공 경로에 text verdict 픽스처 추가. 모바일 제출과 웹 interest가 moderation API를 선호출(501은 게이트에 위임). `EXPO_PUBLIC_WEB_ORIGIN` 미설정 시 모바일은 localhost 폴백으로 호출한다.

## 2026-07-13: RevenueCat 실이벤트 계약과 durable review 큐 (Slice 3, P0-3·P0-4)

- **결정**: (1) 웹훅 route는 이벤트 타입별 shape만 검증한다 — purchase류는 app_user+product+transaction ids, lifecycle은 product+original_transaction_id, TRANSFER·미지원 타입은 id/type만. (2) `record_revenuecat_event`(0027)는 purchase를 intent 속성 → original transaction lineage 순으로 귀속하고, lifecycle은 purchase_events lineage → intent 바인딩 → (out-of-order 안전용) intent 속성 순으로 귀속한다. (3) 귀속 불가·unknown product·TRANSFER·미지원 타입 등 "돈은 실재하나 자동 처리 불가" 이벤트는 예외 대신 `purchase_event_reviews`(provider_event_id 유니크, open/resolved/discarded)에 저장하고 `needs_review:true`로 응답한다. route는 어떤 RPC 오류도 terminal 200으로 삼키지 않는다(전부 5xx 재시도). (4) 모바일은 단일 identity 서비스가 auth lifecycle(콜드 스타트·SIGNED_IN/OUT·user 변경)과 RevenueCat `logIn`/`logOut`을 동기화하고, purchase/restore는 intent 발급 전 `getAppUserID()==세션 uid`를 보증하며 불일치 시 구매를 시작하지 않는다.
- **이유**: 2차 감사 P0-3(TRANSFER 400, 전 이벤트 intent 강요, terminal 200 유실)·P0-4(anonymous 귀속·계정 전환 오염). 돈을 받은 이벤트는 어떤 경우에도 조용히 사라지면 안 된다.
- **검토 대안**: TRANSFER 자동 이관(잘못된 자동 병합 위험 — MVP는 ops review), lifecycle에 intent 필수 유지(실계약 위반), route에서 salvage 로직(서버 권위 원칙 위반).
- **영향**: 1차 계약 테스트 중 "예외" 기대 4곳(14_commerce 3, a04 1, tests-audit 웹 2)을 review-큐 계약으로 갱신 — 1차 감사 acceptance의 의도(효익 미지급·유실 금지)는 유지되고 처리 방식만 durable해졌다. audit2 b03 그린, 웹 audit2 8/8 그린. 실기기 sandbox(구매→restore→refund→transfer)는 여전히 사용자 게이트(RevenueCat 셋업+dev build) 뒤 — 코드 게이트만 해소된 상태로 "real payments ready"를 주장하지 않는다.

## 2026-07-13: Creator Launch·Campaign Pass 최종 MVP 상품 계약 (Slice 4, CP-5·CP-6)

- **결정**: (1) **Creator Launch $4.99 = 정적 share kit로 확정**: 승인 콘텐츠 기반 9:16 share card + caption pack(완전한 public URL 포함), 발행 후 `/kit/[draftId]`에서 크레딧 1회 소비 unlock, 영구 재진입. premium motion theme·MP4 export·end-card 커스터마이즈·재생성은 **판매하지 않으며 카피에서 약속하지 않는다**(post-launch 로드맵). (2) **Campaign Pass $19.99 = 구매 시점부터 30일 연장 + Pass-게이트 캠페인 퍼널 분석 + 인박스 Pass 섹션으로 확정**. vouch/관심 필터/일정 관리/버전 선택/enhanced inbox는 판매 카피에서 제외. 활성 Pass 중 재구매는 서버가 거부하고 만료 후에만 재구매(가치 누적 스택 없음). (3) 서버 계약(0028): unused credit·unlocked kit·활성 Pass가 있으면 동일 scope intent 발급 거부, 미만료 issued intent는 재사용(더블탭 수렴).
- **이유**: 2차 감사 CP-5의 양자택일에서 "정직한 축소"를 선택 — Shipaton 8/1~9/30 창구 안에서 motion/MP4 파이프라인을 검증 가능한 품질로 만들 수 없고, 감사 원칙은 "구현하지 않을 기능을 판매 카피로 약속하지 않는다"이다. P0-5·P0-6의 1:1 가치 전달이 우선.
- **검토 대안**: 원계약 유지(MP4/motion 구현 — 일정 리스크), Pass 가치 누적 스택 판매(현 시점 불필요한 복잡성).
- **영향**: 킷 캡션에서 "Friend-verified" 제거(§11), 캡션 링크 full URL화. b04·17 그린. 모바일 share/campaigns 표면은 codex-1이 이 계약대로 구현. 가격 대비 가치 재평가는 스토어 준비 시점에 사용자와 재논의 가능(문서 기록 후).

## 2026-07-13: 접점 바인딩 invariant와 typed identity evidence (Slice 5, P0-7·P0-8)

- **결정**: (1) `consent_requests`는 트리거로 "claimable 상태(pending/claimed)에는 verified channel+contact hash 필수"를 강제한다 — 모든 생성·재활성 경로(직접 RPC 포함)를 커버. claim은 unbound 요청을 '재발급 필요'로 fail-closed. legacy unbound 요청의 구제는 introducer 재작성 또는 ops 재발급뿐이다(자동 migration 없음 — hosted에 실사용자 없음). (2) `verification_checks`에 typed evidence 모델(check_type/provider_ref/photo_object_name/result/checked_at/expires_at)을 추가하고, `assert_identity_evidence`는 phone+미만료 passed adult_18plus+liveness를 요구하도록 교체(legacy status/verified_at 행은 더 이상 아무것도 승인하지 않음). publish는 campaigns BEFORE 트리거가 추가로 face_match(photo_object_name=승인 대표 사진, 대표=포함 사진 중 sort_order 최솟값)를 요구하며 resume에도 재검증된다.
- **이유**: 2차 감사 P0-7(직접 RPC의 token-possession claim)·P0-8(만료·종류·사진 무결성 없는 pass row).
- **검토 대안**: submit RPC 전면 재정의(재정의 소실 위험 — 트리거 채택), legacy 자동 hash 백필(원본 contact 미보유로 불가능 — 해시만 저장하는 프라이버시 설계의 의도된 결과).
- **영향**: audit2 b05·b06 그린. 구계약 픽스처 정리: 스위트 04/05/10/12/13/16·a01~~a04·a08~~a10이 contact-bound 제출과 typed evidence로 이행, 12의 "legacy claim 성공" 단언은 "재발급 요구"로 반전. 실 provider 연동·sandbox 증명은 여전히 사용자 게이트(identity 벤더 선정) 뒤이며 enforcement 스위치는 off 유지.

## 2026-07-13: Provider 비용 reserve/reconcile 원장과 외부 AI 동의 (Slice 6, P0-9·P0-10·H-2)

- **결정**: (1) 모든 provider 호출은 사용자 컨텍스트(auth.uid())의 `reserve_provider_usage`로 선예약된다 — kill switch·월간 hard cap($200=20000센트, `provider_monthly_cap_cents`)·사용자 시간당 quota(60)·비활성/삭제요청 계정·draft-scoped AI 작업의 사전 동의(`ai_processing_consents`)를 원자적으로 강제하고, 같은 request_ref replay는 같은 예약을 반환한다(실패 예약은 re-arm). 호출 후 actual_cents로 reconcile. (2) request_ref는 작업 내용에 결합된다: 전사는 voice object 버전, 텍스트 moderation은 content hash, 이미지 검증은 object 이름 — 같은 콘텐츠 재시도는 재과금되지 않는다. (3) 외부 AI 동의는 introducer의 affirmative action으로 `record_ai_processing_consent(draft, revision)`에 기록되고(`AI_PROCESSING_CONSENT_REVISION` 상수), 서버 reserve가 동의 없는 draft-scoped 작업을 차단한다. (4) H-2: 삭제 처리에서 share_kits를 credit ledger보다 먼저 제거(restrict FK). (5) 정기 운영은 `run-scheduled-ops.mjs` 단일 진입점으로 통합하되, 실제 스케줄러 연결은 배포 환경 확정 후로 명시(자동화 완료 주장 금지).
- **이유**: 2차 감사 P0-9(비용 hard cap 부재)·P0-10(외부 AI 동의 부재)·H-2(paid 계정 삭제 FK 실패).
- **검토 대안**: route별 개별 rate limit(전역 cap 불가), 동의를 클라이언트 플래그로만 기록(서버 권위 위반), GH Actions 스케줄 즉시 연결(hosted service key를 CI 시크릿에 넣는 결정은 사용자 몫).
- **영향**: audit2 b07·b08 그린(11/12). transcribe/moderate-text/media-validate 라우트가 reserve→호출→reconcile로 재배선. 모바일 disclosure UI는 codex-1이 구현. 비용 추정치는 보수적 근사(전사 3센트, moderation 1센트)로 COST_MODEL 재검토 대상.
