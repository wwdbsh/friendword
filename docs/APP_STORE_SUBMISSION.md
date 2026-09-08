# App Store 제출 키트 (T009 / Issue #78)

> 작성: **2026-09-08**. 대상: `com.friendword.app` v1.0.0 첫 공개 출시.
> 이 문서의 목적은 **상헌 님이 버튼만 누르면 되게** 하는 것입니다. 값이 소유자 결정인 항목은 `[결정 필요]`로 표시하고 선택지와 권장안을 함께 둡니다.
> 사실 근거: `docs/HACKATHON_RULES.md`(2026-08-04 Final Rules 대조), `docs/REVENUECAT_SETUP.md`, `docs/PRIVACY_DATA_MAP.md`, `docs/OPS.md`, `docs/PRODUCT.md`, `docs/COMMUNITY_GUIDELINES.md`, `docs/THREAT_MODEL.md`, `docs/DEVICE_QA.md`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/app/paywall.tsx`, `apps/mobile/src/services/purchases.ts`, `docs/DECISIONS.md` 2026-09-08 항목(T001~T004).
> **이 문서는 Apple 심사 정책을 인용하되, 심사 기준 해석을 보증하지 않습니다.** App Store Connect UI에서 실제 문항이 다르면 UI가 권위입니다.

---

## 0. 제출을 막는 것 (먼저 읽으십시오)

이 세 가지는 **문서로 해결되지 않습니다.** 순서대로 처리하지 않으면 제출 자체가 불가능하거나 심사에서 거부됩니다.

| #   | 블로커                                 | 사실                                                                                                                                                                                                                                                                     | 필요한 조치                                                                |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| B1  | **Privacy Policy URL이 존재하지 않음** | `apps/web/app`에 `/privacy`·`/terms`·`/support` 라우트가 **없습니다**(실측: 라우트 12개 전수 확인). Privacy Policy URL은 App Store Connect **필수 입력**입니다.                                                                                                          | §2 `[결정 필요] D1`, 정적 페이지 3종 추가                                  |
| B2  | **심사자가 로그인할 수 없음**          | 로그인은 **이메일 OTP 코드 단일 경로**입니다(`apps/mobile/src/services/authSession.ts` → `signInWithOtp`/`verifyOtp`). 심사자는 우리 메일함을 열 수 없습니다.                                                                                                            | §6 `[결정 필요] D5`                                                        |
| B3  | **심사자의 결제가 서버에서 거부됨**    | App Review의 IAP는 **Sandbox 환경**에서 실행됩니다. 현재 `sandbox_payments_enabled=off`이고 `sandbox_test_accounts`가 비어 있어 SANDBOX purchase intent 발급 자체가 거부됩니다(`docs/OPS.md` Launch gates 표). 심사자는 "purchases are not available yet"만 보게 됩니다. | §5 `[결정 필요] D4` — 데모 계정을 `sandbox_test_accounts`에 등록 + 창 열기 |

B3은 Shipaton 요건과도 직결됩니다 — 룰 §제출물 6번은 **심사위원이 유료 기능을 10/13까지 테스트할 수 있어야** 한다고 요구합니다.

---

## 1. 타임라인 (2026-09-30 23:45 PDT 역산)

Shipaton 자격 조건은 **첫 공개 스토어 출시가 제출 기간(2026-07-31 08:00 ~ 2026-09-30 23:45 PDT) 안**이어야 한다는 것 하나입니다(`docs/HACKATHON_RULES.md`). 공식 룰이 "App Review는 수일 이상 걸릴 수 있으니 일찍 제출하라"고 명시합니다.

| 단계 | 기한(권장)          | 내용                                                                                                      | 게이트                                       |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| T-22 | **09-08 ~ 09-10**   | B1(법적 페이지 3종) + ASC 앱 레코드 메타데이터 + IAP 2종 생성/제출                                        | 소유자 결정 D1~D3                            |
| T-20 | **09-10**           | `eas build --profile production --platform ios` → **IPA 추출로 env 베이크 검증**(§7)                      | T003 포함 빌드                               |
| T-19 | **09-11**           | TestFlight internal(**소유자 단독**) 실기기 QA — `docs/DEVICE_QA.md` 전 항목 + T001~T004 재검증           | 외부 테스터 없음                             |
| T-18 | **09-12**           | Sandbox 결제 드릴(`docs/OPS.md` "RevenueCat sandbox 결제 드릴") 통과 — 구매→멱등→restore→환불             | 소유자 실행                                  |
| T-17 | **09-13**           | 스크린샷 8장 촬영(`docs/store-assets/6.9/`) + 심사 노트 확정                                              |                                              |
| T-16 | **09-14**           | **App Store 심사 제출** (`eas submit` 또는 ASC UI). release는 **Manual**로 둡니다.                        | `docs/HACKATHON_RULES.md` 재확인 게이트 체크 |
| —    | 09-14 ~ 09-24       | 심사 왕복 버퍼 **10일**. 거부 1~2회를 전제로 잡은 값입니다(§8의 위험 목록 기준).                          |                                              |
| T-6  | **09-24**           | 승인 후 **수동 release** → 첫 공개 출시. 이 날짜가 Shipaton 자격 확정 시점입니다.                         | 소유자 승인                                  |
| T-5  | **09-25**           | `real_payments_enabled` 전환 판단(§5). Grand Prize shortlist는 **9/30까지의 RevenueCat 계측 매출**입니다. | **소유자 전용 스위치**                       |
| T-0  | **09-30 23:45 PDT** | Devpost 최종 제출(데모 영상 2분 미만, 스토어 URL, 아이콘, 스크린샷, 프로모 코드)                          | 마감 후 수정 불가                            |

**출시 순서 규칙 (DECISIONS 2026-09-08 T003, 위반 시 기존 앱이 씬 없이 제출됨)**
`migration 0062 → web 배포 → 모바일 빌드 출시`. T003 이전 번들은 긴 녹음에서 씬이 거부되어 무음(sceneless) 강등으로 떨어집니다. 현재 유일한 TestFlight 빌드(#7/#9)는 소유자 기기에만 있으므로 영향 사용자는 0명입니다 — **T003을 포함한 모바일 빌드가 출시되기 전에는 어떤 외부 테스터도 초대하지 않습니다.**

---

## 2. App Store Connect 메타데이터

ASC App ID는 이미 존재합니다: **`6791076145`** (`apps/mobile/eas.json` submit.production.ios.ascAppId). Bundle ID `com.friendword.app`, version `1.0.0`, `appVersionSource: remote`(빌드 번호는 EAS가 증가).

### 2.1 확정 가능한 값

| 필드              | 값                                                   | 근거                       |
| ----------------- | ---------------------------------------------------- | -------------------------- |
| Name (≤30)        | `Friendword`                                         | `app.config.ts` name       |
| Primary language  | English (U.S.) — 룰 §7 "모든 제출 자료는 영어"       | HACKATHON_RULES            |
| Primary category  | `Social Networking`                                  | `[결정 필요] D2` 참조      |
| Bundle ID         | `com.friendword.app`                                 | `app.config.ts`            |
| Copyright         | `2026 Sangheon Lee`                                  | 소유자 확인 필요           |
| Price             | Free (IAP 2종)                                       | `docs/REVENUECAT_SETUP.md` |
| Availability      | **미국 스토어프론트 포함 필수**                      | HACKATHON_RULES 자격 §4    |
| Sign-in required  | Yes (핵심 기능에 로그인 필요)                        | `authSession.ts`           |
| Export compliance | 이미 처리됨 — `ITSAppUsesNonExemptEncryption: false` | `app.config.ts` infoPlist  |

### 2.2 Subtitle (≤30자) — 초안 3안, 하나를 고르십시오 `[결정 필요] D2a`

| 안  | 문구                             | 길이 | 성격                              |
| --- | -------------------------------- | ---- | --------------------------------- |
| A   | `Dating, in your friends' words` | 30   | PRODUCT.md의 확정 태그라인 그대로 |
| B   | `Your friend introduces you`     | 26   | 역할이 즉시 읽힘                  |
| C   | `Let a friend vouch for you`     | 26   | 행동 유도                         |

