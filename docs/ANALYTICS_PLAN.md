# Analytics Plan

## North Star

> **Accepted Intro Rooms per Published Campaign**

다운로드나 조회 수만으로는 가치가 증명되지 않습니다. 승인된 캠페인이 실제 상호 대화로 얼마나 전환되는지를 측정합니다.

## 핵심 퍼널 이벤트

2차 감사 H-4(Slice 9, migration 0033)부터 이벤트는 두 계급으로 나뉩니다.

**Client interaction 이벤트** — `track_event` RPC로만 수집. 속성은 allowlist
(`campaign_id`·`campaign_slug`·`pitch_draft_id`·`source`·`platform`·`channel`·`duration_ms`·`product_id`)와
실재 검증(campaign/draft id는 존재해야 함, slug형 값은 `[A-Za-z0-9_-]{1,64}`)을 통과해야 하고,
익명 호출은 `pitch_viewed_unique`/`reel_visit`/`interest_started`만 허용됩니다(`reel_visit`는 migration 0057에서 추가).

```text
introducer_started
voice_recorded
draft_generated
consent_invite_shared      # 비공개 승인 초대 공유 (공개 캠페인 공유 아님)
campaign_shared            # 공개 캠페인 공유 상호작용 (channel: kit_card_download | kit_caption_copy | …)
pitch_viewed_unique        # sessionStorage 단위 dedupe(브라우저 세션당 1회) + source attribution
reel_visit                 # 릴스 퍼널 진입: 캠페인 페이지 도착 (익명 허용, channel attribution)
interest_started
s1_intent_created          # S1 비공개 의사 저장 성공 (로그인 필요)
creator_launch_paywall_viewed
campaign_pass_paywall_viewed
```

릴스 퍼널의 이후 단계는 client가 보낼 수 없습니다: S2 전달은 `interests` INSERT 트리거의
`interest_submitted`, S3 매칭은 `interest_accepted`/`intro_room_created`입니다.

**Server-recorded outcome 이벤트** — 상태가 실제로 바뀌는 테이블의 AFTER 트리거가
기록하며(`properties.recorded_by = "server"`), client가 보내면 RPC가 거부합니다.

```text
consent_sent               # consent_requests → pending
draft_changes_requested    # consent_requests → changes_requested
pitch_approved             # consent_requests → approved
campaign_published         # campaigns → published (최초 발행만; resume 제외)
campaign_paused / campaign_expired
interest_submitted / interest_accepted
intro_room_created
first_message_sent
creator_launch_purchased   # purchase_credit_ledger(available) — 웹훅 경유
creator_launch_credit_consumed
campaign_pass_purchased    # campaign_entitlements 활성/연장
report_submitted / user_blocked
```

## 공통 속성과 attribution

- outcome 이벤트는 트리거가 resource id(`campaign_id`/`pitch_draft_id`/`interest_id`/`intro_room_id`)를 서버에서 채웁니다.
- acquisition attribution: 공개 링크의 `?src=` → `sessionStorage.fw_attribution` → `pitch_viewed_unique`/`interest_started`의 `source` 속성. Creator kit 캡션 링크는 `?src=creator-kit`로 고정되어 kit발 유입이 구분됩니다.
- platform은 client 이벤트만 전달합니다(`web`은 생략 가능, mobile은 `platform: "mobile"`).
- app version·locale·experiment variant는 아직 수집하지 않습니다(수집 시작 시 이 문서를 먼저 갱신).

민감한 원본 음성·사진·메시지 내용, 전화번호, 이메일, 법적 이름과 신원확인 원본은 analytics에 보내지 않습니다.

## 지표 정의 (기간·dedupe·timezone)

- 집계 timezone은 **UTC**, 기간은 ISO 주(월요일 시작)를 기본으로 명시합니다.
- `unique external viewers` = `pitch_viewed_unique` 수. 브라우저 세션당 1회로 dedupe되며 시크릿 창·세션 초기화로 부풀릴 수 있는 **약한 지표**입니다 — 성장 증거로 쓸 때 한계를 함께 표기합니다.
- 전환율 분모·분자는 전부 server-recorded outcome으로 계산합니다(view→interest만 분모가 client 이벤트).
- **referral chain (Slice 5, 2026-07-14 구현)**: 공개 pitch의 `?ref=<slug>`가 `fw_referral`(first-touch)로 보존되고, 로그인 사용자는 `claim_referral`로 사용자당 1개 소스를 서버에 기록하며, 새 캠페인이 처음 published될 때 서버 트리거가 `referral_claims.new_campaign_id`를 채웁니다(client 위조 불가). exporter는 이를 `attributed_new_campaigns`로 출력합니다 — **아직 K-factor라고 부르지 않습니다**(코호트·기간 정의 전이며, 스토어 배포 전 acquisition은 waitlist 전환으로 측정).
- 구 `k_factor_estimate`는 제거되었고 `share_proxy_events_per_published_campaign`(Creator Kit 공유 액션 proxy ÷ 발행 캠페인)으로 재명명되었습니다 — 전환 지표가 아닙니다.
- 서버 권위 outcome 지표(`interests_submitted`/`interests_accepted` 등)는 `recorded_by='server'` 행만 집계하고, client interaction(`pitch_viewed_unique`/`interest_started`)은 위조 가능 한계를 명시해 분리 출력합니다. 결제는 REFUND lineage를 차감한 `net_paid_transactions`입니다. 모든 exporter 출력에 timezone(UTC)·window·지표별 source_of_truth/limitations 메타데이터가 포함됩니다(감사 H-9).

## 초기 가설과 판정선

| 가설                                          |                                     초기 판정선 | 실패 시 행동                                            |
| --------------------------------------------- | ----------------------------------------------: | ------------------------------------------------------- |
| 친구는 짧은 음성으로 시작할 수 있습니다.      |                    start→voice completion ≥ 50% | 질문 수와 가입 단계를 줄입니다.                         |
| Dater가 타인의 소개를 승인할 의향이 있습니다. |                    consent sent→published ≥ 40% | 초대 카피·통제권·private preview를 개선합니다.          |
| 피치는 공유할 가치가 있습니다.                | published campaign당 median 5+ external viewers | 결과물 품질·share preview·Introducer 보상을 수정합니다. |
| 외부 시청자가 관심을 표현합니다.              |             unique view→interest submitted ≥ 2% | CTA, 필수 프로필 길이, 신뢰 설명을 개선합니다.          |
| 관심 표현이 대화로 이어집니다.                |                        submitted→accepted ≥ 20% | 관심 프로필 정보·필터를 개선합니다.                     |
| 공유가 새 캠페인을 만듭니다.                  |                         campaign K-factor ≥ 0.3 | 후속 `Pitch a friend` CTA와 referral을 개선합니다.      |
| 사용자가 캠페인 기능에 결제합니다.            |                             activated→paid ≥ 3% | 가격보다 가치 패키지와 노출 시점을 먼저 수정합니다.     |

판정선은 외부 시장 사실이 아니라 초기 목표입니다. 첫 20개 캠페인의 실제 분포를 확인한 뒤 업데이트합니다. 기능마다 해결할 퍼널 단계와 성공 지표를 먼저 명시하고, 가격·카피·benefit order 실험은 한 번에 하나만 바꿉니다.
