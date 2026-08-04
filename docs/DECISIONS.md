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

## 2026-07-13: Dater 통제는 immutable revision으로, audience는 interest 경계 트리거로 (Slice 7, CP-1·CP-2)

- **결정**: (1) Dater의 문구 수정은 draft를 직접 고치지 않고 `create_dater_revision`이 **새 immutable revision**을 만들어 consent request를 그 revision으로 갱신한다 — introducer revision과 같은 불변성·hash 규약을 공유하고, 이전 revision id로는 approve가 실패한다(stale 거부). (2) 모든 revision은 생성 시점의 draft transcript를 BEFORE 트리거로 동결한다(0032). (3) 공개 설정(audience 나이·intent 필터, 위치 정밀도 city/region/hidden, 무료 기간 7/14일)은 `set_publish_preferences`가 서버 검증(성인 하한 18 고정)으로 draft에 저장하고, `approve_and_publish_pitch`는 저장된 기간과 일치하는 `campaign_days`만 받아 **정확히 승인 revision snapshot + 저장된 preference**를 campaigns로 복사한다. (4) audience policy는 `interests` BEFORE INSERT 트리거가 강제한다 — 나이 미상 sender는 age-banded policy에서 fail-closed, intent 필터는 dating_profiles 값 기준, policy NULL이면 필터 없음. (5) Dater 본인 사진 업로드는 consent_pending 동안 subject에게만 열리는 RLS(storage+pitch_assets)로 허용하고, revision snapshot의 `included_asset_ids`는 voice를 포함한 전체 asset 집합이다(사진만 넘기면 approve가 voice를 삭제하므로 UI 계약에 명시). (6) 공개 피치는 승인 body 섹션과 접근 가능한 전체 transcript(`<details>`)를 렌더하고, caption은 provider 세그먼트 timestamp, waveform은 실제 오디오 decode에서 파생한다 — Introducer 원본 음성이 중심이고 AI 표현은 Dater 승인본만 노출된다.
- **이유**: 2차 감사 CP-1("모든 단어·사진·audience 통제")·CP-2("구조화된 friend voice 표현"). 통제권은 UI 편의가 아니라 서버 invariant여야 하며(감사 §12), snapshot 발행은 "Dater가 본 것=공개된 것"을 hash로 보증한다.
- **검토 대안**: draft 직접 UPDATE 허용(승인 대상과 공개본의 동일성 붕괴 — 기각), audience 필터를 웹 interest 플로우에서만 검사(직접 insert 우회 — 트리거 채택), 위치 정밀도 region 구현을 위한 지오코딩(현 데이터는 approximate_location 문자열뿐 — city=현행 노출, hidden=미노출, region은 동일 문자열 정책으로 시작).
- **영향**: audit2 b13 그린(12/13, 잔여 red는 b10뿐). 웹 ConsentFlow에 편집·업로드·공개 설정·프로필 확인 UI(codex-1), `/p` 공개 페이지에 승인 body+transcript 섹션. trust note 카피를 실제 통제권 범위로 갱신. 남은 CP-2 항목인 word-level timestamp 하이라이트는 세그먼트 단위로 시작(whisper verbose_json word 단위는 비용·정밀도 재평가 후).

## 2026-07-13: 데모는 정직한 서면 프리뷰, 공개 표면은 영어 기본 (Slice 8, CP-3·CP-4)

- **결정**: (1) **Blair 데모에서 가짜 재생을 제거**한다 — 오디오가 없는 pitch는 Play 버튼·타임라인·타이머를 렌더하지 않고, 전체 서면 피치와 "No voice recording in this preview" 정직 표기를 보여준다. 랜딩 데모 밴드 카피도 "데모에는 음성이 없고 실제 페이지는 친구의 실제 음성을 재생한다"로 고친다. 권리 확보된 실제 데모 음성 녹음은 사용자 결정(직접 녹음 등) 뒤에 언제든 fixture `audioUrl`로 끼울 수 있다 — 코드 경로는 이미 실오디오를 지원한다. AI 합성 음성은 "Introducer 원본 음성" 경계(§CLAUDE 8)와 충돌하므로 채택하지 않는다. (2) **첫 출시 locale은 영어** — 랜딩·공개 피치·OG·모바일 잔여 문자열을 영어로 전환하고, Playwright(§8-16)와 프로덕션 E2E가 `lang="en"`+한글 0자를 회귀로 고정한다(한국어는 후속 locale로 재도입 가능, 기본값 금지). (3) Creator kit 전달을 E2E로 고정: revoked credit 후 재구매 허용→unlock 1회 소비→재진입 idempotent→9:16 카드 렌더(10g~10j).
- **이유**: 2차 감사 CP-3(가짜 재생은 Grand Prize 대표 데모에서 불허)·CP-4(북미 영어권 타깃)·§7 Slice 8(Creator 결과물 e2e). E2E가 한국어를 기대하던 잘못된 고정도 함께 제거.
- **검토 대안**: TTS 데모 음성(원본 음성 경계 위반·기만 위험 — 기각), 데모 유지+각주(Play가 동작하는 것처럼 보이는 한 기만 — 기각), 한국어 병행 기본(북미 acquisition 불일치 — 기각).
- **영향**: `PitchPlayer`가 no-audio 모드를 얻고 fixture 데모가 서면 프리뷰가 된다. landing/pitch Playwright 스펙 영어 전환+한글 회귀 추가(39 passed). 프로덕션 E2E 10e~10j 추가. 남은 한글은 코드 주석의 한국어 문서 섹션명 인용뿐(제품 카피 아님). App Store/email 카피는 해당 표면 구축 시 영어 기준으로 작성한다.

## 2026-07-13: 성장 지표 서버 권위·만료 상태기계·컨텍스트 내비 (Slice 9, H-4·H-5·CP-7·H-8)

- **결정**: (1) **outcome 분석 이벤트는 상태가 바뀌는 테이블의 AFTER 트리거가 기록한다**(0033: campaigns/consent_requests/interests/intro_rooms/messages/reports/blocks/purchase_credit_ledger/campaign_entitlements, `recorded_by: "server"` 스탬프). RPC 재정의에도 살아남고 direct insert 경로까지 커버한다. `track_event`는 client interaction 이벤트 9종만 받고 속성 allowlist+실재 검증을 강제하며, 익명은 `pitch_viewed_unique`/`interest_started`만 보낼 수 있다. 웹·모바일의 outcome 전송 코드는 전부 제거했고, 모바일의 동의 초대 공유는 `consent_invite_shared`로 분리해 `campaign_shared`를 공개 캠페인 공유(kit download/copy, `?src=creator-kit` attribution)에만 쓴다. (2) **만료 상태기계**: `expire_due_campaigns()`(service role 전용)가 `ends_at` 경과 캠페인을 `expired`로 전환하고, `set_campaign_status`는 창이 끝난 캠페인의 재개를 거부하며 expired→archived만 허용한다. 인박스는 `ends_at` 경과를 클라이언트에서도 'Ended'로 표시해 잡 지연 중에도 Live/Resume를 보여주지 않는다. 만료 잡은 `run-scheduled-ops.mjs`에 편입. (3) **CP-7**: `list_my_interests()` RPC(blocked 제외)+모바일 My interests 실화면, Introducer work의 서버 draft 병합 복구(codex-1). (4) **H-8**: 채팅 메시지 목록 `aria-live=polite`→`role="log"`, block/leave에 명시적 confirm 추가.
- **이유**: 2차 감사 H-4(조작 가능한 analytics로는 Grand Prize 증거 불가)·H-5(만료 불일치)·CP-7(컨텍스트 UI 낙후)·H-8. K-factor·전환 지표 정의와 한계는 ANALYTICS_PLAN "지표 정의" 절에 문서화.
- **검토 대안**: RPC 내부 기록(재정의 소실 위험 — 트리거 채택), client 이벤트 전면 금지(유입·노출 지표 소실 — interaction만 허용), 읽기 시 lazy 만료 전환(public read는 이미 ends_at 기준 — 상태·이벤트 일관성은 잡이 담당).
- **영향**: audit2 **14/14 전부 그린**(b10·b14 포함). 스위트 09/12를 새 계약으로 갱신. `AnalyticsEventName` 타입이 client 이벤트로 축소. verification_pending/blocked 상태 계약을 RPC·repo·모바일 라벨에 정렬. 남은 H-8 항목(터치 타깃 전수 측정·스크린리더 실기기 QA·TrustCard 대비 측정)은 Slice 10 기기 패스에서 수행.

## 2026-07-13: Slice 10 release gate 판정 — launch gate는 유지(off)

- **결정**: 2차 감사 §7 Slice 10 체크리스트를 실행한 결과, **`real_payments_enabled`/`public_beta_enabled`는 계속 off로 유지**한다. 코드·스키마·테스트 게이트는 전부 통과했으나, 감사 §13의 일곱 조건 중 세 가지가 사용자 게이트 뒤에 남아 있어 실결제·외부 공개 조건이 충족되지 않았다.
- **통과한 게이트 (Advisor 직접 재실행)**: 전체 CI 세트(lint/typecheck/unit/format/web build/Playwright 39/웹 audit 11+audit2 8) · clean DB에서 migrations 0001~~0033 전체 적용+스위트 01~~18 그린 · **audit2 14/14 그린 및 CI 편입**(웹 test:audit2 + DB test-db-audit2.sh) · 프로덕션 E2E 신규 사용자 full loop 전 체크 PASS · 만료/삭제/orphan 정기 ops hosted 드릴 클린 · provider kill switch hosted 드릴(on→차단, off→복구, 원복 확인) · 신고 남용 방어(b01+E2E+Slice 1 브라우저 검증) · 영어 공개 데모(가짜 재생 없음) · GROWTH_EVIDENCE는 "수집 전" 정직 상태 유지.
- **미충족(사용자 게이트) — 해제 전 필수**: (1) RevenueCat 셋업+dev build 후 sandbox 실왕복(purchase→restore→refund→transfer), (2) identity 벤더 계약+키 후 enforcement on 실증(현재는 로컬 fixture 증명뿐), (3) OPENAI 키 후 moderation enforcement on 실증, (4) 실기기 iOS flow QA(시뮬레이터·웹 검증만 존재), (5) Resend 도메인·`EXPO_PUBLIC_WEB_ORIGIN`.
- **검토 대안**: public_beta만 선해제(관심 표현은 identity gate 미실증 상태에서 성인 증거 없이 열림 — 기각), sandbox 없이 real_payments 해제(감사 P0-3/4 acceptance 위반 — 기각).
- **영향**: 제품 판정은 "기능성 베타 — 실결제·외부 공개 서버 차단"을 유지한다. 사용자 키 게이트가 채워지는 시점에 위 다섯 항목을 순서대로 실증한 뒤 launch gate 해제를 다시 판단한다(그때 이 문서에 기록). §11 금지 표현은 계속 사용하지 않는다.

## 2026-07-14: 3차 감사 수용 — public beta gate의 의미 확정과 QA preview allowlist (Slice 0, P0-NEW-4)

- **결정**: (1) 3차 감사(`docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`, 기준 `0f9311f`)를 새 acceptance source of truth로 수용한다. 판정은 "기능성 내부 베타"이며, 2026-07-13 Slice 10 판정문의 "코드·스키마·테스트 게이트는 전부 통과" 표현은 3차 감사로 반증되었다(green test가 비용 cap 조작·동의 순서 위반·moderation 우회·public gate 무력화를 가렸다). (2) **`public_beta_enabled=off`의 의미를 "외부 공개 차단"으로 확정**한다: interest 제출(기존 0023)에 더해 campaign의 published 전이(initial publish·resume·re-publish)와 공개 read(공개 pitch 페이지·OG)까지 서버에서 차단한다. migration 0034가 campaigns BEFORE INSERT/UPDATE 트리거로 published 전이를 게이트하고, 웹 read는 `getPublishedPitchBySlug`/OG 라우트가 gate를 확인해 닫힌 캠페인을 404로 처리한다. (3) 내부 QA는 service-role 암묵 우회나 gate 전역 토글 대신 **명시적 `qa_preview_allowlist`**(pitch_draft 단위, service role 전용)를 쓴다 — 프로덕션 E2E는 자기 draft만 allowlist에 넣고 끝나면 지운다. (4) 작업 체제는 Advisor(오케스트레이터)+Claude Opus 워커 2~3명으로 전환(사용자 지시, codex 토큰 고갈). (5) 3차 감사 회귀는 audit3 스위트(`supabase/tests/audit3/`, c-prefix)로 신설하고 red-first로 작성한다.
- **이유**: 3차 감사 P0-NEW-4 — 0023의 gate는 interests INSERT에만 붙어 있어 "외부 공개 서버 차단" 문서 주장이 코드와 달랐다. 이미 published된 row도 gate off에서는 공개 페이지가 닫혀야 한다(감사 acceptance).
- **검토 대안**: gate의 의미를 "관심 제출만 차단"으로 축소 재정의(이미 발행된 미검수 콘텐츠가 인터넷에 남는 것을 허용 — 기각), 공개 read를 RLS로 차단(공개 페이지는 service client 경유라 RLS가 적용되지 않음 — 앱 계층 게이트+DB 전이 트리거 조합 채택), e2e의 gate 전역 토글 유지(프로덕션 gate가 QA 중 전역으로 열림 — allowlist 채택).
- **영향**: publish·resume는 gate on 또는 allowlist 등록 시에만 가능. 문서 truth reset(README·PRODUCT·COST_MODEL·ANALYTICS_PLAN·TASKS·SESSION_HANDOFF)으로 감사 §9 금지 표현 제거. 감사 §13 금지 표현 목록("hard cap 완료", "외부 공개 서버 차단" 등)은 acceptance 증거 전까지 사용 금지.

## 2026-07-14: provider 원장 service-only 전환과 AI 동의 revision binding (Slice 1, P0-NEW-1·P0-NEW-2)

