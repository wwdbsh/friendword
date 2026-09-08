# Friendword 운영 플레이북 — "월요일 아침에 뭘 하나" (2026-09-09)

> `GROWTH_PLAYBOOK_2026-09.md`가 "왜·무엇"이라면 이 문서는 "어디서·얼마·누가·언제·어떤 순서로"다. 모든 금액은 USD, 벤치마크는 출처를 달았고 우리 수치는 전부 `[가설]`이다. 결정이 필요한 곳은 `[결정]`.

---

## 1. 예산 — 얼마를, 어디에

### 1.1 전제(사실)

- 고정비 ≈ $55/월, 캠페인당 변동비 ≈ $0.25, **월 클라우드·API 상한 $200**(COST_MODEL). 이 상한은 *인프라*이고 마케팅비는 별도 항목이다 — **마케팅 예산 자체가 아직 정해지지 않았다** `[결정]`.
- 무료 자원: Noise $1,000 매칭 크레딧(Ship Kit), Apple Search Ads 신규 계정 $100 크레딧(2026 가이드 기준), OneSignal 3개월(미사용), Layers 2개월, AppTweak·AppFollow 할인, Linearity 50%.
- 규칙: 유기적 CAC·기여 마진이 검증되기 전 유료 획득 금지(PRODUCT/GROWTH_EVIDENCE). → **유료는 "실험 예산"으로만, 매출 전환 검증 후 확대.**

### 1.2 세 가지 티어 `[결정]`

| 티어                   | 월 마케팅비 | 구성                                                                                                          | 언제 고르나                                                     |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **A. 제로(권장 출발)** | $0~$50      | Noise 크레딧 $1,000 + ASA 크레딧 $100 + Manychat 무료 + 자체 릴스                                             | 9/9~스토어 승인. 릴스 P0 수정 전에는 어떤 유료도 낭비           |
| **B. 실험**            | $300~$500   | TikTok Promote($3~10/일, 최상위 릴스 부스트) + ASA 롱테일 $5/일 + 마이크로 크리에이터 1~2명($200~$500/편)     | 스토어 승인 + 릴스 P0 반영 후, src별 전환율이 첫 실측치를 낸 뒤 |
| **C. 스케일**          | $1,000+     | TikTok Ads Manager Spark Ads($20/일 ad group, $50/일 캠페인) + Meta AAA($5/일부터, 앱 설치 10 이벤트/주 학습) | 페이지 방문→관심 ≥3%가 2주 연속 확인될 때만                     |

