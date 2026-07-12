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
