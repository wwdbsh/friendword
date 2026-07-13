# RevenueCat 연동 — 사용자 설정 가이드

코드는 전부 배선돼 있습니다. 아래 값만 채우면 sandbox 결제가 살아납니다.
(원칙: API 키·토큰 값은 사용자가 직접 입력합니다.)

## 1. RevenueCat 대시보드

1. 프로젝트 생성 → iOS 앱 추가 (`com.friendword.app`)
2. App Store Connect에서 제품 2종 생성 후 RevenueCat에 연결:
   - `creator_launch_credit_499` — Consumable, $4.99 (Creator Launch credit)
   - `campaign_30d_1999` — Non-renewing subscription, $19.99 (30-day Campaign Pass)
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
- 2차 감사가 확인한 **미해소 코드 결함**(키 입력만으로 해결되지 않음): 웹훅이 실제 RevenueCat 이벤트 계약(TRANSFER/lifecycle의 선택 필드)과 불일치(P0-3), 모바일 SDK가 auth 전환 시 `logIn`/`logOut`을 호출하지 않음(P0-4), Creator Launch 재구매 trap(P0-5), Campaign Pass 정상 구매 진입 부재(P0-6). Slice 3~4에서 수정 예정이며, 그 전까지 "RevenueCat complete"/"real payments ready" 표현을 어떤 문서에도 쓰지 않습니다.
- sandbox 실검증(구매→restore→refund→transfer)은 Slice 3 코드 수정 + 사용자 대시보드 셋업 + dev build 이후에만 수행 가능합니다.

## Slice 3 갱신 (2026-07-13)

- P0-3(웹훅 실이벤트 계약)·P0-4(SDK identity 동기화)의 **코드 게이트는 해소**되었습니다: 이벤트 타입별 schema, transaction lineage 귀속, `purchase_event_reviews` durable 큐(운영 절차는 `docs/OPS.md`), auth lifecycle `logIn`/`logOut` 동기화와 구매 전 identity 일치 보증.
- 여전히 남은 것: 대시보드 셋업+dev build 후 **실제 sandbox 왕복 검증**(purchase→restore→refund→transfer, 계정 전환 A→B). 이것이 끝나기 전 "RevenueCat complete"를 주장하지 않습니다. 실결제는 launch gate(`real_payments_enabled=off`)로 계속 차단됩니다.