권장: **A** — 이미 제품 문서의 공식 태그라인이고 30자 정확히 들어갑니다.

### 2.3 Promotional Text (≤170자, 심사 없이 수시 변경 가능)

```
Your friend records a 30-60 second voice intro. You approve every photo and every
word before anything goes public. Then the pitch is a link anyone can watch.
```

### 2.4 Description (영문 초안 — 그대로 붙여넣기 가능)

```
Friendword is dating in your friends' words.

Instead of writing your own profile, a friend who actually knows you records a
30-60 second voice introduction. Friendword turns that recording — their real
voice, the photos you approved, captions from what they actually said — into a
vertical pitch you can share as a link.

HOW IT WORKS

1. A friend starts a pitch. They say how they know you and record 30-60 seconds
   in their own voice. They suggest a few photos.
2. You approve it, item by item. You get an invitation link. You review every
   photo, every line of text, and the recording itself. Change what you want,
   delete what you don't. Nothing is public until you approve it — and you set
   how precisely your location is shown, what you're looking for, and when the
   campaign ends.
3. Anyone can watch the link. No account needed to view.
4. Interest goes through a verified profile. To express interest, a viewer has
   to complete their own photos, basic profile, and adult confirmation. You see
   who is interested and decide.
5. You talk first, in the app. If you accept, a text-only intro room opens.
   Phone numbers and emails are never handed over automatically.

WHAT FRIENDWORD DOES NOT DO

- No swipe feed, no public browsing of profiles, no compatibility score.
- No AI avatars, no voice cloning, no lip-sync. Your friend's real voice is the
  point.
- No appearance ratings, no public voting, no anonymous comments.
- We do not run background checks and we do not claim anyone is safe.

SAFETY

Report and block are available everywhere, on every public pitch and inside every
intro room, and they are never behind a payment. You can pause or delete a
campaign at any time, withdraw your consent, and delete your account and its data
from inside the app.

Friendword is for adults 18 and over.

IN-APP PURCHASES

Friendword is free to use: recording a pitch, approving it, publishing the link,
receiving interest, and messaging cost nothing.

- Creator Launch ($4.99): one share card and caption pack for one published
  pitch.
- 30-day Campaign Pass ($19.99): adds 30 days to one campaign's live window and
  unlocks that campaign's funnel analytics.

Both are one-time purchases. Neither unlocks safety features.
```

> **금지 표현 검토 완료** — `docs/THREAT_MODEL.md` "주장과 공개 경계"에 따라 "safe", "verified people", "background checked", 사기 방지 보장 문구를 쓰지 않았습니다. "Verified"는 관심 표현자의 **프로필 완료 요건**으로만 서술했습니다.
> 한국어 현지화는 **선택**입니다(룰은 영어만 요구). 추가한다면 위 문구의 직역이 아니라 §2.4와 같은 경계를 지키는 별도 검수가 필요합니다.

### 2.5 Keywords (≤100자, 쉼표 구분·공백 없이)

```
friend,intro,voice,matchmaking,introduction,vouch,wingman,single,date,setup,link,share
```

(85자. `dating`은 앱 이름·설명에 이미 있어 중복 배점이 없으므로 제외했습니다.)

### 2.6 URL 3종 `[결정 필요] D1` — **B1 블로커**

