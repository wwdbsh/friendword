# Friendword 폭발적 성장 플레이북 — Shipaton 2026 (2026-09-08 작성)

> 이 문서는 **개발이 아니라 성장**의 전략과 액션 플랜이다. 사실과 가설을 구분한다: 저장소 문서와 외부 출처가 있는 것만 사실로 쓰고, 나머지는 `[가설]`로 표시한다. 외부 출처는 각 절 끝에 링크로 둔다. 수치 목표는 검증 단위(첫 20캠페인)에서 갱신한다.

---

## 0. 한 문장 결론

**Friendword는 이미 틱톡에서 자생적으로 유행 중인 "내 싱글 친구 소개해요(drop your info)" 영상 포맷을 제품화한 것이다.** 우리가 할 일은 새로운 행동을 가르치는 것이 아니라, **이미 일어나는 행동에 "동의·검증·수신함"을 붙여 더 안전하고 더 잘 되게 만드는 것**이다. 성장 전략의 전부는 이 한 줄에서 나온다: _"댓글창 대신 친구가 통제하는 수신함."_

## 0.5 제품 진실 — 마케팅이 딛고 설 사실 (저장소 원문 기준)

- **행동**: Dater(싱글 친구)는 자기 프로필을 쓰지 않는다. Introducer가 iOS에서 **30~60초 실제 목소리**로 소개하고 사진을 제안하면, AI가 녹음을 hook·관계·특징 3·일화·어울리는 상대로 구조화한다. Dater는 **사진·문구·오디오를 하나씩 승인**하고 위치 정밀도·의도·종료일을 정한 뒤에야 공개 URL이 생긴다. 시청자는 **가입 없이** 세로 링크를 보고, 관심을 보내려면 사진·바이오·나이·성인 확인이 든 프로필이 필요하다. 수락하면 텍스트 전용 Intro Room이 열리고 전화·이메일은 자동 공유되지 않는다.
- **차별점의 실체**: 바이오 없음, AI 아바타·보이스클론 없음, 공개 피드·평점 없음. 낯선 사람의 *진짜 친구*가 *진짜 목소리*로 보증하는 것을 듣는다. 공개 페이지의 배지 **"Approved by the person being introduced"** 는 장식이 아니라 구조다.
- **공유 객체**: `friendword.com/p/<slug>` + 1080×1920 MP4(승인된 타임라인 뒤에 1.5초 엔드카드: 브랜드 + 페이지 주소만, **이름·문구 없음**, 오디오 무손실). 캠페인당 무료 렌더 1회. 캡션 팩 3종(예: _"A real friend's voice. No bios written at 1am."_, _"I recorded a pitch about my favorite person. Listen before you swipe."_), 링크는 `?src=creator-kit` 고정.
- **귀속**: `?src=`는 세션에 심겨 `pitch_viewed_unique`·`interest_started`에 붙고, `?ref=<slug>`는 첫 터치로 저장돼 로그인 시 `claim_referral`(사용자당 1출처) → 다음 발행 캠페인에 서버 트리거로 `new_campaign_id`가 찍힌다(클라이언트 위조 불가).
- **성장 플랜이 지켜야 할 공백**: 푸시 알림 없음(이메일만, 문구에 "soon/will reply" 같은 시점 약속 금지), 웹 창작 없음(iOS 앱만), iOS 전용·미제출, 한국어 UI 없음, 실사용자·매출 0, 소유자당 라이브 캠페인 1개, 유료 획득은 유기적 CAC 검증 전 금지. 데모 인물 Blair/Maya(Brooklyn, "Friends for 6 years")는 항상 "Demo data" 라벨로만 쓴다.
- **표면 문구(브랜드 보이스)**: "Say it like only you can — Record 30–60 seconds in your own voice. Tell one vivid story, not a résumé." / "Your mix is ready to send!" / "Turn the pitch into a launch." / "Sharing this pitch is free and always will be." — 믹스테이프·트랙·릴리스 데이 은유(Hype Mixtape).

---

