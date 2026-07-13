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
