# Friendword

> Claude 개발 인수인계 문서  
> 최종 업데이트: 2026-07-12 (Asia/Seoul)  
> 작성 언어: 한국어 / 제품·스토어·마케팅 기본 언어: 영어  
> 프로젝트 상태: 아이디어 및 핵심 정책 확정, 개발 시작 전

> **2026-08-04 운영 정책 공지:** 이 문서의 과거 Advisor/Worker·Codex·고정 모델 오케스트레이션 서술은 역사 기록이며 현재 정책이 아닙니다. 현재 모델 라우팅, 에이전트 구성, 병렬성, 검증과 에스컬레이션은 사용자 범위 `fable-control-plane` 플러그인이 단독으로 소유합니다. 이 문서는 제품 계약과 역사적 맥락에만 사용합니다.

## Overview

**Friendword는 친구의 30~60초 음성 추천을 당사자가 승인한 사진·문구와 결합해 공유 가능한 세로형 모션 피치로 만들고, 이를 본 사람이 검증된 프로필로 관심을 표현한 뒤 당사자가 수락하면 안전한 인앱 대화를 시작하는 18세 이상 대상의 friend-led dating campaign 앱이다.**

핵심 문장은 다음과 같다.

> **Dating, in your friends' words.**

Friendword는 또 하나의 스와이프 마켓플레이스가 아니다. MVP에는 공개 프로필 피드와 무한 스와이프가 없다. 발견(discovery)은 친구가 Instagram, TikTok, iMessage, WhatsApp 등 기존 네트워크에 공유한 피치 링크에서 시작된다. 따라서 지역별로 충분한 프로필 재고를 먼저 확보해야 하는 전통적인 데이팅 앱의 콜드스타트 문제를 줄이고, 하나의 캠페인이 시청자·관심 표현자·새 소개자를 동시에 유입시키는 공유 루프를 만든다.

제품에는 세 가지 **계정 유형**이 아니라 캠페인과 행동에 따라 생기는 세 가지 **컨텍스트 역할**이 있다.

1. **Introducer**: 싱글 친구를 추천하는 사람. 음성을 녹음하고 사진과 초안을 제안한다.
2. **Dater**: 소개 대상자. 본인 확인 후 모든 사진·문구·음성·공개 범위를 수정하거나 승인하고 캠페인을 소유한다.
3. **Interested Person**: 피치를 본 사람. 열람에는 가입이 필요 없지만 관심 표현에는 본인 사진, 기본 프로필, 연락처 및 성인 확인이 필요하다.

한 사람은 하나의 User 계정으로 캠페인 A에서는 Introducer, 캠페인 B에서는 Dater, 캠페인 C에서는 Interested Person이 될 수 있다. 회원가입 시 역할을 고정하거나 계정을 전환하지 않는다. 사용자가 들어온 링크와 선택한 행동이 현재 컨텍스트를 결정한다. `Creator`는 Creator Launch 상품의 마케팅 명칭일 뿐 계정 유형이나 도메인 역할이 아니다.

이 제품이 지켜야 할 핵심 원칙은 다음과 같다.

- 당사자 동의 전에는 어떤 피치도 공개되지 않는다.
- 소개자가 올린 사진은 제안일 뿐이며 Dater가 개별 승인·삭제·교체할 수 있다.
- 소개자의 실제 음성을 사용하되 얼굴 출연, AI 아바타, 음성 복제, 립싱크 딥페이크를 만들지 않는다.
- 피치는 Dater의 승인된 사진, 원본 친구 음성, 자막, 키네틱 타이포그래피, 파형 및 그래픽으로 구성한다.
- 피치 링크는 가입 없이 볼 수 있지만 관심 표현에는 검증된 사진과 프로필이 필요하다.
- 전화번호와 이메일은 곧바로 공개하지 않는다. 상호 수락 후 인앱 Intro Room에서 먼저 대화한다.
- 신고, 차단, 동의 철회, 캠페인 중지, 데이터 삭제와 안전 기능은 결제 여부와 무관하게 제공한다.
- 글로벌 소개자 랭킹은 만들지 않는다. 대량 소개와 타인 대상화를 유도할 수 있기 때문이다.

---

## Steps

## [요구사항] - 해커톤 룰 파악

### 현재 공식 상태

