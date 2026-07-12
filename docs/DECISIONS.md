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

## 2026-07-12: 로컬 PostgreSQL 17 + plain-SQL 스키마 테스트 하니스

- **결정**: 초기 schema 테스트를 Docker/pgTAP 대신 로컬 PostgreSQL 17과 plain-SQL 하니스로 실행합니다.
- **이유**: 개발 환경에 Docker가 없고 Homebrew에 `pgtap` formula가 없습니다.
- **검토 대안**: Supabase local Docker stack, pgTAP 기반 테스트.
- **영향**: 현재 DB 검증은 로컬 PostgreSQL 17에서 실행합니다. Supabase local stack을 도입할 때 pgTAP과 실행 하니스를 재검토합니다.