- **결정**: (1) `reserve_provider_usage`/`reconcile_provider_usage`를 **service_role 전용**으로 재작성(0035). API 라우트가 authoritative user·kind·scope·estimate를 결정하고, 클라이언트는 cents·status·request_ref를 고를 수 없다. estimated_cents는 1~50으로 bound(0-비용 예약 금지). (2) request_ref마다 **atomic lease**(token·5분 만료·attempt_count): granted=true를 받은 attempt만 provider를 호출하고, 활성 lease 중 중복 요청은 거부, succeeded replay는 저장 결과 재사용(재호출 금지), 만료 lease는 cap 재검사 후 re-arm. reconcile은 lease token 일치를 요구해 stale attempt가 승자를 덮지 못한다. (3) **보수적 실패 회계**: failed/timeout은 GREATEST(actual, estimate)를 cap에 남긴다. 'released'(0)는 provider 호출이 전혀 없던 경로 전용. (4) **외부 AI 동의를 모든 usage kind로 확장**하고 서버 관리 `ai_disclosure_current_revision`에 bind — 임의 문자열·구 revision 동의는 무효. 동의 scope는 draft(`pitch_draft`)와 사용자 단위(`own_content`, Interested 사진·bio/note) 두 종류. (5) **동의 선행 순서**: 모바일은 server draft 생성→동의→업로드→검증/전사로 분리(`uploadDraftMedia` 신설), 웹 interest는 affirmative 동의 후에만 업로드·모더레이션. `write_manually`/무동의 경로는 `/api/media/validate`가 **구조 검사만** 수행하고 moderation 'skipped' 기록 — 외부 AI 호출 0회, enforcement는 계속 fail-closed.
- **이유**: 3차 감사 P0-NEW-1(비용 cap 조작·중복 과금·실패 비용 소실)·P0-NEW-2(동의 전 사진 전송, revision 무결성 부재).
- **검토 대안**: 라우트에서만 권한 검사(DB direct RPC 우회 가능 — 기각), 실패 시 실비용 조회 후 기록(provider가 실패 과금을 조회로 안 주는 경우 다수 — 보수적 estimate 유지 채택), 동의를 draft 스코프로만 유지(Interested/프로필 경로 커버 불가 — own_content 신설).
- **영향**: audit3 c02·c03이 계약을 회귀로 고정(red→green 증거 확보). b07/b08은 새 계약으로 갱신. 모바일 67 테스트(+8), 웹 audit3 10 테스트 신설·CI 편입. README·COST_MODEL의 cap 표현을 acceptance 근거와 함께 상향. 잔여: 실키 enforcement-on 검증·실기기 QA는 사용자 게이트(§12), Dater upload의 draft-scoped 동의 확장은 Slice 2.

## 2026-07-14: 채팅 moderation 출시 정책 — reactive-only 명시 (Slice 2, H-3)

- **결정**: Intro Room 채팅의 출시 정책을 **reactive-only**로 명시한다. 서버가 강제하는 것: 참가자 판정(비참가자 read/write 불가), 메시지 길이(2000)·rate limit(20건/60초/room), 신고(운영 큐 적재)·차단(즉시 양방향 중단)·나가기(방 종료), 차단·정지·삭제 계정의 접근 차단. 서버가 하지 않는 것: **pre-send 외부 AI moderation과 async quarantine은 하지 않으며, 이를 "moderation complete"라고 표현하지 않는다.** 운영 SLA: 내부 베타 동안 신고 큐를 매일 1회 이상 확인(OPS 기존 SLA 준용), 외부 베타 전 재평가.
- **이유**: 3차 감사 H-3. pre-send 외부 AI는 대화 양쪽의 AI 처리 동의와 메시지당 비용(사용자당 quota 소진)을 요구하고, 사적 대화 전문을 외부 provider로 상시 전송하는 프라이버시 트레이드오프가 있다 — 관심 표현까지 양측이 신원·프로필 검증을 거친 1:1 대화라는 점에서 내부 베타 위험 수준과 불균형하다.
- **검토 대안**: pre-send OpenAI moderation(양측 동의+비용+사생활 전송 — 외부 베타 규모에서 재평가), keyword 기반 high-risk 감지(우회가 쉬워 안전 착시를 만들 위험 — 기각), async quarantine(전송 후 회수는 이미 노출된 뒤라 효과 제한 — 기각).
- **영향**: COMMUNITY_GUIDELINES·OPS에 정책·한계를 명시. 외부 베타 해제 조건 재평가 목록에 "채팅 moderation 정책 재검토"를 유지. 이 정책은 `public_beta_enabled=off`(0034 authoritative) 상태의 내부 베타 기준이다.

## 2026-07-14: Dater revision·publish의 authoritative validation과 승인 snapshot 완결 (Slice 2, P0-NEW-3·P0-2)

- **결정**: (1) `/api/media/validate`의 pitch-media 인가를 확장 — draft creator(Introducer) 상시, **subject(Dater)는 status='consent_pending' 동안** 허용(그 외 403 유지). Dater의 moderation 예약은 Dater 본인의 draft-scoped AI 동의로 게이트(0036이 reserve/record 동의 RPC의 draft 인가를 subject로 확장). (2) `create_dater_revision`은 enforcement on에서 포함 photo 전부의 validation full-pass와 텍스트의 content-addressed passed verdict(공식은 0026/라우트와 byte-identical, raw `headline\n\nbody` — 입력은 양쪽 다 zod trim을 거쳐 동일)를 요구. `/api/moderate-text`에 `dater_pitch_content` kind 신설(subject+consent_pending 인가, scope는 'pitch_content'로 기록). (3) **dater_edited 확인 항목**: Dater가 문구를 바꾼 revision은 `dater_edited=true`로 기록되고 approve에 `hard_claims_confirmed=true`를 요구(플래그 무관) — AI 재추출 없이 "직접 바꾼 문구의 사실성 확인"을 보수적 상위집합으로 강제. (4) `approve_and_publish_pitch`가 included photo를 승인 시 재검(enforcement on)하고 **approved revision transcript를 pitch_drafts.transcript로 무조건 복사** — public reader가 읽는 행이 승인 snapshot과 일치. (5) manual(no-AI) 경로 정책: enforcement on 동안 manual 초안 '제출'은 의도적으로 차단하고 모바일이 전용 카피("AI 검수 없이 쓴 초안은 safety review가 켜진 동안 게시 불가")와 AI 경로 전환을 제공 — 미검수 음성이 공개되는 것보다 정직한 제한을 택함(사람 검수 운영 도입 시 재평가).
- **이유**: 3차 감사 P0-NEW-3(정상 UI 403 + direct 우회 publish), P0-2(manual 경로 회귀의 정책 부재), CP-1.
- **검토 대안**: Dater upload를 Introducer 위임 검증으로 우회(주체 불일치·감사 명시 기각), Dater edit 시 AI 재추출(Dater 경로에 비용·동의 추가 — 확인 강제로 대체), transcript를 read 시점 revision 조인으로 해결(reader 전면 개편 — atomic copy 채택).
- **영향**: audit3 c04 + 웹 audit3 8테스트(dater 인가 매트릭스) red→green. b13은 dater_edited 계약으로 갱신. consent Playwright에 동의 스텝 반영(40 passed). e2e-production에 mock 없는 Dater upload→validate→moderate→revision→publish 단계(6k) 추가. Dater "사진 교체" 대표 기능이 정상 UI 경로에서 실제로 동작.

## 2026-07-14: 계정 가드 전수·introducer 삭제 정책·review payload 보존 (Slice 3, H-1·H-2·H-4·H-5·H-6)

- **결정**: (1) **가드 전수 원칙** — authenticated가 실행 가능한 모든 SECURITY DEFINER RPC는 예외 없이 `private.assert_active_account`를 지난다(0037). 예외는 anon 표면(get_ai_disclosure_revision 등)과 service-role 전용 함수(reserve/reconcile — target_user 검사로 커버)뿐이며 인벤토리 표로 기록한다. (2) **Introducer 삭제는 프라이버시 우선**: 본인이 녹음한 voice는 개인 데이터로 보고 삭제하며, voice를 잃은 published/paused campaign은 archived로 전이한다(Introducer 원본 음성이 감정적 중심이라는 제품 경계 §8 — 음성 없는 피치를 계속 공개하지 않는다). Dater 소유 데이터는 보존. (3) **purchase_event_reviews payload**: resolved 후 90일 경과 시 PII scrub(요약 유지), open review는 운영 필요로 보존. (4) **H-4**: raw consent token은 승인/거절/만료 확인 시·publish 시·계정 전환 시 로컬에서 purge, 업로드 완료 draft의 로컬 미디어 사본도 publish 후 정리. (5) **H-5**: profile-media에 owner-prefix client DELETE policy를 열고 웹 Remove/rollback이 storage object를 실제 삭제(orphan cleanup은 잔여 안전망으로 강등). pitch-media는 client DELETE 불허 유지. (6) **H-6**: 정기 ops는 GitHub Actions cron(`scheduled-ops.yml`)을 표준 실행 경로로 하되, 시크릿 등록 전까지 비활성임을 명시(사용자 게이트) — "자동화 완료" 주장은 시크릿 등록·실행 증적 후에만.
- **이유**: 3차 감사 H-1(suspended/deleted의 RPC 우회 read), H-2(삭제 정책·보존 미정), H-4(bearer token 로컬 잔존), H-5(storage orphan), H-6(스케줄러 미연결).
- **검토 대안**: introducer 삭제 시 voice 보존·재귀속(타인 소유 캠페인 유지에 유리하나 삭제권·음성 개인정보 원칙과 충돌 — 기각), campaign paused 전이(재개 시 음성 부재 상태 노출 — archived 채택), review payload 무기한 보존(분쟁 대응에 유리하나 PII 최소화 원칙 위반 — 90일 채택).
- **영향**: audit3 c05가 가드 매트릭스·삭제 시나리오·scrub·DELETE policy를 회귀로 고정. PRIVACY_DATA_MAP·OPS 갱신 대상.

## 2026-07-14: Commerce 상태기계 확정 — Pass 재구매·연장·restore·alias·refund 계약 (Slice 4, P0-3·P0-5·P0-6)

- **결정**: (1) **Intent 동시성**: `purchase_intents`에 (user, product, scope) partial unique(issued) + `issue_purchase_intent` advisory lock — double-tap은 기존 intent 재사용. (2) **Campaign Pass 상태기계** — 2026-07-13 "만료 후 재개 불가" 결정을 명시적으로 개정한다: **무료 resume 불가는 유지**하되, **유료 Campaign Pass 구매가 expired 캠페인의 유일한 재개 경로**가 된다. "30일 추가"는 `GREATEST(now, ends_at) + 30일`로 확정(active면 잔여기간 뒤에 추가, lapse면 구매 시점부터 — scheduler 지연과 무관하게 동일). grant 시 expired→published 전이는 0034 public-beta 게이트의 지배를 받는다: 비공개 베타 중에는 entitlement는 기록하되 revival은 review 큐('revival_blocked_by_beta_gate')로 보류하고 게이트 해제 후 반영한다(돈을 받았으면 벤핏 기록이 유실되지 않아야 한다). paused 캠페인의 grant는 창만 연장하고 paused를 유지(자발적 중지 존중). (3) **Restore는 intent 무발급**: restore는 기존 구매의 복원이므로 클라이언트가 새 purchase intent를 만들지 않는다(이 결함이 active benefit 존재 시 restore를 막고 있었다). (4) **Alias 귀속**: 웹훅 벤핏 owner resolution은 raw_app_user_id 실패 시 aliases 배열로 귀속한다. TRANSFER는 service-role `resolve_purchase_event_review(reassign/dismiss)`로 운영 종결하며 OPS 런북에 절차를 기록한다. (5) **Refund/consumed kit**: refund는 available/reserved credit을 회수하지만 **consumed credit으로 이미 생성된 Creator kit은 회수하지 않는다**(전달 완료된 소모성 디지털 재화; 반복 refund는 운영 review 신호).
- **이유**: 3차 감사 P0-5(intent 동시성·refund 계약 불명), P0-6(상태기계 모순·restore 차단·"30일"의 이중 해석), P0-3(alias 미사용·transfer 도구 부재).
- **검토 대안**: 만료 즉시 삭제/영구 종결(문서의 재구매 약속과 충돌 — 기각), "30일"을 항상 구매 시점 기준(active 사용자의 잔여 가치 소멸 — 기각), restore에도 intent(이중 발급·차단 재현 — 기각), TRANSFER 자동 재귀속(소유권 분쟁 자동화 위험 — 운영 도구 채택).
- **영향**: audit3 c06이 계약을 회귀로 고정. FRIENDWORD_HANDOFF 원 계약과의 차이는 이 문서가 canonical. REVENUECAT_SETUP·OPS 갱신 대상. sandbox 실왕복(purchase→restore→refund→transfer)은 사용자 게이트로 잔존.

## 2026-07-14: Slice 4 구현 확정 — record RPC는 payload 단일 시그니처 (계약 개정)

- **결정**: `record_revenuecat_event(payload JSONB)` 단일 시그니처를 유지하고 alias는 서버가 `payload->'aliases'`에서 파생한다. 별도 `event_aliases TEXT[]` 파라미터(초기 계약안)는 채택하지 않는다 — 라우트가 payload와 다른 배열을 넘겨 어긋날 수 있는 경로를 없애는 서버 권위 원칙. 웹 라우트 테스트가 "별도 파라미터를 넘기지 않음"까지 회귀로 고정.
- **이유**: 병렬 워커 간 계약 불일치를 Advisor 통합 검증에서 발견(mock 스파이 테스트는 실제 PostgREST 시그니처 해석을 검증하지 못함) — 단일 소스 계약으로 수렴.
- **영향**: 이 유형(신규 RPC의 라우트-DB 시그니처)은 향후 mock-free 검증(e2e 또는 hosted 드릴)을 acceptance에 포함한다.