현재 웹앱 라우트 전수: `/`, `/auth/confirm`, `/consent/[token]`, `/inbox`, `/interests`, `/kit/[draftId]`, `/me`, `/p/[campaignSlug]`, `/p/[campaignSlug]/interest`, `/rooms`, `/rooms/[roomId]`, `/internal/render/[revisionId]`, `/api/*`. **법적/지원 페이지가 하나도 없습니다.**

| 필드                | 필요 여부              | 권장 값                          | 상태                 |
| ------------------- | ---------------------- | -------------------------------- | -------------------- |
| Privacy Policy URL  | **필수**               | `https://friendword.com/privacy` | **없음 — 생성 필요** |
| Support URL         | **필수**               | `https://friendword.com/support` | **없음 — 생성 필요** |
| Marketing URL       | 선택                   | `https://friendword.com`         | 존재(랜딩)           |
| Terms of Use (EULA) | IAP 있으면 사실상 필수 | `https://friendword.com/terms`   | **없음 — 생성 필요** |

**권장**: T006/T011에서 `apps/web/app/{privacy,terms,support}/page.tsx` 정적 페이지 3종을 추가합니다. 내용 출처는 각각 `docs/PRIVACY_DATA_MAP.md`, `docs/COMMUNITY_GUIDELINES.md`, `docs/OPS.md`의 "데이터 삭제 요청" 절입니다. Support 페이지에는 **공개 support contact와 child safety contact**가 반드시 실려야 합니다 — `docs/COMMUNITY_GUIDELINES.md`가 "출시 전에 확정해야 한다"고 남겨둔 항목이고, 아직 확정되지 않았습니다(`[결정 필요] D1b`: 어떤 주소를 공개할 것인가).

> `friendword.com` 자체의 HTTPS 응답·Vercel 도메인 연결 상태는 이 태스크에서 확인하지 못했습니다(DECISIONS 2026-08-05 기준 "사용자 잔여 액션", 2026-08-11 기록으로는 Auth Site URL이 friendword.com으로 이전됨). **제출 전에 세 URL이 실제로 200을 반환하는지 브라우저로 확인하십시오** — Apple은 URL을 실제로 엽니다.

---

## 3. Age Rating 설문

**결론: 최고 등급(성인 전용)으로 신청합니다.** `docs/COMMUNITY_GUIDELINES.md`가 18세 이상 전용을 제품 불변 조건으로 못박고 있고, `docs/PRODUCT.md`도 "18세 이상 대상"으로 정의합니다.

> `[확인 필요]` Apple은 2025년에 연령 등급 체계를 4+/9+/13+/16+/18+로 개편했습니다. **ASC 설문 UI에 실제로 나오는 선택지가 권위**입니다. 데이팅 앱은 어느 체계에서도 최상위(구 17+ / 신 18+)로 떨어집니다.

| 설문 항목                                              | 답      | 근거                                                                                                                    |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Unrestricted Web Access**                            | No      | 앱 안에 임의 URL을 여는 브라우저가 없습니다. `Linking.openURL`은 우리 웹 오리진의 kit 페이지로만 갑니다(`paywall.tsx`). |
| **Gambling**                                           | No      | 없음                                                                                                                    |
| **Contests**                                           | No      | 없음                                                                                                                    |
| **User Generated Content** (신 체계: Frequent/Intense) | **Yes** | 음성·사진·문구·관심 프로필·Intro Room 메시지 전부 UGC입니다.                                                            |
| **Messaging / chat**                                   | **Yes** | 수락된 두 사람의 text-only Intro Room                                                                                   |
| **Dating**                                             | **Yes** | 제품 정의 그 자체                                                                                                       |
| Sexual Content or Nudity                               | None    | 금지 정책이고 moderation 대상입니다. "Infrequent/Mild"를 고르지 않는 근거는 **허용하지 않기 때문**입니다.               |
| Violence / Horror / Profanity / Drugs / Alcohol        | None    | 해당 없음                                                                                                               |
| Medical/Treatment Info                                 | No      |                                                                                                                         |
| **Age Verification / 18+ 앱 여부**                     | **Yes** | 생년월일 + 전화 확인 + (enforcement on 시) identity provider age assertion — `docs/COMMUNITY_GUIDELINES.md`             |

**심사 근거로 함께 제출할 서술 (App Review Notes에 포함):**

> Guideline 1.1.4 / 1.2 (User-Generated Content) 대응: 앱은 (a) 게시 전 콘텐츠 필터, (b) 모든 공개 콘텐츠와 1:1 대화에서의 신고, (c) 차단, (d) 24시간 내 운영자 조치와 감사 로그를 갖춘 신고 큐, (e) 앱 내 연락 수단을 제공합니다. 자동 필터가 운영자 검토를 대체하지 않습니다.
> **정직하게 남길 한계**: Intro Room 메시지는 **전송 전 자동 검열을 거치지 않습니다**(`docs/COMMUNITY_GUIDELINES.md`의 확정 정책 — 사적 1:1 대화 전문을 외부 AI로 상시 전송하지 않는 프라이버시 트레이드오프). 서버가 강제하는 것은 참가자 판정, 길이·rate 제한, 신고·차단·나가기, 차단·정지 계정 접근 차단이고 나머지는 신고 기반 반응형 검토입니다. 심사 노트에 이 상태를 "moderation complete"라고 쓰지 않습니다. **Apple이 1.2의 사전 필터를 요구하면 이것이 거부 사유가 될 수 있습니다** — §8 R3 참조.

---

## 4. App Privacy (영양성분표)