## 1. 우리가 겨루는 판 — Shipaton 2026이 실제로 보상하는 것

| 상                                            | 무엇을 보나(원문 발췌)                                                                                                                                                                                                                                                   | 우리 적합도                                                                               | 노릴 것인가                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Grand Prize $100k**                         | 제출 기간 내 **RevenueCat 매출 총액으로 후보(shortlist)** 선정 → 후보 중 "Early and Effective Release" + "Growth by numbers"(installs, active users, paying, conversion, retention, waitlist, social reach, community)로 심사. "post-release growth"를 명시적으로 묻는다 | 매출 창이 짧음(결제 활성 시점 의존). 후보 진입은 어렵지만 서사는 강함                     | **서사와 수치는 반드시 준비**, 후보 진입은 결제 활성 시점(§8)에 달림 |
| **Most Viral (Noise) $15k**                   | Virality(Noise에서 UGC 플레이북으로 바이럴 게시물 생성), Scalability(반복 가능한 포맷), Conversion relevance                                                                                                                                                             | **최적합**. 우리 제품 자체가 UGC 포맷이고, Ship Kit에 **Noise $1,000 매칭 크레딧**이 있음 | **1순위 타깃**                                                       |
| **Growth Loop (Layers) $15k**                 | 특정 청중·가설, Layers SDK 설치·검증, 루프(메시지·채널·실험·결과), 학습                                                                                                                                                                                                  | 루프가 명확(캠페인 URL·?ref 귀속). SDK 설치는 소규모 개발                                 | **2순위**(SDK 설치 30분 수준이면 진행)                               |
| **#BuildInPublic $30k**                       | 과정 공유의 창의성(팔로워 수 무관), 커뮤니티 반응으로 앱에 반영한 것, 배운 것                                                                                                                                                                                            | 오늘 밤 같은 자율 QA·수리 서사가 이미 소재. 다만 **공개 게시물 링크 제출 필수**           | **2순위** — 매일 1포스트, Devpost에 링크                             |
| **HAMM $20k**                                 | 명확·현실적·확장 가능한 수익 흐름, 표준을 넘는 모델, 지속성·차별성                                                                                                                                                                                                       | "공유는 무료, 더 멀리·더 오래만 유료" + 소모성 2종 + 구독 거부는 차별적                   | **3순위** — 제출문에 논리 정리                                       |
| **Idea to Income (Replit) $15k**              | 주간 매출·거래 **성장률**(총액 아님), 유료 사용자, craft, social pull                                                                                                                                                                                                    | 0에서 시작하므로 성장률 서사 유리                                                         | 조건 확인(Replit 사용 요건이면 제외)                                 |
| **Keep Them Coming Back (OneSignal)**         | 푸시 통합 품질·가치·창의성                                                                                                                                                                                                                                               | 푸시는 non-goal                                                                           | 제외                                                                 |
| Design / Peace / Catvertising / Funnel Vision | —                                                                                                                                                                                                                                                                        | 디자인은 후보(Hype Mixtape), 나머지 부적합                                                | Design은 스크린샷·영상 품질로 자연 응모                              |

**2025 수상작이 알려주는 것**(RevenueCat 공식 발표):

- Grand Prize _Payout_: 17,000 users · $30,017 revenue · 1,750 paying · 500k+ social impressions — 심사평은 "technical audacity and tangible real-world impact".
- Buzziest Launch _ReadHim_: Instagram 밈 계정으로 한 달 520만 뷰, 230만 팔로워 틱토커 파트너십, 나이트클럽·슈퍼카·로봇개 스턴트, 승인 10일 만에 $1,100 MRR.
- #BuildInPublic _Gurwi_: 13,000 users, 1,000+ 리뷰(4.9). 2·3위는 X·TikTok에 **매일** 과정 공유.
- RevenueCat의 공식 조언: "Target 100 paying customers during Shipaton", 마이크로 인플루언서(수백 팔로워)가 대형 계정보다 낫다, Discord/Reddit 니치 커뮤니티, 초기 사용자에게 직접 DM·리뷰 요청.

