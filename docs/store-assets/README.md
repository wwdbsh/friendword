# 스토어 자산 (App Store + Devpost)

> 이 디렉터리는 **실기기에서 촬영한 원본 스크린샷**만 담습니다. 합성 이미지, 목업, 생성 이미지는 넣지 않습니다 — Shipaton 룰은 "영상·텍스트 설명에 묘사된 대로 설치·실행돼야 함"을 요구하고, Apple은 실제 앱과 다른 스크린샷을 거부합니다.
>
> 사용처와 메타데이터 전체는 [`docs/APP_STORE_SUBMISSION.md`](../APP_STORE_SUBMISSION.md) §9.

## 디렉터리

```
docs/store-assets/
  README.md          ← 이 파일
  6.9/               ← 6.9" 세트(iPhone 17 Pro Max 급). 현재 비어 있음
```

`6.9/` 한 세트만 채우면 App Store Connect가 나머지 크기를 스케일합니다.

## 촬영 규칙

1. **실기기, TestFlight 빌드.** 시뮬레이터 스크린샷은 상태바·폰트 렌더가 실기기와 달라 쓰지 않습니다.
2. **해상도**: 6.9" 세트는 **1320×2868**(세로). Devpost 제출물 요건 5번은 별도로 **1179×2556, 기기 프레임 없는** 스크린샷 최소 1장을 요구하므로, 프레임을 씌우기 전 **원본을 반드시 보관**합니다.
3. **기기 프레임·목업 프레임을 씌우지 않습니다.** Devpost가 "기기 프레임 없는"을 명시했고, App Store도 원본을 허용합니다.
4. **상태바**: 시간·배터리·신호가 보이는 그대로 둡니다. 위조하지 않습니다.
5. **개인정보 금지 (CLAUDE.md 보안 규칙)**: 실제 이메일 주소, 전화번호, 법적 이름, 신분증, 실인물 사진, 메시지 전문, token, 캠페인 slug가 프레임에 들어가면 안 됩니다.
   - 특히 **Track 2(친구 상세)** 화면은 이름과 초대 접점을 입력받으므로 **스크린샷 대상이 아닙니다.**
   - 사진 화면(`03-photos.png`)에는 소유자 본인 또는 동의를 받은 사람의 사진만 씁니다. Shipaton 룰 §IP는 실인물 콘텐츠의 동의 확보를 참가자 책임으로 둡니다.
6. **데이터는 QA 별칭 계정으로 만든 합성 캠페인**을 씁니다(`docs/DEVICE_QA.md`). 실사용자 캠페인은 촬영하지 않습니다.
7. **다크/라이트**: 앱은 `userInterfaceStyle: 'light'` 고정이므로 라이트 한 벌만 찍습니다.

## 캡션 규칙

- 스크린샷 위에 텍스트를 합성하지 않습니다 — 캡션은 App Store Connect의 스크린샷별 입력란이 아니라 **설명문과 프로모션 텍스트가 담당**합니다. 아래 캡션은 **어떤 화면을 왜 찍는지에 대한 촬영 지시**이며, 이미지에 굽지 않습니다.
- 캡션 문구는 영어이고 `docs/APP_STORE_SUBMISSION.md` §2.4 설명문과 같은 표현 경계를 지킵니다 — "safe", "verified people", "background checked", 안전 보증 표현 금지(`docs/THREAT_MODEL.md`).

## 기대 파일 목록

| 파일                            | 화면 (라우트)                  | 무엇이 보여야 하는가                                                           |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `6.9/01-home.png`               | `apps/mobile/app/index.tsx`    | 홈. 헤더에 백 라벨 누출 없음                                                   |
| `6.9/02-relationship.png`       | `pitch/new.tsx` Track 1        | 관계 종류·기간 선택                                                            |
| `6.9/03-photos.png`             | `pitch/new.tsx` Track 3        | 제안 사진 1~4장이 실제로 붙은 상태                                             |
| `6.9/04-record.png`             | `pitch/new.tsx` Track 4        | 녹음 중 타이머(30~60초 구간)                                                   |
| `6.9/05-review.png`             | `pitch/new.tsx` Track 5        | 리뷰 + AI 처리 동의 문구가 함께 보이는 프레임                                  |
| `6.9/06-share.png`              | `pitch/share.tsx`              | 승인 초대 링크 공유 상태 (**토큰이 판독 가능하게 보이면 안 됨**)               |
| `6.9/07-campaigns.png`          | `campaigns/index.tsx`          | 캠페인 목록                                                                    |
| `6.9/08-account.png`            | `account/index.tsx`            | Sign out 카드와 Delete your account 카드가 한 화면에                           |
| `6.9/iap-01-creator-launch.png` | `paywall.tsx` (Creator Launch) | **$4.99 가격 문자열이 실제로 표시된 상태** — IAP 심사 첨부용, 스토어 노출 아님 |
| `6.9/iap-02-campaign-pass.png`  | `paywall.tsx` (Campaign Pass)  | **$19.99 가격 문자열이 실제로 표시된 상태** — IAP 심사 첨부용                  |

IAP 스크린샷 2장은 RevenueCat 키가 빌드에 구워지고 ASC 상품이 준비된 뒤에만 찍을 수 있습니다. paywall이 "Purchases aren't live yet"을 보여주면 키가 없는 것입니다(`docs/APP_STORE_SUBMISSION.md` §7).

## 아이콘

App Store 1024×1024 아이콘은 `apps/mobile/assets/icon.png`가 그대로 쓰입니다(실측 1024×1024). Devpost 제출물 요건 4번도 같은 파일을 씁니다 — 여기에 사본을 두지 않습니다.

## 2026-09-08 촬영 상태

시뮬레이터(iPhone 17 Pro Max, iOS 26.5, 1320×2868 원본)에서 6장 확보: `01-home`, `02-relationship`, `03-photos`, `04-record`, `07-campaigns`, `08-account`. 합성 데이터(QA 별칭 계정·합성 사진)만 포함. 미촬영: `05-review`, `06-share`(실제 음성 초안이 필요 — 시뮬레이터 마이크는 무음), 그 외 README 상단 목록의 나머지. 실기기 또는 실제 음성으로 만든 초안에서 보충한다.
