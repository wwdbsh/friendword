# RevenueCat Shipaton 2026 규칙 추적

> 확인 날짜: **2026-08-04** (최초 조사 2026-07-12, 직전 확인 2026-07-23)
> 상태: **Final Official Rules 공개됨 — 전면 대조 완료.** `/rules` 탭에 전문이 게시됐고(2026-08-01 개막, Updates 탭 공지), 아래 내용은 그 전문과 Overview·Resources·Discussions(매니저 답변)를 2026-08-04에 직접 읽고 정리한 것입니다. 이 문서가 이제 사전 조사 추정을 **대체**합니다.

## 공식 자료

- [Devpost Overview](https://revenuecat-shipaton-2026.devpost.com/)
- [Devpost Rules (전문)](https://revenuecat-shipaton-2026.devpost.com/rules)
- [Devpost Resources](https://revenuecat-shipaton-2026.devpost.com/resources)
- [Devpost Discussions](https://revenuecat-shipaton-2026.devpost.com/forum_topics) — 매니저(Charlie Chapman, Perttu Lähteenlahti, Jaewoong Eum, Rhys Kentish) 답변이 규칙 해석의 준공식 소스
- shipaton.com · discord.gg/X95EwqBxQT · 문의 shipaton@revenuecat.com

## 일정 (전부 PDT — 공식 룰 확정)

| 항목                | 기간                                              |
| ------------------- | ------------------------------------------------- |
| 등록                | 2026-05-15 08:00 ~ 2026-09-30 23:45               |
| **제출 기간**       | **2026-07-31 08:00 ~ 2026-09-30 23:45**           |
| 첫 공개 스토어 출시 | 제출 기간 내 (매니저 표현으로는 "Aug 1 or later") |
| #BuildInPublic 기간 | ~2026-08-01 08:30 ~ 2026-09-30 23:45              |
| 심사                | 2026-10-01 00:00 ~ 2026-10-13 12:00               |
| 수상 발표           | 2026-10-21                                        |

- 이전 문서의 "7/31 vs 8/1 상충"은 해소 — 공식 룰의 Submission Period가 7/31 08:00 시작. 어느 쪽이든 현재(8/4) 이후 출시에는 영향 없음.
- 룰 명시 권고: "App Review는 수일 이상 걸릴 수 있으니 **스토어에 일찍 제출**하라." 수동 release 유지 전제.
- 모든 날짜는 스폰서 재량으로 변경 가능.

## 자격 (확정)

- **제외국: Russia, Crimea, Cuba, Iran, North Korea + OFAC 제재국.** **대한민국 참가 가능 확정.** 2025 룰에 있던 Brazil·Quebec·Syria 제외는 2026 룰에 없음.
- 거주 관할 성년 개인, 팀, 조직(법인) 참가 가능. 개인이 복수 팀 + 개인 자격 동시 참가 가능.
- RevenueCat·스폰서 직원은 Conflict of Interest Award만 가능. 심사위원과 그 고용주는 불가.
- 수상 시 신원·역할 검증(affidavit) 전까지 수상 미확정. 한국 거주자는 W-8BEN 등 세무 서류 요구 가능, 세금·송금 수수료는 수상자 부담, 서류는 발송 후 10영업일 내 반송, 상금은 서류 수령 후 60일 내 지급. NY주법·AAA 개별 중재(클래스액션 포기).

## 프로젝트 요건 (공식 룰 전문 기준)

1. **RevenueCat SDK로 인앱 또는 웹 구매 최소 1개를 처리**하거나 RevenueCat Ads로 광고를 서빙하는 동작하는 앱.
2. 플랫폼: iOS, iPadOS, macOS 또는 Android.
3. **첫 공개 버전을 제출 기간 중** App Store, Google Play 또는 Samsung Galaxy Store에 출시. 프로젝트가 그 전에 존재했어도 되지만 **어떤 eligible 스토어에도 공개 출시 이력이 없어야** 함. 기존 앱 업데이트 불인정.
4. **미국에서 접근(다운로드) 가능해야 함** — App Store 미국 스토어프론트 포함 필수.
5. 영상·텍스트 설명에 묘사된 대로 설치·실행돼야 함.
6. 제3자 SDK/API/데이터는 해당 라이선스 조건에 따라 사용 권한이 있어야 함.
7. 스폰서·주최로부터 자금·계약·상업 라이선스를 받아 개발된 프로젝트 불가.

### 매니저 Q&A로 확정된 해석 (2026-08-04 Discussions 확인)

| 질문                                                   | 매니저 답변                                                                                              | Friendword 영향                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 기존 **web-only 프로토타입**이 있는 제품의 신규 iOS 앱 | **자격 있음** — "eligible as long as the only existing version was the website" (Charlie Chapman)        | **Vercel 웹 표면이 공개 상태여도 무해 확정.** 웹 운영·베타 스위치와 iOS 출시 자격이 분리됨 |
| 제출 기간 전 Google Play **open testing**              | **자격 있음** — 테스트 트랙은 공개 출시로 안 침. 첫 production 출시가 기간 내면 됨 (Perttu Lähteenlahti) | **TestFlight internal 운영 유지 가능 확정**                                                |
| 8/1 전 **pre-order 등록**                              | 가능. 실제 공개 출시일이 기간 내면 됨 (Jaewoong Eum)                                                     | 스토어 조기 제출 + 수동 release 전략과 부합                                                |
| **한 앱을 복수 카테고리에** 제출                       | **가능** (Rhys Kentish). 단 Influencer Award는 1개 카테고리만                                            | Grand Prize + HAMM + Design + #BuildInPublic 등 중복 지원 가능                             |

## 제출물 요건 (Devpost)

1. 기능·작동 방식 텍스트 설명.
2. **데모 영상 2분 미만** — 심사위원은 2분 이후를 볼 의무가 없음. 대상 기기에서 실제 작동하는 장면 포함. YouTube 또는 Vimeo에 **공개** 업로드. **제3자 상표·저작권 음악·자료는 허가 없이 금지.**
3. 공개된 스토어 URL.
4. 1024×1024 앱 아이콘.
5. **1179×2556, 기기 프레임 없는** 스크린샷 최소 1장.
6. **무료 체험 또는 심사위원용 프로모 코드** — 심사위원이 모든 유료 기능을 테스트할 수 있어야 함. 심사 종료(10/13)까지 스폰서·심사위원에게 무료 접근 유지 의무.
7. **모든 제출 자료는 영어** 또는 영어 번역 동봉.
8. 심사위원은 테스트 의무가 없고 **텍스트·이미지·영상만으로 심사할 수 있음** → 영상·설명 품질이 실질 심사 표면.

복수 제출 가능하나 각 제출물은 "unique and substantially different"해야 함(같은 앱을 여러 번 제출 불가 — 카테고리 중복 지원과는 별개).

제출 마감 후 제출물 수정 불가(침해물 제거 등 예외만 허용).

## 카테고리·상금 (공식 룰 상금표 기준)

총상금 표기: **$685,000+ 현금 / 총가치 $1M+** (이전의 3종 병존 표기 대체).

| 카테고리                                                                                                                          | 1위                                                                                              | 2위     | 3위     | 비고                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | ------- | ------------------------------------------------------------------ |
| **Grand Prize**                                                                                                                   | **$100,000** + NYC 왕복(1인, 유일하게 여비 포함) + Times Square 빌보드 + Shippy + 9to5Mac/Google | —       | —       | **2·3위 없음** (이전 문서의 $20k/$10k는 #BuildInPublic 오독이었음) |
| **#BuildInPublic**                                                                                                                | $30,000 + 여비 포함 NYC + 빌보드 등                                                              | $20,000 | $10,000 | 여비 포함은 Grand Prize와 이 카테고리 1위뿐                        |
| **Keep Them Coming Back (OneSignal)**                                                                                             | $25,000                                                                                          | $15,000 | $5,000  | 타 사이드 어워드보다 고액                                          |
| HAMM / Catvertising / Design / Peace Prize / Best Game / Next Gen                                                                 | $15,000                                                                                          | $10,000 | $5,000  | Next Gen은 학생 전용(스토어 출시 불요, 영상+오픈소스)              |
| Influencer 5종 (Productivity·Nutrition·Yoga&Fitness·Career·Gaming)                                                                | $15,000                                                                                          | $10,000 | $5,000  | 앱당 1개 카테고리만, 인플루언서 likeness 무단 사용 시 실격         |
| Ship Kotlin Everywhere (JetBrains) / Idea to Income (Replit) / Most Viral (Noise) / Growth Loop (Layers) / Funnel Vision (Stripe) | $15,000                                                                                          | $10,000 | $5,000  | 각자 스폰서 도구 연동이 자격 요건                                  |
| Best App for Galaxy (Samsung)                                                                                                     | Galaxy Store 3주 피처링(현금 없음)                                                               | —       | —       | Galaxy Store 출시 필요                                             |
| Conflict of Interest                                                                                                              | 빌보드+블로그(현금 없음)                                                                         | —       | —       | RC·스폰서 직원 전용                                                |

1위 공통 부상(여비 제외): App Growth Annual 초청(입장만, 여비 자비), Times Square 빌보드, Shippy 트로피, 블로그·미디어 노출.

### Grand Prize 선정 메커니즘 (신규 공개 — 전략상 가장 중요)

> "The Sponsor will compare the **total revenue generated by eligible Projects during the Submission Period, as reported in RevenueCat**, to create a shortlist. … The Project with the highest total revenue does not automatically win."

- **1차 관문이 RevenueCat 계측 매출 절대액**(제출 기간 내 = 9/30까지). shortlist에 못 들면 심사 자체를 못 받음.
- 심사 기준: ① Early and Effective Release(언제·왜 그 시점에 출시했고 초기 빌드로 무엇을 검증했나) ② Growth by numbers(출시 후 개선·마케팅 실험을 설치·전환·리텐션·MRR 등 구체 수치와 연결).
- 동점 시 첫 기준부터 순차 비교.

### 카테고리별 추가 제출 요건 (우리가 낼 가능성 있는 것)

- **Grand Prize**: 출시 후 성장 활동 서술 + 다운로드/매출 등 수치.
- **#BuildInPublic**: 공개 빌드 과정을 담은 소셜 링크들 + 공개 빌드가 앱에 준 이득 서술. **포스트에 #Shipaton 태그 필수**(#BuildInPublic 태그는 선택). 심사: 이야기 공유의 창의성(**팔로워 수 무관 명시**) · 반응과 그로 인한 앱 개선 · 교훈.
- **HAMM**: 수익화 전략·페이월·가격 설계와 전환/매출 수치 서술.
- **Design**: 어디를 보면 되는지 지목하는 디자인·애니메이션 서술.
- **Peace Prize**: 개인·커뮤니티·사회 이득 설계 서술.
- **OneSignal**: OneSignal 연동 + API/MCP/대시보드로 **캠페인 최소 1개 배포** + App ID 제출. 메시지 1개면 자격은 되나 깊이 있는 활용이 유리.
- (참고) Stripe Funnel Vision: RevenueCat Funnels + Stripe 체크아웃 웹 퍼널 필요 — 현 스택(Supabase+RevenueCat IAP)과 별개 작업.

## IP·권리

- 제출물 소유권은 참가자 유지. 스폰서는 심사용 비독점 라이선스 + **3년간 홍보 목적으로 제출물·참가자 이름·likeness·voice·이미지 사용권**.
- 제출물은 원저작·단독 소유여야 하며 제3자 IP·프라이버시·퍼블리시티 권리 침해 금지 — **데모 영상과 앱 내 실인물(목소리 포함) 콘텐츠는 동의 확보가 참가자 책임.**
- 오픈소스 사용 가능(라이선스 준수 + 그 위에 실질 기능 추가 조건).

## Ship Kit (참가 혜택 — 상금 아님)

Devpost 등록 + **이메일로 오는 participant form 작성**이 전제. 5개 마일스톤(등록 → RC 프로젝트 생성 → 첫 테스트 구매 → 첫 Store API 호출 → 첫 실구매)마다 스폰서 퍽 최대 25종 해금. 소통은 Discord 또는 shipkit@revenuecat.com만.

## Friendword 실행 영향 (2026-08-04 대조 결론)

1. **자격 리스크 소거**: 한국 참가 가능, 웹 선공개 무해, TestFlight internal 무해 — 전부 공식/매니저 확인. 남은 자격 조건은 "첫 공개 스토어 출시가 9/30 23:45 PDT 이전"뿐.
2. **Grand Prize를 노린다면 RevenueCat 매출 창이 곧 shortlist 관문** — `real_payments_enabled`를 켜는 시점(사용자 결정, CLAUDE.md §16)이 늦을수록 집계 매출 창이 줄어듦. 매출은 9/30까지만 집계됨.
3. **심사위원 테스트 접근 의무**: 유료 기능(`creator_launch_credit_499`·`campaign_pass_30d_1999`, 둘 다 Consumable)에 대해 무료 체험 또는 프로모 코드를 10/13까지 제공해야 함. 런치 게이트가 심사위원의 핵심 루프 체험을 막지 않는지 제출 전 점검 필요.
4. **미국 접근성**: App Store 미국 스토어프론트 포함 + 제출 자료 영어(또는 번역). 앱 표면 영어 지원 상태 점검 필요.
5. **데모 영상 규정**: 2분 미만, 제3자 상표·저작권 음악 금지 — Introducer 원본 음성·실인물 사진은 동의·권리 보증 대상(§9와 정합). TTS 데모 금지는 자체 규칙으로 유지.
6. **#BuildInPublic은 지금부터 태그 적재**: #Shipaton 태그 포스트 링크가 제출물 요건. 팔로워 수 무관이 명시돼 있어 신규 계정 불리 없음.
7. **한 앱으로 복수 카테고리 제출 가능** — Grand Prize + HAMM + Design + Peace Prize + #BuildInPublic 중복 지원이 규칙상 허용. 카테고리별 추가 서술만 준비하면 됨. OneSignal($25k)은 연동+캠페인 1개가 추가 요건.
8. **2025 선례 수치**(Payout $30k 매출 등)는 전략 참고로만 유지 — 2026 규칙 아님.

## 재확인 게이트

각 게이트에서 Rules·Overview·Updates·Discussions를 확인하고 이 문서에 절대 날짜와 변경점 또는 "변경 없음"을 기록합니다.

- [x] 개발 시작일 — 2026-07-23 확인
- [x] **Final Official Rules 공개 직후 — 2026-08-04 전면 대조 완료 (이 문서)**
- [ ] App Store 심사 제출 전
- [ ] 공개 출시 직전
- [ ] Devpost 제출 7일 전
- [ ] Devpost 최종 제출 직전

## 변경 기록

| 확인 날짜      | 게이트               | 상태·변경점                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 영향                                                                                                                                                                                                                              |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-12     | 초기 조사            | Final Official Rules pending. Overview 내 상금 표기 불일치 확인.                                                                                                                                                                                                                                                                                                                                                                                                                                               | 상금 확정 표기 금지, 대한민국 참가 가능 여부와 최종 제출 요건 재확인 필요.                                                                                                                                                        |
| 2026-07-23     | 개발 시작일          | Official Rules 여전히 pending. Grand Prize $50k/$100k 불일치 해소(전부 $100k), 카테고리·금액 구조 공개, 제출 오픈 7/31 08:00 PDT(Overview "8/1"과 상충), 수상 발표 10/21.                                                                                                                                                                                                                                                                                                                                      | 카테고리 금액 인용 가능(재대조 전제). 한국 참가 가능성 높음(TBD 유지). Pre-8/1 TestFlight 허용 여부 미명시 — internal-only 유지.                                                                                                  |
| **2026-08-04** | **Final Rules 공개** | **전문 공개·전면 대조.** 제외국에 한국 없음(참가 확정). 제출 기간 7/31 08:00~9/30 23:45 PDT로 상충 해소. Grand Prize는 1위 $100k 단독(기존 문서의 2·3위는 #BuildInPublic $30k/$20k/$10k의 오독). OneSignal $25k. **Grand Prize shortlist가 RevenueCat 계측 제출-기간-내 총매출**로 결정됨을 신규 확인. 매니저 답변 4건: 웹 선공개 OK, open testing OK, pre-order OK, 복수 카테고리 OK. 심사위원용 무료 체험/프로모 코드·미국 접근성·영어 자료·#Shipaton 태그 요건 확정. Ship Kit은 participant form 작성 필요. | 자격 불확실성 전부 소거. 남은 마감 리스크는 "9/30 이전 첫 공개 출시"와 App Review 소요뿐. `real_payments_enabled` 시점이 Grand Prize 매출 창과 직결(사용자 결정 항목에 반영). 심사위원 프로모 코드 준비를 제출 체크리스트에 추가. |