- 대회: [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/)
- 공식 발표: [Announcing Shipaton 2026](https://www.revenuecat.com/blog/company/announcing-shipaton-2026/)
- 등록 기간: 2026-05-15 08:00 PDT ~ 2026-09-30 23:45 PDT
- 제출 기간: 2026-08-01 00:00 PDT ~ 2026-09-30 23:45 PDT
- 심사 기간: 2026-10-01 ~ 2026-10-13
- 수상 발표 예정: 2026-10-21
- 2026-07-12 현재 [Rules 페이지](https://revenuecat-shipaton-2026.devpost.com/rules)는 **최종 Official Rules가 아직 공개되지 않았음**을 명시한다. 아래 내용은 현재 공개된 Overview와 RevenueCat 공식 발표 기준이며, 최종 규칙 공개 직후 반드시 다시 대조해야 한다.

### 현재 확인된 필수 요건

1. iOS, iPadOS, macOS 또는 Android에서 동작하는 **새로운 앱**이어야 한다.
2. 첫 공개 버전이 2026-08-01부터 2026-09-30 사이에 App Store, Google Play 또는 Samsung Galaxy Store에 출시되어야 한다.
3. 이전 출시 앱의 업데이트는 인정되지 않는다. 8월 1일 전 개발·홍보는 가능하지만 공개 출시는 금지한다.
4. RevenueCat SDK로 최소 하나의 인앱/웹 구매를 처리하거나 RevenueCat Ads를 사용해야 한다.
5. 현재 Devpost가 요구하는 제출물은 다음과 같다.
   - 기능과 작동 방식에 대한 텍스트 설명
   - 실제 기기에서 앱이 작동하는 모습을 보여주는 2분 이내 공개 YouTube/Vimeo 데모
   - 공개된 스토어 URL
   - 1024×1024 앱 아이콘
   - 기기 프레임이 없는 1179×2556 이상의 스크린샷 최소 1장
   - 심사위원이 유료 기능을 확인할 수 있는 무료 체험 또는 프로모션 코드
6. 참가자는 거주 국가의 성년이어야 하며 일부 국가·지역은 제외될 수 있다. 대한민국 참가 가능 여부는 최종 규칙에서 재확인한다.

### Grand Prize의 현재 의도

2026 Grand Prize는 **대회 기간에 가장 강한 사용자 traction과 growth momentum을 만든 앱**을 찾는다. 심사자는 출시 이후 어떤 행동으로 성장을 밀어 올렸는지 듣고 싶다고 명시했다. 따라서 완성도 높은 데모만으로는 부족하다. 출시일을 늦추지 말고 실제 캠페인, 공유, 검증 사용자, 관심 표현, 결제, 주간 성장 데이터를 쌓아야 한다.

2025년 공식 우승 사례도 이를 뒷받침한다.

- [Payout](https://www.revenuecat.com/blog/company/shipaton-2025-winners/)은 17,000명 이상 사용자, $30,017 매출, 1,750명 유료 사용자, 500,000회 이상 소셜 노출을 만들었다.
- 같은 글의 #BuildInPublic 우승작 Gurwi는 13,000명 이상 사용자와 1,000개 이상 스토어 리뷰를 확보했다.
- 데이팅 인접 제품 ReadHim은 Instagram 밈 계정 520만 회 이상 조회, 230만 팔로워 TikTok 인플루언서 협업, 출시 열흘 내 $1,100 MRR을 만들었다.
- Shutter Declutter는 유기적 입소문과 언론 노출로 1,000명 이상의 유료 구독자를 확보했다.

**Friendword의 Grand Prize 전략은 기능 수가 아니라 측정 가능한 공유 루프다.** 최소한 `published campaigns → unique viewers → verified interests → accepted intro rooms → new campaigns → paid products`가 실제 데이터로 연결되어야 한다.

### 현재 페이지의 불일치와 재확인 게이트

Devpost Overview 본문은 Grand Prize를 $50,000으로 설명하지만, 같은 페이지 하단의 Prizes 영역은 1위를 $100,000으로 표시한다. 전체 현금 규모도 상단과 본문이 다르며 TBD 스폰서 부문이 남아 있다. 문서나 마케팅에 상금 액수를 확정적으로 사용하지 않는다.

Claude는 다음 시점마다 Rules·Overview·Resources를 다시 확인하고 `docs/HACKATHON_RULES.md`에 날짜와 변경점을 기록해야 한다.

- 개발 시작일
- App Store 심사 제출 전
- 공개 출시 직전
- Devpost 제출 7일 전
- Devpost 최종 제출 직전

---

## [문제 정의 및 리서치] - Problem Understanding <> Market Research

## Shipaton 2026이 바라보는 문제와 출제 의도

RevenueCat이 요구하는 것은 “AI로 빠르게 만든 앱” 자체가 아니다. [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)에 따르면 월간 신규 구독 앱 출시는 2022년 약 2,000개에서 2026년 14,700개 이상으로 증가했지만, 2025년 이후 출시된 앱은 전체 구독 매출의 약 3%만 만든다. 공급은 폭증했지만 새 앱의 대부분은 지속 가능한 수요와 수익을 만들지 못한다.

Shipaton 2026의 문제 의도는 다음으로 해석한다.

1. 미완성 아이디어를 실제 스토어 제품으로 출하할 수 있는가.
2. 기술 데모가 아니라 사용자가 반복·공유·결제하는 제품을 만들 수 있는가.
3. RevenueCat을 결제 버튼으로만 붙이지 않고 가격·패키지·전환을 실험하는가.
4. 출시 이후 커뮤니티 피드백과 데이터를 이용해 성장할 수 있는가.
5. 이미 포화된 앱스토어에서 의미 있게 다른 사용자 경험을 제공하는가.

Apple 역시 데이팅 앱은 이미 포화된 카테고리이므로 **meaningfully different or improved experience**가 없으면 신규 제출을 받아들이지 않을 수 있다고 [App Review Guidelines 4.3(b)](https://developer.apple.com/app-store/review/guidelines/)에 명시한다. Friendword는 일반 프로필 피드에 친구 추천 한 줄을 추가한 앱이어서는 안 된다. 외부 공유 가능한 친구 음성 피치와 당사자 승인 캠페인이 제품의 실제 중심이어야 한다.

---

## Research → Context Building

### 시장의 관찰된 문제

[Pew Research Center의 미국 성인 6,034명 조사](https://www.pewresearch.org/internet/2023/02/02/from-looking-for-love-to-swiping-the-field-online-dating-in-the-u-s/)에서 미국 성인의 30%가 온라인 데이팅을 사용한 적이 있고, 사용 경험은 긍정 53%, 부정 46%로 갈렸다. 사용자의 35%는 데이팅 앱이나 기능에 돈을 지불한 적이 있다. 즉 수요와 결제 의향은 존재하지만 경험 만족은 압도적이지 않다.

동일 조사에서 다음 문제가 확인된다.

- 최근 사용자 중 88%는 적어도 가끔 프로필에 실망했다.
- 전체 경험자 중 48%가 원치 않는 성적 메시지, 지속적 연락, 모욕, 물리적 위협 중 하나 이상을 경험했다.
- 50세 미만 여성 경험자의 66%가 위 네 가지 원치 않는 행동 중 하나 이상을 경험했다.
- 사용자 52%가 잠재적 사기꾼을 마주쳤다고 생각했다.
- 최근 남성 사용자 64%는 메시지 부족으로 불안감을 느낀 적이 있고, 최근 여성 사용자 54%는 메시지 양에 압도된 적이 있다.

[FTC 2026 데이터](https://www.ftc.gov/news-events/news/press-releases/2026/04/new-ftc-data-show-people-have-lost-billions-social-media-scams)에 따르면 2025년 금전 피해가 보고된 소셜미디어 사기의 손실은 $2.1B였고, 로맨스 스캠 피해 보고자의 약 60%는 소셜미디어에서 관계가 시작됐다고 답했다. 외부 공유를 성장 수단으로 쓰는 Friendword는 이 위험을 줄이는 설계를 제품 핵심으로 가져가야 한다.

### 문제를 사용자 관점으로 재정의

#### Dater의 문제

- 자기소개는 자기 마케팅처럼 느껴지고, 성격을 입증하기 어렵다.
- 스와이프와 반복 채팅이 피로하지만 앱을 완전히 떠나면 새로운 사람을 만날 경로가 줄어든다.
- 누가 관심을 보냈는지 정보가 부족하면 응답할 이유가 없다.
- 연락처를 낯선 사람에게 즉시 공개하는 것은 불안하다.

#### Introducer의 문제

- 친구를 소개하고 싶어도 프로필 전체를 작성하거나 계속 스와이프하는 것은 노동이다.
- 3~5분 발표 자료와 오프라인 무대는 재미있지만 대부분의 사람에게 너무 높은 마찰이다.
- 자신이 잘 아는 친구의 매력을 짧게 말하는 것은 가능하지만 영상 편집은 어렵다.
- 소개 후 결과와 자신의 기여가 전혀 보이지 않으면 반복 동기가 약하다.

#### Interested Person의 문제

- 자기서술과 보정된 사진만으로는 신뢰와 대화 소재가 부족하다.
- 관심을 표현하기 위해 곧바로 전화번호·이메일을 넘기는 것은 위험하다.
- 앱을 설치하고 긴 가입을 마치기 전에 상대를 볼 수 있어야 한다.

### 기존 솔루션과 경쟁 공백

Friendword의 기본 발상은 완전히 새로운 것이 아니다. “친구가 데이팅에 관여한다”는 모델에는 직접 경쟁자가 있다.

| 제품 | 현재 방식 | Friendword가 그대로 따라 하면 안 되는 이유 | Friendword의 차별화 |
|---|---|---|---|
| Tinder/Bumble/Hinge | 자기서술, 앱 내부 피드, 알고리즘/스와이프 | 기존 시장의 유동성·브랜드와 경쟁할 수 없음 | 공개 피드 없이 친구의 기존 소셜 그래프에서 발견 |
| [Wingman](https://www.wingmanapp.com/faq) | 친구가 프로필을 쓰고 대신 스와이프·소개 | 친구에게 지속적 탐색 노동을 요구하며 지역별 프로필 재고가 필요 | 한 번의 음성 피치 제작과 외부 공유에 집중 |
| [Chorus](https://getchorus.co/how-it-works) | Matchmaker가 친구 대신 스와이프, 매칭 후 Dater 대화 | 양쪽 Matchmaker와 지역 유동성이 필요 | 링크 열람은 무가입, 관심 표현 시점에만 검증 가입 |
| [Vouched](https://gotvouched.com/) | 브라우저에서 친구가 한 질문에 답해 프로필을 보강하고 crush/match | “friend-backed profile”만으로는 거의 직접 중복 | 친구가 시작하는 원본 음성→AI 모션 피치, Dater 승인, 외부 캠페인, 동적 멀티 추천, 검증 관심 인박스 |
| [Pitch-A-Friend](https://www.pitch-a-friend.com/) | 친구가 3~5분 슬라이드로 오프라인 청중에게 발표 | 장소·일정·발표 용기가 필요하고 확장이 도시 이벤트에 묶임 | 30~60초 음성으로 비동기 제작, 어디서나 공유·응답 |
| [Dear Real](https://www.dearreal.com/help/) | 친구의 vouch와 matchmaking을 제공 | friend-approved dating 자체는 선행됨 | 마켓플레이스가 아니라 소셜 콘텐츠 기반 캠페인 |

### 반드시 지켜야 할 경쟁 경계

다음 다섯 가지 중 하나라도 빠지면 Friendword는 Vouched 또는 Wingman의 약한 복제품이 된다.

1. Introducer의 **원본 음성**이 피치의 감정적 중심이어야 한다.
2. 결과물은 프로필 안의 추천 문구가 아니라 **외부 공유 가능한 세로형 모션 피치**여야 한다.
3. Dater의 신원·얼굴 일치와 개별 콘텐츠 승인이 공개 전 필수여야 한다.
4. 시청은 무가입이지만 관심 표현은 사진·기본 프로필·성인 확인을 갖춘 사용자만 가능해야 한다.
5. 앱 내부 피드보다 campaign URL과 referral attribution이 먼저 동작해야 한다.

### 리서치 시 사용 원칙

- 경쟁사가 존재하지 않는다고 주장하지 않는다.
- Vouched의 공개 대기자 수나 경쟁사의 활성 사용자 수를 검증 없이 시장 규모로 사용하지 않는다.
- 당사자 동의가 안전을 “보장한다”고 주장하지 않는다. 안전 위험을 낮추는 한 층일 뿐이다.
- 친구 추천이 사람의 성격을 증명한다는 과장 표현을 피한다. 이해관계자·친구가 함께 거짓말할 수 있다.
- 사용자 인터뷰를 하지 않았다면 인터뷰 결과를 만들지 않는다. 초기 검증은 행동 데이터와 실제 concierge beta로 수행한다.

---

## Problem Statement

### 가장 큰 문제

**온라인 데이팅에서 사람들은 자기 자신을 매력적으로 설명해야 하지만 자기서술은 신뢰 신호가 약하고 피로하다. 친구는 더 구체적이고 인간적인 맥락을 제공할 수 있지만, 기존 friend-assisted dating 제품은 친구에게 지속적인 스와이프·가입·프로필 작성 노동을 요구하거나 지역 마켓플레이스의 유동성에 의존한다.**

### 핵심 기회

친구가 가장 자연스럽게 할 수 있는 행동인 “30~60초 동안 왜 이 사람을 만나볼 가치가 있는지 말하기”만 받고, 나머지 편집·구조화·공유·응답 처리를 제품이 담당한다. 공개 전 당사자 승인을 강제하고 관심 표현자의 정보를 검증함으로써, 친구의 사회적 맥락과 Dater의 통제권을 동시에 제공한다.

### 해결하지 않는 문제

- 완벽한 호환성 예측 또는 장기 관계 성공 보장
- 범죄·사기 가능성의 완전 제거
- 모든 싱글을 위한 범용 데이팅 마켓플레이스
- 친구가 없거나 공개 소개를 원하지 않는 사용자의 발견 문제
- AI가 연애 상대를 자동 선택하거나 대화를 대신하는 기능
- 익명 평가, 외모 점수, 공개 댓글 또는 타인을 대상으로 한 투표

---

## Opportunity Sizing

### 시장 총량의 근거

- 미국 인구는 2025년 추계 약 341.8M이다. [U.S. Census QuickFacts](https://www.census.gov/quickfacts/fact/table/US/HSG010224)
- 2023년 기준 미국의 미혼 인구는 약 133.5M으로 집계됐다. [U.S. Census, The Single Life](https://www.census.gov/content/dam/Census/library/visualizations/2024/comm/the-single-life.pdf)
- Pew 조사에서 미국 성인의 30%가 온라인 데이팅을 사용한 경험이 있고 35%가 적어도 한 번 결제했다.
- Bumble은 2025년 3.7M 유료 사용자와 $965.7M 매출을 보고했다. [Bumble FY2025 results](https://ir.bumble.com/financials/quarterly-results/)

이는 데이팅에 사용·결제 시장이 충분히 크다는 증거이지 Friendword가 이 시장의 일정 비율을 자동으로 얻는다는 뜻은 아니다. 실제 SAM은 다음 조건 때문에 훨씬 작다.

- 영어권 18세 이상, 초기 마케팅은 21~34세
- 현재 싱글이며 공개 또는 제한 공유 소개에 동의
- 소개를 도와줄 친구가 최소 한 명 존재
- 짧은 동영상·스토리 링크 공유 문화에 익숙함
- 상대방의 친구 추천을 의미 있는 신호로 받아들임

### 해커톤 단계의 현실적인 기회 단위

Grand Prize에서 중요한 단위는 거대한 TAM이 아니라 **활성 캠페인 하나가 만드는 검증된 성장**이다. 초기 목표는 다음처럼 계산한다.

- 100개 published campaigns
- 캠페인당 median 20 unique viewers → 2,000 verified unique views
- view-to-interest 2% → 40 verified interests
- interest-to-accepted-intro 30% → 12 Intro Rooms
- campaign-to-new-campaign K-factor 0.3 → 추가 30개 캠페인
- activated campaign-to-paid 3~5% → 3~5개 초기 결제

이 숫자는 예측이 아니라 검증 목표다. 첫 20개 캠페인에서 실제 퍼널을 측정한 뒤 목표를 업데이트한다.

---

## [솔루션 & 엔지니어링]

## Problem Solutioning

비용 표기는 솔로 개발자 기준의 상대적 구현 비용이다.

- **S**: 0.5~2 개발일
- **M**: 3~5 개발일
- **L**: 1~2주
- **XL**: 2주 이상 또는 운영 인력이 계속 필요

| Opportunity | 후보 솔루션 | 비용 | 판단 |
|---|---|---:|---|
| 자기소개 피로·낮은 맥락 | 친구 음성 전사→구조화→자막/모션 피치 | M | MVP 핵심 |
| 타인 도용/fake pitch | Dater 계정, 전화 OTP, selfie liveness/face match, 공개 전 승인 | L | MVP 필수. 외부 신원확인 공급자 사용 |
| 친구 참여 마찰 | Introducer는 앱 또는 브라우저 초대 링크에서 30~60초 녹음 | M | MVP 핵심 |
| 지역 마켓플레이스 콜드스타트 | 공개 피드 대신 외부 share URL과 OG/social preview | M | MVP 핵심 |
| 관심 표현의 scam 인상 | 관심 표현자 사진·기본 소개·연령·전화 확인 | M | MVP 필수 |
| 연락처 노출 위험 | 수락 후에만 1:1 Intro Room, 신고·차단 | L | MVP 필수 |
| 다중 친구 맥락 | 승인된 추가 추천을 동적 Vouch Card로 표시 | M | MVP 후반 |
| 이미 공유된 피치 수정 | 동적 웹 피치만 즉시 업데이트, (로드맵의) MP4 export는 자동 수정하지 않음 | S | 정책으로 확정, MP4는 post-launch |
| Introducer 반복 동기 | 가명 프로필, 완료 수, 감사 배지, 커스터마이징 해금 | M | 글로벌 랭킹 없이 구현 |
| 수익화 | 무료 Starter + $4.99 Creator Launch + 30일 Campaign Pass | M~L | Shipaton 필수 |
| 운영 안전 | 텍스트·이미지 moderation, 신고 큐, SLA, 감사 로그 | L/XL | 범위를 제한하되 MVP 필수 |

---

## Solution Prioritization

### P0: 스토어 출시와 핵심 루프에 반드시 필요한 기능

1. **Account & Contextual Role**
   - 18+ 중립적 나이 확인 화면
   - 전화 OTP 또는 동등한 소유 확인
   - 하나의 User 계정과 공통 인증 identity
   - 회원가입에서 `Creator/Dater` 계정 유형 선택을 요구하지 않음
   - 진입 경로와 resource membership으로 Introducer, Dater, Interested Person 컨텍스트 결정
   - 한 사용자가 서로 다른 캠페인에서 여러 역할을 동시에 수행할 수 있음
2. **Private Pitch Draft**
   - Introducer가 친구 이름/연락 초대, 관계 유형과 기간 입력
   - 사진 제안 업로드
   - 30~60초 원본 음성 녹음
   - AI 전사 및 구조화 초안 생성
3. **Dater Consent & Verification**
   - 초대 링크를 받은 당사자가 신규 또는 기존 User 계정으로 invitation claim
   - 유효한 기존 인증이 없을 때 selfie liveness와 프로필 대표 사진 face match
   - 사진·텍스트·음성·대상 지역·공개 기간을 개별 수정/승인
   - 승인 전 전체 비공개
4. **Pitch Generation**
   - 9:16 세로형, 원본 친구 음성 + Dater 승인 사진 + 자막 + 키네틱 텍스트
   - 친구의 얼굴 영상, 생성형 얼굴, voice clone, lip-sync 금지
   - 15~60초 이내, 음소거 시에도 이해 가능한 자막
5. **Campaign Link**
   - 앱 설치 없이 열람 가능한 HTTPS 링크
   - social OG 이미지/영상 미리보기
   - noindex 기본값, Dater가 pause/revoke/delete 가능
   - 캠페인별 referral/UTM attribution
6. **Verified Interest**
   - 관심 표현 전 성인·전화·사진·기본 bio·dating intent 입력
   - Dater가 사진과 정보를 보고 accept/decline
   - 이메일·전화번호 직접 노출 금지
7. **Intro Room**
   - 수락된 두 사용자만 1:1 텍스트 채팅
   - 신고·차단·나가기
   - 사진/파일 전송은 MVP에서 제외해 moderation 표면 축소
8. **RevenueCat**
   - 무료 Starter, $4.99 Creator Launch credit와 30일 Campaign Pass
   - 구매 복원, sandbox 테스트, entitlement/expiration 처리
9. **Safety & Operations**
   - 업로드 전/후 필터링
   - 신고 큐와 운영자 비공개 도구
   - 차단 시 양방향 노출과 메시지 중지
   - 계정·캠페인 삭제 및 데이터 보존 정책
10. **Analytics**
    - 전체 성장 퍼널 이벤트와 campaign attribution

### P1: 출시 직후 성장 실험에 필요한 기능

- Campaign Pass: 추가 친구 1~5명의 Vouch Card
- Introducer 가명 프로필과 소개 완료 배지
- Creator Launch: premium visual theme, social asset 재생성, 서버 렌더 MP4 export (정적 share kit은 이미 MVP로 출시됨 — 위 상품 계약 참조)
- Campaign Pass: accepted-intro 단계까지의 확장 analytics (view→interest source별 퍼널은 이미 MVP Pass 가치)
- push notification: 승인 요청, 관심 도착, 수락, 새 메시지
- BuildInPublic용 익명화된 성장 스냅샷

### P2: 해커톤 이후에만 검토

- 앱 내부 탐색 피드와 추천 알고리즘
- background/financial check
- 영상·사진 채팅
- 오프라인 이벤트와 date scheduling
- 글로벌 Introducer 랭킹
- AI 연애 코치, 자동 답장, 호환성 점수
- 연락처 전체 동기화

---

## 확정 사용자 흐름

### Flow A: Introducer가 피치 시작

1. 신규 또는 기존 User가 `Pitch a friend`를 누르면 해당 pitch draft의 Introducer 컨텍스트가 된다. 별도 Creator 계정을 만들지 않는다.
2. 친구와의 관계 유형·기간을 선택한다.
3. Dater에게 보낼 동의 초대 연락처를 입력한다. 연락처는 초대 전송 목적으로만 사용한다.
4. 공개되지 않는 draft에서 사진을 제안하고 30~60초 음성을 녹음한다.
5. AI가 음성을 다음 구조의 editable JSON으로 변환한다.
   - `hook`
   - `relationship_context`
   - `three_specific_qualities`
   - `evidence_or_anecdote`
   - `good_match_for`
   - `hard_claims_requiring_confirmation`
6. Introducer가 초안을 검토하고 Dater에게 승인 요청을 보낸다.

### Flow B: Dater가 신원 확인 및 승인

1. Dater가 deep link를 열고 신규 계정을 만들거나 기존 User 계정으로 로그인한다.
2. 서버가 invitation contact와 로그인 identity를 확인하고 기존 User에 consent request와 `DATER_OWNER` membership을 연결한다. 별도 Dater 계정을 만들지 않는다.
3. 18세 이상 확인과 전화 확인을 계정 수준에서 재사용하고, 유효기간이 지났거나 위험 신호가 있을 때만 selfie liveness/face match를 다시 수행한다.
4. 각 사진을 승인·교체·삭제한다.
5. AI 문구와 친구 음성을 듣고 수정 요청 또는 승인한다.
6. 위치의 공개 정밀도, dating intent, 관심 표현 필터, 캠페인 종료일을 선택한다.
7. 승인하면 처음으로 pitch URL이 생성된다.

### Flow C: 시청 및 관심 표현

1. 누구나 공유 링크에서 피치를 볼 수 있다. 가입 wall은 없다.
2. `I'm interested`를 누르면 신규 가입 또는 기존 User 로그인이 시작되고 해당 interest의 Interested Person 컨텍스트가 된다.
3. 기존 `dating_profile`이 있으면 재사용하고, 없거나 오래된 경우 최소 2장의 현재 사진, 짧은 bio, 나이, 대략적 위치, dating intent를 제출한다.
4. Dater는 관심 인박스에서 사진과 프로필을 확인하고 수락·거절·신고할 수 있다.
5. 수락 시 Intro Room이 열린다. 연락처 공유는 두 사람이 별도로 선택할 때만 가능하다.

### Flow D: 여러 친구 추천 추가

1. Published campaign의 Dater 또는 최초 Introducer가 다른 친구에게 추천 요청을 보낸다.
2. 추가 친구는 짧은 음성 또는 텍스트 추천을 제출한다.
3. Dater 승인 후 동적 웹 피치 하단에 독립된 Vouch Card로 추가된다.
4. 이미 내려받거나 SNS에 업로드된 MP4는 자동 수정하지 않는다.
5. Dater가 원할 때만 새 추천을 포함한 MP4 `Re-cut`을 생성한다.

---

## 단일 계정과 컨텍스트 역할 원칙

### 계정 모델

Friendword에는 Creator 계정, Dater 계정, Interested Person 계정이 따로 존재하지 않는다. 모든 사람은 하나의 `User` identity와 하나의 RevenueCat App User ID를 가진다. 역할은 User의 영구 속성이 아니라 특정 campaign, pitch draft 또는 interest와의 관계에서 파생된다.

```text
User A
├── Campaign 1: INTRODUCER
├── Campaign 2: DATER_OWNER
├── Campaign 3: INTEREST_SENDER
└── Campaign 4: ADDITIONAL_VOUCHER
```

`users`에 `role`, `account_type`, `is_creator`, `is_dater` 같은 전역 필드를 만들지 않는다. 역할 변경 API도 만들지 않는다. 새로운 행동이 새로운 resource relationship을 추가할 뿐 기존 관계를 덮어쓰지 않는다.

### 진입 경로가 현재 컨텍스트를 결정한다

| 진입 경로 또는 행동 | 현재 컨텍스트 | 생성되는 관계 |
|---|---|---|
| `Pitch a friend` | Introducer | pitch draft creator / campaign membership |
| Dater consent deep link | Dater | campaign `DATER_OWNER` |
| 공개 피치의 `I'm interested` | Interested Person | `interests.sender_user_id` |
| 추가 추천 초대 | Additional Voucher | campaign membership |

회원가입에서 “Creator인가요, Dater인가요?”라고 묻지 않는다. 홈에서도 계정 모드 스위치보다 `Pitch a friend`, `My dating campaigns`, `My interests`처럼 할 일을 보여준다.

### 허용·금지 관계

- 동일한 User가 서로 다른 캠페인에서 모든 역할을 수행할 수 있다.
- 하나의 campaign에는 정확히 한 명의 `DATER_OWNER`가 있어야 한다.
- 동일 User는 같은 campaign에서 `DATER_OWNER`와 `INTRODUCER`를 동시에 가질 수 없다. 자기 자신을 친구인 것처럼 소개하는 것을 막기 위함이다.
- 한 campaign에는 최초 Introducer와 여러 `ADDITIONAL_VOUCHER`가 참여할 수 있다.
- Interested Person은 campaign member가 아니다. `interests` record의 sender로 연결되고, 수락 후 Intro Room participant가 된다.

### 인증과 프로필 재사용

- 전화 확인과 기본 identity는 계정 수준에서 재사용한다.
- liveness/face match는 검증 시각·위험 신호·프로필 사진 변경을 기준으로 재검증한다.
- Dater와 Interested Person은 하나의 `dating_profile`을 공유한다. 역할마다 bio와 사진을 중복 생성하지 않는다.
- 캠페인마다 공개할 사진·문구·지역 범위와 음성에 대한 동의는 매번 별도로 받는다. 신원 인증 재사용이 콘텐츠 동의 재사용을 의미하지 않는다.
- `introducer_profile`은 가명·완료 수·커스터마이징 해금 같은 선택적 facet일 뿐 별도 계정이 아니다.

---

## 수익화 설계

### 무료 Starter

- Dater 본인 확인과 핵심 안전 기능
- verified Dater당 동시에 활성화할 수 있는 친구 1명의 기본 피치 1개
- 기본 테마 1개
- 기본 동적 web pitch와 14일 공개
- 제한 없는 링크 시청
- 검증 관심 표현의 수신·수락·채팅
- 신고, 차단, 삭제

무료 버전도 실제 연결이 가능해야 한다. Introducer가 음성을 녹음하고 Dater가 승인한 뒤 링크를 공유하고, 관심 표현을 받아 Intro Room에서 대화하는 전체 핵심 루프를 결제 없이 완료할 수 있다. 관심을 보낸 사람의 사진을 가리거나 관심 수락·채팅·신고·차단 같은 연결과 안전 기능을 결제벽 뒤에 두지 않는다.

### Creator Launch — $4.99

**Introducer가 특정 친구의 피치 하나를 더 잘 공유하기 위해 구매하는 피치당 일회성 상품**이다. 무료 피치 공개의 입장료가 아니며, 이미 무료로 가능한 연결·공유를 막지 않는다. `Creator`는 상품의 마케팅 명칭일 뿐 별도의 사용자 역할이 아니고, 도메인과 데이터 모델에서 구매자는 기존 `Introducer`다.

> **현행 MVP 계약(canonical)** — [`docs/DECISIONS.md`](docs/DECISIONS.md) 2026-07-13 "Creator Launch·Campaign Pass 최종 MVP 상품 계약". 감사 CP-5의 "정직한 축소" 결정으로 Creator Launch $4.99가 실제로 제공하는 것은 **승인 콘텐츠 기반 정적 share kit** 하나다. 아래 목록이 판매·약속하는 전부이며, 그 아래 "원 계약(historical)" 표기는 초기 기획 기록으로 현재 상품 범위가 아니다.

- 승인된 피치에서 생성한 9:16 세로형 정적 share card 1개(PNG)
- Instagram/TikTok/iMessage 스토리용 caption pack(완전한 공개 URL 포함)
- 발행 후 `/kit/[draftId]`에서 크레딧 1회 소비로 unlock, 이후 영구 재진입(재소비 없음)

**판매하지 않으며 카피에서 약속하지 않는(post-launch 로드맵) 항목**: premium motion theme, AI 추가 composition, 서버 렌더 MP4 export, end card 커스터마이즈, social asset 재생성. 킷 산출물은 Dater 승인 snapshot의 콘텐츠(승인 headline, 대표 사진=포함 사진 중 sort_order 최솟값)만 사용하며 별도 재승인이 필요한 신규 표현을 만들지 않는다.

Creator Launch에는 캠페인 공개 기간, 관심 표현 필터, Vouch 관리, 관심 인박스, 캠페인 운영 analytics가 포함되지 않는다. 이는 Dater용 Campaign Pass의 영역이다.

크레딧은 private draft 단계에서 예약할 수 있지만 발행 후 kit unlock 시점에만 소비된다. Dater가 거절하거나 unlock 전에 캠페인이 삭제되면 credit을 Introducer의 계정으로 반환한다. 이미 unlock으로 소비된 credit은 다른 캠페인으로 이전하지 않으며 환불로도 재발급하지 않는다(전달 완료된 소모성 디지털 재화 — DECISIONS 2026-07-14 "Commerce 상태기계 확정" refund 계약). 결제가 Dater의 승인권·수정권·공개권·삭제권을 제한해서는 안 된다.

#### 원 계약(historical — post-launch 로드맵, 현재 미판매)

초기 기획의 Creator Launch Pack 구성은 아래와 같았다. 감사 CP-5로 현재 상품에서 제외됐고 향후 로드맵으로만 남는다.

- premium motion theme 1개
- AI가 제안하는 추가 pitch composition
- 서버 렌더 MP4 export 1회
- Friendword 기본 end card 커스터마이징
- Dater가 승인한 콘텐츠 기준 social asset 재생성 1회

iOS에서는 반복 구매 가능한 consumable IAP `creator_launch_credit_499`로 구현한다. 사용자 관점에서는 자동 갱신이 없는 피치당 일회성 결제지만, 같은 Introducer가 다른 친구를 소개할 때 다시 구매할 수 있다. RevenueCat webhook과 서버 `purchase_credit_ledger`에서 `available → reserved → consumed` 및 publish 전 반환을 idempotent하게 처리하며, RevenueCat entitlement 하나만으로 consumable 사용 여부를 판정하지 않는다.

### 30-day Campaign Pass

초기 정가 가설: **USD $19.99**, 비자동 갱신. **Dater가 자신이 소유한 캠페인을 30일 동안 더 적극적으로 운영하기 위해 구매하는 독립 상품**이다. Creator Launch와 상하 관계가 아니며, Creator Launch 구매 여부와 가격에 영향을 주지 않는다.

> **현행 MVP 계약(canonical)** — DECISIONS 2026-07-13 상품 계약 + 2026-07-14 "Commerce 상태기계 확정"(Slice 4). 감사 CP-6의 가치 정직화로 Campaign Pass $19.99가 실제로 제공하는 것은 아래 셋이다. 그 아래 "원 계약(historical)"은 초기 기획 기록으로 현재 상품 범위가 아니다.

- 구매 시점 기준 **30일 연장** — 정확히 `GREATEST(now, ends_at) + 30일`(active면 잔여기간 뒤에 적층, 만료 상태면 구매 시점부터. scheduler 지연과 무관하게 동일)
- Pass-게이트 캠페인 퍼널 분석(view→interest를 source별로 집계)
- 인박스의 Pass 섹션

**재구매·재개 규칙**: 활성 Pass 중에는 서버가 재구매를 거부하고 **만료 후에만** 재구매한다(가치 누적 스택 없음). 무료 resume는 불가하고 **유료 Campaign Pass 구매가 expired 캠페인의 유일한 재개 경로**다(2026-07-13의 "만료 후 재개 불가"를 Slice 4에서 명시적으로 개정). paused 캠페인 구매는 창만 연장하고 paused를 유지한다(자발적 중지 존중). 비공개 베타 중 revival grant는 review 큐로 보류되며(돈은 받되 벤핏 기록 유실 금지) 게이트 해제 후 반영된다.

**판매하지 않으며 카피에서 약속하지 않는 항목**: 최대 5 Vouch Card, 여러 승인 버전 중 활성 버전 선택, 동적 web campaign 업데이트, 일정 관리, 향상된 관심 인박스·알림 관리. **관심 표현 필터(audience filter)는 무료 Dater consent 기능이지 Pass 가치가 아니다**(공개 설정에서 무료 제공).

Creator Launch가 적용된 캠페인과 적용되지 않은 캠페인 모두 Campaign Pass 가격은 동일하게 $19.99다. 두 상품은 한 캠페인에 함께 적용될 수 있지만 혜택이 겹치지 않으며 결제 금액을 서로 차감하지 않는다.

#### 원 계약(historical — post-launch 로드맵, 현재 미판매)

초기 기획의 30-day Campaign Pass 구성은 아래와 같았다. 감사 CP-6으로 30일 연장·퍼널 분석·인박스 섹션만 남기고 나머지는 현재 상품에서 제외됐다.

- 캠페인 30일 활성(→ 현행 유지, 단 적층 규칙은 위 상태기계)
- 최대 5개의 승인된 Vouch Card
- campaign pause/resume 일정 관리
- 여러 승인 pitch version 중 활성 버전 선택
- 추가 추천이 반영된 동적 web campaign 업데이트
- 향상된 관심 인박스·알림 관리

iOS에서는 한 달과 같은 정해진 기간의 접근을 제공하는 **non-renewing subscription**, Android에서는 **1개월 prepaid subscription**을 우선 검토한다. Apple은 non-renewing subscription을 특정 기간의 서비스 접근용으로 정의하고, Google Play는 1개월 prepaid base plan을 지원한다. RevenueCat의 non-subscription entitlement는 자동 만료 처리에 주의가 필요하므로 [Non-Subscription Purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions) 문서를 따라 서버와 webhook으로 만료 상태를 검증한다.

### 결제 주체

- Introducer는 무료로 초안을 만들 수 있고 필요하면 $4.99 Creator Launch를 구매한다.
- Dater는 승인 후 $19.99 Campaign Pass를 구매할 수 있다.
- Creator Launch 구매 여부와 무관하게 Dater가 캠페인의 공개·수정·중지·삭제를 소유한다.
- Interested Person은 MVP에서 어떤 기능에도 결제하지 않는다. 관심 표현, 본인 확인, Intro Room 입장과 안전 기능은 무료다.
- Introducer가 캠페인을 선물하는 `Gift a Pass`는 스토어 정책·계정 귀속·환불 처리가 복잡하므로 P2다.

| 상품 | 구매자 | 적용 대상 | 기능 조작자 | 결제 형태 |
|---|---|---|---|---|
| Free Starter | 없음 | Dater 소유 캠페인 | Introducer 제작, Dater 승인·운영 | 무료 |
| Creator Launch $4.99 | Introducer | 특정 pitch draft 1개 | Introducer가 제작안을 고르고 Dater가 최종 승인 | 피치당 일회성 consumable |
| Campaign Pass $19.99 | Dater | Dater 소유 campaign 1개 | Dater | 30일 non-renewing access |
| Interest / Intro Room | 없음 | Interested Person와 Dater | 각 참여자 | 무료 |

두 상품은 독립적이므로 캠페인은 다음 네 상태를 모두 허용한다.

| Creator Launch | Campaign Pass | 캠페인 상태 |
|---|---|---|
| 미구매 | 미구매 | 기본 제작·공유·연결이 가능한 Free Starter |
| 구매 | 미구매 | 정적 share kit을 unlock한 무료 운영 캠페인 |
| 미구매 | 구매 | 30일 연장 + 퍼널 분석으로 운영하는 캠페인 |
| 구매 | 구매 | share kit unlock과 30일 연장 운영이 각각 적용된 캠페인 |

Creator Launch 구매 기록과 credit은 Introducer가 소유하고, Campaign Pass와 공개 campaign은 Dater가 소유한다. Introducer가 Creator Launch를 결제해도 Dater의 캠페인 소유권이나 통제권을 얻지 않는다.

### RevenueCat을 잘 사용하는 방식

- Offering: `starter`, `creator_launch`, `campaign_30d`
- Products: `creator_launch_credit_499`, `campaign_pass_30d_1999`
- Entitlement: `campaign_plus`; consumable Creator Launch는 entitlement가 아니라 서버 credit ledger로 관리
- Paywall 이벤트, 구매, 취소/환불, 만료를 analytics와 연결
- sandbox purchase와 webhook test event를 모두 검증
- Campaign Pass는 RevenueCat customer state와 서버 entitlement를 동기화해 restore하고, 미사용 Creator Launch credit은 로그인 후 서버 ledger에서 복구한다. 이미 소비된 credit은 restore로 재발급하지 않는다.
- 가격/카피/benefit order 실험
- Devpost 심사용 promo unlock 또는 허용되는 무료 체험 경로 준비
- 광고는 민감한 데이팅·신원 데이터와 충돌하므로 MVP에서 사용하지 않는다.

---

## 비용·버짓·손익분기 계획

### 냉정한 결론

**사용자가 앱을 쓸 때마다 비용이 발생하지 않는 구조는 현실적으로 불가능하다.** 전화 인증, 얼굴 liveness, 미디어 처리, 저장·전송에는 무료 사용자도 변동비가 든다. 따라서 “모든 사용자 한 명마다 반드시 흑자”가 아니라 다음 두 조건을 재무 안전 기준으로 삼는다.

1. 캠페인 한 개의 변동비에 상한을 두어 사용량 증가가 통제 불가능한 손실로 이어지지 않게 한다.
2. 월간 전체 코호트에서 Creator Launch와 Campaign Pass의 혼합 매출이 무료 사용자의 변동비와 고정비를 함께 회수하게 한다.

무제한 무료 캠페인과 무제한 서버 렌더를 제공하면서 결제 전환을 기다리는 방식은 채택하지 않는다. 안전 기능은 무료로 유지하되, 비용이 큰 생성·내보내기·재렌더·보관 기간을 제한한다.

### 2026-07-12 기준 공식 가격 입력값

| 항목 | 공식 가격 또는 무료 구간 | Friendword 적용 |
|---|---:|---|
| Apple Developer Program | $99/년 | 필수 출시 비용, 월 환산 $8.25 |
| Apple Small Business Program | IAP 수수료 15% | 가입 승인 전에는 보수적으로 30% 시나리오도 별도 계산 |
| RevenueCat | 월 tracked revenue $2,500까지 $0, 이후 1% | 해커톤 단계 $0 가정 |
| Supabase Pro | $25/월, 100K MAU·100GB storage·250GB egress 포함 | production DB/Auth/Storage 기본 고정비 |
| Vercel Pro | $20/월, $20 usage credit 포함 | 상업용 public web pitch 기본 고정비 |
| PostHog | 월 1M events 무료 | 초기 analytics $0 |
| Twilio Verify, 미국 SMS | 성공 인증당 $0.05 + SMS당 $0.0083, carrier fee 별도 | 성공 인증 1회당 최소 $0.0583 |
| AWS Rekognition Face Liveness | 첫 500K회 $0.015/회 | Dater와 관심 표현자의 고의도 단계에서만 실행 |
| AWS Rekognition image API | 초기 구간 약 $0.001/API call | face compare와 이미지 moderation에 사용 |
| OpenAI Moderation | API 사용자 무료 | 텍스트·이미지 1차 필터, 운영자 검토 대체 불가 |
| Cloud Run | us-central1 월 240K vCPU-sec·450K GiB-sec 무료, 이후 종량제 | FFmpeg/Remotion worker, max instance 제한 |

가격은 세금, 환율, SMS carrier fee, 지역별 차이와 공급자 변경을 포함하지 않는다. `docs/COST_MODEL.md`에 확인 날짜와 URL을 기록하고 매주 자동 재검증한다.

### 캠페인 1개당 기준 변동비

아래는 문서의 초기 퍼널인 캠페인당 관심 표현자 0.4명, Introducer 1명, Dater 1명을 기준으로 한 **예산 가정**이다. 공급자의 청구서가 아니라 개발 전 보수적 모델이다.

| 비용 발생 지점 | 가정 | 캠페인당 추정 |
|---|---:|---:|
| 전화 OTP | Introducer 1 + Dater 1 + Interested 0.4, 성공당 $0.0583 | $0.140 |
| Liveness | Dater 1 + Interested 0.4, 회당 $0.015 | $0.021 |
| Face compare·이미지 moderation | 약 6~7 API calls | $0.007 |
| 음성 전사·structured generation | 원본 1분 이하, 1회 생성 | $0.010 이하 목표 |
| 최종 media render | 승인 후 1회, 짧은 CPU worker | $0.010 이하 목표 |
| storage·egress·email·기타 | 20 views, lifecycle deletion, 포함량 우선 | $0.020 |
| **직접비 소계** |  | **약 $0.208** |
| **예산 기준** | retry·실패·fraud·지역 차이 포함 | **$0.25/캠페인** |
| **스트레스 기준** | SMS 재전송·초과 트래픽이 큰 경우 | **$0.50/캠페인** |

핵심 비용 KPI는 `Cost per Published Campaign`이며 정상 기준 $0.25, hard investigation threshold $0.50로 둔다. 캠페인이 draft에서 중단되더라도 이미 발생한 OTP·AI 비용은 별도로 `Cost per Started Campaign`에 포함한다.

### 월 고정비 기준

| 항목 | 월 환산 |
|---|---:|
| Supabase Pro | $25.00 |
| Vercel Pro | $20.00 |
| Apple Developer Program | $8.25 |
| 도메인·DNS 예비비 | 약 $2.00 |
| RevenueCat·PostHog·Cloud Run | 초기 무료 구간 내 $0 가정 |
| **기준 고정비** | **약 $55/월** |

법률 자문, 유료 디자인 자산, 광고비, 상헌 님의 개발 노동비, 환율·세금은 이 표에 포함하지 않는다. 특히 데이팅·신원 데이터 서비스의 전문 법률 검토는 기술 운영비와 분리된 선택 예산으로 취급한다.

### 손익분기 계산

Small Business Program의 15% 수수료가 적용된다고 가정한다.

```text
$4.99 Creator Launch 순매출 = $4.99 × 0.85 = $4.2415
$19.99 Pass 순매출 = $19.99 × 0.85 = $16.9915

월 손익 = creator_launch_count × $4.2415
          + campaign_pass_count × $16.9915
          - published_campaigns × $0.25
          - $55
```

월 100개 published campaigns에서는 고정비와 변동비를 합쳐 약 $80이 필요하다.

| 100 campaigns 상품 혼합 | App Store 순매출 | 월 손익 |
|---|---:|---:|
| 모두 무료 | $0.00 | -$80.00 |
| Creator Launch 5%, Pass 0% | $21.21 | -$58.79 |
| Creator Launch 10%, Campaign Pass 3% | $93.39 | +$13.39 |
| Creator Launch만 20% | $84.83 | +$4.83 |

따라서 `$4.99 Creator Launch`도 충분히 손익 구조를 만들 수 있다. 다만 무료 캠페인 100개를 Creator Launch 하나만으로 보전하려면 약 19개, 즉 약 19%가 구매해야 한다. 더 현실적인 초기 혼합 목표는 **Creator Launch 구매 10%와 Campaign Pass 구매 3%**다. 두 상품은 서로 다른 사용자가 독립적으로 구매하며 이 조합에서는 약 $13.39의 월 기여이익이 남는다.

무료 Starter는 유지한다. 위 표는 무료 제공을 없애기 위한 근거가 아니라 무료 코호트의 정확한 비용을 알고 유료 제작 기능으로 보전하기 위한 운영 기준이다. App Store 수수료가 30%라면 손익분기는 더 나빠지므로 Small Business Program 승인을 출시 전 체크리스트에 넣는다.

이 계산은 광고 획득비용(CAC)이 $0인 organic/referral 중심 모델이다. 유료 광고를 시작하면 `CAC ≤ 90-day contribution margin`이 입증되기 전에는 캠페인을 확대하지 않는다.

### 필요한 초기 버짓

#### 기술 출시 최소 버짓: 약 $500~600

- Apple Developer Program: $99
- 도메인: $12~20/년
- Supabase + Vercel 3개월: $135
- API 사용량 500 published campaigns 기준: 약 $125
- AI·render·SMS 가격 오차와 테스트 재시도 버퍼: 약 $150~200

이 금액은 기능을 출시할 수 있는 최소치이며 장애·fraud·스토어 지연에 취약하다.

#### Shipaton 권장 버짓: **$1,000~1,500**

- 위 최소 기술비 약 $500~600
- 공급자 청구·SMS abuse·렌더 실패 대응 reserve $300~500
- 스토어·정책·테스트 장비·예상하지 못한 유료 도구 reserve $200~400

전문 법률 자문을 받는다면 별도 예산으로 잡는다. Android 동시 출시, 유료 마케팅, 전문 영상·브랜딩도 이 권장 버짓에 포함하지 않는다.

### 비용 폭주 방지 설계

1. **Render late**: preview는 브라우저 client-side motion으로 보여주고 서버 MP4는 Dater 최종 승인 후 1회만 생성한다.
2. **Verify late**: Dater는 승인 직전, Interested Person은 프로필을 모두 작성한 뒤 제출 직전에 liveness를 실행한다.
3. **One free campaign**: verified Dater당 무료 활성 캠페인 1개, 기본 테마, server re-cut 없음으로 제한한다.
4. **Finite free cohort**: 초기 무료 캠페인은 월 100개처럼 명시된 예산 슬롯으로 운영하고 소진 후 waitlist 또는 다음 달 발급으로 전환한다. 기존 캠페인과 안전 기능은 중단하지 않는다.
5. **Lifecycle deletion**: 원본 음성·실패 렌더는 승인 후 7일, 만료 캠페인의 대형 export는 grace period 후 삭제한다.
6. **Rate limit**: 전화번호·device·IP·campaign 기준 OTP, AI generation, liveness, render 횟수를 제한한다.
7. **Provider caps**: Cloud Run max instances, Twilio usage trigger, AWS Budget, OpenAI project budget, Supabase/Vercel spend alert를 설정한다.
8. **Kill switch**: 신규 campaign creation, render, SMS를 각각 독립적으로 일시 중지할 수 있게 한다. 신고·차단·삭제·기존 채팅은 유지한다.
9. **No automatic re-render**: 추가 Vouch Card가 생겨도 MP4를 자동으로 다시 만들지 않는다.
10. **No paid acquisition before proof**: organic cohort에서 activation, paid conversion, cost per campaign을 확인하기 전 광고를 집행하지 않는다.

### 재무 운영 게이트

- 매일: provider별 spend, failed OTP/render, fraud anomaly
- 매주: campaign cohort revenue, variable cost, gross contribution, refund
- 월간 hard cap: 출시 초기 전체 cloud/API 비용 **$200**. 75% 도달 시 신규 무료 슬롯 축소, 90%에서 유료·기존 안전 경로를 제외한 고비용 작업 중지
- 가격 유지 조건: Creator Launch ≥ 10%와 Campaign Pass ≥ 3%, 또는 동일한 contribution을 만드는 독립 상품 조합
- 구조 재검토 조건: 2주 연속 cost per published campaign > $0.50, refund > 5%, 또는 전체 paid product conversion < 8%
- 가격 실험은 한 번에 하나만 바꾸며 cohort별 App Store 순매출로 계산

---

## Solution Evaluation / Measurement Plan

### North Star

**Accepted Intro Rooms per Published Campaign**

다운로드나 조회만으로는 가치가 증명되지 않는다. 하나의 승인된 캠페인이 실제로 몇 개의 상호 대화로 전환되는지가 핵심이다.

### 핵심 퍼널 이벤트

```text
introducer_started
voice_recorded
draft_generated
consent_sent
dater_verified
draft_changes_requested
pitch_approved
campaign_published
campaign_shared
pitch_viewed_unique
interest_started
interest_verified
interest_submitted
interest_accepted
intro_room_created
first_message_sent
creator_launch_paywall_viewed
creator_launch_purchased
creator_launch_credit_consumed
campaign_pass_paywall_viewed
campaign_pass_purchased
report_submitted
user_blocked
campaign_paused
campaign_expired
```

모든 이벤트는 `campaign_id`, acquisition source, platform, app version, locale, experiment variant를 포함하되 민감한 음성·사진·메시지 내용은 analytics에 보내지 않는다.

### 초기 가설과 판정선

| 가설 | 초기 판정선 | 실패 시 행동 |
|---|---:|---|
| 친구는 짧은 음성으로 시작할 수 있다 | start→voice completion ≥ 50% | 질문 수와 가입 단계를 줄임 |
| Dater가 타인의 소개를 승인할 의향이 있다 | consent sent→published ≥ 40% | 초대 카피·통제권·private preview 개선 |
| 피치는 공유할 가치가 있다 | published campaign당 median 5+ external viewers | 결과물 품질·share preview·Introducer 보상 수정 |
| 외부 시청자가 관심 표현을 한다 | unique view→interest submitted ≥ 2% | CTA, 필수 프로필 길이, 신뢰 설명 개선 |
| 관심 표현이 대화로 이어진다 | submitted→accepted ≥ 20% | 관심 프로필 정보·필터 개선 |
| 공유가 새 캠페인을 만든다 | campaign K-factor ≥ 0.3 | `Pitch a friend` 후속 CTA와 referral 개선 |
| 사용자가 캠페인 기능에 결제한다 | activated→paid ≥ 3% | 가격보다 가치 패키지와 타이밍 먼저 수정 |

판정선은 목표이지 외부 시장 사실이 아니다. 첫 20개 캠페인 후 실제 분포로 다시 설정한다.

### Grand Prize 증거 패키지

Devpost 제출 전에 다음을 하나의 재현 가능한 대시보드와 `docs/GROWTH_EVIDENCE.md`에 모은다.

- 출시일부터 일별/주별 verified users
- published campaigns와 승인율
- unique external viewers와 acquisition source
- verified interests, accepted Intro Rooms, first-message rate
- 새로운 캠페인을 만든 referral 수와 K-factor
- payer 수, gross revenue, refund, paywall conversion
- 앱스토어 rating/review 수
- BuildInPublic 포스트 URL, impressions, comments, 실제 반영된 피드백
- 출시 후 변경한 기능과 전후 지표
- fraud/report/block 지표와 처리 시간

---

## 안전·동의·스토어 정책

### 18+ 정책

10대는 타깃이 아니다. Google Play는 core dating/matchmaking 앱에 미성년자 차단 기능 사용을 요구하며, Social/Dating 카테고리는 성인 앱이어도 [Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en)를 준수해야 한다.

- 마케팅 타깃: 21~34세, 제품 사용 최소 연령: 18세
- Play Console의 Restrict Minor Access 사용
- 우회하기 쉬운 생년월일 입력만으로 끝내지 않고 전화·신원 확인 공급자와 age assertion 결합
- 공개된 CSAE/CSAM 정책, 인앱 신고, child safety contact 필수

### UGC 정책

Apple [Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/)와 Google Play [UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB)를 기준으로 다음을 P0에 포함한다.

- Terms 및 Community Guidelines 동의
- 업로드 전후 objectionable content 필터
- 콘텐츠·사용자 신고
- 1:1 대화 사용자 차단
- 운영자가 확인할 moderation queue
- 공개 support contact
- 신고 대응 SLA와 audit log
- 외모 점수, hot-or-not 투표, 익명 댓글 금지

### AI와 개인정보

- 음성·사진을 외부 AI 공급자에게 보내기 전 처리 목적과 공급자 공유를 명시하고 동의받는다.
- AI는 친구 발언을 더 강한 사실로 변형하지 않는다. 범죄 이력, 건강, 성생활, 재산, 직업, 학력 등 민감·객관 주장에는 Dater 확인을 요구한다.
- AI 결과는 공개 전 인간이 편집하고 Dater가 최종 승인한다.
- 원본 음성은 승인·렌더 완료 후 짧은 보존 기간 뒤 삭제하고, 사용자가 즉시 삭제할 수 있게 한다.
- 공개 pitch asset과 원본 media bucket을 분리하고 signed URL과 최소 권한을 사용한다.
- 정확한 위치, 전화번호, 이메일, 법적 이름, 신원확인 원본을 public payload에 포함하지 않는다.
- 정부 신분증을 자체 저장하지 않고 가능한 경우 검증 공급자가 처리하도록 한다.

### Fake 소개 위협 모델

공격 예: Introducer가 무관한 사람 A의 사진으로 피치를 만들고 공모자 B가 승인한다.

완화:

1. Dater의 selfie liveness와 공개 대표 사진 face match
2. 모든 사진에 대한 Dater 개별 승인
3. Introducer와 Dater의 별도 전화 확인
4. 두 계정의 위험 신호 및 반복 신고 감지
5. `Verified Dater`는 계정·얼굴 일치만 의미하며 성격이나 안전 보증으로 설명하지 않음
6. 관심 표현자에게도 동일한 기본 얼굴/전화 확인 적용

이 설계도 공모·도난 신분·합성 미디어를 완전히 제거하지 못한다. “safe”나 “background checked”를 검증 범위 이상으로 광고하지 않는다.

---

## [엔지니어링 / 프로덕트 구현] - Solution Scaffolding

### Claude에게 주입할 해커톤 컨텍스트

Claude는 개발을 시작하기 전에 이 문서와 최신 공식 Rules를 읽고 다음 제약을 작업 계획 상단에 고정한다.

- 첫 공개 release는 2026-08-01 이전이면 안 된다.
- 늦은 완성보다 빠른 1.0 출시와 출시 후 성장 iteration이 중요하다.
- RevenueCat 구매가 실제 sandbox와 production path에서 작동해야 한다.
- 2분 데모에서 전체 핵심 루프를 보여줄 수 있어야 한다.
- Friendword의 차별화는 friend-backed profile이 아니라 share-first consented voice campaign이다.
- 안전·동의·신고를 데모 후순위 장식으로 미루지 않는다.

### 권장 기술 선택

솔로 개발과 8주 성장 기간을 고려한 기본안이다. 기존 코드가 없을 때 이 안으로 시작한다.

- **Mobile**: Expo / React Native / TypeScript, iOS 우선 출시
- **Web pitch**: Next.js / TypeScript, server-rendered share page와 OG metadata
- **Backend**: Supabase Postgres, Auth, Storage, Row Level Security, Realtime
- **Media**: server-side FFmpeg 또는 Remotion renderer
- **AI boundary**: speech-to-text와 structured generation을 provider interface 뒤에 격리
- **Purchases**: RevenueCat React Native SDK + backend webhook sync
- **Notifications**: Expo Notifications, 최종 스폰서 규칙 확인 후 OneSignal 검토
- **Analytics**: PostHog 또는 동등한 event analytics + RevenueCat dashboard
- **Identity**: 외부 liveness/face-match provider를 adapter로 추상화
- **Moderation**: text/image/audio moderation provider + 내부 review queue

iOS를 먼저 출시하는 이유는 범위를 줄이기 위함이다. RevenueCat 2026 데이터에서 iOS의 global median D35 download-to-paid conversion은 2.6%, Google Play는 0.9%였다. Android는 웹 피치·백엔드 안정화 후 추가한다.

### File structure

```text
friendword/
├── README.md
├── CLAUDE.md
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── mobile/
│   │   ├── app/
│   │   ├── src/
│   │   │   ├── features/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── analytics/
│   │   │   └── safety/
│   │   └── app.config.ts
│   └── web/
│       ├── app/p/[campaignSlug]/
│       ├── app/api/og/
│       └── src/
├── packages/
│   ├── contracts/
│   ├── domain/
│   ├── ui-tokens/
│   └── config/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed.sql
│   └── tests/
├── media-worker/
│   ├── compositions/
│   └── render/
├── docs/
│   ├── PRODUCT.md
│   ├── HACKATHON_RULES.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── THREAT_MODEL.md
│   ├── COMMUNITY_GUIDELINES.md
│   ├── PRIVACY_DATA_MAP.md
│   ├── ANALYTICS_PLAN.md
│   ├── COST_MODEL.md
│   ├── GROWTH_EVIDENCE.md
│   ├── DECISIONS.md
│   └── TASKS.md
└── scripts/
    ├── verify-rules-links.*
    ├── seed-demo.*
    └── export-growth-evidence.*
```

### Core data model

```text
users
profiles
dating_profiles
introducer_profiles
pitch_drafts
pitch_assets
consent_requests
campaigns
campaign_memberships
vouches
interests
intro_rooms
messages
reports
blocks
verification_checks
purchase_events
purchase_credit_ledger
campaign_entitlements
analytics_events
provider_usage_events
cost_ledger
```

핵심 소유·관계 필드:

```text
users
- id
- auth_identity
- phone_verified_at
- account_status

profiles
- user_id
- display_name
- birth_date
- locale
- verification_status

dating_profiles
- user_id
- bio
- photos
- dating_intent
- approximate_location
- profile_updated_at

introducer_profiles
- user_id
- pseudonym
- completed_introduction_count
- unlocked_customizations

campaigns
- id
- owner_user_id              # DATER_OWNER

campaign_memberships
- campaign_id
- user_id
- role                       # DATER_OWNER | INTRODUCER | ADDITIONAL_VOUCHER
- status

pitch_drafts
- id
- created_by_user_id         # Introducer
- subject_user_id            # invitation claim 후 Dater User

interests
- campaign_id
- sender_user_id             # Interested Person

purchase_events
- purchaser_user_id
- product_id
- scope_type                 # PITCH_DRAFT | CAMPAIGN
- scope_id
```

DB와 RLS에서 다음 invariant를 보장한다.

- `users`에는 전역 역할 또는 계정 유형 필드를 두지 않는다.
- `(campaign_id, user_id)` membership 중복을 금지한다.
- published campaign당 활성 `DATER_OWNER`는 정확히 한 명이다.
- 동일 campaign에서 같은 User의 `DATER_OWNER`와 `INTRODUCER` 동시 역할을 금지한다.
- Creator Launch 구매자는 해당 pitch draft의 Introducer여야 하고 scope는 `PITCH_DRAFT`다.
- Campaign Pass 구매자는 해당 campaign의 `DATER_OWNER`여야 하고 scope는 `CAMPAIGN`이다.
- 하나의 RevenueCat App User ID는 Friendword의 `users.id`에 대응한다.

주요 상태 기계:

```text
PitchDraft:
draft → consent_pending → changes_requested → approved
      → published → paused → expired → archived/deleted

Interest:
started → verification_pending → submitted
        → accepted | declined | withdrawn | blocked

IntroRoom:
open → left | blocked | closed
```

상태 전이는 서버에서 검증한다. Introducer는 `approved` 이후 콘텐츠를 직접 바꿀 수 없고 Dater만 게시·중지·삭제할 수 있다. 이 권한은 User의 전역 role이 아니라 현재 resource의 membership과 ownership으로 판정한다.

### API 경계

- 클라이언트는 service role key를 절대 갖지 않는다.
- media upload는 짧은 만료의 signed URL을 사용한다.
- public pitch endpoint는 공개에 필요한 최소 projection만 반환한다.
- authorization은 `users.role` 같은 전역 값이 아니라 campaign membership, pitch ownership, interest sender 관계로 판정한다.
- interest profile은 해당 캠페인의 Dater와 본인만 읽을 수 있다.
- 메시지는 같은 open Intro Room 참가자만 읽고 쓸 수 있다.
- RevenueCat webhook은 authorization header, idempotency, event replay를 처리한다.
- RevenueCat webhook은 App User ID로 하나의 User를 찾은 뒤 product별 `scope_type/scope_id`와 구매 당시 resource role을 다시 검증한다.
- verification provider 결과는 원본 신분증이 아니라 status, provider reference, timestamp만 저장한다.

### README.md 초안에 반드시 포함할 내용

- 한 문장 제품 정의
- 왜 또 다른 dating app이 아닌지
- 하나의 User가 resource별 세 컨텍스트 역할을 수행하는 방식과 end-to-end flow
- 로컬 개발 및 테스트 방법
- 환경 변수 목록과 비밀 관리 원칙
- RevenueCat sandbox 설정
- 월 지출 상한과 `docs/COST_MODEL.md` 갱신 방법
- moderation/identity provider mock 사용법
- 현재 MVP 범위와 제외 범위
- 공식 Shipaton 링크와 final-rules pending 경고

### CLAUDE.md 초안 (역사 기록 — 2026-08-04 폐기)

> 아래 목록은 최초 개발 체제의 기록입니다. 현재 `CLAUDE.md`는 Friendword의 프로젝트 사실과 불변 조건만 담고, 모델·에이전트·검증 라우팅은 `fable-control-plane` 플러그인이 소유합니다.

- Claude(Fable 5)는 Advisor(orchestrator)이자 worker이며 요구사항 분석·작업 분해·설계 결정·최종 검증을 소유한다.
- tmux Codex Worker는 `friendword-codex-1`, `friendword-codex-2`, `friendword-codex-3`으로 고정한다.
- Worker brief에는 재탐색이 필요 없도록 컨텍스트, 경로, 컨벤션, 함정, 완료 조건과 테스트 명령을 포함한다.
- Worker 결과는 diff와 테스트를 Advisor가 직접 재검증하기 전까지 완료가 아니다.
- 검증 실패는 사소한 마무리를 제외하고 correction brief로 원 Worker에게 재위임한다.
- 이 문서와 `docs/DECISIONS.md`가 제품 판단의 source of truth다.
- Creator/Dater 계정 유형이나 전역 role field를 만들지 않고 resource relationship으로 권한을 판정한다.
- 경쟁 경계 다섯 가지를 훼손하는 기능 변경을 금지한다.
- 개인정보, 동의, moderation, 결제 코드는 mock으로 완료 처리하지 않는다.
- 한 번에 하나의 vertical slice를 끝내고 실제 모바일/웹 표면에서 QA한다.
- 새로운 기능 전에 scope와 metric을 명시한다.
- 불확실한 시장 사실이나 사용자 인터뷰를 만들어내지 않는다.
- Devpost 최종 규칙이 기존 문서와 충돌하면 규칙을 우선하고 변경을 기록한다.

### AGENTS.md 초안 (역사 기록 — 2026-08-04 폐기)

> 아래 고정 Codex 세션과 Advisor 재검증 체제는 더 이상 활성 정책이 아닙니다. 현재 `AGENTS.md`는 모델 독립적인 저장소 안전 규칙만 정의합니다.

- 호칭은 `상헌 님`, 한국어는 존댓말
- Advisor와 세 Codex Worker가 같은 파일을 동시에 수정하지 않음
- 각 Worker의 owned paths와 acceptance criteria를 `docs/TASKS.md`에 기록
- Worker의 완료 보고를 그대로 승인하지 않고 Advisor가 diff·test·manual QA를 재실행
- 검증 실패 시 원 Worker에게 재현 증거가 포함된 수정 브리프를 전달
- 작업 전 관련 문서·schema·call site를 읽음
- TypeScript strict, `any`, `@ts-ignore`, 무근거 type assertion 금지
- DB schema 변경은 migration과 RLS test 동반
- 동일 User의 다중 캠페인 역할 허용과 동일 캠페인 Dater/Introducer 중복 금지를 test로 보호
- UI 변경은 실제 기기/브라우저에서 manual QA
- 결제는 sandbox purchase, restore, expiration, refund path 검증
- UGC 기능은 신고·차단·moderation 경로 없이 merge 금지
- 사용자 데이터와 secret을 로그·스크린샷·Devpost 자료에 노출하지 않음
- 완료 시 변경, 검증, 남은 위험을 기록

---

## Advisor + Worker 실행 방식 (역사 기록 — 2026-08-04 폐기)

> 이 절 전체는 당시 실행 이력을 보존하기 위한 것입니다. 새 작업에 적용하지 않습니다. 현재 오케스트레이션의 단일 source of truth는 설치된 `fable-control-plane` 플러그인입니다.

### 모델 역할 분담

- **Advisor**: Claude, orchestrator이자 worker. 요구사항 분석, 작업 분해, 설계 결정과 최종 검증을 소유하면서 구현·리서치·문서작성·반복 노동도 직접 수행한다.
- **Workers**: tmux Codex 세션 `friendword-codex-1`, `friendword-codex-2`, `friendword-codex-3`. 코드·문서 작성과 수정, 테스트 작성, 구현 리서치를 Advisor와 분담한다.
- **Optional reviewer**: Advisor가 추가 독립 검증이 필요하다고 판단할 때만 Opus subagent를 생성한다. 기본 작업 흐름이나 단순 병렬화를 위해 습관적으로 생성하지 않는다.

Advisor는 단순한 작업 전달자가 아니다. 판단, 검증, 구현, 리서치, 문서작성과 필요한 노동 전부에 임한다. 다만 반복적이거나 경계가 명확한 구현·리서치·문서 작업은 Worker에게 적절히 분배하여 상헌 님의 처리 한계를 확장한다.

### Advisor가 직접 소유하는 일

1. 요구사항을 제품 목표·제약·위험으로 해석한다.
2. 작업을 독립적으로 검증 가능한 vertical slice로 분해한다.
3. 아키텍처, 데이터 경계, 제품 정책, 안전·비용 trade-off를 결정한다.
4. 필요한 구현·리서치·문서작성 작업을 직접 수행한다.
5. Worker에게 전달할 decision-complete brief를 작성한다.
6. Advisor가 직접 구현한 변경은 Advisor가 직접 테스트하고 matching surface에서 확인한다.
7. 필요하면 Opus subagent에게 독립 검증을 요청하되, 최종 판단을 위임하지 않는다.
8. 모든 Worker 결과의 diff를 직접 읽고 테스트를 직접 실행한다.
9. 통합된 end-to-end 흐름과 비용·보안 경계를 직접 검증한다.
10. 상헌 님에게 변경, 증거, 남은 위험과 다음 결정을 보고한다.

### Worker와 분담하는 일

- 기능 코드와 테스트 작성·수정
- schema, migration, RLS policy와 test 작성
- UI, API, media worker, analytics 구현
- 문서 초안·업데이트와 근거 리서치
- 회귀 조사, fixture·seed·Devpost asset 자동화

작업의 중요도가 낮아서 Worker에게 주는 것이 아니다. Advisor가 이미 결정한 경계 안에서 독립적으로 구현·검증할 수 있기 때문에 분담한다.

### Worker brief 필수 형식

Advisor는 Worker가 같은 내용을 다시 탐색하지 않도록 이미 파악한 컨텍스트를 브리프 안에 전달한다. 모든 브리프에는 다음 항목이 있어야 한다.

```text
TASK
한 문장으로 정의한 결과물

WHY / CONTEXT
제품 목표, 사용자 흐름, 이미 내려진 결정, 관련 위험

SCOPE
수정 가능한 정확한 파일 경로와 소유 범위

OUT OF SCOPE
건드리면 안 되는 기능·파일·정책

CONVENTIONS
프로젝트 구조, 타입·오류 처리·테스트·로그 규칙

KNOWN TRAPS
동의, RLS, idempotency, 비용 호출, 기존 실패 등 알려진 함정

ACCEPTANCE CRITERIA
관찰 가능한 완료 조건

REQUIRED VERIFICATION
통과해야 할 명령, 테스트, manual QA surface

RETURN FORMAT
changed files, diff summary, test output, residual risks
```

Worker에게 “이 기능을 알아서 구현하라”처럼 재탐색과 제품 결정을 떠넘기는 브리프를 주지 않는다. 모호한 설계 결정이 남아 있다면 Advisor가 먼저 결정하거나, 선택지와 판단 기준을 명시한 조사 태스크로 분리한다.

### 세 Worker 세션 운영 규칙

1. `friendword-codex-1`, `friendword-codex-2`, `friendword-codex-3`에는 동시에 겹치는 파일을 배정하지 않는다.
2. `docs/TASKS.md`에 session, owned paths, dependency, acceptance criteria와 상태를 기록한다.
3. dependency가 있는 태스크는 선행 diff가 Advisor에게 승인되기 전에 시작하지 않는다.
4. 공통 contract나 schema를 바꾸는 Worker는 소비자 목록과 migration 영향을 브리프에서 받는다.
5. Worker는 범위 밖 문제를 발견하면 임의 수정하지 않고 증거와 함께 반환한다.
6. 장시간 작업은 중간 산출물을 commit으로 간주하지 않는다. Advisor 승인 전까지 완료가 아니다.

### 검증·승인 경계

- **Worker의 완료 보고를 그대로 믿지 않는다.** Advisor가 실제 diff와 호출 경로를 읽는다.
- Worker가 제시한 테스트 로그만으로 승인하지 않는다. Advisor가 같은 테스트를 직접 실행한다.
- UI는 실제 앱/브라우저, API는 실제 요청, 결제는 sandbox purchase와 webhook, media는 실제 render 결과로 확인한다.
- 테스트가 통과해도 요구사항·동의·비용·RLS 경계를 위반하면 reject한다.
- 검증이 실패하면 원인, 재현 명령, 기대 결과를 담은 **수정 브리프를 원 Worker에게 재위임**한다.
- Advisor의 직접 수정은 오탈자, import, 명백한 한두 줄 연결처럼 사소한 마무리에만 허용한다. 설계나 동작이 바뀌는 수정은 Worker에게 재위임한 뒤 다시 검증한다.
- Advisor가 직접 작성한 구현에는 위 재위임 규칙을 적용하지 않으며, Advisor가 직접 수정·검증하고 필요 시 Opus reviewer의 독립 검증을 받는다.

### 기본 실행 루프

```text
Advisor understands → decides → decomposes → writes briefs
→ Advisor/Workers execute within owned paths
→ Workers return evidence
→ Advisor reads diffs + reruns tests + performs manual QA
→ approve OR return correction brief
→ integrate → end-to-end verification → report to 상헌 님
```

결정이 바뀌면 `docs/DECISIONS.md`에 날짜, 이유, 검토한 대안, 비용·안전·일정 영향과 변경된 Worker brief를 남긴다.

### 첫 구현 순서

1. repo, lint/typecheck/test, CI와 환경 변수 검증
2. schema, RLS, mock seed
3. Introducer draft + audio capture
4. Dater consent + verification adapter
5. AI structured draft + editable approval
6. public web pitch + share attribution
7. verified interest flow
8. Intro Room + report/block
9. RevenueCat sandbox purchase + expiration
10. analytics dashboard + growth evidence export
11. store metadata, privacy, community/child safety pages
12. TestFlight closed beta → manual release after 2026-08-01

각 단계는 화면·API·DB·analytics가 연결된 vertical slice로 끝내야 한다. 화면만 만들고 다음 단계로 넘어가지 않는다.

---

## [확장 및 자동화] Loop Engineering

### 1. Product Loop

```text
hypothesis → smallest experiment → instrument → ship → observe
→ keep/change/kill decision → DECISIONS.md
```

- 기능마다 해결할 퍼널 단계와 성공 지표가 있어야 한다.
- 20개 캠페인 전에는 추천 알고리즘과 대규모 확장을 만들지 않는다.
- 사용자 요청 수보다 실제 중단 지점과 전환율을 우선한다.

### 2. Growth Loop

```text
friend creates → dater approves → campaign shared
→ viewer expresses interest OR starts another pitch
→ new verified user/campaign → more sharing
```

- 모든 링크에 source와 referrer를 기록한다.
- 피치 종료 화면에는 `Pitch a friend`와 `Create my Friendword`를 분리해 제공한다.
- BuildInPublic 포스트는 기능 홍보보다 실제 학습·실패·지표 변화를 보여준다.
- 자동화는 초안을 만들 수 있지만 게시에는 상헌 님의 승인이 필요하다.

### 3. Safety Loop

```text
filter → user report → triage → action → appeal/audit
→ rule/model update → regression test
```

- high severity 신고는 즉시 노출 중지 후 검토한다.
- 반복 신고 사용자·캠페인·device risk signal을 묶어 본다.
- moderation false positive/negative 샘플을 비식별화해 주기적으로 검토한다.
- 안전 지표 악화 시 성장 기능보다 우선해 수정한다.

### 4. Revenue Loop

```text
paywall impression → package selection → purchase result
→ entitlement usage → campaign outcome → expiry/repurchase
```

- 단순 결제 전환뿐 아니라 유료 캠페인이 더 많은 accepted intro를 만드는지 측정한다.
- paywall 카피, 가격, 노출 시점을 한 번에 하나씩 실험한다.
- 구매·환불·만료 오류를 자동 경고한다.

### 5. Rule & Release Loop

- Shipaton Rules 페이지 변경 감지
- App Store review 상태와 release date 확인
- privacy manifest, data safety form, age rating 체크리스트
- 매 release마다 핵심 E2E와 결제 sandbox smoke test
- Devpost 제출 자산 누락 검사

### 권장 자동화

| 자동화 | 주기/트리거 | 출력 | 사람 승인 |
|---|---|---|---|
| Shipaton rule monitor | 매일 또는 공식 공지 발생 | 변경 diff와 영향 | 필요 |
| Growth digest | 매일 | 퍼널, WoW, anomaly | 불필요 |
| Moderation alert | high severity report | 운영 큐/알림 | 조치 필요 |
| Purchase health | webhook failure/refund spike | incident alert | 조치 필요 |
| Cost guardrail | provider usage 또는 월 예산 75/90% | 비용 diff, 원인, kill-switch 제안 | 고비용 작업 중지 시 필요 |
| BuildInPublic draft | 주요 release/학습 | 영어 포스트 초안 | 게시 전 필수 |
| Competitor monitor | 주 1회 | Vouched/Wingman/Chorus 변화 | 전략 변경 시 필요 |
| Store asset check | release candidate | icon/screenshot/privacy 누락 | 제출 전 필수 |

자동화는 판단을 대신하지 않는다. 특히 사용자 신고 조치, 외부 게시, 결제 환불, 계정 정지는 항상 사람이 승인한다.

---

## 현실적인 일정

### 2026-07-12 ~ 07-18: Foundation

- 최종 Rules 모니터 시작
- click-through prototype과 5쌍 concierge test 모집
- repo/scaffold/schema/RLS
- store identity, bundle ID, privacy/community policy 초안

### 2026-07-19 ~ 07-31: Closed Beta Build

- Introducer→Dater approval→public pitch vertical slice
- verified interest와 최소 Intro Room
- RevenueCat sandbox
- TestFlight와 App Review 제출
- **수동 release를 설정해 8월 1일 전 공개되지 않도록 함**

### 2026-08-01 ~ 08-10: 1.0 Launch

- 가능한 한 이른 공개 출시
- founding 20 campaigns concierge onboarding
- 매일 funnel review와 치명적 마찰 수정

### 2026-08-11 ~ 09-15: Growth Iteration

- Vouch Cards, share kit, analytics, paywall experiment
- referral loop와 BuildInPublic
- 실제 피드백을 반영한 주 1회 이상 release

### 2026-09-16 ~ 09-30: Evidence & Submission

- 안정화와 안전 QA
- 2분 demo recording
- growth evidence export
- promo unlock 확인
- Devpost 필드와 최종 규칙 대조
- 09-30 23:45 PDT 이전 제출

---

## Claude가 개발 전에 반드시 답해야 할 질문

다음은 상헌 님에게 다시 아이디어를 묻기 위한 질문이 아니라, Claude가 코드와 공식 자료를 확인해 결정 문서로 남겨야 할 항목이다.

1. iOS non-renewing subscription과 Android prepaid plan을 RevenueCat entitlement로 어떻게 일관되게 만료시킬 것인가?
2. 선택할 identity provider가 liveness, face match, age assertion, 미국/캐나다 지원, 데이터 보존에서 어떤 차이가 있는가?
3. 공개 pitch의 media rendering을 Remotion/FFmpeg 중 무엇으로 구현하며 60초 렌더 latency와 비용은 얼마인가?
4. app/web 간 인증 deep link와 campaign attribution을 어떻게 보존할 것인가?
5. 공개 전 text/image/audio moderation과 신고 후 moderation의 공급자·실패 정책은 무엇인가?
6. App Review가 요구하는 meaningful differentiation를 메타데이터와 2분 데모에서 어떻게 증명할 것인가?
7. 최종 Official Rules가 공개된 뒤 현재 가정 중 무엇이 변경되었는가?

---

## 최종 제품 판단

Friendword는 friend-assisted dating의 최초 제품이 아니다. Vouched, Wingman, Chorus, Dear Real과 같은 선행 제품이 존재한다. 그러므로 “친구가 추천한다”만 구현해서는 제품적으로도, Apple 심사에서도, Shipaton Grand Prize에서도 부족하다.

Friendword가 이길 수 있는 유일하게 설득력 있는 방향은 다음 문장에 모두 들어 있다.

> **A friend speaks once. The dater stays in control. The story travels beyond the dating app. Every interested person shows who they are before contact begins.**

즉, 친구의 자연스러운 음성, 당사자의 강한 동의권, 외부 공유 가능한 콘텐츠, 검증된 관심 표현, 인앱 안전 대화, 캠페인 단위 수익화가 하나의 짧고 측정 가능한 루프로 연결되어야 한다. 이 루프를 먼저 완성하고 실제 성장 수치를 만드는 것이 모든 부가 기능보다 우선한다.

---

## Sources

### Shipaton / RevenueCat

1. [RevenueCat Shipaton 2026 – Devpost Overview](https://revenuecat-shipaton-2026.devpost.com/)
2. [RevenueCat Shipaton 2026 – Rules](https://revenuecat-shipaton-2026.devpost.com/rules)
3. [RevenueCat – Announcing Shipaton 2026](https://www.revenuecat.com/blog/company/announcing-shipaton-2026/)
4. [RevenueCat – Shipaton 2025 Winners](https://www.revenuecat.com/blog/company/shipaton-2025-winners/)
5. [RevenueCat – State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)
6. [RevenueCat – Non-Subscription Purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)
7. [RevenueCat – Webhooks](https://www.revenuecat.com/docs/integrations/webhooks)

### Market / Safety

8. [Pew Research Center – Online Dating in the U.S.](https://www.pewresearch.org/internet/2023/02/02/from-looking-for-love-to-swiping-the-field-online-dating-in-the-u-s/)
9. [FTC – 2025 Social Media Scam Data](https://www.ftc.gov/news-events/news/press-releases/2026/04/new-ftc-data-show-people-have-lost-billions-social-media-scams)
10. [U.S. Census – QuickFacts, United States](https://www.census.gov/quickfacts/fact/table/US/HSG010224)
11. [U.S. Census – The Single Life](https://www.census.gov/content/dam/Census/library/visualizations/2024/comm/the-single-life.pdf)
12. [Bumble – FY2025 Results](https://ir.bumble.com/financials/quarterly-results/)

### Competitors

13. [Vouched](https://gotvouched.com/)
14. [Wingman FAQ](https://www.wingmanapp.com/faq)
15. [Chorus – How It Works](https://getchorus.co/how-it-works)
16. [Pitch-A-Friend](https://www.pitch-a-friend.com/)
17. [Dear Real – Help / Product Guide](https://www.dearreal.com/help/)

### Store / Platform Policy

18. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
19. [Apple – Non-Renewing Subscriptions](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-non-renewing-subscriptions)
20. [Google Play – Create and Manage Subscriptions](https://support.google.com/googleplay/android-developer/answer/140504?hl=en)
21. [Google Play – User-Generated Content Policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB)
22. [Google Play – Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en)
23. [Google Play – Age-Restricted Content and Functionality](https://support.google.com/googleplay/android-developer/answer/16302250?hl=en)

### Cost / Infrastructure Pricing

24. [Apple Developer Program – Membership Details](https://developer.apple.com/programs/whats-included/)
25. [Apple – App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/)
26. [RevenueCat – Pricing](https://www.revenuecat.com/pricing)
27. [Supabase – Pricing](https://supabase.com/pricing)
28. [Vercel – Pricing](https://vercel.com/pricing)
29. [PostHog – Product Analytics Pricing](https://posthog.com/)
30. [Twilio – Verify Pricing](https://www.twilio.com/en-us/verify/pricing)
31. [AWS – Rekognition Pricing](https://aws.amazon.com/rekognition/pricing/)
32. [OpenAI – Moderation Endpoint Pricing](https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use)
33. [OpenAI – GPT-4o mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe)
34. [Google Cloud – Cloud Run Pricing](https://cloud.google.com/run/pricing)
