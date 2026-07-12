# Analytics Plan

## North Star

> **Accepted Intro Rooms per Published Campaign**

다운로드나 조회 수만으로는 가치가 증명되지 않습니다. 승인된 캠페인이 실제 상호 대화로 얼마나 전환되는지를 측정합니다.

## 핵심 퍼널 이벤트

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

## 공통 속성

모든 이벤트에 다음을 포함합니다.

- `campaign_id` 또는 해당 이벤트가 연결된 resource 식별자
- acquisition source와 referrer/UTM attribution
- platform
- app version
- locale
- experiment variant

민감한 원본 음성·사진·메시지 내용, 전화번호, 이메일, 법적 이름과 신원확인 원본은 analytics에 보내지 않습니다.

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