출처: `docs/PRIVACY_DATA_MAP.md`. **PostHog는 이 리포에 연동되어 있지 않습니다** — 코드 실측 결과 analytics는 Supabase 자체 `track_event` RPC 하나뿐이고, 속성은 allowlist(`campaign_id`·`campaign_slug`·`pitch_draft_id`·`source`·`platform`·`channel`·`duration_ms`·`product_id`)로 제한됩니다(`docs/ANALYTICS_PLAN.md`). PostHog는 `docs/COST_MODEL.md`의 **후보 목록**에만 있습니다. 따라서 제3자 analytics SDK는 **없음**으로 신고합니다.

**Tracking(추적) 답변: 전 항목 No.** 앱은 다른 회사의 앱·웹사이트 데이터와 결합하지 않고, 광고 네트워크·데이터 브로커에 아무것도 보내지 않습니다. 따라서 **ATT 프롬프트도 필요하지 않습니다**(권장: `NSUserTrackingUsageDescription`을 추가하지 **마십시오** — 이유 없는 프롬프트는 5.1.2 위반입니다).

| 데이터 타입              | 수집   | 목적                         | 사용자 연결 | 추적 | 근거                                                                   |
| ------------------------ | ------ | ---------------------------- | ----------- | ---- | ---------------------------------------------------------------------- |
| Email Address            | Yes    | App Functionality            | **Yes**     | No   | `auth.users`에만 존재. 알림 발송 시 service-role로 해석 후 즉시 폐기   |
| Name                     | Yes    | App Functionality            | **Yes**     | No   | `profiles.display_name`(확인 전에는 공개 표면에 나가지 않음 — 0061)    |
| Phone Number             | Yes    | App Functionality            | **Yes**     | No   | 성인·본인 확인. 공개 payload 금지                                      |
| Other User Contact Info  | Yes    | App Functionality            | **Yes**     | No   | 동의 초대 접점 — **raw 저장 없이 hash만**                              |
| Photos or Videos         | Yes    | App Functionality            | **Yes**     | No   | 제안 사진·클립·프로필 사진. 승인 전 비공개 버킷                        |
| Audio Data               | Yes    | App Functionality            | **Yes**     | No   | Introducer 원본 음성. 승인·렌더 후 짧게 보존(초기 기준 7일)            |
| Other User Content       | Yes    | App Functionality            | **Yes**     | No   | AI 초안 문구, Intro Room 메시지, 관심 노트                             |
| Sensitive Info           | Yes    | App Functionality            | **Yes**     | No   | dating intent = 성적 지향에 준함. `[확인 필요]` ASC 문항 문구 확인     |
| Coarse Location          | Yes    | App Functionality            | **Yes**     | No   | **정밀 위치는 수집하지 않습니다.** Dater가 공개 정밀도를 직접 고릅니다 |
| Purchase History         | Yes    | App Functionality            | **Yes**     | No   | RevenueCat 웹훅 → `purchase_events`                                    |
| User ID                  | Yes    | App Functionality            | **Yes**     | No   | Supabase user id = RevenueCat appUserID                                |
| Product Interaction      | Yes    | Analytics, App Functionality | **Yes**     | No   | `track_event` 퍼널 이벤트(allowlist 속성만)                            |
| Crash Data / Performance | No     | —                            | —           | —    | 제3자 크래시 SDK 없음                                                  |
| Device ID / Advertising  | No     | —                            | —           | —    | 광고 식별자 미사용                                                     |
| Precise Location         | **No** | —                            | —           | —    | 위치 권한 자체를 요청하지 않습니다                                     |
| Contacts                 | **No** | —                            | —           | —    | 주소록 동기화 없음(P2로도 명시적 제외)                                 |
| Browsing/Search History  | No     | —                            | —           | —    |                                                                        |

**보조 서술(Privacy Nutrition Label 밖이지만 심사 노트·정책 페이지에 필요):**

- 외부 AI 공급자(OpenAI: whisper-1 transcription + structuring)로 음성·transcript가 나갑니다. **동의 없이는 외부 호출 0회**이며, 동의는 서버 관리 disclosure revision에 bind됩니다(`ai_processing_consents`).
- 이메일 발송은 Resend, 결제는 RevenueCat/Apple, 저장·인증은 Supabase입니다.
- **삭제**: 앱 내 계정 삭제가 존재합니다(`apps/mobile/app/account/index.tsx` — 확인 문구 입력 후 영구 삭제, 별도 sign out 카드). 삭제 잡은 매일 03:10 UTC에 돌며 storage 객체까지 제거합니다(`docs/OPS.md`).

**권한 문자열 (이미 `app.config.ts`에 있음, 그대로 심사 통과 대상):**

- 마이크: "Friendword uses your microphone to record a 30–60 second pitch for your friend."
- 사진: "Friendword lets you suggest photos and short videos that your friend can approve or replace."
- **주의**: 사진은 이제 PHPicker로 열려 **라이브러리 권한을 요청하지 않습니다**(DECISIONS 2026-09-08 / 커밋 5aca36e). `NSPhotoLibraryUsageDescription`은 문자열로 남아 있어도 무해하지만, 심사자가 "권한을 요청하지 않는데 왜 문자열이 있나"를 묻지는 않습니다. 제거는 하지 않습니다 — expo-image-picker의 다른 경로가 이를 쓸 수 있습니다.

---

## 5. In-App Purchase

`docs/REVENUECAT_SETUP.md` 기준. **둘 다 Consumable**입니다(Campaign Pass는 ASC에서 non-renewing subscription 유형이 사라져 Consumable로 생성하며, 옛 ID는 Apple이 영구 잠금해 canonical ID가 `campaign_pass_30d_1999`입니다).