**해커톤 창(9/30까지) 권장: A → 승인 후 B의 절반($150~250).** 근거: TikTok Ads Manager는 ad group당 $20/일이 최소인데 학습에는 그 이상이 필요하고([Stackmatix](https://www.stackmatix.com/blog/tiktok-ads-minimum-daily-budget-2026)), 첫 달 테스트 예산으로 $700~1,000을 권하는 시장에서 우리 창은 2주뿐이다. 돈보다 **크리에이티브(릴스)와 크리에이터(Noise)** 가 병목이다.

### 1.3 채널별 단가 벤치마크(2026, 출처)

- TikTok 중앙값 CPM ≈ $4.08, CPC ≈ $0.50, 모바일 게임 CPI ≈ $3.20; Meta CPM ≈ $15, CPC ≈ $1.72 ([Influee](https://influee.co/blog/tiktok-ads-benchmarks), [Trendtrack](https://www.trendtrack.io/blog-post/tiktok-vs-meta-cpm)). 데이팅 카테고리 전용 CPI는 공개 벤치가 없어 **첫 실측이 우리 숫자다**.
- Apple Search Ads: 데이팅은 경쟁 카테고리, 헤드 키워드 CPT $5~20+, 롱테일은 $0.25~2.5 ([AppTweak](https://www.apptweak.com/en/aso-blog/apple-ads-benchmarks), [Sonar](https://trysonar.app/blog/apple-search-ads-guide)).
- 마이크로 인플루언서(1만~~10만): 인피드 영상 $200~1,500, 라이프스타일 5만·참여율 3%면 $300~~500, Spark Ads 권리는 +20~50% ([IMH](https://influencermarketinghub.com/influencer-rates/micro-influencer-rates/), [Showcase](https://www.showca.se/post/tiktok-influencer-rates)).
- Noise: 조회당 지급(CPM은 우리가 설정, 계약·선불 없음) ([getnoise](https://getnoise.com/)).

---

## 2. 계정·도구 셋업 체크리스트 (9/9, 소유자 2시간)

| #   | 할 일                                                        | 정확히                                                                                                                                                                                                                                                                                                                                                            | 비용     |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | TikTok **Business 계정** @friendword (US 리전)               | 프로필 링크 = `friendword.com/?src=tiktok-bio`, 바이오 "Your friend says it better. Comment FRIEND for the link"                                                                                                                                                                                                                                                  | 0        |
| 2   | Instagram @friendword(프로페셔널), Threads 연동              | 링크 스티커 사용 가능                                                                                                                                                                                                                                                                                                                                             | 0        |
| 3   | **Manychat** — TikTok DM 자동응답                            | TikTok은 댓글→DM 트리거가 미국에서 아직 제한적이라 **"DM me FRIEND"** 키워드 트리거로 설정(무료: 1,000 컨택·키워드 3개). Instagram은 댓글→DM 가능. 응답문: 페이지 링크 + "Watch, no signup." ([Manychat 커뮤니티](https://community.manychat.com/general-q-a-43/tiktok-auto-dm-from-comments-6480), [instantdm](https://instantdm.com/blog/tiktok-comment-to-dm)) | 0~$15/월 |
| 4   | **Noise** 브랜드 계정 + Ship Kit 크레딧 청구                 | 브리프 2개 등록(F2·F4, §5)                                                                                                                                                                                                                                                                                                                                        | 크레딧   |
| 5   | **Apple Search Ads** 계정 + $100 크레딧, Basic 말고 Advanced | 키워드 §6                                                                                                                                                                                                                                                                                                                                                         | 크레딧   |
| 6   | **Layers** 계정(Growth Loop 상 자격)                         | SDK 설치 필요 → 개발 30분 `[결정]`                                                                                                                                                                                                                                                                                                                                | 0        |
| 7   | Shipaton **Discord** 가입, #BuildInPublic 채널               | 첫 글: 밤샘 QA 서사                                                                                                                                                                                                                                                                                                                                               | 0        |
| 8   | X(트위터) @friendword_app, LinkedIn 개인                     | #BuildInPublic 일일 포스트                                                                                                                                                                                                                                                                                                                                        | 0        |
| 9   | **Ship Kit participant form** 제출                           | 퍽 해제                                                                                                                                                                                                                                                                                                                                                           | 0        |
| 10  | CapCut(무료) + 자막 프리셋, Linearity 50%                    | 릴스 편집                                                                                                                                                                                                                                                                                                                                                         | 0~       |
| 11  | 링크 규칙 시트                                               | `?src=` 값 표: tiktok-f1..f5, ig-f1.., owner-story, noise-<id>, discord, reddit, asa                                                                                                                                                                                                                                                                              | 0        |

---

## 3. 콘텐츠 운영 — 무엇을 언제 올리나

### 3.1 빈도(출처 있는 기준)

- 신규 계정(0~~1k 팔로워)은 **하루 1~~2개**, 최소 주 2~5개 꾸준히; 들쭉날쭉이 가장 나쁨 ([JoinBrands](https://joinbrands.com/blog/how-often-to-post-on-tiktok/), [Flowshorts](https://flowshorts.app/blog/how-often-to-post-on-tiktok)).
- **우리 캘린더**: 9/11~9/30 매일 1개(틱톡) + 같은 영상을 릴스에 재게시 + 주 3회 X/Threads 빌드인퍼블릭. 총 틱톡 20개.

### 3.2 주간 편성표 (반복)

| 요일 | 포맷                         | 소재                                                                                                                                                                         | CTA                  |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 월   | F2 drop-your-info 업그레이드 | 실제 페이지(승인된 것)                                                                                                                                                       | DM me FRIEND         |
| 화   | F5 빌드인퍼블릭              | 지난주 수치·배운 것                                                                                                                                                          | Devpost 링크(바이오) |
| 수   | F1 리액션                    | Dater가 친구 음성을 처음 듣는 장면(동의 필수)                                                                                                                                | 페이지 링크          |
| 목   | F3 AI vs 친구(방식 투표)     | 같은 사람: 프로필 문장 vs 친구 음성                                                                                                                                          | 댓글 투표(사람 아님) |
| 금   | F4 #SayItForThem             | 크리에이터/시드 소개자                                                                                                                                                       | 듀엣                 |
| 토   | 하이라이트 재편집            | 가장 잘 된 릴스의 다른 훅 버전                                                                                                                                               | 동일                 |
| 일   | 캐러셀(사진 6~9장)           | "이번 주 소개된 사람들"(승인·이름 없이 페이지 카드) — 캐러셀은 평균 도달 +3%, 참여 +81% 보고 ([StackInfluence](https://stackinfluence.com/blog/tiktoks-photo-post-comeback)) | 링크                 |

### 3.3 제작 규격(고정)

- 1080×1920, 첫 2초에 **결과/제품**(이름 + "introduced by"), 단어 단위 자막(흰/검 외곽선 또는 머스터드), 세이프존 상 130 / 하 484 / 우 140 / 좌 44px, 15~30초, 상업 라이브러리 음원.
- 얼굴·이름은 승인한 Dater만. 데모 인물(Blair/Maya)은 "Demo" 라벨.
- 캡션 3줄: 훅 1줄 / 한 줄 설명 / "DM me FRIEND for her page" + 해시태그 4개(#matchmaking #singlefriend #datingapps #setmeup) — 해시태그는 검색용, 도달용 아님.

### 3.4 새 지렛대: 틱톡 60초 음성 댓글(2026-09-03 출시, 한 달 내 글로벌)

"댓글에 음성 남기기"가 곧 틱톡 기본 기능이 된다([TechCrunch](https://techcrunch.com/2026/09/03/tiktok-comments-are-getting-more-interactive-with-voice-comments-polls-and-more/)). 포맷 F6 `[가설]`: **"댓글에 친구를 음성으로 소개해 봐 — 우리는 그걸 페이지로 만들어 줄게."** 크리에이터 영상 밑에 음성 댓글이 쌓이면 그 자체가 Introducer 파이프라인이다. 롤아웃 시점에 맞춰 9/20 전후 테스트.

---

## 4. DM·댓글 운영 스크립트

- **DM 응답(자동)**: "Here's [name]'s page — no signup to watch: {link}?src=tiktok-dm. If it lands, tap I'm interested (2 photos + a bio, that's it)."
- **댓글 응답(수동, 30분/일)**: 질문 유형별 3종 — "가입 없이 봐요?" / "친구 대신 올리려면?" / "안전해요?"(→ "승인 전 비공개·신고·차단·AI 고지"만 말함, 보장 표현 금지).
- **금지**: 사람 평가·외모 언급, 매칭 성공률, "safe/verified".

---

## 5. 크리에이터 프로그램(Noise + 직접 섭외)

- **Noise 브리프 A(F4 #SayItForThem)**: "Pick one single friend. 60 seconds on why they're a catch. Show your face, say their first name only, end with 'DM me FRIEND' → we send the page." 지급: CPM 설정 `[결정, 권장 $8~12/1k뷰]`, 월 상한 = 크레딧 $1,000.
- **Noise 브리프 B(F2)**: 기존 "drop your info" 영상 패러디 → "now she controls the inbox".
- **직접 섭외 3명(5만 이하, 데이팅·우정·대학 생활 니치)**: 편당 $200~~300, Spark Ads 권리 포함 협상(+20~~50%). 조건: 본인 친구를 실제로 Friendword로 소개(진정성), 결과 페이지 링크.
- **크리에이터 동의 문서 1장**: 얼굴·이름은 본인과 승인한 친구만, 우리 가이드라인 링크, 보장 표현 금지.

---

## 6. ASO·스토어

- **제목/부제**: "Friendword — Dating, in your friends' words" / 키워드 100자: `matchmaker,wingman,set up,friend,introduce,single,voice,date,intro,blind date,dating app,hype`.
- **롱테일 타깃(낮은 경쟁·높은 의도)**: "matchmaker app", "set up my friend", "wingman dating", "blind date app", "voice dating" — 헤드 키워드("dating app")는 CPT $5~20이라 제외 ([DMA](https://www.digitalmarketingagency.sg/blog/dating-keywords), [ASOMobile](https://asomobile.net/en/blog/best-aso-strategies-for-dating-apps/)).
- **ASA 설정**: 캠페인 1개 · 정확 일치 키워드 8개 · CPT 상한 $1.5 · 일 $5 · 크레딧 소진 후 중단하고 전환율 판단.
- **Featuring nomination**: 승인 직후 ASC → Featuring → Nominations, "App Launch", 스토리: 친구 목소리·승인·무가입. 최소 2주 전 제출 원칙이라 **9/15 제출 → 10월 노출** 기대.
- **리뷰 요청**: 첫 매칭(룸 생성) 후 이메일 1통: "honest feedback helps other people discover the app" 톤(RevenueCat 조언).

---

## 7. 커뮤니티·PR·이메일

- **Shipaton Discord**: 주 2회 — 진행 로그 + "당신의 싱글 친구 소개해 주면 우리가 페이지를 만들어요"(빌더들이 첫 소개자 풀).
- **Reddit**: r/dating_advice, r/GenZ, r/datingoverthirty — **홍보 금지**, F3 논쟁("친구가 쓴 소개 vs 본인 프로필") 경험담 1편 + 댓글에서만 링크 요청 시 답변. 서브레딧 규칙 확인 필수.
- **PR**: 데이팅 피로 기사 쓰는 기자 5명 리스트(Mashable·TechCrunch·The Verge·Bustle·Refinery29의 dating 태그) → 한 문단 피치: "TikTok's 'set up my friend' videos, productized with consent." 자료: 데모 영상 30초·스크린샷·창업자 인용. `[Claude가 리스트·피치 초안 작성]`
- **이메일**: waitlist 1행 → 앱 출시일 1통. 트랜잭션 메일 제목 구체화(콜드 리뷰 P1).
- **Product Hunt**: 해커톤 창엔 생략(데이팅 소비자 앱에 효율 낮음, 운영 여력 우선).

---

## 8. 측정·의사결정 규칙(주간)

| 지표                            | 출처                          | 판단                                                 |
| ------------------------------- | ----------------------------- | ---------------------------------------------------- |
| 릴스 조회→`reel_visit`          | 플랫폼 인사이트 + track_event | <1%면 훅·첫 2초 교체, ≥2%면 해당 포맷 증량           |
| 방문→관심(`interest_submitted`) | 서버                          | <1.5%면 페이지 상단·관심 마찰 점검                   |
| 관심→수락                       | 서버                          | <20%면 관심 품질(프로필 요구) 유지, 수신함 문구 점검 |
| Creator Launch 전환             | RevenueCat                    | <5%면 유료 실체 재배치(콜드 리뷰 P1) 즉시            |
| 신고·리뷰 큐                    | OPS 스크립트                  | 24h 초과 0건 유지                                    |
| 지출                            | 채널별                        | 티어 상한 초과 금지; ASA는 크레딧까지만              |

---

## 9. 첫 2주 일일 체크리스트(소유자 60분 + Claude)

- **매일 아침(15분)**: Claude 리포트 확인(어제 조회·방문·관심·수락·매출·신고), 릴스 1개 업로드(캡션·해시태그는 전날 Claude 초안), DM 자동응답 상태 확인.
- **매일 저녁(30분)**: 댓글 응답, 관심 수락 운영 지원(시드 Dater에게 "수신함 확인" 리마인드), 다음 날 소재 승인.
- **주 2회(15분)**: 빌드인퍼블릭 포스트(Claude 초안), Discord 글.
- **주 1회(30분)**: §8 표로 결정(포맷 증량/교체, 예산 티어 유지/변경), GROWTH_EVIDENCE 갱신.

---

## 10. Claude가 매일 만드는 것

릴스 캡션·훅 3안, 다음 날 대본, DM·댓글 스크립트 갱신, 크리에이터 브리프·동의문, 기자 리스트·피치, ASA 키워드 성과표, 일일 리포트, #BuildInPublic 초안, Devpost 제출문·2분 영상 스크립트.

## 11. 결정 목록 `[결정]`

1. 마케팅 예산 티어(권장 A → 승인 후 B 절반)
2. Noise CPM(권장 $8~12)
3. Layers SDK 설치(30분 개발) — Growth Loop 상 응모 여부
4. 마이크로 크리에이터 직접 섭외 3명 여부·단가 상한
5. 릴스 P0 재설계를 창 안에 할지(콜드 리뷰 §6-1) — **이 결정이 위 모든 예산의 전제**