## 2026-07-14: 성장 루프 계약 — 무료 공유·waitlist acquisition·referral 진실 (Slice 5, GP-P0-1·GP-P0-2·H-7·H-8·H-9)

- **결정**: (1) **Introducer 무료 공유가 기본**(GP-P0-1): published 캠페인의 Introducer는 live URL 열람·native Share·링크 복사를 무료로 쓴다(`list_my_introduced_campaigns` RPC — 비공개 상태에선 slug를 반환하지 않아 링크 유출 방지). Creator Launch는 무료 공유의 paywall이 아니라 premium share asset 선택 상품으로 강등 노출. 공유 링크는 `?src=introducer-share&ref=<slug>` attribution을 유지한다. (2) **Acquisition은 waitlist로 시작**(GP-P0-2): 스토어 배포 전이므로 공개 pitch의 `Pitch a friend`는 랜딩 waitlist 섹션으로 연결하고, `join_waitlist`(anon RPC, email 형식·중복 no-op·시간당 cap)로 수집한다. **K-factor를 주장하지 않고 waitlist conversion으로 명확히 낮춘다**(감사 acceptance). (3) **Durable referral chain**: `?ref=<campaignSlug>`를 `fw_referral`로 보존 → 로그인 사용자는 `claim_referral`(first-touch, 사용자당 1개, 자기 캠페인 무시) → 새 캠페인 publish 시 서버 트리거가 `new_campaign_id`를 기록(client 위조 불가). (4) **H-7 활성 1캠페인**: owner당 published/paused 캠페인 1개를 트리거+advisory lock으로 강제. Campaign Pass는 기간 상품이지 수량 상품이 아니다. Pass revival이 이 guard에 걸리면 0038 패턴대로 review 보류. (5) **Exporter 진실화(H-8·9)**: `k_factor_estimate` 제거 → `share_proxy_events_per_published_campaign`, server-recorded 지표는 `recorded_by='server'`만 집계, client 지표는 한계 명시 분리, 결제는 refund lineage 차감 `net_paid_transactions`, 신규 `attributed_new_campaigns`(referral chain 기반), 모든 지표에 timezone/window/source_of_truth/limitations 메타데이터.
- **이유**: 3차 감사 GP-P0-1(핵심 viral actor가 공유 불가), GP-P0-2(유입→신규 캠페인 경로·측정 부재), H-7(문서만 있는 무료 1캠페인), H-8·9(위조 가능한 지표와 K-factor 오명명).
- **검토 대안**: 즉시 web pitch creation 개방(음성 녹음·동의 흐름의 웹 이식 규모 과대 + 공개 게이트와 충돌 — waitlist 채택), Introducer 랭킹/보상(§CLAUDE 8 경계 위반 — 미채택), last-touch referral(공유 루프 측정에 first-touch가 보수적·단순 — first-touch 채택).
- **영향**: audit3 c07이 guard·referral·waitlist를 회귀로 고정. ANALYTICS_PLAN·COST_MODEL·GROWTH_EVIDENCE·PRIVACY_DATA_MAP(waitlist email PII) 갱신 대상. waitlist 이메일 발송(초대)은 Resend 사용자 게이트 뒤.

## 2026-07-14: 대표 데모 정직화·judge-safe flow·structure scene (Slice 6, GP-P0-3·CP-2)

- **결정**: (1) 데모의 미구현 정보(age 29, `+2 friends vouch`)를 제거하고 이를 정답으로 고정한 E2E를 실제 계약으로 교체한다. age는 W2의 실구현(Dater 확정 birth date 파생)에 한해 `pitch.age` non-null일 때만 공개 헤더에 노출한다(프리뷰=공개본 동일성). vouch(Flow D)는 P1 미구현이므로 표시하지 않는다. (2) 대표 데모용 실음성 seed 파이프라인(`scripts/seed-demo-pitch.mjs` + manifest)을 구축한다 — OPENAI 키 없이 동작(수기 transcript/segments 전제), `rightsCleared:true` 없이는 emit 거부, TTS/AI 합성 음성 금지(2026-07-13 결정 유지). 실음성 파일 도착 전까지 공개 데모는 정직한 서면 프리뷰를 유지한다. (3) judge-safe interest→inbox→accept→Intro Room은 **새 게이트 신설 없이** 기존 경계(0034)의 allowlist 의미로 성립함을 c09로 잠근다 — 비-allowlist는 interest 제출 경계에서 차단되어 downstream 도달 불가. (4) `submit_interest`의 ON CONFLICT DO UPDATE 게이트 우회 의혹은 **실증으로 기각** — PostgreSQL은 tentative row에 BEFORE INSERT 트리거를 발동하므로 우회가 존재하지 않는다(0001~0039 대조 실험). 존재하지 않는 취약점을 수정한다고 주장하는 migration을 배포하지 않기로 하고 migration 0040은 미사용 갭으로 남기며 c11이 재제출 게이트 동등성을 회귀로 잠근다. (5) CP-2: structure JSONB를 hook/relationship/qualities/anecdote/good-match scene으로 매핑하고, photo scene은 실제 audio duration·segment 경계로 전환하며, caption은 segment-level로 정직화(가짜 word 하이라이트·극단 fallback 제거), waveform 실패는 접근 가능한 상태로 표시한다(OG·kit의 장식 waveform도 비-waveform 그래픽으로 교체).
- **이유**: 3차 감사 GP-P0-3(대표 데모가 차별점을 체험시키지 못함)·CP-2(구조화 음성 표현 부족). 증거가 지시보다 우선한다는 원칙으로 0040을 철회했다.
- **검토 대안**: TTS 데모 음성(원본 음성 경계 위반 — 기각 유지), decide/room에 defense-in-depth 게이트(운영 액션 과차단·기존 스위트 충돌 위험 — 기각), 0040 DiD 재추가(중복 — 기각).
- **영향**: audit3 c09·c11 신설(11/11), pitch-scene-timing 웹 유닛 신설, pitch/landing Playwright 계약 교체. 잔여 사용자 게이트: 권리 확보 실음성 녹음(도착 시 seed 1회 실행), hosted judge-safe seed 프로비저닝, real-audio 육안 QA.

## 2026-07-14: Dater 프로필 확정·canonical location·voice 보존·recap 이원화 (Slice 6, CP-1·CP-8)

- **결정**: (1) consent에 Dater 본인 확인 단계를 추가한다 — birth date(18+ 서버 검증), 구조화 location(region 필수·city 선택), dating intent를 `set_dater_profile` SECURITY DEFINER RPC(0041)로만 기록(신규 컬럼 직접 grant 없음). `approve_and_publish_pitch`는 active-account 가드 직후 **18+를 fail-closed로 재강제**한다(birth_date 직접 UPDATE grant는 interest-sender 경로 보존을 위해 유지하되 publish가 최종 게이트). (2) 공개 location은 canonical로: hidden→미노출, region→region만, city→"City, Region". legacy 행(구조화 region 부재)의 region 정밀도는 **null로 fail-closed**(city 수준 문자열을 절대 노출하지 않음). (3) `PublishedPitch`는 structure/age/datingIntent/canonical location을 노출하고 birth date 원본은 절대 노출하지 않는다. 계정 삭제 시 cascade로 파기. (4) consent 최종 검토는 설정 요약이 아닌 **실제 출력 still 스냅샷**(cover=재생 첫 사진, 이름+age, canonical location, headline/body, 포함 사진 순서)이며, 사진 순서는 친구 원본 유지(포함 여부만 선택)·음성 trim 불가를 카피로 정직 표기한다. (5) `create_dater_revision`의 명시 asset 목록은 draft의 voice asset을 **자동 포함**한다 — photos-only 클라이언트 목록이 승인 시 Introducer 원본 음성 행을 삭제할 수 없다(Advisor 검증 파생 하드닝). (6) CP-8: AI path는 recording step에서 recap 요구를 제거(caption은 transcript 파생, 선택 수정만), manual/no-AI path만 제출 시 recap 필수(`ManualRecapRequiredError`).
- **이유**: 3차 감사 CP-1(실 output preview·age/location/intent 미확정·region==city)·CP-8(voice-first 약속과 recap 의무 충돌). voice 보존은 UI 계약을 서버 invariant로 격상.
- **검토 대안**: birth_date 직접 grant 철회(verified-interest 경로 파손 — 기각), 지오코딩 기반 region(데이터 부재 — Dater 입력 구조화 채택), voice 누락 목록 거부(픽스처·UI 파손 큼 — 자동 포함 채택).
- **영향**: migration 0041, audit3 c08(red-first, voice 보존 포함), data 68 테스트, consent Playwright 16, e2e-production.mjs에 7w~7z(게이트 self-check→프로필 설정→검증) 추가. 프로덕션 E2E는 0041 hosted push 후 재실행 필요.

## 2026-07-14: 상품 계약 단일화와 kit 정직화 (Slice 6, CP-5·CP-6·§9)

- **결정**: (1) canonical 상품 계약을 문서 전체 단일 소스로 강제한다 — 2026-07-13 상품 계약 + 2026-07-14 Commerce 상태기계 확정의 합. `FRIENDWORD_HANDOFF.md`의 원계약은 삭제하지 않고 "원 계약(historical — post-launch 로드맵, 현재 미판매)"으로 분리하며 상단에 현행 MVP 계약 콜아웃(Creator Launch=정적 9:16 share kit+caption pack·unlock 1회 소비·영구 재진입 / Campaign Pass=GREATEST(now,ends_at)+30일 연장+퍼널 분석+인박스 섹션·만료 후에만 재구매·유료가 expired 유일 재개 경로)을 둔다. PRODUCT·COST_MODEL·웹/모바일 카피를 1:1 정렬(diff 0). (2) kit-image의 가짜 waveform을 제거하고 정직한 "VOICE PITCH / Press play at the link" 요소로 교체(실 voice-derived 서버 디코드는 정적 카드에 과도한 의존성 — 기각). (3) kit 산출물은 승인 snapshot 콘텐츠만 사용하며(headline=승인 revision, 대표 사진=포함 사진 중 sort_order 최솟값) 재승인이 필요한 신규 표현을 만들지 않는다 — audit3 c10으로 고정. (4) PRODUCT.md의 motion pitch 현재-기능 표기를 현행 구현으로 하향하고 structured scene은 진행 중 목표로 명시. (5) Pass 카피에서 미구현 가치 약속 0건, audience filter는 무료 Dater consent 기능으로 판매 카피에서 제외. 결제 전 analytics teaser는 범위 통제로 구현하지 않는다.
- **이유**: 3차 감사 CP-5(계약 병존·가짜 waveform·재승인 경계)·CP-6(미구현 약속)·§9(문서 truth 충돌). "구현하지 않을 기능을 판매 카피로 약속하지 않는다".
- **검토 대안**: 원계약 삭제(로드맵 기록 소실 — historical 분리 채택), kit waveform 실 파형 렌더(과도한 런타임 의존 — 기각).
- **영향**: HANDOFF/PRODUCT/COST_MODEL·KitView·kit-image·InboxView·모바일 paywall/campaigns 카피 정렬, audit3 c10 신설. kit 픽셀 렌더 QA는 hosted 프로덕션 E2E(10g~10j)에서 검증.

## 2026-07-14: Trust Layer 스펙 확정·consent 단계화·모바일 QA 차단 해소 (Slice 7, §8·§11)