| Product ID                  | Type       | Reference Name        | Display Name           | Price            | Description (심사 제출용, ≤45자 표시명 / ≤255자 설명)                                                                                |
| --------------------------- | ---------- | --------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `creator_launch_credit_499` | Consumable | Creator Launch Credit | `Creator Launch`       | $4.99 (Tier 5)   | `One share card and caption pack for one published pitch. One-time purchase. The kit stays available after unlock.`                  |
| `campaign_pass_30d_1999`    | Consumable | 30-Day Campaign Pass  | `30-Day Campaign Pass` | $19.99 (Tier 20) | `Adds 30 days to this campaign's live window, on top of any time it already has left, and unlocks that campaign's funnel analytics.` |

가격 티어 번호는 미국 스토어프론트 기준 관례값입니다 — **ASC에서 $4.99 / $19.99가 나오는 티어를 UI로 확인해 고르십시오**(Apple이 티어 표를 개편해 왔습니다).

### 5.1 IAP 심사 스크린샷 (필수)

각 IAP마다 **구매 화면 스크린샷 1장**이 필요합니다. 대상: 앱의 `/paywall` 화면에서 `status.state === 'ready'`이고 가격이 실제로 표시된 상태 — 즉 **RevenueCat 키가 구워지고 ASC 상품이 "Ready to Submit" 이상**이어야 찍을 수 있습니다. 파일명은 `docs/store-assets/6.9/iap-01-creator-launch.png`, `iap-02-campaign-pass.png`로 둡니다.

### 5.2 심사자가 실제로 보게 될 것 `[결정 필요] D4` — **B3 블로커**

`apps/mobile/src/services/purchases.ts`의 실패 문구는 다음과 같습니다(T004에서 벤더 원문 노출 제거):

| 상태                     | 심사자가 보는 제목          | 본문                                                                        |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------- |
| 키 미베이크 / SDK 미구성 | `Purchases aren't live yet` | `Purchases are not switched on in this build yet. Nothing was charged.`     |
| offerings 로드 실패      | `The store didn't answer`   | `The store could not be reached just now. Nothing was charged — try again…` |
| offering에 상품 없음     | `Nothing to buy here yet`   | `There is nothing to buy for this pitch yet. Nothing was charged.`          |
| 로그아웃                 | `Sign in to buy this`       | `Sign in first so the purchase lands on your account. Nothing was charged.` |

**여기에 더해 서버 게이트가 있습니다.** 상품이 보이고 심사자가 구매를 눌러도, `sandbox_payments_enabled=off`이거나 그 계정이 `sandbox_test_accounts`에 없으면 SANDBOX purchase intent 발급이 **거부**됩니다(`docs/OPS.md` Launch gates). App Review의 결제는 정의상 Sandbox이므로 **현 상태로 제출하면 심사자는 구매를 완료할 수 없습니다.**

선택지:

| 안                                                                                                                    | 결과                                                                   | 위험                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A (권장)** 데모 계정 user_id를 `sandbox_test_accounts`에 등록 + `sandbox_payments_enabled=on`을 심사 기간 동안 유지 | 심사자가 전체 구매 왕복을 완료. `real_payments_enabled`는 **계속 off** | 등록된 계정은 프로덕션 구매를 할 수 없습니다(0060 fail-safe). 데모 전용 계정이므로 무해. 심사 종료 후 §7단계로 창을 닫습니다. |
| B `real_payments_enabled`도 켠다                                                                                      | 실사용자 결제도 열림                                                   | **소유자 전용 스위치**이고 Slice 10 release gate 통과가 전제입니다. 심사만을 위해 켜지 않습니다.                              |
| C 아무것도 하지 않는다                                                                                                | 심사자가 "purchases are not available yet"을 봄                        | **3.1.1/2.1 거부 가능성이 높고 Shipaton 심사위원 접근 요건도 못 맞춥니다.**                                                   |

권장 A. 절차는 `docs/OPS.md` "RevenueCat sandbox 결제 드릴" 1단계(등록+스위치)와 동일하며, 심사 노트에 "purchases run in Apple's sandbox for review"라고 적을 필요는 없습니다(당연한 동작).

### 5.3 Shipaton 심사위원용 무료 접근 `[결정 필요] D6`

룰 §제출물 6: 심사위원이 **모든 유료 기능을 10/13까지** 테스트할 수 있어야 합니다.

- 안 1 (권장): **App Store 프로모 코드**를 각 IAP에 대해 발급해 Devpost 제출물에 첨부. `[확인 필요]` Consumable에 대한 프로모 코드 발급 가능 여부를 ASC UI에서 직접 확인하십시오 — 확인되지 않으면 안 2로 갑니다.
- 안 2: 심사위원용 계정을 `sandbox_test_accounts`에 등록하고 sandbox 구매를 안내(코드 없이 무료 왕복).
- 안 3: 심사 기간 동안 데모 캠페인에 Creator Kit·Pass 효익을 서버에서 직접 부여.

어느 쪽이든 **소유자 결정**이며, 10/13까지 유지 의무가 있습니다.

---

## 6. App Review Notes (심사자용 안내)

### 6.1 로그인 `[결정 필요] D5` — **B2 블로커**

로그인은 이메일 OTP 코드 하나뿐입니다. 심사자에게 **코드를 받을 수단**을 줘야 합니다.

| 안                                                                                    | 장점                                              | 단점 / 확인 필요                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **A (권장)** Supabase Auth의 **test OTP** 기능으로 데모 이메일 1개에 고정 코드를 매핑 | 코드가 상수라 노트에 적을 수 있음. 코드 변경 없음 | `[확인 필요]` Supabase 대시보드에서 **이메일** test OTP를 지원하는지 확인(전화번호는 지원). 미지원이면 B |
| B 심사자가 직접 열 수 있는 메일함(전용 웹메일 계정)의 주소와 비밀번호를 노트에 제공   | 즉시 가능                                         | 노트에 제3자 서비스 자격증명이 들어갑니다. 계정 탈취 시 데모 데이터 노출                                 |
| C 심사 전용 하드코딩 우회 계정                                                        | 확실                                              | **2.3.1(숨겨진 기능) 위험**과 보안 부채. 권장하지 않음                                                   |

