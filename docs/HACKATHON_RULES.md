# RevenueCat Shipaton 2026 규칙 추적

> 확인 날짜: **2026-07-23** (최초 조사 2026-07-12)  
> 상태: **Final Official Rules pending** — `/rules` 탭은 여전히 "The Official Rules for the Hackathon are not yet available. They will be posted prior to the start of the Hackathon." 플레이스홀더

## 공식 자료

- [Devpost Overview](https://revenuecat-shipaton-2026.devpost.com/)
- [Devpost Rules](https://revenuecat-shipaton-2026.devpost.com/rules)
- [RevenueCat 공식 발표](https://www.revenuecat.com/blog/company/announcing-shipaton-2026/)

2026-07-23 재확인 기준으로도 최종 Official Rules는 미공개이며 Updates 탭도 비어 있습니다. 아래 내용은 공개된 Overview·Prizes·`/details/dates`와 RevenueCat 공식 발표를 기준으로 하며, 최종 규칙 공개 직후 다시 대조해야 합니다. 자격 제외국 정식 목록, 심사 가중치, IP/소유권 조항은 최종 규칙 전까지 미확정입니다.

## 일정

| 항목                 | 일정                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| 등록                 | 진행 중 (2026-07-23 기준 참가자 6,469명, 별도 등록 마감일 미표기)                |
| 제출                 | 2026-07-31 08:00 PDT 오픈 (Devpost `/details/dates`) ~ 2026-09-30 23:45 PDT 마감 |
| 신규 앱 첫 공개 출시 | 2026-08-01 ~ 2026-09-30 사이                                                     |
| 수상 발표            | 2026-10-21 09:00 PDT                                                             |

주의: Devpost `/details/dates`는 제출 오픈을 **7/31 8:00am PDT**로, Overview 본문은 "submissions open on August 1st"로 서술해 상충합니다. 앱 릴리스 윈도우(8/1~9/30)는 별개로 일관됩니다.

2026-08-01 전 개발, 비공개 테스트와 홍보는 가능하지만 첫 공개 release는 허용된 출시 기간 전에 하면 안 됩니다. App Review에는 일찍 제출하되 수동 release를 사용합니다.

## 현재 확인된 필수 요건

1. iOS, iPadOS, macOS 또는 Android에서 동작하는 새로운 앱이어야 합니다.
2. 첫 공개 버전을 기간 중 App Store, Google Play 또는 Samsung Galaxy Store에 출시해야 합니다.
3. 이전 출시 앱의 업데이트는 인정되지 않습니다.
4. RevenueCat SDK로 최소 하나의 인앱/웹 구매를 처리하거나 RevenueCat Ads를 사용해야 합니다.
5. 현재 Devpost 제출물은 다음과 같습니다.
   - 기능과 작동 방식의 텍스트 설명
   - 실제 기기에서 작동하는 앱을 보여주는 2분 이내 공개 YouTube/Vimeo 영상
   - 공개된 스토어 URL
   - 1024×1024 앱 아이콘
   - 기기 프레임이 없는 1179×2556 이상 스크린샷 최소 1장
   - 심사위원이 유료 기능을 확인할 무료 체험 또는 프로모션 코드
6. 참가자는 거주 국가의 성년이어야 하고 일부 국가·지역은 제외될 수 있습니다. 대한민국 참가 가능 여부는 최종 규칙에서 재확인합니다. 참고(2026-07-23): 2025 공식 룰의 제외국은 "Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, Syria + OFAC 제재국"으로 **대한민국은 미포함** — 2026도 가능성 높으나 최종 룰 공개 전까지 TBD로 취급합니다.
7. 2026-08-01 이전 비공개 TestFlight/internal testing 허용 여부는 공개 페이지에 명시가 없습니다("You can brainstorm, build, and post before August 1st"만 확인). 현행 internal-only 운영을 유지하고 최종 룰에서 재확인합니다.

## Grand Prize 방향과 증거

현재 Grand Prize 설명은 대회 기간에 강한 사용자 traction과 growth momentum을 만든 앱을 찾는다고 밝힙니다. 따라서 기능 수나 데모 완성도만이 아니라 출시 후 성장 행동과 실제 퍼널 데이터가 필요합니다.

Friendword는 다음 연결을 재현 가능한 데이터로 증명해야 합니다.

```text
published campaigns → unique viewers → verified interests
→ accepted intro rooms → new campaigns → paid products
```

[2025년 공식 우승 사례](https://www.revenuecat.com/blog/company/shipaton-2025-winners/)는 Payout의 17,000명 이상 사용자, $30,017 매출, 1,750명 유료 사용자와 500,000회 이상 소셜 노출, Gurwi의 13,000명 이상 사용자와 1,000개 이상 스토어 리뷰, ReadHim의 Instagram 520만 회 이상 조회와 출시 열흘 내 $1,100 MRR, Shutter Declutter의 1,000명 이상 유료 구독자를 보고했습니다. 이는 2026 규칙이 아니라 측정 가능한 성장 증거가 중요하다는 전략 참고 자료입니다.

## 현재 공개된 평가 영역

2026-07-23 기준 공개된 카테고리와 표기 금액(Final Official Rules 공개 후 재확인 필요):

- **Grand Prize (Build & Grow)**: 1위 $100,000 / 2위 $20,000 / 3위 $10,000 (현금). 기준: "the app that gains the most user traction and growth momentum during the event" — 릴리스 이후 성장 노력 서술 제출. 측정 방식(자동 지표 vs 심사, 데이터 윈도우)은 미명시.
- **사이드 어워드 8개** (각 1위 $15,000 / 2위 $10,000 / 3위 $5,000): #BuildInPublic, HAMM("Smartest use of RevenueCat to drive real revenue"), Catvertising(RevenueCat Ads), RevenueCat Design, Peace Prize(사회적 선), Best Game, Next Gen(학생 전용 — video+오픈소스 코드로 심사), 스폰서 카테고리.
- **스폰서**: Replit, OneSignal, JetBrains, Layers, Noise, Stripe, Samsung 등. **비현금 부상**: NYC 트립+App Growth Annual, Times Square 빌보드, Shippy 트로피, 9to5Mac/9to5Google 노출. **Shipaton Growth Fund**(투자자 노출) 신설.
- 공개된 심사위원: Charlie Chapman, David Barnard (RevenueCat). 심사 가중치 미공개.

전략적으로는 가능한 한 이른 유효 기간 내 출시로 성장 측정 기간을 확보하고, 개발과 `#BuildInPublic`을 병행하며, RevenueCat 구매 구조를 초기 아키텍처와 실제 검증 경로에 포함합니다. 카테고리별 제출 판단은 최종 심사 기준이 공개된 뒤 확정합니다.

## 상금·규칙 불일치 경고

**2026-07-23 재확인: $50,000 vs $100,000 불일치는 해소** — Overview·Prizes·Judges 전 섹션이 Grand Prize 1위를 $100,000으로 일관 표기하며 $50,000 표기는 페이지에서 사라졌습니다. 단, **총상금 표기는 여전히 3종 병존**($490,000+ / over $700,000 in cash / over $1 million worth in total)하고 페이지가 상호 관계를 명시하지 않으므로, 총액은 확정 수치로 사용하지 않습니다. 개별 카테고리 금액은 위 표기를 인용하되 Final Official Rules 공개 시 재대조합니다.

기존 `docs/shipaton-2026.md`에 있던 총 상금, Grand Prize 액수, 카테고리별 금액과 부상 표기는 이 불일치 때문에 확정 정보로 승계하지 않았습니다. 또한 해당 문서의 “2025년 규칙과 유사할 것”이라는 참가 국가·팀·다중 제출 가정과 ShipKit·Discord 제공 가정은 2026 최종 규칙이 아니므로 의사결정 근거로 사용하지 않습니다.

## 제품·출시 체크

- RevenueCat sandbox와 production 구매 경로를 실제로 검증합니다.
- 2분 영상에서 Introducer draft → Dater 승인 → public pitch → verified interest → Intro Room의 핵심 루프를 보여줍니다.
- friend-backed profile이 아니라 share-first consented voice campaign이라는 차별화를 메타데이터와 데모에 드러냅니다.
- 안전, 동의, 신고를 데모 후순위로 미루지 않습니다.
- 늦은 완성보다 빠른 1.0 출시와 출시 후 성장 iteration을 우선합니다.

## 재확인 게이트

각 게이트에서 Rules·Overview·Resources를 확인하고 이 문서에 절대 날짜와 변경점 또는 “변경 없음”을 기록합니다.

- [x] 개발 시작일 — 2026-07-23 확인 (본격 감사 대응 착수 직전 재확인으로 수행)
- [ ] App Store 심사 제출 전
- [ ] 공개 출시 직전
- [ ] Devpost 제출 7일 전
- [ ] Devpost 최종 제출 직전

## 변경 기록

| 확인 날짜  | 게이트    | 상태·변경점                                                      | 영향                                                                       |
| ---------- | --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-07-12 | 초기 조사 | Final Official Rules pending. Overview 내 상금 표기 불일치 확인. | 상금 확정 표기 금지, 대한민국 참가 가능 여부와 최종 제출 요건 재확인 필요. |
| 2026-07-23 | 개발 시작일 | Official Rules 여전히 pending, Updates 탭 비어 있음. Grand Prize $50k/$100k 불일치 해소(전부 $100k), 카테고리·금액 구조 공개(사이드 8개 각 $15k/$10k/$5k), 제출 오픈 7/31 08:00 PDT(Overview 본문 "8/1"과 상충), 수상 발표 10/21 09:00 PDT. 2025 룰 선례상 대한민국 제외국 아님. 총상금 3종 표기 병존. | 카테고리 금액 인용 가능(재대조 전제). 한국 참가 가능성 높음(TBD 유지). Pre-8/1 TestFlight 허용 여부는 여전히 미명시 — internal-only 유지. 다음 게이트: App Store 심사 제출 전. |