- **결정**: (1) **Trust Layer 시각 스펙을 수치로 확정**(DESIGN.md): trust 표면(consent/report/delete/payment)은 1px hairline(`strokes.trust`), soft shadow(`shadows.trust`=0 4px 16px rgba(34,27,21,0.08)), tilt 0, Unbounded는 카드당 heading 1개, teal은 신호 전용. 신규 토큰 `borderMuted`(#8A7D73)·`borderSuccess`(#0E8F76)로 3:1 미달 경계 2건(textFaint 2.72/2.92, fresh 2.35/2.51 — red-first)을 해소하고 contrast matrix에 영구 음성가드 2개를 편입. landing/공개 피치의 hype 강도는 유지. (2) **consent 검토는 wizard식 분리 대신 "6단계 numbered step + sticky scroll-spy progress rail"**: 모든 입력을 마운트 유지해 RPC 순서·검증·Slice 6 프리뷰를 무변경으로 보존(§8 acceptance는 단계화 OR sticky progress — 기존 16 스펙의 cross-step 단언 보존을 우선). (3) **interest 카드-레벨 하향은 의도적 보류**: kit(70% expression)과 스타일 모듈을 공유하므로 44px+정온 chip까지만 적용, 완전 분리는 interest 전용 trust 모듈 후속 리팩터로. (4) **app/ 콜로케이트 테스트 금지**: expo-router가 `app/` 하위 테스트를 라우트로 번들해 Expo Go 부팅이 불가능했던 잠복 결함(07-13 유래)을 S7 시뮬레이터 QA에서 발견 — 테스트를 `src/screens/__tests__/`로 이동하고 no-colocated-tests 가드 테스트로 재발 차단. (5) 로그아웃 campaigns의 introduced 섹션은 generic 에러 대신 sign-in 유도로 통일.
- **이유**: 3차 감사 §8(trust 순간의 과도한 hype 강도·인지 부담·contrast 미검사·44px)·§10 Slice 7·§11 browser/device. 시뮬레이터 QA가 green test가 놓친 부팅 불가 결함을 즉시 드러냄 — "green test는 완료 증거가 아니다"의 실증.
- **검토 대안**: wizard식 단계 분리(기존 스펙 커버리지 손실·상태 재작성 위험 — 기각), metro blockList(이동으로 근본 해소 가능 — 문서화만), kit까지 함께 하향(70% expression 표면 훼손 — 기각).
- **영향**: ui-tokens 20 테스트(음성가드 2), 모바일 104(가드 1 포함), Playwright 46(consent 회귀 5 추가), 44px 실측표(§보고). 실기기 iOS QA만 사용자 게이트로 잔존. interest 전용 trust 모듈은 후속 항목.

## 2026-07-14: TestFlight 배포 채널 신설 (Advisor 단독, 사용자 요청)

- **결정**: EAS Build/Submit 기반 TestFlight 내부 테스트 채널을 만든다 — `apps/mobile/eas.json`(development/preview/production, remote 버전·autoIncrement), 앱 아이콘/스플래시 자산(Hype Mixtape: tangerine 필드+cream 스피치 버블+ink/flirt waveform+hype 스타 — 1024 아이콘은 Devpost 제출 요건 겸용), `extra.eas.projectId`는 `.env`의 `EAS_PROJECT_ID` 주입. 대화형 크리덴셜 단계(Apple Developer Program, eas login/init, env:push, 첫 빌드 승인)는 전부 사용자 게이트로 OPS.md 런북에 분리한다. 키·시크릿 값은 Claude가 수신하지 않는다.
- **이유**: 실기기 QA(Slice 7 잔여 사용자 게이트)를 장소 제약 없이 반복 가능하게. Shipaton 규칙상 8/1 전 비공개 테스트 허용 — 공개 release만 창구 내(수동 release 전략 유지).
- **검토 대안**: 로컬 케이블 설치(장소 제약 — 기각), Ad Hoc 배포(기기 UDID 관리 부담 — 기각), 공개 App Store 조기 출시(Shipaton 규칙 위반 — 금지).
- **영향**: expo config 정상 해석·모바일 typecheck green. 잔여: 사용자 1회 셋업(OPS.md) 후 첫 TestFlight 빌드. RevenueCat sandbox 검증(Slice 8)은 TestFlight 빌드에서 이어서 가능.

## 2026-07-18: Campaign Pass 제품 ID rename과 ASC 상품 유형 확정

- **결정**: (1) Campaign Pass의 스토어 제품 ID를 `campaign_30d_1999` → **`campaign_pass_30d_1999`**로 전 계층 1:1 rename(dual-ID 매핑 계층 금지, migration 0042가 활성 RPC 5개를 최신 정의본에서 문자열만 교체해 재정의). 사유: App Store Connect에서 동일 ID의 IAP를 생성 후 삭제하는 실수로 Apple이 ID를 팀 단위 영구 잠금. (2) ASC 상품 유형은 두 상품 모두 **소모품(Consumable)** — 새 ASC UI에 "갱신 안 함 구독" 유형이 없고, Pass의 30일 기간·적층·만료는 서버 상태기계가 전담하므로 스토어 유형 의존이 없다. 자동 갱신 구독은 비자동 갱신 계약 위반이라 금지.
- **이유**: RevenueCat/ASC 실제 셋업 중 발견. 운영 교훈: **ASC IAP ID는 삭제해도 영구 소각** — 생성 전 ID 재확인, 삭제 금지.
- **검토 대안**: 서버-스토어 ID 매핑 계층(진실 이원화 — 기각), 자동 갱신 구독 유형(계약 위반 — 기각).
- **영향**: 0042 hosted 배포, contracts/data/mobile 상수·SQL 테스트 9종·문서 3종 교체(rc-rename 워커, red-first: 옛 RPC에서 새 ID 거부 재현 → 0042 후 green, Advisor 전 스위트 재실행 green). RevenueCat/ASC에는 새 ID로 상품 등록.

## 2026-07-23: Shipaton 2026 규칙 재확인 게이트(개발 시작일) 수행과 상금 표기 갱신

- **결정**: 본격 4차 감사 대응 착수 전 재확인 게이트(개발 시작일)를 수행하고 `docs/HACKATHON_RULES.md`를 2026-07-23 기준으로 갱신한다 — (1) Grand Prize $50k/$100k 불일치는 해소되어 1위 $100,000/2위 $20,000/3위 $10,000, 사이드 어워드 8개 각 $15k/$10k/$5k를 인용 가능 표기로 승격(Final Official Rules 재대조 전제). (2) 총상금은 3종 표기($490k+/$700k+ cash/$1M+ total) 병존으로 확정 사용 금지 유지. (3) 제출 오픈은 Devpost dates 기준 7/31 08:00 PDT(Overview 본문 "8/1"과 상충 기록), 앱 릴리스 윈도우 8/1~9/30 불변. (4) 대한민국은 2025 룰 제외국 미포함 선례로 "참가 가능성 높음, TBD"로 기재.
- **이유**: Official Rules는 여전히 pending이고 Updates 탭이 비어 있어, 공개 요약 페이지의 현재 상태를 절대 날짜와 함께 고정 기록해야 이후 룰 공개 시 diff가 가능하다.
- **검토 대안**: 룰 공개까지 재확인 연기(착수 직전 정보로 전략을 짜야 하므로 기각), 상금 확정 표기 전면 유지(불일치가 실제 해소되어 과도한 보수성 — 기각).
- **영향**: HACKATHON_RULES.md 일정·상금·자격·게이트 체크리스트·변경 기록 갱신. Pre-8/1 TestFlight 허용은 여전히 미명시라 internal-only 운영 불변. 다음 게이트는 App Store 심사 제출 전.

## 2026-07-25: 정기 운영은 GitHub Actions 대신 Supabase pg_cron (사용자 결정)

- **결정**: 정기 운영 실행 경로를 GitHub Actions cron에서 **hosted Supabase pg_cron**(migration 0043)으로 전환한다. 순수 SQL pass 2종만 스케줄: `expire_due_campaigns()` 15분 주기(4차 감사 H-17 창 축소), `scrub_resolved_purchase_review_payloads()` 매일 03:30 UTC. Storage API가 필요한 계정 삭제 처리·orphan 스윕은 실사용자 유입 전까지 Advisor 수동 실행으로 유지하고, 출시 하드닝(4차 Slice 9)에서 Storage 접근 가능한 스케줄 런타임(예: Supabase scheduled Edge Function)으로 승격한다. `.github/workflows/scheduled-ops.yml`은 삭제, CI 워크플로는 비활성화(파일은 보존 — 여건 변화 시 재검토).
- **이유**: private 레포의 Actions 무료 분량 소진 + 결제 여력 부재로 매시간 잡이 시작조차 못 하고 실패 메일만 발송("recent account payments have failed or your spending limit needs to be increased"). 사용자가 GitHub Actions 불사용을 명시 결정(2026-07-25). pg_cron은 hosted DB 안에서 무료로 돌고 네트워크·시크릿 의존이 없다.
- **검토 대안**: GitHub 결제 한도 상향(비용 — 기각), 레포 공개 전환으로 무료 분량 확보(전략 문서 노출 — 현 시점 기각, 재검토 가능), Vercel Cron(Hobby 티어 주기 제약 — 기각).
- **영향**: 0043 마이그레이션(pg_cron 가드 — 로컬 하니스는 NOTICE 후 no-op), OPS.md 정기 운영 섹션 재작성. 로컬 게이트(lint/type/test/format + DB 하니스 4종)가 push 전 유일한 회귀 검증이 됨 — Advisor가 push 전 반드시 실행. GH Actions 시크릿 2종은 등록됐지만 미사용. 검증: 로컬 DB 하니스 base+audit 7/7+audit2 14/14+audit3 11/11 green, hosted 배포는 supabase CLI 로그인(사용자 게이트) 후 `db push`.

## 2026-07-29: 모션 피치 출력 고도화 트랙 개시와 7개 제약 확정 (사용자 인터뷰)

- **결정**: "사진 선택 + 녹음"만 하는 사용자에게 인스타 릴스/틱톡에 올릴 만한 출력을 주는 것을 다음 제품 축으로 세우고, 시작 전 사용자 인터뷰로 다음 7개를 확정한다. (C1) 해커톤 마감과 무관하게 제대로 만든다 — 단 각 단계는 독립 출시 가능해야 한다. (C2) **AI는 효과만, 사진 원본 픽셀은 유지** — 생성형 이미지·아웃페인팅·스타일 트랜스퍼로 인물이 달라지는 것 금지, Ken Burns·마스크·타이포·컷·컬러 그레이드는 허용. (C3) 기본 무료 + 프리미엄 유료 — 무료 티어에서도 충분히 wow해야 바이럴이 성립한다. (C4) 렌더당 소액, 벤더 비용 **월 $200 캡** 이내. (C5) 출력은 웹 플레이어와 MP4 **둘 다**, 웹 먼저 MP4 나중 — 단 **처음부터 하나의 scene definition을 공유**하도록 설계한다. (C6) **음악 없이 내보내고** 사용자가 IG/TikTok에서 트렌딩 오디오를 입힌다 — 음원 라이선스 리스크 0, 대신 편집 리듬의 비트 소스는 Introducer의 목소리(transcript 세그먼트 타임스탬프·무음·강세)다. (C7) **동영상 업로드 포함** — 사진+동영상 혼합.
- **이유**: 현재 출력은 사진 크로스페이드 + 자막 + 파형이 전부이고(`apps/web/src/pitch/scenes.ts`, `view.ts`), 서버 렌더러(`media-worker/`)는 9줄 placeholder다. 4차 감사 GP-P0-1이 "구조화된 모션 피치"를 P0로 지목한 항목과 정확히 같은 공백이다. §8의 경쟁 경계 중 "외부 공유 가능한 세로형 모션 피치"가 실제로는 미구현 상태였다.
- **검토 대안**: (C2) 생성형 이미지 허용(인물 동일성·동의 경계 훼손 + 플랫폼 AI 라벨링 의무 발생 — 기각), (C5) 웹 전용 또는 MP4 전용(전자는 공유 마찰, 후자는 미리보기 부재 — 둘 다 채택하되 장면 정의 공유로 이원화 방지), (C6) 앱 내 음악 번들(라이선스 비용·지역 제한 — 기각).
- **영향**: Opus 2명(렌더 파이프라인 실현가능성 / scene grammar·무료-프리미엄·승인 영향) + Codex 2명(코드베이스 통합·마이그레이션 / 정책·모더레이션·비용·경쟁) 4인 조사 트랙 개시. 공통 브리프는 scratchpad `MOTION_TRACK_BRIEF.md`. 승인(consent) 범위 확대 여부 — Dater가 정지 사진만 승인하고 모션·크롭은 승인하지 않은 상태로 공개해도 되는지 — 는 조사 결과를 받아 별도 결정으로 기록한다. 동영상 UGC 추가에 따른 모더레이션 의무는 §9에 따라 mock으로 완료 처리하지 않는다.

## 2026-07-29: 신고 라우트의 in-process 직렬화 철회와 미디어 등록 시점 원복 (Advisor 판단, 적대적 검증 결과)

- **결정**: (1) `/api/report`의 in-process `runExclusive` 게이트와 64-deep 부하 셰딩을 **삭제**하고, 원자성은 신규 migration `0045`의 `reports` BEFORE INSERT 트리거(`pg_advisory_xact_lock`)로 옮긴다. (2) 캠페인당 익명 신고 한도의 응답을 200에서 **429로 되돌린다**. (3) 모바일 `pitch_assets` 등록을 제출 시점으로 미룬 변경을 **원복**하고, 원래 잡으려던 결함(제거한 사진이 여전히 게시될 수 있음)은 사진 제거 시 등록 행도 함께 제거 + 제출 직전 집합 대조로 해결한다.
- **이유**: 세 수정 모두 적대적 검증에서 재현된 반증을 받았다. (1) 게이트가 캠페인 조회와 이미 429 확정인 요청까지 직렬화해 정상 신고자 지연이 120ms→2630ms로 악화되고, 80 동시 요청에서 **진짜 신고 16건이 503으로 소실**됐다 — 안전 신고 엔드포인트에 공격자가 값싼 억제 지렛대를 얻는다. (2) 200 응답은 `ReportCampaignLink.tsx:34,41-45`를 통해 버려진 신고에 "Report received. Our team reviews every report."라고 **거짓 영수증**을 주고, 버려진 고심각도 신고가 `pause_campaign_after_high_severity_report`(0024:57+)에 도달하지 못해 저심각도 20건으로 자동 일시정지를 차폐할 수 있다. 오라클도 실제로는 닫히지 않았다(한도 초과 요청이 프로버 자신의 IP 카운터를 올리지 않아 6회 요청으로 대상 상태 판독). (3) 등록을 미루면 `pitch_assets` 행도 `consent_revisions` 행도 없는 진행 중 draft가 `scripts/cleanup-orphan-media.mjs`의 48시간 orphan 스윕 대상이 되어 **Introducer의 음성과 사진이 조용히 삭제**된다.
- **검토 대안**: (1) 임계 구역을 count+insert로 축소(프로세스 전역 상한은 그대로 남음 — 기각), (2) 200 유지 + UI 카피 수정(신고가 자동 일시정지에 도달하지 못하는 문제는 미해결 — 기각), (3) orphan 스윕에 in-flight draft 보호 규칙 추가(참조 원장을 이원화 — 등록 원복이 더 단순, 기각).
- **영향**: 0045 신설, `/api/report` 재작성, 트리거 메시지→429 매핑 계약(`report rate limit exceeded for this reporter` / `... for this campaign`), 모바일 등록 경로 원복 + `pitch_assets` 삭제 경로. 함께 발견된 별도 버그: `enforce_message_rate_limit`(0025:27-46)의 카운트에 락이 없어 동일한 경합을 갖는다. **구현·재검증 진행 중이며 이 결정으로 완료 처리하지 않는다.**

## 2026-07-29: 모션 피치 아키텍처 확정 — 승인 대상은 MP4가 아니라 장면 JSON (인터뷰 2차 + 4인 조사 종합)

- **결정**: (1) **Dater의 승인 대상을 `PitchScene` JSON으로 정의**한다(U5). 불변 `consent_revisions.scene_definition` + `scene_hash`를 승인 증거로 삼고, consent 미리보기·공개 웹 플레이어·MP4 워커가 **모두 같은 JSON만** 해석한다. 워커는 hash를 재검증해 불일치 시 거부한다. 이로써 "승인 후 정확히 한 번 렌더"와 "승인한 것과 나가는 것이 같다"가 동시에 성립하고, 웹 미리보기가 곧 MP4 미리보기가 되어 확인 비용이 $0이 된다. (2) **렌더러는 브라우저를 합성기로 쓰는 단일 React 컴포넌트** — 웹은 브라우저에서 실행, MP4는 headless Chromium 프레임 캡처 + FFmpeg 인코딩. FFmpeg는 합성기가 아니라 인코더이자 업로드 클립 정규화기다. (3) **Remotion 미채택**(A2) — ≤3인 무료지만 4인 for-profit 순간 월 최소 $100로 총예산의 50%. 검증된 CDP 캡처 루프(~300줄)로 대체한다. (4) **실행처는 Vercel Fluid**(U6). (5) **공개 URL은 웹 플레이어, MP4는 다운로드 산출물**(A1). (6) **효과는 15종 닫힌 union**이며 렌더러가 union 밖을 만나면 plan을 거부한다 — C2가 약속이 아니라 코드 강제가 된다. U1에 따라 제3자 보호용 블러·크롭만 예외. (7) **무료에 MP4 1회 포함**(U7), 워터마크 제거는 판매하지 않는다. 프리미엄은 신규 SKU 없이 기존 `campaign_pass_30d_1999`에 얹는다. (8) 인터뷰 2차 확정: 제3자·미성년자는 **블러/크롭 허용**(U1), $200은 **회사 총비용 전부**(U2), 사람 검토는 **당분간 사용자 본인**(U3), 1차 출시는 **미국**(U4).
- **이유**: Opus-R·Opus-C·Codex-I 셋이 서로 모르는 채 "승인 대상은 MP4가 아니라 장면 정의"라는 같은 결론에 도달했다. 실측 근거: 브라우저 합성 0.92 CPU-s/video-second vs FFmpeg 0.73(1.26배 차이뿐), 로컬 ffmpeg 빌드에 `drawtext`·`subtitles` 부재, headless Chrome `<video>` seek 드리프트 0ms. 비용 실사에서 병목이 렌더가 아님이 드러났다 — 렌더는 월 1,000건에 $6 미만이고, 실제 병목은 ①자동 모더레이션 ②에그레스 ③OpenAI다. 웹 플레이어 열람 5MB vs MP4 35MB의 7배 차이가 A1의 근거다.
- **검토 대안**: 승인 전 proof MP4 렌더(렌더 2배 + 승인 전 공유 가능 아티팩트 생성 + "정확히 한 번" 제약 개정 — 기각), 정지 프레임 승인 유지(크롭 키프레임·강조 단어·병치가 전부 승인 이후 생성되어 실질적으로 승인하지 않은 영상이 나감 — 기각), 선언적 scene JSON + 웹/서버 렌더러 2종 구현(픽셀 동등성이 "비슷하게 보이는 두 구현"으로 전락 — 기각), Shotstack/Creatomate 외부 API($0.133/건, 20~50배 — 기각), Supabase Edge Function(CPU 2초·메모리 256MB로 50배 부족 — 기각), Cloud Run·Fly(월 $2.3 차액에 세 번째 클라우드 도입 — 기각).
- **영향**: 계획 문서 [`MOTION_PITCH_PLAN_2026-07-29.md`](MOTION_PITCH_PLAN_2026-07-29.md) 신설. 5단계 20~~28 영업일, 각 단계 독립 출시 가능. 선행 작업 2건: `timestamp_granularities=['word']` 추가(비용 $0), `pitch_assets`에 width/height 컬럼. **Phase 1보다 먼저 고칠 P0**: `create_dater_revision`이 Dater가 고친 headline/body를 저장하면서 `structure`를 원본 그대로 복사하고, 공개 페이지는 `structure`를 렌더하고 `body`를 무시한다 — 즉 **Dater가 고친 문장이 공개 페이지에 반영되지 않으며**, `three_specific_qualities`는 consent 화면에 아예 표시되지 않는데도 페이지는 "every word here was reviewed and approved"라고 주장한다(§8·§12 위반). 미검증으로 남은 것: 클라우드 vCPU 벤치마크(원가 전체가 "클라우드 = M4 Pro의 1/2~~1/2.5" 가정 위에 있음), 컨테이너 콜드스타트, Safari↔Chromium 스크린샷 diff, TikTok 공식 safe zone 실측값, Creatomate 가격 — **사용자 대면 문구에 쓰지 않는다.** 경쟁 실사 결론: 자동 릴스 편집은 moat가 아니며(CapCut·Canva 우위) 남는 차별점은 신뢰 workflow와 distribution loop다. Hinge가 2026년 `Friend's Take`를 시험 중이다.

## 2026-07-30: Dater가 공개되는 모든 텍스트를 보게 만든다 (5차 감사 P0, 0047)

- **결정**: (1) Dater의 승인 대상을 `structure`의 **다섯 필드 직접 편집**으로 바꾸고, `headline`/`body`는 **서버가 그 structure에서 파생**한다(`0047`). 클라이언트가 보낸 headline/body는 published structure가 존재하면 **읽지 않는다** — 레거시 4-인자 경로에서도 그렇다. (2) **전사는 편집 불가, 그러나 consent에 전면 노출**한다. 친구가 실제로 한 말을 고치게 하면 §8 경계 1(Introducer 원본 음성)이 무너지므로 편집은 열지 않되, 보지 못한 텍스트를 승인시킬 수는 없다. 거절 경로는 기존 "Request changes"다. (3) 하드 클레임은 편집이 아니라 **항목별 처분**을 받는다 — `retained_hard_claims TEXT[]`로 Dater가 "여전히 사실"과 "그 내용을 지웠다"를 고르고, 지운 것은 published structure에서 제거되며 확인 대상에서 빠진다. 클라이언트는 목록을 **줄일 수만 있고 만들어낼 수 없다**(목록 밖 값은 `hard claim is not one of the flagged claims`로 거절). (4) `PitchPlayer`에는 렌더에 실제로 쓰는 필드만 명시 복사로 넘긴다 — 클라이언트 컴포넌트에 `pitch` 전체를 넘기면 삭제된 클레임이 RSC flight payload로 발행된다. (5) `structure_reviewed`(양쪽 테이블)로 0047 이전 발행분을 렌더 시점에 구별해, 그 행들에는 검토를 주장하는 문구를 쓰지 않는다.
- **이유**: 공개 페이지는 `structure`의 다섯 필드를 렌더하는데 `create_dater_revision`이 Dater의 headline/body 편집만 저장하고 `structure`는 원본 그대로 복사했다. 즉 **Dater가 고친 문장이 공개 페이지에 반영되지 않았고**, `three_specific_qualities`는 consent 화면에 아예 표시되지 않았으며, 전사는 `<details>`와 플레이어 자막 두 곳에 공개되는데 `ConsentFlow.tsx`에 "transcript"라는 문자열이 한 번도 없었다. 그럼에도 페이지는 "every word here was reviewed and approved by {daterName} before publishing"라고 주장했다 — §8과 §12 동시 위반.
- **검토 대안**: 공개 페이지가 `structure` 대신 승인된 `body`를 렌더(한 줄이면 문구는 참이 되지만 CP-2의 구조화 장면과 진행 중인 모션 트랙의 토대를 잃는다 — 기각), 전사를 편집 가능하게(원본 음성 정직성 붕괴 — 기각), 하드 클레임을 편집 불가로 유지(1차 시도의 내 결정이었고 **틀렸다** — Dater가 플래그된 문장을 지워도 플래그가 남아 "I confirm all of these claims are true."에 서명하도록 강요된다. 페이지에 없는, 어쩌면 거짓이라 지운 문장을 — 기각), moderation의 동일성 스킵으로 저장 잠금 해소(스위치가 꺼진 동안 들어온 미검증 텍스트를 켠 뒤에도 영구 면제 — 기각. 파생 경로 통일만으로 잠금이 풀린다).
- **영향**: `0047` 신설, `supabase/tests/23_dater_structure_edit.sql` 신설, `audit2/b13`의 `to_regprocedure` 핀을 6-인자로 갱신(강제된 변경이며 약화 아님). 전체 게이트 green — contracts 14 / data 85 / mobile 155 / web audit3 73 / DB base(23 포함) / audit 7-7 / audit2 14-14 / audit3 11-11 / typecheck·lint·format 클린.
  **폐쇄 범위는 한정해서 진술한다**: "신규 승인은 공개되는 모든 텍스트가 consent에 노출된 뒤에만 발행되고, **그 이전 발행분은 페이지가 검토를 주장하지 않는다**." 기존 행의 전사와 qualities는 Dater가 본 적 없이 지금도 공개되며, 코드가 보장하는 것은 "보았다"가 아니라 "보았다고 주장하지 않는다"이다.
  `structure_reviewed`의 시맨틱은 **"다섯 필드가 Dater 편집기에 표시된 상태로 그의 인증된 세션이 제출했다"**이지 "변경했다"도 "사람이 읽었다"도 아니다. 제3자 위조는 불가하지만(직접 쓰기 권한 없음, 설정 경로는 `auth.uid()=subject_user_id`+`consent_pending`) "forge 불가"라는 표현은 쓰지 않는다.
  S5 유니코드 공백 가드는 **"닫힘"이 아니라 "좁힘"**이다. U+2800(BRAILLE PATTERN BLANK), tag 문자 U+E0001–E007F, Variation Selectors Supplement U+E0100–E01EF는 서버 목록과 클라이언트 정규식 양쪽을 통과한다. 심각도 낮음 — 사용 주체는 자기 페이지를 스스로 비워 보이게 만드는 Dater 본인뿐이고 동의·안전 경계 위반이 아니다.
  **알려진 후속 3건**: `/api/moderate-text`의 `.max()`가 UTF-16 단위라 astral 문자 위주 텍스트가 서버 기준 합법인데도 400으로 거절될 수 있음(P2), 상한 초과 AI 원문이 저장을 막는 근본 해법은 transcribe 시점 상한 강제, `transcribe/route.ts`의 blank-filter 때문에 "byte-identical to the transcription path" 주석이 과장. **잔여 미검증**: consent 플로 실브라우저 QA, Playwright `consent.spec.ts`, hosted `0047` 배포, moderation provider 실호출.
- **프로세스 기록**: 1차 시도가 적대적 검증 6명 중 5명에게 반증당했다(저장 잠금, 지운 클레임 서명 강요, 전사 미노출, RSC 유출). 교정 라운드에서 Advisor(나)가 워커에게 확정으로 못 박은 계약 중 **넷이 틀렸다** — RPC 첫 파라미터명, 컬럼명, `included_asset_ids`의 DEFAULT 유무, "유지 0개면 확인 요구 없음". 전부 워커나 검증자가 코드 근거로 잡아냈다. 사용자 지시(2026-07-30)로 Fable 5 부오케스트레이터를 세워 Advisor 판단을 사전 검증하게 했고, 이 결정 기록의 범위 한정·시맨틱·"좁힘" 표현이 그 검증의 산출물이다. 또한 살아 있는 워크플로 에이전트에게 `SendMessage`를 보내 중복 인스턴스를 만든 결과 검증 단계 이후에도 구현이 계속되어 **검증자 보고가 stale해졌다** — 검증자가 든 결함 4건은 Advisor 재실행 시점에 이미 해소돼 있었다. 앞으로 워커 보고의 "테스트를 추가했다"는 **실행 로그(테스트 개수 포함) 없이 인정하지 않는다.**

## 2026-07-30: 0047 실브라우저 QA 완료 — 로컬 스택에서 UI↔RPC 왕복 검증

- **결정**: 로컬 Supabase 스택(Docker + `supabase start`, 마이그레이션 46개 + seed)에서 consent 플로 전체를 실브라우저로 1회 완주하고, 그 결과 발견된 3건을 반영한다. (1) 검토된 행의 카피 "final say on **every** claim"을 "**any** claim"으로 교체 — 플래그된 클레임이 0개일 때 있었던 것처럼 읽히는 함의 제거. 문구를 고정하던 audit3 핀도 새 문구로 갱신(이제 "every claim"이 재등장하면 실패). (2) `next.config.mjs` 이미지 허용 목록에 **개발 환경 한정** `http://127.0.0.1` 추가 — 승인 직후 `router.push`가 공개 페이지로 이동할 때 `next/image`가 로컬 스택의 서명 URL 호스트를 거부해 클라이언트 예외가 났다. 프로덕션 빌드는 목록이 그대로라 영향 없다(제품 결함 아님, 로컬 QA 환경 구성 갭). (3) 루트 `.env`의 `OPENAI_API_KEY`가 비어 있음을 확인 — 이전 전사 QA는 키가 설정된 hosted Vercel 경유였다. moderation provider 실호출은 사용자 게이트로 잔존.
- **검증된 것 (전부 실제 UI→PostgREST→RPC 왕복)**: 8자리 코드 로그인(Mailpit) → 클레임 → 전사 읽기 전용 노출("The transcript that will publish, in full") → 다섯 필드 편집기에서 Thing 2 수정 → rev2 (`structure_reviewed=t`, `dater_edited=t`, headline은 서버 파생) → 사진 제외 후 **photo-only 저장 성공** (rev3, `reviewed` sticky 유지, `edited=f`) → 클레임 처분("Owns a home in Brooklyn" 제거) → rev4 `claims=["Runs marathons"]`, 체크박스는 유지 클레임만 커버 → About you/Reach 입력 → 승인 → 캠페인 published → 공개 페이지에서 **편집 문장 렌더 / 지운 클레임 플래그 HTML 0건 / reviewed 분기 카피 실행 / AI 원문 잔존 0건**. 추가로 **moderation 문자열의 클라이언트 파생식(`daterPitchModerationText`)과 서버 파생식(projection→hook+body+qualities)이 아포스트로피 포함 실입력에서 sha256 동일**함을 교차 구현 대조로 증명 — 영구 잠금 위험의 핵심 전제 해소. Playwright 전 스위트 68/68(warm 서버 전제 — cold 컴파일이 첫 테스트 타임아웃을 소모하며, `webServer`가 루트 `.env`를 모르므로 루트 env를 export한 서버를 먼저 띄워야 재현된다).
- **hosted 배포 완료 (2026-07-30)**: `supabase db push`로 `0044`~`0047` 적용, `migration list` 동기화 확인. REST 프로브로 6-인자 `create_dater_revision`과 `remove_pitch_draft_asset`이 해석되고(PGRST202 아님, P0001 `authentication required`) `structure_reviewed` 컬럼이 노출됨을 확인. **순서 창이 예상과 반대로 열려 있었다**: Vercel이 main 자동 배포라 새 웹 클라이언트가 커밋 직후부터 이미 프로덕션에 나가 있었고, DB가 뒤처진 동안 Dater 편집 저장(6-인자 RPC)과 consent 읽기(`structure_reviewed` select)가 hosted에서 실패하는 상태였다. `public_beta_enabled=off`로 실사용자가 없어 실피해 0. 교훈: **마이그레이션이 필요한 클라이언트 변경은 커밋 전에 hosted DB를 먼저 push한다** — Vercel 자동 배포가 커밋과 동시에 클라이언트를 내보내기 때문이다.
- **추가 검증 (2026-07-30, 사용자가 로컬 개발용 OPENAI_API_KEY 입력 후)**: enforcement=on 상태에서 두 번째 QA 드래프트로 브라우저 왕복 재실행 — Dater 편집 저장이 **실제 OpenAI moderation 호출**(`POST /api/moderate-text 200`, 1.5s)을 거쳐 원장에 passed verdict를 남기고, 무조건 moderation 게이트가 그 verdict를 찾아 revision을 수락했다. 즉 클라이언트 파생 문자열과 서버 파생 문자열의 일치가 오프라인 해시 대조뿐 아니라 **실호출 경로 전체에서** 증명됐다. enforcement가 introducer 제출도 막는 것(`require_pitch_text_moderation`)을 확인했고, 픽스처는 introducer 쪽 verdict를 서버 파생식으로 시드했다(QA 대상은 Dater 쪽 실호출).

## 2026-07-30: 모션 Phase 1 — PitchScene v1 스냅샷과 공용 플레이어 (0048)

- **결정**: (1) **PitchScene v1**은 텍스트를 나르지 않는 닫힌 스키마다 — `{schemaVersion, canvas{width,height,fps}, durationMs, scenes[{assetId,startMs,endMs}]}`. envelope·canvas·entry 모두 **닫힌 키 집합**으로 DB가 거절한다(용인된 `text` 필드는 미검열 문구의 공개 경로가 되므로). 자막은 revision의 불변 transcript에서 플레이어가 유도한다. (2) **안전 하한을 DB가 강제**: 장면당 ≥1000ms(스트로브 차단), [0,durationMs] 연속 커버, 중복 금지, reviewed photo만 참조, duration=마지막 segment end. (3) **scene_hash는 서버 전용** — 저장 jsonb의 `::text`를 digest하되, 해시 전에 **정규화**(정수화·assetId 소문자화·키 순서)한다. 두 클라이언트가 같은 타임라인을 다른 포맷으로 보내도 해시가 하나다. (4) **승인 집합 일치**: approve는 scene 참조 사진 집합 == included 집합을 양방향으로 요구. (5) **전방 복사**: scene 없는 저장은 이전 scene을 새 자산 스냅샷으로 재검증해 복사, 실패 시 NULL 강등. (6) **초기 scene은 Introducer의 submit이 동봉**(5-인자) — 이것 없이는 저장 없이 바로 승인하는 Dater의 페이지에 모션이 없다. (7) content_hash에 scene 포함. (8) `pitch_assets.width/height` + 모바일·Dater 웹 업로드 치수 전달, 전사 요청에 `timestamp_granularities=['word','segment']`(둘 다 — 'word'만 보내면 segments가 빠져 자막·scene 정렬 전체가 죽는다).
- **검증**: 워커 3(병행) + 적대적 4렌즈 — 전체 반증 0. DB 뮤테이션 21/21 red(워커가 스스로 M13 공백을 발견해 M13b로 보강). 실스택 브라우저 QA: 서버 scene 경계 7.8s에서 사진 전환(재계산이었다면 17.25s — **판별 테스트**), 저장 없이 승인한 Dater의 공개 페이지가 동일 해시의 scene을 재생, RSC payload에 assetId+타이밍만 실림. hosted `0048` push 후 계약 프로브 통과. **이번에는 DB push가 커밋보다 먼저다.**
- **검토 대안**: scene에 자막 포함(밀반입 채널 — 기각), 클라이언트 해시(cross-language 바이트 함정 — 기각), "겹침 없음"만 검증(30ms×100 스트로브가 유효해짐, 위험은 시청자에게 — 기각), consent 웹이 승인 전 자동 revision 생성(보이지 않는 revision — 기각).
- **알려진 제한**: builder는 all-or-nothing — 사진 수 > floor(durationMs/1000)이면 scene NULL(30초 최소 녹음 + 최대 4장에서는 실발생 불가, 서버 하한의 정직한 귀결). Introducer의 모바일 미리보기는 아직 정지 화면(Dater가 승인하는 모션과 다를 수 있음 — Phase 2 이후). JS `Math.round`와 PG `round`가 정확한 half-ms에서 갈릴 수 있으나 결과는 제출 거절이지 손상 아님. Phase 4 렌더 워커의 해시 재검증은 `::text` 바이트를 재직렬화 없이 그대로 — 0048 주석에 핀.

## 2026-07-30: 모션 Phase 2 — 목소리 리듬·크롭 사다리·효과 어휘·템플릿 (0049, v2 스키마)

- **결정**: (1) **PitchScene v2** — 사진 N장을 크롭 사다리(wide→punchIn→detail→wideAlt + typographic 카드)로 다샷 시퀀스화, 컷은 transcript 타임스탬프 유도 비트 그리드(word 온셋·gap 휴지)에 스냅, 효과 11종 닫힌 union(kenBurns/punch/grade/grain/lightLeak/wordPop/kineticText/countBadge/progressBar/waveViz/backdropBlur — parallax·maskReveal·sticker·speedRamp는 v3 이후), warm/hype 템플릿. **크롭 좌표계는 canvas-fitted frame** — 어떤 크롭도 Dater가 검토한 프레임 밖 픽셀을 드러낼 수 없고 정사각 rect=9:16이라 왜곡 불가(동의 속성의 구조화). **텍스트는 전부 참조**(wordPop {segmentIndex,wordIndex}, kineticText/countBadge source 토큰) — scene 내 자유 문자열 0, 플레이어가 불변 revision에서 해석. (2) **플래시 예산은 이벤트 전개**: punch 온셋 + lightLeak 전개 펄스 피크(`peak_k = startMs + floor(k*1000/pulseHz)`, k=0 포함, 반개구간 [startMs,endMs)) + wordPop/countBadge 출현의 합집합에 전역 334ms 최소 간격. `pulseHz`는 정수 0..3(소수는 JS/PG 나눗셈 분기 — 이 세션의 같은 클래스 4번째 함정). grain은 주파수가 아니라 강도로 안전(≤0.25, ≤30Hz — 3Hz 규칙의 표적은 휘도 플래시지 서브픽셀 텍스처가 아님). (3) **골든 벡터**: scene JSON+기대 판정 fixture를 vitest와 SQL이 공유(생성 파일 바이트 대조 드리프트 테스트) — 3구현(zod/PL·pgSQL/builder) 등가를 주석이 아니라 데이터가 강제. (4) **초→ms 반올림을 3구현 IEEE 동일로**: DB `pitch_transcript_duration_ms`를 double precision 분수부 비교로 재정의(174만 값 기계 대조 diff 0. `floor(x+0.5)`는 0.49999999999999994에서 덧셈 자체가 반올림되어 기각, `float8::numeric`은 15자리 절삭으로 결함 재생산 — 마이그레이션에 함정 문서화). (5) **모바일 sceneless 폴백**: 'pitch scene' 프리픽스 거절 시 scene=null 1회 재시도 — 빌더/DB 불일치가 Introducer를 막지 못함. 관측성은 현재 console.warn+테스트 단언뿐(앱에 analytics 파이프 부재) — **운영 점검 항목: `consent_revisions`의 scene NULL 비율**. (6) **해석기 의미론 동결**: schemaVersion별 파라미터 해석은 동결, 시각적으로 유의미한 해석 변경은 새 버전 + 구버전 해석기 보존. reduced-motion은 모든 주기 휘도 층 정적화(층 열거식 테스트 — 새 층 추가 시 실패), wordPop/countBadge 램프 ≥150ms.
- **동결 예외 기록**: v2 스키마를 배포 전 1회 제자리 수정(플래시 예산 전개·pulseHz 정수화) — hosted 0048이 `schemaVersion must be 1`로 v2 쓰기를 거절 중이라 보호 대상이 공집합임을 근거로 Deputy 승인. **0049 hosted push(2026-07-30)로 예외 창 폐쇄 — 이후 모든 시각 변경은 schemaVersion 3.**
- **검증**: 워커 4 + 적대적 4렌즈 → 시청자 안전 렌즈가 반증 3건 실측(예산 미발동 "증명"의 산술 오류 — 실제로는 load-bearing, 온셋-플래시 갭 5 events/s, wordPop scrim 무램프 8회/s) → 교정 4워커 + 재검증 2렌즈 low. F1 교훈 절차화: **"증명됨"은 재현 아티팩트 없이 수용 불가**. 실스택 QA: 같은 15초 녹음·사진 2장이 warm 5샷(모바일 경로, 카드 0 — structure 없는 fail-closed) → hype **9샷+카드2+wordPop3+lightLeak2**로, hype 전환의 dirty 게이트·저장·승인·공개 페이지 참조 해석(0.5s hook 카드, 9.6s "up." 팝, 5.5s match 카드)까지 브라우저 실측. 전 게이트: contracts 239/adapters 11/data 106/mobile 176/web audit3 133/DB 01~25+audit 3종/typecheck·lint·format 클린.
- **알려진 제한**: 얼굴 감지 없는 중심 가중 크롭(가장자리 얼굴 잘림 가능, 배경 제3자 확대 가능 — Phase 3의 U1에서 해소), Opus-C 문법 중 v2 미표현(landscape card/endcard/quote/RMS 액센트 — Phase 4 이후), R12 강조 단어 화이트리스트는 word 타이밍에 텍스트가 없어 길이 프록시로 대체, `pulseHz=3`은 333ms 초과 leak에서 자기 위반이라 사실상 단일 피크 전용(핀의 내재 귀결), lightLeak tint는 해석기 팔레트 소관(현재 warm off-white — red 계열 tint 도입 시 WCAG red-flash 재검토 필수, 코드 강제 없음), 초→ms 1ms 분기는 4자리 소수 프로바이더에서만 도달(현 Whisper 2자리 — 도달 불가).

## 2026-07-30: 영상 상한 확정 — Phase 3 착수 전제 (사용자 인터뷰 3차, U8~U11)

- **결정**: (U8) 피치당 클립 **전체 3, 무료 1 / 프리미엄 3** — 무료도 영상 1개로 바이럴 가능, 추가 클립은 기존 `campaign_pass_30d_1999`에 얹는다(신규 SKU 없음, U7 계승). scene 자산 상한 12는 사진과 공유. (U9) **원본 ≤15초**(picker `videoMaxDuration`으로 기기에서 강제) · **scene 사용 ≤10초**. 모더레이션은 결과물이 아니라 원본 전체를 검사하므로 이 상한이 피치당 비용을 결정한다 — 3클립 45초 기준 **$0.098/피치**(시각 $0.10/분 + 음성 $0.03/분, Codex-X 2026-07-29 실사 단가), 월 500피치에 $49. (U10) **인제스트(무음 프록시 + 모더레이션 통과) 성공 즉시 원본 삭제** — 프록시(≈9.4MB/피치)만 보존, 플래그된 원본만 검토 증거로 예외 보존. 스토리지 지렛대(원본 보존 시 600MB/피치로 Pro 100GB가 170피치에서 소진)이자 개인정보 최소화(음성 트랙 포함 원본이 서버에 남지 않음). (U11) **원본 파일 ≤200MB** — 4K 촬영본 수용, 인제스트가 1080p 프록시로 정규화하므로 품질 손실 없음. Supabase **Pro 전제**(Free는 파일당 50MB 하드캡 — 플랜 확인됨(2026-07-30): **현재 Free — 50MB 임시 캡 적용**, 추후 Pro 전환 시 200MB 활성화(상한은 설정값으로 구현해 하드코딩 금지)).
- **이유**: Phase 3(영상 업로드 + 인제스트 프록시 + 얼굴 감지)의 모더레이션·스토리지·에그레스 원가가 전부 이 네 숫자에서 파생된다. 열람 무게가 사진만 5MB → 3클립 14.4MB로 뛰므로(무료 에그레스 250GB = 5만 → 1.7만 열람) 무료 1클립 분할이 에그레스 방어이기도 하다.
- **검토 대안**: 전부 무료 3클립(에그레스·모더레이션 3배 + 프리미엄 차별점 상실 — 기각), 원본 ≤60초(모더레이션 $0.39/피치로 월 500피치 $195 — 총예산 단독 잠식, 기각), 원본 ≤10초(비용 최저지만 기기에서 정확히 자를 것을 강요해 업로드 경험 악화 — 기각), 원본 영구 보존(스토리지 선형 증가 + 미공개 음성 보유 — 기각).
- **영향**: Phase 3 착수 가능. 인제스트 파이프라인 요구가 확정됨 — probe → ≤15초 검증 → 무음 1080p 프록시 → 프레임 모더레이션 → 원본 삭제 → 플래그 시 원본 보존 + 공개 금지. `MEDIA_MAX_BYTES`(15MB)는 사진·음성 전용으로 남고 영상은 별도 상한. Supabase 플랜 확인(사용자)과 U1 얼굴 감지(블러/크롭) 벤더 선정이 Phase 3 브리프의 선행 항목.

## 2026-07-30: 클라이언트 역할 권한 전면 정리 — 자가 신원 위조 P0 (0051·0052)

- **결정**: (1) Supabase가 `public` 스키마에 부여하는 anon·authenticated 기본 권한을 **전면 회수**하고 코드가 실제로 쓰는 것만 컬럼 단위로 재부여한다(`0052`). **anon은 테이블 권한 0** — 무가입 표면(공개 피치·OG·익명 신고·consent 미리보기·waitlist·analytics)이 전부 service-role 또는 SECURITY DEFINER RPC를 거치므로 §8 경계 4를 유지하면서 권한만 제거된다. (2) service 전용 RPC의 `REVOKE ... FROM PUBLIC`을 **`FROM PUBLIC, anon, authenticated`**로 교정한다(`0051`, 0035:430 선례) — 0050의 인제스트 4종 + 기존 5종(`record_revenuecat_event`·`erase_pitch_draft`·`consume_creator_credit`·`reassign_pitch_storage_owner`·`scrub_resolved_purchase_review_payloads`). (3) **테스트 하니스가 hosted 기본 권한(FUNCTIONS·TABLES·SEQUENCES)을 에뮬레이션**한다(`auth_stub.sql`) — 이것이 없으면 하니스가 프로덕션보다 약해 결함을 숨긴다. (4) PostgREST의 `merge-duplicates` upsert는 `ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key`를 생성하므로 **충돌 키 컬럼에 UPDATE가 필요**하다 — `profiles.user_id`·`dating_profiles.user_id`를 부여하고, 키 재지정은 RLS `WITH CHECK (auth.uid() = user_id)`가 막는다(권한과 RLS가 각자 다른 층).
- **이유**: Phase 3a 적대 검증이 0050의 익명 실행 가능 RPC를 익스플로잇으로 재현했고(공개 anon 키만으로 타인 잡 claim → ffmpeg·모더레이션 0회로 succeeded 위조 → 검토 큐 열람 → 사람의 검토 결정 뒤집기), 교정 워커가 같은 메커니즘이 TABLES에도 적용됨을 발견했다. Advisor가 직접 재현: `SET LOCAL ROLE authenticated`로 `UPDATE users SET phone_verified_at` → **UPDATE 1**. 이 컬럼은 `assert_identity_evidence`(0012:64, 0030:62)가 읽는 신원 게이트다. `authenticated`의 `pitch_assets` DELETE는 `remove_pitch_draft_asset`의 모든 가드(voice 보호·상태·업로더)를 우회했다. **`02_rls.sql:120-127`이 자가 인증 불가를 정확히 단언하면서 계속 통과해왔다** — 하니스가 프로덕션보다 약해서 결함을 숨긴 것이며, 이것이 개별 결함보다 무거운 교훈이다.
- **검토 대안**: `ALTER DEFAULT PRIVILEGES` 되돌리기(소유 역할 지정이 필요하고 기존 명시 GRANT와 상호작용이 불투명 — 명시 REVOKE+재부여 채택), 클라이언트 upsert 호출부를 insert/update로 분리(제품 코드 2곳 변경 vs 권한 1줄 — 후자 채택, RLS가 안전을 보장하므로), 하니스 에뮬레이션 없이 수정만(같은 클래스가 다시 숨는다 — 기각).
- **영향**: `0050`·`0051`·`0052` hosted 배포 완료(2026-07-30). 프로덕션 프로브로 차단 확인 — `claim_media_ingest_job` → `42501 permission denied`, `record_revenuecat_event`·`erase_pitch_draft` → `PGRST202`(스키마 캐시에서 소거), anon `users` SELECT → 401. 로컬 실스택 PostgREST 확인: 이름 확정 부트스트랩 200, 관심 온보딩 201, 자가 인증 위조 403, 키 재지정 403. 신규 테스트 `27_upsert_key_column_privileges.sql`이 PostgREST 생성 SQL 형태를 그대로 재현해 이 클래스를 고정한다.
  **행동 변화**: 만료 JWT는 `PGRST303 JWT expired`(42501 아님)로 깔끔하게 나오지만, **로그아웃 상태 탐색의 웹·모바일 수동 QA가 남은 정직한 확인**이다. **향후 마이그레이션이 새 테이블을 추가하면 다시 광범위 기본 권한을 갖고 도착한다** — 새 테이블마다 명시 GRANT를 쓰거나 0052식 sweep을 반복해야 하고, ACL을 단언하는 테스트만이 이를 잡는다.
- **프로세스 기록**: 이 P0는 Phase 3a와 무관한 기존 결함이며, **모션 트랙 작업이 아니었으면 발견되지 않았을 것**이다. 검증자가 브리프 밖 발견을 보고했고 Advisor가 액면으로 받지 않고 직접 재현했다. 교정 후 재검증에서 검증자가 **교정이 새로 연 구멍**(merge upsert 키 컬럼 누락으로 온보딩 2종 사망)을 실 스택 인과 증명(403→GRANT→200→REVOKE→403)으로 잡았다 — "고쳤다"를 검증 없이 믿지 않는 규율이 두 방향 모두에서 작동했다.

## 2026-08-03: 바이럴 루프 실현 가능성 확정과 퍼널 종착지 (0053)

- **사용자 요구 메커니즘 (변경 불가)**: 릴스 업로드 → 낯선 사람이 봄 → 그 Dater가 마음에 듦 → **액션** → 유입 → Dater 응답 시 매칭·채팅. 사용자가 2026-08-03에 이 경로를 명시 재확인했고, Advisor가 제안했던 "다크 소셜 주 경로 재정의"는 **기각**됐다. 성장 모델을 바꾸는 것이 아니라 이 경로를 **작동시키는 것**이 과제다.
- **조사 결론 (4축 + 양방향 적대 판정)**: 플랫폼 정책이 원천 블로커는 **아니다**. (a) 인스타 랭킹 문서 원문(Advisor 직접 확인, about.instagram.com/blog/announcements/instagram-ranking-explained)은 영상 내 URL·텍스트를 금지하지 않는다 — demotion 대상은 `low-resolution or watermarked reels, ... reels that are majority text`이며 **"watermarked"에 한정어가 없다.** "자기 로고는 괜찮다"는 완화는 정책 문서가 아니라 **Mosseri의 릴스 발언**("If you watermark a Reel with your own logo ... that's actually good to go", socialmediatoday 730852)이고 텍스트·URL은 언급조차 없다 → 엔드카드는 **짧은 텍스트만, 지속 워터마크 금지, 실측 A/B 대상**으로 다룬다. (b) 틱톡 Creator Academy는 QR을 추천 부적격 사유로 언급(원문 JS 렌더로 부분 확인) → **틱톡 내보내기에 QR 금지**, QR은 오프라인 전용. (c) 낯선 시청자를 옮기는 공식 수단은 **인스타 Private Replies API**(릴스 댓글 → 자동 DM으로 클릭 가능 링크, **팔로우 무관**, 댓글 후 7일·1건, developers.facebook.com/docs/messenger-platform/instagram/features/private-replies). (d) 선례가 증명한 유일 패턴은 **NGL형 비대칭 — 낯선 시청자는 설치 경계를 넘지 않는다**(NGL 2022 IG 스토리 링크 1,500만 다운로드). 따라서 첫 액션은 웹에서 완결되고 설치는 그 연속이다.
- **양쪽 판정자가 공통 지목한 유일한 fatal**: 퍼널 종착지가 막혀 있다(`0023_launch_gates.sql:102-104`). **바이럴은 재현 불가능한 일회성 자원**이므로 트리거보다 종착지가 먼저다. 그리고 조사에서 댓글 전환율·DM 개봉률의 1차 수치가 **하나도** 나오지 않았다 — 우리가 실측해야 하므로 **계측이 실험보다 먼저**다.
- **결정**: (1) **단계형 관심** — S1(의사 저장) / S2(검증 후 전달) / S3(Dater 승인). **§8 경계 4의 "검증 후 관심 표현"을 전달 시점 기준으로 해석**한다: 보호 대상은 Dater가 받는 관심의 품질이고 S1은 도달 0건이므로 약속이 유지된다(Deputy 승인). (2) **S1은 `interests`의 상태가 아니라 별도 테이블 `interest_intents`**다 — `interests`의 기존 소비자 전부가 "행 = 전달된 관심"을 가정하므로 상태 컬럼은 읽기 하나만 놓쳐도 미검증 관심이 Dater 표면에 뜬다. 별도 테이블이면 **"interests의 모든 행은 검증된 관심"이 구성으로 강제**되고, 승격은 `submit_interest` 위임이라 베타·moderation·프로필 게이트가 각자 코드 경로로 발동해 우회 샛길이 없다. S1은 **자유 텍스트를 받지 않고**(미검증 텍스트 저장 방지), 만료는 **캠페인 수명 연동**(`ends_at + 7일`)이며, Dater·Introducer·anon은 어떤 표면·카운트·analytics에서도 읽을 수 없다. (3) **귀속 수리**: `fw_referral`을 sessionStorage → localStorage `{slug, ch, ts}` + 30일 만료(first-touch no-overwrite 유지), `claim_referral(slug, channel DEFAULT NULL)`로 채널 차원 추가(1-인자 하위호환 유지), 랜딩·캠페인·**모든 로그인 복귀 표면**(root layout)에서 클레임. (4) **엔드카드는 schemaVersion 4가 아니라 렌더러 크롬**이다 — 브랜드 상수·URL은 Dater 콘텐츠가 아니므로 승인 타임라인 **바깥에** 렌더러가 덧붙인다(U5의 의도적 예외). v4 동결 해제·3구현 등가·골든 벡터 churn이 사라지고 URL이 설정값이 되어 도메인 미확정 문제도 해소된다. 의미 있는 표면은 **MP4 내보내기(Phase 4)** 뿐이며, 그때 consent에 "내보낸 영상 끝에 Friendword 카드가 붙습니다" 고지 1줄을 추가한다.
- **검토 대안**: `interests`에 상태 컬럼 추가(읽기 누락 시 §8 위반 — 기각), 엔드카드 v4 스키마(churn만 있고 소비자 0 — 기각), Dater별 App Store Custom Product Page(귀속에는 좋으나 Dana 사진·문구가 스토어에 노출·인덱싱되고 회수가 심사 주기에 묶임, §8 신규 노출면 — 기각), Play Install Referrer(`apps/mobile/android` 디렉터리 자체가 없음 — 로드맵), 앱 내 피드(동의 모델 변경 — 별도 결정), 임의 30일 만료(베타 장기 off 시 산 캠페인의 의사가 증발 — 캠페인 수명 연동 채택).
- **영향**: `0053` 신설(interest_intents + RLS + 시간당 캡 + 캠페인 수명 연동 만료 pg_cron + 승격 RPC + `claim_referral` 채널), 웹 S1/S2 흐름·귀속 저장소·퍼널 이벤트(`reel_visit`/`s1_intent_created`/`s2_interest_delivered`). 전 게이트 green — DB 01~28 + audit 7/7·14/14·11/11, contracts 293, data 122, mobile 231, web audit3 168, **web ui 6(신설)**, build·typecheck·lint·format.
  **`public_beta_enabled`는 켜지 않았다** — 0034가 의도적으로 만든 런치 게이트이며 출시 판단은 사용자 몫이다. S2 파이프라인이 완성돼 있어 **스위치를 켜는 순간 전달이 즉시 활성화**된다. **본격 릴스 푸시는 스위치 이후로 시퀀싱해야 한다** — 그 전에 밀면 트래픽이 저장된 의사에서 멈췄다가 캠페인 만료와 함께 사라진다.
- **프로세스 기록 (세 번째 같은 클래스)**: 두 워커가 병행하며 RPC 이름을 서로 다르게 가정해 **클라이언트가 존재하지 않는 함수(`save_interest_intent`)를 호출**했고, zod 스키마도 실제 반환 컬럼(`created_at` vs `intent_created_at`)과 어긋났다. **모든 게이트가 초록이었다** — `packages/data` 테스트가 RPC를 mock하므로 이름이 무엇이든 통과한다. 이는 0047(fake row가 묻는 컬럼명을 그대로 반환)·0052(하니스가 hosted 기본 권한 미에뮬레이션)에 이은 **세 번째 "테스트가 프로덕션보다 약해 자기가 잡으려던 것을 숨긴" 사고**다. 대응: `packages/data/src/rpcContract.test.ts` 신설 — **마이그레이션 SQL을 파싱해 진실로 삼고** 클라이언트가 호출하는 RPC 이름·인자명을 대조한다(뮤테이션 red 2종 증명). 이제 마이그레이션이 이름의 권위다. 추가로 검증자가 **정경로의 귀속 누수**(로그인이 일어나는 interest 페이지에 `ReferralTracker` 미마운트 → 계측 자체가 무효)와 **자기 조회를 취소하는 이펙트**를 찾았고, 문구 감사에서 §12 과대약속 5건("will review", "when Friendword opens", "beyond their review", "until you complete", "check back soon")을 제거했다.

## 2026-08-03: Phase 4 — 승인된 장면이 실제 MP4가 된다 (0054)

- **왜 지금**: 제품의 핵심 약속은 "친구가 만들어준 세로형 피치를 릴스/틱톡에 올린다"인데 `media-worker/render/index.ts`가 **9줄 주석**이었다. 사용자가 지정한 메커니즘(릴스 → 낯선 시청자 → 액션 → 유입 → Dater 응답 시 매칭)의 **첫 칸에 올릴 파일이 없었다.** 0053이 종착지를 열었으니 이제 입력을 만든다.
- **아키텍처 확정 실행**: 브라우저를 합성기로. 웹과 MP4가 **같은 scene JSON을 같은 컴포넌트**로 해석하고 서버는 headless Chromium 프레임을 캡처해 FFmpeg로 인코딩한다(FFmpeg는 인코더이지 합성기가 아니다). Remotion 미채택(A2) 유지.
- **해석기 리팩터링은 불필요했다**: `MotionSceneV2`가 이미 `sceneV2Frame(scene, …, frameMs, …)` 순수 함수 위에 있고 rAF 루프는 `isPlaying`으로만 게이트된다. 렌더는 `isPlaying=false`로 마운트하고 `elapsedMs`를 스텝한다 — **웹 재생 경로 무변경**. audit3가 해석기 소스에 `Math.random`/`Date.now`/`performance.now` 부재를 이미 핀하고 있었다.
- **실측 (Advisor 직접 재실행, 60초 최악 케이스 1,845프레임, darwin)**: 총 148.5s ≤ 180s, 피크 메모리 1,219MB ≤ 1,310MB, **/tmp 피크 19.6MB — 프레임 파일 0장**(스트리밍이 동작한다는 증거), 번들 ~153MB ≤ 250MB. 출력 15s=5.0MB / 60s=18.1MB. **메모리 여유가 7%뿐이고 darwin RSS 합산 프록시이므로 리눅스 배포 실측 전까지 확정으로 취급하지 않는다.** `-threads 2` 고정 전에는 ffmpeg 단독 651MB로 합계 1,843MB였다.
- **결정 (Deputy 검증)**: (1) **프레임 디스크 축적 금지** — /tmp 잔여가 리눅스에서 ~300MB인데 1080×1920 PNG 1,800장은 GB 단위다. ffmpeg stdin 스트리밍이 선택이 아니라 제약. (2) **캡처는 전용 내부 라우트** — 공개 페이지를 찍으면 헤더·푸터·CTA가 들어간다. (3) **CSS `transition`은 캡처에서 무력화** — 벽시계로 보간되므로 캡처 속도에 따라 결과가 달라져 결정론이 깨진다. 불투명도 램프는 이미 해석기가 만들므로 끄면 승인된 해석만 남는다(**픽셀 동일성은 약속하지 않는다** — §12). (4) **첫 프레임 전 `fonts.ready` + 전 사진 `decode()` 게이트** — 없으면 MP4에만 폴백 폰트가 **영구히** 박힌다. (5) **`elapsedMs` 반영이 한 커밋 늦다** — 주입 직후 찍으면 전 구간이 1프레임 밀리고, "같은 t 두 번 = 동일" 검사로는 **일관되게 밀린 상태를 못 잡으므로** 샷 경계 검사를 따로 뒀다. (6) **오디오 무필터** — AAC면 `-c:a copy`, 아니면 순수 AAC 인코드. `loudnorm` 등 파형을 바꾸는 처리는 §8-1 위반. 엔드카드는 무음 패딩이고 `-shortest`를 쓰지 않는다(오디오 15.0s vs 컨테이너 16.5s로 실측 확인). (7) **v2 전용**, v1/v3는 핀된 에러로 거부.
- **enqueue는 승인 시점이 아니라 최초 내보내기 요청 시점(lazy)** — Deputy가 Advisor 초안을 뒤집었다. 근거: ① 아무도 내보내지 않을 캠페인에 승인마다 2~3분 컴퓨트를 태우지 않는다. ② **도메인 미취득 상태에서 eager는 placeholder 엔드카드 URL을 멱등 캐시 결과에 영구히 굽는다**(같은 revision은 재렌더되지 않는다). ③ `approve_and_publish_pitch`를 렌더 인프라에 결합시키지 않는다(네 번째 재정의 회피). ④ placeholder 주석의 원 제약이 `render late`였다. exactly-once는 `revision_id UNIQUE` + `ON CONFLICT DO NOTHING`이 요청 시점에 보장한다.
- **무료 1회는 `purchase_credit_ledger`가 아니라 별도 grant 테이블**(`pitch_render_unlocks`, share_kits 0020 형태). 무료는 구매가 아니므로 구매 원장에 섞으면 환불·감사 시맨틱이 흐려진다. **캠페인당 UNIQUE가 원자성 그 자체**이고, **소비는 enqueue가 아니라 성공 시점**이다 — 터미널 실패가 무료 1회를 태우면 안 된다. 재렌더는 기존 `campaign_pass_30d_1999` 재사용(신규 SKU 0).
- **출력은 중첩 경로 `pitch-media/<draft>/renders/<revision>.mp4`** — `private.pitch_media_draft_id`(0003)의 정규식이 name 세그먼트에 `/`를 불허해 NULL을 반환하므로 `pitch_media_object_count`(0025)에 안 잡힌다. 0050 §7 산수(정상 14 / 피크 17 / 상한 20)가 **그대로 유지**되고, 부수적으로 클라이언트가 그 경로에 쓸 수도 없다. 삭제는 편입 확인됨 — `process-deletions.mjs`의 `listStoragePaths`가 폴더 스택으로 실제 재귀하고, orphan sweep은 consent revision이 있는 draft prefix 전체를 보호한다.
- **엔드카드는 scene 스키마가 아니라 렌더러 크롬**(2026-08-03 결정의 실행): 브랜드 상수 + canonical 캠페인 URL(**환경 설정값** — 도메인 미취득이므로 하드코딩 금지)을 승인 타임라인 **뒤에 순수 append**, 1.5초. Dater 저작 텍스트 0. 동의 화면에 고지 1줄을 **같은 슬라이스에** 출시했다. 실측 판독성: 1080폭에서 브랜드 ~64px / URL ~34px.
- **과금 문구를 두 개로 쪼갰다**: `campaign pass required`(무료 1회를 정말 썼다 — 참인 주장) vs `a render for this campaign is already in progress`(**아직 아무것도 소비되지 않았다 — 기다리면 된다**). 소비가 성공 시점이므로 진행 중 사용자에게 결제를 권하는 것은 거짓이고 **부당한 결제 유도**다(§12, §9 인접). UI가 이 구분을 유지하며 진행 중 상태에서 결제 유도를 띄우지 않는다.
- **검토 대안**: 승인 시점 eager enqueue(placeholder URL 영구 각인 — 기각), 엔드카드 schemaVersion 4(동결 해제·3구현 등가·골든 벡터 churn, 소비자 0 — 기각), `purchase_credit_ledger`에 무료 grant(감사 시맨틱 오염 — 기각), 평평한 출력 경로(20-객체 쿼터 잠식 — 기각), 실시간 재생 녹화(비결정론 — 기각), Remotion(예산 50% — 기존 A2 유지).
- **결함 기록 (프로세스)**: ① **과금이 새는 경로를 Advisor가 잘못 지목했다.** Advisor는 "complete 미커밋 중 request가 끼어든다"고 봤으나 워커가 실행으로 반증했다 — unlock INSERT의 FK가 campaigns 행에 `FOR KEY SHARE`를 잡아 이미 직렬화된다. **진짜 구멍은 반대편이었고 더 나빴다**: 소비가 성공 시점이므로 **첫 렌더가 in-flight인 동안 새 revision을 요청하면 교차 타이밍 없이 순차만으로 무료 MP4 2개**가 열렸다. sibling 게이트로 막았고, 명시적 campaign 잠금은 암묵적 FK 동작 의존을 없앤 값으로 유지한다. ② 실패 재요청에 총량 상한이 없어 재요청마다 워커 시도 3회 예산이 새로 열렸다(동시 상한은 속도만 묶는다) — 0045/0053 패턴의 시간당 캡 추가. ③ **`ffprobe-static`이 번들에 인라인돼 `__dirname`이 재작성되고 있었다.** 워커가 `ffmpeg-static` 하나만 externalize해 절반만 고쳤고, Advisor가 빌드 산출물에서 `ingest-run/route.js`에 패키지 소스가 인라인된 것을 확인해 둘 다 externalize했다(수정 후 인라인 0, 리눅스 바이너리·index.js·package.json이 트레이싱됨). **Phase 3a 인제스트 워커가 프로덕션에서 깨져 있었다** — `FRIENDWORD_MEDIA_INGEST_SECRET` 미설정으로 501을 반환해 한 번도 실행되지 않았기에 드러나지 않았다.
- **영향**: `0054` 신설(`media_render_jobs` lease 큐 + `pitch_render_unlocks` + 요청/조회/claim/complete RPC + 동시 상한 + 재시도 시간당 캡), 렌더 엔진(`apps/web/src/lib/pitchRender/**`), 캡처 라우트, 워커 라우트, kit 내보내기 카드 + 서명 다운로드 라우트, 동의 고지. 게이트 — DB 01~29 exit 0, data 135, contracts 293, mobile 231, web audit3 173 / ui 13 / render 32(+gated), build·typecheck·lint·format.
  **`vercel.json`이 없어 함수 메모리가 기본값이다.** 렌더 피크가 1,219MB(darwin 프록시)이므로 **배포 전 메모리 상향과 리눅스 실측이 필요하다** — 이것을 하지 않으면 첫 프로덕션 렌더가 OOM으로 죽을 수 있다.
- **게이트 목록 교정 (2026-08-03)**: `pnpm test:e2e`가 Advisor의 게이트 목록에서 빠져 있었고, 0053 커밋(`5cef761`)이 귀속 저장소를 `sessionStorage` → `localStorage`로 옮기면서 **두 Playwright 스펙을 red로 남긴 채 나갔다**. 제품이 아니라 테스트가 낡은 것이었지만(실브라우저에서 `{"slug":"demo-blair","ch":"ig_reel","ts":…}` 확인) 놓친 것은 사실이다. 두 스펙을 새 계약(slug + 채널 + 만료 타임스탬프, 옛 저장소 잔여 0)으로 갱신하고 뮤테이션 red로 증명했다. **`build` 때와 같은 클래스의 누락이므로, 웹 변경에는 `test:e2e`도 필수 게이트다.** 실행 전제: 이 스위트는 `reuseExistingServer: true`라 **로컬 Supabase env가 실린 dev 서버가 이미 떠 있어야** 한다 — 서버를 내리고 돌리면 Playwright가 env 없는 서버를 띄워 전 스펙이 "missing its Supabase configuration"에서 죽는다(57 failed로 실측).

## 2026-08-04: Shipaton 2026 Final Official Rules 공개 — 전면 대조 (CLAUDE.md §13 게이트)

- **결정**: 2026-08-01 개막과 함께 게시된 Final Official Rules 전문 + Overview·Resources·Updates·Discussions(매니저 답변 4건)를 대조하고 [`docs/HACKATHON_RULES.md`](HACKATHON_RULES.md)를 전면 개정했다. 이 문서가 이제 사전 조사 추정을 대체하는 source of truth다.
- **자격 불확실성 전부 소거**: ① 제외국은 Russia·Crimea·Cuba·Iran·North Korea+OFAC뿐 — **대한민국 참가 확정**(2025의 Brazil·Quebec·Syria 제외 소멸). ② **웹 선공개 무해** — "eligible as long as the only existing version was the website"(Charlie Chapman, 매니저) → Vercel 웹 표면 공개 상태가 자격을 훼손하지 않음이 준공식 확정. ③ **테스트 트랙 무해** — Play open testing이 공개 출시로 안 침(매니저) → TestFlight internal 운영 유지. ④ pre-order 등록 가능(출시일만 기간 내). ⑤ 한 앱 복수 카테고리 제출 가능(Influencer만 1개 제한).
- **신규 확인 — Grand Prize shortlist 메커니즘**: 1차 관문이 **RevenueCat에 보고된 제출 기간(7/31~9/30 PDT) 내 총매출 절대액**이고, shortlist 진입 후에야 성장 품질 심사를 받는다. 최고 매출 자동 우승은 아니나 shortlist에 못 들면 심사 자체가 없다. → **`real_payments_enabled`를 켜는 시점(사용자 결정, §16)이 Grand Prize 매출 집계 창과 직결**된다는 사실을 사용자 결정 대기 항목의 맥락에 추가.
- **제출 의무 확정**: 심사위원용 **무료 체험 또는 프로모 코드**(Consumable 2종의 유료 기능을 10/13까지 테스트 가능해야), **미국에서 다운로드 가능**(미국 스토어프론트 필수), 제출 자료 **영어**(또는 번역), 데모 영상 2분 미만·제3자 저작물 금지, #BuildInPublic은 **#Shipaton 태그** 포스트 링크 제출. 심사위원은 테스트 의무가 없어 영상·텍스트가 실질 심사 표면이다.
- **교정된 오류**: 이전 문서가 Grand Prize를 1위 $100k/2위 $20k/3위 $10k로 기록했으나 **Grand Prize는 1위 단독**이고 $30k/$20k/$10k는 #BuildInPublic의 것이다. OneSignal 카테고리는 $25k/$15k/$5k로 타 사이드 어워드($15k/$10k/$5k)보다 고액. 총상금은 $685,000+ 현금/총가치 $1M+로 표기 통일.
- **영향**: 남은 마감 리스크는 "첫 공개 스토어 출시 ≤ 9/30 23:45 PDT"와 App Review 소요(룰이 조기 제출 명시 권고)뿐. Ship Kit participant form(등록 이메일로 수신) 작성은 사용자 액션. 심사위원 프로모 코드 준비를 제출 체크리스트에 추가.