**어느 안이든 실제 개인 이메일 주소는 이 문서에 적지 않습니다.** 노트 작성 시점에 소유자가 ASC 입력란에 직접 씁니다. 별칭 체계는 `docs/DEVICE_QA.md`의 QA 별칭 관례(소유자 Gmail의 `+` 별칭)를 따르되, **데모 계정은 QA 별칭과 분리**하십시오 — 심사자가 보는 계정에 QA 잔여 데이터가 있으면 안 됩니다.

### 6.2 심사자가 따라갈 경로 (노트 본문 초안, 영어)

```
Friendword is one product with two surfaces: the iOS app (where a friend records
the introduction) and a web consent page (where the person being introduced
approves it before anything is public). This is intentional — the person being
introduced must be able to approve from a link, without installing an app.

You can see the whole loop with the demo account below. It takes about 8 minutes.

DEMO ACCOUNT
  Email: <filled in App Store Connect>
  Sign-in code: <filled in App Store Connect>
  (Sign-in is a 6-digit code sent by email. The account above is configured so
  the code is fixed and does not need a mailbox.)

A. IN THE APP — record an introduction
   1. Open the app, tap "Pitch a friend".
   2. Choose a relationship and how long you have known them.
   3. Enter a first name and a contact for the approval invitation.
   4. Add 1-4 photos. The picker does not ask for library permission — you only
      hand over the photos you pick.
   5. Record 30-60 seconds. IMPORTANT: please actually speak. The server refuses
      a recording it cannot hear — a take with fewer than about 12 words is
      rejected and you are sent back to re-record. This is deliberate: an
      inaudible take used to produce an entirely invented introduction.
   6. On the review screen, agree to AI processing, then create the draft. The
      recording is transcribed and structured by OpenAI; the disclosure on that
      screen is the consent, and nothing is sent to any AI provider without it.
   7. Copy the approval link.

B. IN A BROWSER — approve it (the person being introduced)
   8. Open the approval link. Review each photo and each line, then approve and
      publish. Only at this point does a public URL exist.

C. IN A BROWSER — watch and express interest (a stranger)
   9. Open the public pitch link. No account is needed to watch.
  10. "I'm interested" requires a completed profile: photos, a short bio, an age
      and adult confirmation. This is the verification boundary.
  11. Back in the inbox, accept the interest. A text-only intro room opens.
      Report, block and leave are available inside it, and on every public pitch.

IN-APP PURCHASES
  Both products are consumables and neither unlocks any safety feature. Report,
  block, campaign pause, consent withdrawal and account deletion are free.
  - Creator Launch ($4.99): a share card and caption pack for one published pitch.
  - 30-Day Campaign Pass ($19.99): 30 more days for one campaign plus that
    campaign's funnel analytics.

ACCOUNT DELETION
  Account > Delete your account. It asks you to type a confirmation phrase and
  then permanently deletes the account and its media.

AGE
  Friendword is 18+. Date of birth plus phone confirmation gate the flows.

MODERATION — an honest statement
  Public content passes automated filters before and after upload and every
  public surface and every 1:1 room can be reported and blocked, with an operator
  queue reviewed at least daily. Messages inside a private intro room are NOT
  scanned by an AI before they are sent; that is a deliberate privacy trade-off,
  and those rooms are moderated reactively from reports, with server-enforced
  participant checks, rate limits, block and leave.
```

### 6.3 노트에 반드시 포함할 짧은 경고

- **녹음은 12단어 이상 실제 발화가 필요합니다** (DECISIONS 2026-09-08 T001). 심사자가 무음으로 테스트하면 정상 경로를 못 봅니다. 위 노트 A-5에 이미 포함했습니다.
- 앱은 **처음 보내기 전에 표시 이름을 묻습니다**(T002). 심사자가 시트를 만나도 정상입니다.
- 승인·공개 열람은 웹 표면입니다. 앱만으로 전체 루프가 끝나지 않는 것이 설계입니다.

---

## 7. 빌드 · 제출 절차

```sh
# 0) 브랜치는 main. 커밋·푸시·배포는 상헌 님 승인 후에만.
cd apps/mobile

# 1) production 프로필 env가 실제로 있는지 (대시보드 신뢰 금지 — 이 리포에서 2회 사고)
pnpm dlx eas-cli env:list production
#    보여야 하는 것: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
#                    EXPO_PUBLIC_WEB_ORIGIN, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
#                    FRIENDWORD_VIDEO_MAX_BYTES

# 2) 빌드 (eas.json production: autoIncrement=true, appVersionSource=remote →
#    빌드 번호는 EAS가 올립니다. version 1.0.0은 app.config.ts에서 바꿉니다.)
pnpm dlx eas-cli build --profile production --platform ios

# 3) IPA 베이크 검증 — 대시보드가 아니라 산출물을 봅니다
#    빌드 아티팩트를 내려받아 압축을 풀고 번들에서 키 존재를 확인:
#      unzip -o build.ipa -d /tmp/ipa
#      grep -c "<RevenueCat public key prefix>" /tmp/ipa/Payload/*.app/main.jsbundle
#    0이면 env가 안 구워진 것 — env 등록 후 재빌드해야 반영됩니다.

# 4) 제출
pnpm dlx eas-cli submit --profile production --platform ios
#    ascAppId 6791076145는 eas.json에 이미 있습니다.
```

**IPA에서 확인할 것 (실기기 TestFlight 설치 후):**

