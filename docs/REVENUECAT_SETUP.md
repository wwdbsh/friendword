# RevenueCat 연동 — 사용자 설정 가이드

코드는 전부 배선돼 있습니다. 아래 값만 채우면 sandbox 결제가 살아납니다.
(원칙: API 키·토큰 값은 사용자가 직접 입력합니다.)

## 1. RevenueCat 대시보드

1. 프로젝트 생성 → iOS 앱 추가 (`com.friendword.app`)
2. App Store Connect에서 제품 2종 생성 후 RevenueCat에 연결:
   - `creator_launch_credit_499` — Consumable, $4.99 (Creator Launch credit)
   - `campaign_pass_30d_1999` — Consumable, $19.99 (30-day Campaign Pass) [^pass-id]

[^pass-id]: Campaign Pass는 원래 옛 ID(migration 0014에서 정의, Non-renewing subscription)로 설계됐으나 두 가지가 바뀌었습니다. (1) ASC UI에서 non-renewing subscription 유형이 사라져 **Consumable**로 생성합니다(웹훅 계약은 `NON_RENEWING_PURCHASE`로 동일하게 처리). (2) 사용자가 옛 ID로 IAP를 생성 후 삭제해 Apple이 해당 ID를 **영구 잠금**했기 때문에 canonical ID를 `campaign_pass_30d_1999`로 rename했습니다. 코드·DB·테스트는 모두 새 ID 기준입니다.

3. 두 제품을 **default offering**의 패키지로 추가
4. Project settings → Integrations → **Webhooks**:
   - URL: `https://<웹 도메인>/api/revenuecat` (로컬 테스트: ngrok 등 터널)
   - Authorization header 값을 만들어 입력

## 2. 루트 `.env`에 입력

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` — RevenueCat iOS Public SDK key
- `REVENUECAT_WEBHOOK_AUTH_TOKEN` — 위 4번에서 만든 Authorization 값

## 3. 개발 빌드

`react-native-purchases`는 네이티브 모듈이라 Expo Go에서 동작하지 않습니다.

```bash
cd apps/mobile
npx expo prebuild
npx expo run:ios   # 또는 EAS: eas build --profile development --platform ios
```

## 코드가 이미 처리하는 것

- 모바일: 키 존재 시 `Purchases.configure(appUserID = Supabase user id)`,
  paywall(`/paywall`)에서 offerings 로드·구매·복원. 구매 전에
  `pitch_draft_id`/`campaign_id` subscriber attribute를 설정해 서버가 귀속 가능
- 서버 웹훅(`/api/revenuecat`): Authorization 검증 → `purchase_events`
  (provider_event_id로 멱등) → Creator Launch는 `purchase_credit_ledger`에
  available 크레딧, Campaign Pass는 `campaign_entitlements` 30일 upsert,
  EXPIRATION/CANCELLATION 시 비활성화 → analytics 이벤트 기록
- 미설정 상태는 전부 정직하게 노출: paywall은 "Billing isn’t live yet",
  웹훅은 501. mock 결제 경로는 존재하지 않습니다

## Sandbox 검증 체크리스트 (키 입력 후)

1. Sandbox Apple ID로 dev build에서 Creator Launch 구매 → RevenueCat 대시보드에
   이벤트 확인
2. `purchase_events`·`purchase_credit_ledger`에 행 생성 확인 (Supabase SQL)
3. Campaign Pass 구매 → `campaign_entitlements` active/expires_at 확인
4. 앱 삭제 → 재설치 → Restore purchases 동작 확인

## 현재 상태 경고 (2026-07-13, 2차 감사)

- **실결제는 launch gate(0023)로 서버에서 차단되어 있습니다.** `real_payments_enabled=off`인 동안 purchase intent 발급 자체가 거부되고 PRODUCTION 이벤트는 효익을 만들지 않습니다. 해제는 2차 감사 §7 Slice 10 release gate 통과 후입니다.
- 3차 감사 Slice 4(2026-07-14, migration 0038)에서 확정된 계약: (a) purchase intent는 (user, product, scope)당 issued 1개 — 동시 double-tap은 기존 intent 재사용, (b) Campaign Pass "30일"은 `GREATEST(now, ends_at) + 30일`(active면 잔여 뒤 적층, lapse면 지금부터) — scheduler 지연과 무관, (c) expired 캠페인은 Pass 구매로만 부활(public beta gate off 동안은 entitlement 기록 + `revival_blocked_by_beta_gate` review 보류), (d) **restore는 새 purchase intent를 발급하지 않음**, (e) alias 귀속은 payload.aliases로 서버가 파생, TRANSFER는 `resolve_purchase_event_review`로 운영 종결(OPS 참조), (f) refund는 available/reserved credit만 회수 — 이미 생성된 kit은 회수하지 않음.
- sandbox 실검증(구매→restore→refund→transfer)은 Slice 3 코드 수정 + 사용자 대시보드 셋업 + dev build 이후에만 수행 가능합니다.

## Slice 3 갱신 (2026-07-13)

- P0-3(웹훅 실이벤트 계약)·P0-4(SDK identity 동기화)의 **코드 게이트는 해소**되었습니다: 이벤트 타입별 schema, transaction lineage 귀속, `purchase_event_reviews` durable 큐(운영 절차는 `docs/OPS.md`), auth lifecycle `logIn`/`logOut` 동기화와 구매 전 identity 일치 보증.
- 여전히 남은 것: 대시보드 셋업+dev build 후 **실제 sandbox 왕복 검증**(purchase→restore→refund→transfer, 계정 전환 A→B). 이것이 끝나기 전 "RevenueCat complete"를 주장하지 않습니다. 실결제는 launch gate(`real_payments_enabled=off`)로 계속 차단됩니다.
