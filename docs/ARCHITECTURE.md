# 아키텍처

## 권장 기술 선택

솔로 개발과 8주 성장 기간을 전제로 한 기본안이며 iOS를 먼저 출시해 범위를 줄입니다.

| 경계          | 선택                                                                  |
| ------------- | --------------------------------------------------------------------- |
| Mobile        | Expo / React Native / TypeScript                                      |
| Web pitch     | Next.js / TypeScript, server-rendered share page와 OG metadata        |
| Backend       | Supabase Postgres, Auth, Storage, Row Level Security, Realtime        |
| Media         | server-side FFmpeg 또는 Remotion renderer                             |
| AI            | speech-to-text와 structured generation을 provider interface 뒤에 격리 |
| Purchases     | RevenueCat React Native SDK와 backend webhook sync                    |
| Notifications | Expo Notifications, 최종 스폰서 규칙 확인 후 OneSignal 검토           |
| Analytics     | PostHog 또는 동등한 event analytics와 RevenueCat dashboard            |
| Identity      | 외부 liveness/face-match provider를 adapter로 격리                    |
| Moderation    | text/image/audio provider adapter와 내부 review queue                 |

## File structure

```text
friendword/
├── README.md
├── CLAUDE.md
├── AGENTS.md
├── apps/
│   ├── mobile/
│   │   ├── app/
│   │   └── src/{features,components,services,analytics,safety}/
│   └── web/
│       ├── app/p/[campaignSlug]/
│       ├── app/api/og/
│       └── src/
├── packages/{contracts,domain,ui-tokens,config}/
├── supabase/{migrations,functions,seed.sql,tests}/
├── media-worker/{compositions,render}/
├── docs/
└── scripts/
```

이 구조는 목표 구조입니다. 실제 디렉터리가 아직 생성되지 않았으면 구현 완료로 간주하지 않습니다.

## API와 권한 경계

- 클라이언트는 service role key를 절대 보유하지 않습니다.
- media upload에는 만료가 짧은 signed URL을 사용합니다.
- public pitch endpoint는 공개에 필요한 최소 projection만 반환합니다.
- authorization은 전역 `users.role`이 아니라 campaign membership, pitch ownership, interest sender 관계로 판정합니다.
- interest profile은 해당 캠페인의 Dater와 본인만 읽습니다.
- 메시지는 동일한 open Intro Room 참가자만 읽고 씁니다.
- RevenueCat webhook은 authorization header, idempotency와 event replay를 처리합니다.
- webhook은 App User ID로 단일 User를 찾고 product의 `scope_type`/`scope_id` 및 구매 당시 resource role을 재검증합니다.
- verification provider 결과는 원본 신분증이 아니라 status, provider reference와 timestamp만 저장합니다.

## Provider 격리 원칙

AI, identity, moderation 구현을 adapter 뒤에 두어 공급자 교체와 로컬 mock을 가능하게 합니다. mock은 로컬 개발 경로일 뿐 개인정보·동의·moderation·결제의 production 완료 근거가 아닙니다. 공개 media와 원본 media bucket을 분리하고, 외부 공급자 전송 전 목적·공유 동의를 받습니다.