1. `/paywall`이 **실제 가격 문자열**을 표시 — RevenueCat 키가 구워졌다는 유일한 증거입니다. "Purchases aren't live yet"이면 키가 없습니다.
2. 스플래시·아이콘·홈 렌더, 헤더에 백 라벨 누출 없음 (`docs/DEVICE_QA.md`).
3. 30~60초 녹음 후 리뷰 화면 Play recording에서 **소리가 실제로 나고** 표시 시간이 타이머와 일치.
4. 무음 take가 정직한 에러로 거부됨.
5. 계정 화면에 sign out과 계정 삭제가 모두 보임.

**버전·빌드 번호 위치**: marketing version은 `apps/mobile/app.config.ts`의 `version: '1.0.0'`. build number는 EAS 원격 카운터(`eas.json` → `cli.appVersionSource: "remote"`, `build.production.autoIncrement: true`)이므로 리포에서 손으로 올리지 않습니다.

**심사 후 정리 (sandbox 창 닫기)**: 심사 승인 후 `docs/OPS.md` 드릴 7단계대로 `sandbox_payments_enabled=off` + `sandbox_test_accounts` 행 삭제. 단 **Shipaton 심사위원이 sandbox로 유료 기능을 보는 안(D6-2)을 택했다면 10/13까지 열어 둡니다.**

---

## 8. 거부 위험과 우리의 답

| #   | 가이드라인                 | 위험                                          | 현 상태 / 답변                                                                                                                                                                        | 잔여 위험                                    |
| --- | -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| R1  | **5.1.1(v) 계정 삭제**     | 계정 생성 앱은 앱 내 삭제 필수                | **있습니다.** `account/index.tsx` — 확인 문구 입력 후 영구 삭제, 상태 재조회로 "삭제됐다"를 거짓말하지 않음. 서버 잡이 storage 객체까지 제거                                          | 없음                                         |
| R2  | **3.1.1 IAP**              | 디지털 상품을 외부 결제로 팔면 거부           | 두 상품 모두 RevenueCat(=StoreKit) 경유. 앱 안에 외부 결제 링크 없음                                                                                                                  | **B3(§5.2) 미해결 시 구매 불가로 거부**      |
| R3  | **1.2 / 1.1.4 UGC**        | 필터·신고·차단·연락처·24시간 조치 요구        | 게시 전후 필터, 모든 공개 표면·1:1의 신고, 차단(즉시 양방향 차단), 신고 큐 일 1회 이상 검토, audit log. §3의 정직한 한계 서술 포함                                                    | **Intro Room 사전 필터 없음** — 요구 시 논쟁 |
| R4  | **5.1.2 데이터 사용**      | 동의 없는 제3자 공유 / ATT 누락               | 외부 AI는 명시 동의 후에만, 동의 없으면 호출 0회. 추적 없음 → ATT 프롬프트 없음이 정답                                                                                                | privacy 페이지 부재(B1)가 곧 위반            |
| R5  | **2.1 성능·불완전 제출**   | 크래시, 데모 계정 미작동, 기능 미완           | TestFlight #7의 **미해결 'rest' 크래시**가 백로그 B4로 남아 있습니다(`docs/SESSION_HANDOFF.md`). 제출 전 재현 여부를 반드시 확인하십시오                                              | **미해결 — 제출 전 확인 필요**               |
| R6  | **4.2 최소 기능**          | "웹의 껍데기"로 보이면 거부                   | 앱은 네이티브 녹음·오디오 무결성 판정·사진 선택·초안 검토·결제를 직접 합니다. 승인/열람만 웹입니다                                                                                    | 낮음                                         |
| R7  | **2.3.1 숨겨진 기능**      | 심사자에게 안 보이는 경로                     | 런치 게이트는 **문서화된 서버 상태**이지 숨긴 기능이 아닙니다. 심사자용 우회 로그인(D5-C)을 넣으면 **여기에 걸립니다** — 그래서 권장하지 않습니다                                     | D5-C 선택 시 상승                            |
| R8  | **4.8 Sign in with Apple** | 제3자·소셜 로그인이 있으면 SIWA도 제공해야 함 | **해당 없음.** 로그인은 이메일 OTP 단일 경로이고 Google/Facebook/Apple 등 제3자 로그인 서비스를 제공하지 않습니다. 4.8은 "third-party or social login service"를 제공할 때 적용됩니다 | 심사자 오해 시 노트로 설명 가능              |
| R9  | **1.1.6 / 2.3 과장 표현**  | 검증 범위 초과 주장                           | §2.4 설명문에서 "safe"·"background checked"·안전 보증 표현을 배제했습니다(`docs/THREAT_MODEL.md` 경계)                                                                                | 낮음                                         |
| R10 | **5.1.1 데이터 최소 수집** | 불필요한 개인정보 요구                        | 정밀 위치·주소록을 요청하지 않고, 사진은 PHPicker로 라이브러리 권한 없이 받습니다                                                                                                     | 낮음                                         |

---

## 9. 스크린샷

Apple은 **6.9" 세트 1종**(iPhone 17 Pro Max 급, 1320×2868)만 있으면 나머지를 스케일합니다. Shipaton은 별도로 **1179×2556, 기기 프레임 없는** 스크린샷 최소 1장을 요구하므로(룰 §제출물 5), **프레임 없는 원본을 함께 보관**합니다.

디렉터리와 촬영 규칙은 `docs/store-assets/README.md`. 예상 파일명(오케스트레이터가 실기기에서 촬영해 채웁니다 — **이 태스크는 이미지를 만들지 않았습니다**):