출처: [Devpost 규칙](https://revenuecat-shipaton-2026.devpost.com/rules), [2025 수상작](https://www.revenuecat.com/blog/company/shipaton-2025-winners), [How to win Shipaton part 3](https://www.revenuecat.com/blog/engineering/how-to-win-shipaton-part-3-growing-your-app/), [Ship Kit](https://www.shipaton.com/ship-kit), [ReadHim 사례](https://www.einnews.com/pr_news/866676286/vibecoding-goes-mainstream-at-this-year-s-shipaton-from-revenuecat)

---

## 2. 시장 신호 — 왜 지금, 왜 이 형태인가 (사실)

1. **댓글 매치메이킹은 이미 틱톡의 장르다.** "She's 27, loves hiking and horror movies, drop your info below" — 크리에이터가 싱글 친구 대신 올리고 댓글창이 데이팅 포럼이 되는 포맷. 변형: "Tag 3 single friends", "Repost to be seen locally". ([sofiadate 정리](https://www.sofiadate.com/type-dating/dating-on-tiktok), [TikTok #matchmaking](https://www.tiktok.com/tag/matchmaking))
2. **스와이프 피로는 측정된 사실이다.** Censuswide(18–35세 14,503명, 2025-12~2026-01): 주당 29+ 프로필 스와이프, **싱글의 64%가 친구의 추천을 신뢰**. 다른 조사들: Gen Z 48%가 작년 모든 데이팅 앱 삭제, 70%+ 번아웃. ([adjust](https://www.adjust.com/blog/state-of-dating-apps/), [rollingout 2026-03](https://rollingout.com/2026/03/14/dating-apps-losing-users/), [medium 2026](https://medium.com/insights-from-the-abnormal-gen-z/is-gen-z-dating-app-fatigue-real-in-2026-3a6ad894875f))
3. **대형 앱이 같은 방향으로 움직인다** — Tinder Double Date(2025-06), Hinge Friend's Take(친구가 프로필에 음성·영상 답변). 우리는 이들의 "기능"이 아니라 "출발점"이다: 친구가 먼저 말하고, 당사자는 승인만 한다. ([Hinge 2025](https://hinge.co/newsroom/hinge-2025-product-evolution), [datingnews](https://www.datingnews.com/apps-and-sites/hinge-adds-a-feature-that-makes-it-easier-to-ask-someone-on-a-date/))
4. **음성은 전환을 올린다.** Hinge 음성 프롬프트 사용자는 데이트 갈 확률 80% 높음, 음성 있는 프로필은 답장 3배(업계 인용치). Gen Z에게 보이스노트는 "새 러브 랭귀지". ([GDI](https://www.globaldatinginsights.com/featured/voice-notes-feature-gaining-popularity-in-gen-z-dating/), [wokewaves](https://www.wokewaves.com/posts/gen-z-dating-etiquette-2026))
5. **한국도 같은 방향**: 셋로그(2025-12 출시, 2026-05 iOS·Android 1위, 100만+ DL)가 "단톡방에서 영상 보고 만나는" Z세대 소개팅 도구로 쓰임 — 프로필보다 자연스러운 일상, 초대 기반 폐쇄성, "알고 시작하는" 만남. ([한국경제 2026-05-23](https://www.hankyung.com/article/2026052240597), [국민일보 2026-05-05](https://www.kmib.co.kr/article/view.asp?arcid=1777972785&code=11131100&sid1=soc))
6. **친구 기반 앱의 교훈**: Match Group의 _Ship_(2019, 친구가 대신 스와이프)은 Match 계열 최고 성장 후 2022 종료("traction 부족"). *Wingman*은 살아남았고 **친구의 음성 메시지**를 추가했다. _Cerca_(2025-03, 조지타운 학생 창업)는 친구의 친구만 매칭 → 6월 2만, 10월 6만 사용자, 캠퍼스 시딩·파티·$1.6M 시드. 교훈: **친구 참여는 "스와이프 대행"이 아니라 "보증(vouch)"일 때 작동하고, 밀도 있는 작은 네트워크(캠퍼스·도시)에서 시작해야 한다.** ([GDI Ship](https://www.globaldatinginsights.com/news/match-groups-ship-no-longer-available/), [Wingman](https://www.wingmanapp.com/), [Cerca](https://www.34st.com/article/2025/10/cerca-dating-app-gen-z-matchmaking))

---

## 3. 포지셔닝 — 우리가 말할 한 줄과 말하지 않을 것

**핵심 메시지(영문 고정, 한국어 병기):**

- _"Your friend says it better."_ — 친구가 말하면 더 잘 들린다.
- _"Dating, in your friends' words."_ (기존 태그라인 유지)
- 포맷 설명 한 줄: _"The 'set up my single friend' video — but she approves it first, and the replies land in her inbox, not the comments."_

**세 청중, 세 훅**

| 청중             | 아픔                                                  | 훅                                                                 |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Introducer(친구) | "내 친구 진짜 좋은 사람인데 앱 프로필은 걔를 못 담아" | "60초 목소리로 걔를 소개해. 나머지는 우리가."                      |
| Dater(당사자)    | 스와이프 피로, 자기 소개의 어색함, 노출 공포          | "네가 승인하기 전엔 아무것도 공개되지 않아. 관심은 네 수신함에만." |
| Viewer(시청자)   | 댓글로 구애하는 민망함, 사기·봇 의심                  | "가입 없이 보고, 마음이 가면 프로필 채워서 한 번만 두드려."        |

**절대 하지 않을 말·하지 않을 콘텐츠**(THREAT_MODEL·COMMUNITY_GUIDELINES): "safe"·"background checked"·사기 방지 보장, 친구의 보증이 사실을 증명한다는 암시, 만들어낸 시장 수치, 틱톡 safe-zone 보장, "매칭 성공률"; **외모 점수·사람에 대한 공개 투표·익명 공개 댓글·딥페이크(얼굴 교체·보이스클론)** 는 콘텐츠로도 금지. "Verified"는 관심 발신자의 프로필 완성만 뜻한다. 대신 **우리가 실제로 하는 것**을 말한다: 승인 전 비공개, 원본 음성 무편집, 신고·차단, AI 사용 고지(녹음이 기기를 떠나기 전 동의).

---

## 4. 성장 루프 설계 — 무엇이 무엇을 낳는가

```
[Introducer 녹음] → [Dater 승인·발행] → [공개 페이지 + MP4(엔드카드=페이지 주소)]
        ↑                                          ↓ 릴스/틱톡/스토리 업로드
[다음 Introducer]  ←  "나도 친구 소개할래"  ←  [시청자 관심 → 수락 → 매칭]
        ↑                                          ↓
   [Dater가 다음엔 Introducer가 됨: "소개받은 사람이 소개한다" 루프(랜딩 문구 기존)]
```

**루프 계측(이미 존재)**: `reel_visit`(`?src=`), `s1_intent_created`, `interest_submitted/accepted`, `intro_room_created`, `?ref=<slug>` 첫 터치 → `claim_referral` → 첫 발행 시 `attributed_new_campaigns`. `scripts/export-growth-evidence.mjs`가 주간 산출.

**K-factor를 만드는 세 지렛대**

1. **MP4가 광고다** — 모든 발행 캠페인이 세로 1080×1920 영상 + 엔드카드(페이지 주소)를 무료로 받는다. 이 영상이 곧 유일한 유입 크리에이티브. → 영상의 첫 3초와 엔드카드가 K를 결정한다(§5 콘텐츠).
2. **시청자의 다음 행동** — 관심을 보낸 사람은 "소개받은 사람"이 아니어도 "나도 친구 소개하기" CTA를 본다(공개 페이지 하단 "Know someone worth hyping up? Pitch a friend"). 이 CTA의 전환을 측정하고 문구를 실험한다.
3. **댓글창의 관성 활용** — 릴스 댓글에 "drop your info" 대신 **"링크는 프로필에 / 'FRIEND' 댓글 달면 DM으로"** 자동응답(Manychat류)으로 페이지 링크를 보낸다. 2026 크리에이터 전환 관행상 키워드 DM CTA가 link-in-bio보다 높다(§7 채널). ([socialkit](https://socialk.it/en/blog/tiktok-cta-conversion-guide), [hookstudio](https://www.hookstudio.ai/blog/cta-placement-matrix-3x-conversions-tiktok-instagram))

---

## 5. 콘텐츠 시스템 — 반복 가능한 포맷 5종 (Most Viral 심사의 "Scalability")

각 포맷은 **누구나 30분 안에 만들 수 있고**, 우리 MP4·앱 화면·실제 페이지를 재료로 쓴다. 모든 영상 끝은 "friendword.com/p/…" 또는 "Comment FRIEND".

| #   | 포맷                                  | 첫 3초 훅                                                | 본문                                                                                                               | 왜 퍼지나                                                              |
| --- | ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| F1  | **"My friend describes me" 리액션**   | Dater가 처음 듣는 친구 음성에 반응(눈물·웃음)            | 친구 음성 피치(우리 MP4 일부) + Dater 승인 화면                                                                    | 감정·진정성. 리액션 장르와 매치메이킹 장르의 결합                      |
| F2  | **Drop-your-info 업그레이드**         | "댓글로 구애하는 시대는 끝. 이제 친구가 통제하는 수신함" | 기존 틱톡 매치메이킹 영상 패러디 → 우리 페이지로 전환                                                              | 이미 유행하는 포맷의 '다음 버전'이라 알고리즘·시청자가 이해            |
| F3  | **AI vs 친구**                        | "AI가 프로필 써준다는데, 친구 목소리 이길 수 있을까?"    | 같은 사람: 앱 프로필 텍스트 vs 친구 60초 음성 → **방식**에 대한 댓글 투표(사람에 대한 투표·평점은 가이드라인 금지) | 논쟁 유발, 우리 차별점(원본 음성 무편집·AI는 캡션만)                   |
| F4  | **Introducer 챌린지 "#SayItForThem"** | "친구 한 명 골라. 60초 안에 왜 걔가 좋은 사람인지 말해"  | 듀엣/스티치로 이어짐, 마지막에 페이지 링크                                                                         | 참여형 챌린지, 파트너 크리에이터에게 나눠주기 쉬움                     |
| F5  | **빌드 인 퍼블릭 일지**               | "AI가 밤새 내 앱을 QA하고 결함 16개를 고쳤다"            | 오늘 밤 같은 실제 로그·스크린샷, 결정 이유                                                                         | #BuildInPublic 심사 + 개발자 커뮤니티 확산(X·Threads·LinkedIn·Discord) |

**제작 규칙**: 세로 9:16, 첫 프레임에 자막, 얼굴 노출은 동의된 Dater만, 실제 사용자 페이지는 본인 승인 후만 사용(우리 제품 원칙과 동일). 음악은 플랫폼 상업 라이브러리. 캡션에는 `?src=` 값(reel-f1 등)을 포맷별로 다르게 넣어 어느 포맷이 유입을 만드는지 측정.

**Noise 운용(Most Viral 자격 요건)**: Ship Kit의 $1,000 매칭 크레딧으로 F2·F4를 "브리프"로 등록 → 소규모 UGC 크리에이터 다수가 같은 포맷을 자기 친구로 재현 → 조회당 지급. 심사는 "Noise에서 UGC 플레이북으로 바이럴 게시물"을 보므로 **브리프 텍스트와 결과 포스트 링크를 보관**한다.

---

## 6. 시드 전략 — 첫 20캠페인, 첫 100관심 (밀도 우선)

교훈(Cerca·Ship): 넓게 얇게 말고 **한 도시·한 집단**에서 밀도를 만든다.

- **제약**: 소유자당 라이브 캠페인은 **1개**(DB 강제) — "한 사람이 5개 돌리기" 전술은 불가능하고, 캠페인 수 = Dater 수다.
- **1차 시드(9/11~9/20, 10캠페인)**: 소유자 네트워크. 조건: 영어로 60초 말할 수 있는 Introducer(현재 전사는 영어 고정 — §9 리스크), 실명 아닌 표시 이름, Dater 웹 승인. Claude가 각 캠페인에 맞춤 "녹음 대본 가이드"(12단어 이상, 이야기 하나, 형용사 3개 금지 규칙)를 제공.
- **2차 시드(9/20~9/30, 10캠페인)**: 1차 Dater들이 Introducer로 전환(루프 검증) + Noise 크리에이터 5명이 자기 친구를 올림.
- **첫 100관심**: 20캠페인 × MP4 1~~2개 = 릴스 30~~40개. 관심 100건 = 캠페인당 5건 `[가설]`. 여기서 §4의 전환율 첫 실측치가 나온다.
- **커뮤니티**: Shipaton Discord(빌더들끼리 서로의 친구 소개 = 즉시 20명의 Introducer 후보), r/dating_advice·r/GenZ류에는 "홍보"가 아니라 F3 논쟁 글("친구가 쓴 소개 vs 내가 쓴 프로필, 뭐가 더 정확?")로 진입.

---

## 7. 채널 우선순위와 CTA 메커니즘

| 채널               | 역할                                                                                                              | CTA                                                        | 계측               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| TikTok(1순위)      | F1~F4 대량 배포, Noise 크리에이터                                                                                 | "Comment FRIEND" → DM 링크(`?src=tiktok-f#`) / 프로필 링크 | `reel_visit` src별 |
| Instagram Reels    | 같은 영상 재사용, 스토리 링크 스티커                                                                              | 링크 스티커(직접 링크 가능)                                | src=ig             |
| X·Threads·LinkedIn | #BuildInPublic, 개발자·심사위원 노출                                                                              | Devpost·랜딩                                               | 게시물 링크 보관   |
| Shipaton Discord   | 시드 Introducer 모집, 상호 피드백                                                                                 | 캠페인 링크 교환                                           | 캠페인 수          |
| 앱스토어           | ASO + **Featuring nomination**(ASC → Featuring → Nominations, 최소 2주 전, "App Launch" 유형; 디자인·독창성 가중) | —                                                          | 노출               |
| 이메일             | 관심·수락·렌더 알림(기존), waitlist 1통 원칙                                                                      | —                                                          | outbox             |

**링크 규칙**: 캠페인 링크는 항상 `?src=<채널-포맷>&ref=<slug>`. 소유자 채널은 `src=owner-*`, 크리에이터는 `src=noise-<id>`.

---

## 8. 매출 — 해커톤 창 안에서 "정직하게" 숫자를 만드는 법

**사실**: Grand Prize 후보는 제출 기간 내 RevenueCat 매출 총액. 우리 SKU는 Creator Launch $4.99(피치당), Campaign Pass $19.99(캠페인당). 구독 없음. `real_payments_enabled`는 소유자만 켠다(LAUNCH_STRATEGY D4, 권장 B: 실기기 드릴 후).

**전략**

1. **결제 활성은 스토어 승인 즉시**를 목표로 실기기 드릴을 9/10 이전에 끝낸다(D5). 매출 창을 하루라도 넓힌다.
2. **첫 유료 전환은 시드 캠페인에서 나온다**: 20캠페인 중 Creator Launch 10%(2건)·Pass 3%(1건)가 손익분기 가설. 해커톤 관점에선 **"100 paying customers"가 RevenueCat이 말한 목표**지만 우리 창(승인~9/30, 약 2주)에선 비현실적 — 대신 **주간 성장률(Idea to Income 기준)**과 **전환율 실측**을 서사로 만든다.
3. **가격을 건드리지 않는다**(첫 20캠페인 전). 대신 **"Founding Introducer" 배지**(무료, RevenueCat 조언의 VIP 처우)와 **심사위원 프로모 코드**(규칙 요건)를 준비.
4. **HAMM 서사**: "공유·수락·채팅·안전은 영원히 무료. 유료는 '더 멀리(Creator Kit)'와 '더 오래(Pass)'뿐. 무료 사용자가 늘수록 유료 트리거(릴스 성과·만료 임박)가 늘어나는 구조" — 구독 거부 결정을 차별점으로.
5. **Stripe 웹 결제(Funnel Vision)**는 하지 않는다 — 웹 결제 표면 신설은 non-goal이고 창 안에 못 만든다.

---

## 9. 리스크와 정직한 한계

| 리스크                                                                           | 영향                                | 대응                                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전사가 영어 고정(`language=en`) → 한국어 Introducer는 무음으로 거부됨(T001 가드) | 소유자 네트워크(한국) 시딩 불가     | **결정 필요**: (a) 영어 화자 시딩만, (b) 소규모 개발로 언어 자동 감지/한국어 허용(+ 전사 가드의 CJK 토큰 규칙) — 셋로그 신호를 보면 (b)의 상방이 큼 |
| 스토어 승인 지연                                                                 | 매출 창 축소, Grand Prize 후보 불가 | 9/12 이전 첫 제출, 거부 2회 흡수                                                                                                                    |
| 크리에이터 콘텐츠의 동의·초상권                                                  | 신고·삭제·평판                      | 우리 제품 원칙 그대로: Dater 승인 없는 얼굴·이름 노출 금지, 브리프에 명문화                                                                         |
| "친구 대행" 앱들의 실패(Ship)                                                    | 카테고리 회의론                     | 우리는 스와이프 대행이 아니라 **보증+동의+수신함**; 서사에서 명시                                                                                   |
| 매출 절대액 부족                                                                 | Grand Prize 후보 탈락               | Most Viral·Growth Loop·BuildInPublic·HAMM에 분산 응모                                                                                               |
| 한 사람(소유자) 운영 한계                                                        | 콘텐츠 볼륨                         | Claude가 대본·캡션·브리프·주간 리포트·Devpost 초안을 전담(§11)                                                                                      |

---

## 10. 22일 액션 플랜 (9/9 → 9/30) + 심사기간

| 날짜             | 소유자                                                                        | Claude                                                                      | 산출              |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------- |
| 9/9              | D1~D3 확정, ASC 메타·IAP, Ship Kit 폼, Noise·Layers 계정                      | 랜딩 카피 A/B 초안, F1~F5 대본 10개, Noise 브리프 2개, Devpost 설명문 초안  | 제출 준비물       |
| 9/10             | EAS 빌드→TestFlight→실기기 드릴→**App Store 제출**, 시드 Introducer 10명 초대 | 녹음 가이드·초대 메시지 템플릿, #BuildInPublic 1호 포스트(밤샘 QA 서사)     | 제출 완료         |
| 9/11~9/14        | 시드 캠페인 녹음·승인 지원, 매일 1포스트                                      | 캠페인별 MP4 캡션·해시태그, 주간 리포트 스크립트, Featuring nomination 문안 | 캠페인 5~10       |
| 승인 당일(~9/15) | 결제 활성(D4-B), 프로모 코드 발급, Featuring nomination 제출                  | 릴스 1차 배포 캘린더(20개), Noise 브리프 활성화                             | 라이브            |
| 9/16~9/22        | 릴스 업로드(F1·F2 위주), Discord 시딩, 관심 수락 운영                         | src별 전환 리포트 1차, 문구 실험, F3 논쟁 글                                | 관심 50 `[가설]`  |
| 9/23~9/28        | 2차 시드(Dater→Introducer), F4 챌린지 시작, 리뷰 요청 DM                      | 데모 영상 2분 스크립트·편집 지시, Devpost 최종문, 수치 표                   | 관심 100 `[가설]` |
| 9/29~9/30        | Devpost 제출(영상·설명·스크린샷·프로모 코드·소셜 링크)                        | 제출 검수 체크리스트, GROWTH_EVIDENCE 갱신                                  | 제출              |
| 10/1~10/13       | 심사위원 접근 유지(sandbox 창·프로모), 운영 지속                              | 주간 리포트 2회, 커뮤니티 응답                                              | —                 |

**데모 영상(2분) 구성**: 0–15s 문제(스와이프 피로, 댓글 매치메이킹 장면) → 15–60s 제품(친구 녹음 → 승인 → 페이지 → MP4) → 60–90s 성장·숫자(캠페인·관심·매칭·매출·src 전환) → 90–120s RevenueCat 통합·다음 계획. (Devpost 조언: 첫 10초에 피치, 실제 동작 시연.) ([Devpost tips](https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video))

---

## 11. Claude가 매일 맡는 것 (운영 자동화)

- 아침: 전날 `export-growth-evidence` + `track_event` 집계 → 한 화면 리포트(캠페인·관심·수락·룸·src별 유입·전환·매출).
- 콘텐츠: 캠페인별 캡션 3안, 첫 3초 훅 5안, F1~F5 대본, 크리에이터 브리프, 댓글 응답 템플릿.
- 커뮤니티: Discord·Reddit 초안(홍보 아닌 논쟁·경험담), DM 회신 초안.
- 심사: #BuildInPublic 포스트 초안(사실만), Devpost 텍스트, 수치 표, 데모 영상 스크립트.
- 안전: 신고 큐·review 큐·배포 실패 알림 확인, 매일 결과 보고.

---

## 12. 측정 — 성공의 정의와 중단 조건

- **북극성**: 캠페인당 수락된 Intro Room(ANALYTICS_PLAN).
- **주간 대시보드 6개 숫자**: 발행 캠페인, 릴스 조회(플랫폼), `reel_visit`, `interest_submitted`, `interest_accepted`, 순매출.
- **가설 문턱(첫 20캠페인 후 갱신)**: 조회→방문 ≥2%, 방문→관심 ≥3%, 관심→수락 ≥30%, Creator Launch ≥10%, Pass ≥3%.
- **중단·감속**: 월 비용 75/90%(COST_MODEL), 신고 24h 미처리, review 큐 24h 방치, 동의 없는 얼굴 노출 신고 1건이라도 → 해당 크리에이티브 즉시 내림.

---

## 13. 창의적 확장 아이디어 (검증 전 `[가설]`, 비용 0~소액)

1. **"Say It For Them" 결혼식 축사 훅**: 베스트맨/신부 들러리 연설이 곧 Friendword 피치 — 결혼식 시즌 콘텐츠와 결합, 축사 잘 쓰는 사람=좋은 Introducer.
2. **캠퍼스 밀도 실험(Cerca 방식)**: 한 대학 커뮤니티에서 Introducer 20명 동시 발행 → "이번 주 우리 학교 친구들이 소개하는 사람들" 릴스 묶음.
3. **Introducer 리더보드(비공개, 배지)**: 소개로 매칭을 만든 사람에게 "Matchmaker" 배지 — HAMM 서사와 연결(향후 유료 슈퍼 Introducer 기능 `[가설]`).
4. **한국어 개방 시 "소개팅 주선자" 포지셔닝**: 셋로그 세대에게 "친구가 60초로 소개, 당사자 승인, 단톡방 대신 수신함". 한국어는 전사 개방(§9)이 선행.
5. **"AI가 밤새 고쳤다" 개발 서사 자체를 마케팅으로**: 오늘 밤의 QA→수리 로그를 #BuildInPublic 시리즈로 — 개발자 커뮤니티가 1차 Introducer 풀이 된다.
6. **엔드카드 QR**: MP4 엔드카드에 페이지 QR(현재는 주소 텍스트) — 오프라인 상영(파티·카페)에서 즉시 접근 `[소규모 개발]`.
7. **"Reply as a friend" 역방향**: 시청자가 관심 대신 **자기 친구를 추천**하는 버튼 — 루프의 두 번째 갈래 `[개발 필요, 20캠페인 후]`.