| 파일                        | 화면                                | 캡션(≤ 두 줄, 영어)                          |
| --------------------------- | ----------------------------------- | -------------------------------------------- |
| `01-home.png`               | 앱 홈 (`app/index.tsx`)             | `Dating, in your friends' words.`            |
| `02-relationship.png`       | Track 1 관계 선택                   | `Start with how you actually know them.`     |
| `03-photos.png`             | Track 3 사진 제안                   | `Suggest photos. They approve every one.`    |
| `04-record.png`             | Track 4 녹음                        | `30 to 60 seconds, in your own voice.`       |
| `05-review.png`             | Track 5 리뷰 + AI 동의              | `Read it back before you send it.`           |
| `06-share.png`              | `pitch/share.tsx`                   | `One link. No account needed to watch.`      |
| `07-campaigns.png`          | `campaigns/index.tsx`               | `Every campaign you started, in one place.`  |
| `08-account.png`            | `account/index.tsx`                 | `Sign out or delete your account, any time.` |
| `iap-01-creator-launch.png` | paywall (Creator Launch, 가격 표시) | IAP 심사용 — 스토어 노출 아님                |
| `iap-02-campaign-pass.png`  | paywall (Campaign Pass, 가격 표시)  | IAP 심사용 — 스토어 노출 아님                |

---

## 10. Shipaton 제출 체크리스트

`docs/HACKATHON_RULES.md` 대조. 이 표는 App Store 제출과 **별개**이며 2026-09-30 23:45 PDT가 마감입니다.

- [ ] **첫 공개 스토어 출시가 제출 기간 내** — 유일한 남은 자격 조건. 웹 선공개·TestFlight internal은 무해(매니저 확인 완료)
- [ ] **미국 스토어프론트 포함** availability
- [ ] **RevenueCat SDK로 구매 처리** — `react-native-purchases` 사용 중, 웹훅 계약 구현 완료
- [ ] **매출 창**: Grand Prize shortlist는 제출 기간 내 RevenueCat 계측 총매출. `real_payments_enabled`를 켜는 시점이 곧 창의 시작입니다 — **소유자 전용 결정** `[결정 필요] D7`
- [ ] **Ship Kit participant form** 작성(등록 메일로 옴). 마일스톤 5종: 등록 → RC 프로젝트 → 첫 테스트 구매 → 첫 Store API 호출 → 첫 실구매
- [ ] **심사위원 무료 접근** — 프로모 코드 또는 sandbox 등록, **10/13까지 유지** (§5.3 / `[결정 필요] D6`)
- [ ] **데모 영상 2분 미만**, YouTube/Vimeo 공개, 제3자 상표·저작권 음악 없음, 실기기 동작 장면 포함. **앱에 등장하는 실인물 음성·사진은 동의 확보가 참가자 책임**
- [ ] **1024×1024 아이콘** — `apps/mobile/assets/icon.png` 실측 1024×1024 ✔
- [ ] **1179×2556 프레임 없는 스크린샷 ≥1장**
- [ ] **모든 제출 자료 영어**
- [ ] **#BuildInPublic 지원 시 `#Shipaton` 태그 포스트 링크** 필수
- [ ] `docs/HACKATHON_RULES.md` 재확인 게이트 3종 체크: "App Store 심사 제출 전" / "공개 출시 직전" / "Devpost 제출 7일 전" / "최종 제출 직전"

---

## 11. `[결정 필요]` 요약

| ID  | 결정                                                         | 권장                                              | 막히는 것        |
| --- | ------------------------------------------------------------ | ------------------------------------------------- | ---------------- |
| D1  | privacy/terms/support 페이지를 만들 것인가, 어디에 둘 것인가 | `friendword.com/{privacy,terms,support}` 정적 3종 | **제출 불가**    |
| D1b | 공개 support contact와 child safety contact 주소             | 소유자 결정                                       | 정책 페이지 내용 |
| D2  | Primary category                                             | Social Networking (대안: Lifestyle)               | 메타데이터       |
| D2a | Subtitle 3안 중 택1                                          | A `Dating, in your friends' words` (30자)         | 메타데이터       |
| D3  | Copyright 표기 명의                                          | 소유자 확인                                       | 메타데이터       |
| D4  | 심사 기간 sandbox 창을 열 것인가                             | **안 A** (등록 + `sandbox_payments_enabled=on`)   | **IAP 심사**     |
| D5  | 심사자 로그인 수단                                           | **안 A** Supabase test OTP (미지원 시 B)          | **심사 진행**    |
| D6  | Shipaton 심사위원 무료 접근 수단                             | 프로모 코드(가능 확인 후) 또는 sandbox 등록       | Shipaton 자격    |
| D7  | `real_payments_enabled` 전환 시점                            | 출시 승인 직후(매출 창 최대화) — **소유자 전용**  | Grand Prize      |

## 12. 이 문서가 해결하지 못한 사실 공백

1. **`friendword.com`의 현재 HTTPS 응답 상태** — 리포에는 2026-08-05 결정("canonical origin")과 2026-08-11 Auth 이전 기록만 있고, 실제 도메인 연결 확인 기록이 없습니다. 프로덕션 오리진으로 문서에 살아 있는 것은 `friendword-web-nmsi.vercel.app`입니다(`docs/OPS.md`).
2. **ASC 앱 레코드 `6791076145`의 현재 상태** — 메타데이터가 어디까지 채워졌는지, IAP 2종이 생성됐는지는 리포에서 알 수 없습니다.
3. **Apple 연령 등급 체계의 현행 문항** — 2025년 개편 이후의 정확한 선택지는 ASC UI 확인이 필요합니다.
4. **Consumable IAP의 프로모 코드 발급 가능 여부** — ASC UI 확인 필요.
5. **Supabase Auth의 이메일 test OTP 지원 여부** — 대시보드 확인 필요.
6. **TestFlight #7의 미해결 'rest' 크래시(백로그 B4)** — 현재 브랜치에서 재현되는지 확인되지 않았습니다. R5 위험의 실체입니다.
7. **가격 티어 번호** — $4.99/$19.99에 해당하는 현행 티어는 ASC UI가 권위입니다.
