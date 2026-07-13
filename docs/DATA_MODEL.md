# 데이터 모델

> 실측 기준: migrations 0001~0033 (2026-07-13). 새 테이블·컬럼은 마이그레이션이 source of truth이며 이 문서는 관계·불변식 요약이다.

## Core tables

```text
users, profiles, dating_profiles, introducer_profiles
pitch_drafts, pitch_assets, consent_requests, consent_revisions
campaigns, campaign_memberships, vouches
interests, intro_rooms, messages
reports, blocks, verification_checks, deletion_requests
purchase_intents, purchase_events, purchase_event_reviews,
purchase_credit_ledger, campaign_entitlements, share_kits
analytics_events, provider_usage_events, cost_ledger
media_validations, text_moderations, ai_processing_consents
app_config, ops_alerts
```

## 핵심 소유·관계 필드

| 테이블                 | 핵심 필드와 의미                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                | `id`, `auth_identity`, `phone_verified_at`, `account_status`                                                                               |
| `profiles`             | `user_id`, `display_name`, `birth_date`, `locale`, `verification_status`                                                                   |
| `dating_profiles`      | `user_id`, `bio`, `photos`, `dating_intent`, `approximate_location`, `profile_updated_at`; Dater와 Interested Person이 공유합니다.         |
| `introducer_profiles`  | `user_id`, `pseudonym`, `completed_introduction_count`, `unlocked_customizations`; 별도 계정이 아닌 선택적 facet입니다.                    |
| `campaigns`            | `id`, `owner_user_id`(=`DATER_OWNER`), `slug`, `ends_at`, `audience_policy`(JSONB), `location_precision`(`city/region/hidden`)             |
| `campaign_memberships` | `campaign_id`, `user_id`, `role` (`DATER_OWNER`, `INTRODUCER`, `ADDITIONAL_VOUCHER`), `status`                                             |
| `pitch_drafts`         | `created_by_user_id`(Introducer), `subject_user_id`(claim 후 Dater), `transcript`(JSONB), `audience_policy`, `publish_days`(7/14)          |
| `consent_revisions`    | draft별 immutable snapshot(`headline/body/structure/asset_ids/voice_asset_path/transcript/content_hash`); 수정=새 revision                 |
| `interests`            | `campaign_id`, `sender_user_id`; Interested Person은 membership이 아니라 sender 관계입니다. audience policy는 INSERT 트리거가 강제         |
| `purchase_events`      | `purchaser_user_id`, `product_id`, `scope_type` (`PITCH_DRAFT` 또는 `CAMPAIGN`), `scope_id`; 미귀속 이벤트는 `purchase_event_reviews` 큐로 |
| `analytics_events`     | `user_id`, `event_name`, `properties`; outcome은 트리거가 기록하고 `recorded_by:"server"`로 표시, client는 interaction 이벤트만            |

## DB/RLS invariant

- `users`에 전역 역할이나 계정 유형 필드를 두지 않습니다.
- `(campaign_id, user_id)` membership 중복을 금지합니다.
- published campaign에는 활성 `DATER_OWNER`가 정확히 한 명 있어야 합니다.
- 같은 User가 동일 campaign에서 `DATER_OWNER`와 `INTRODUCER`를 동시에 가질 수 없습니다.
- 서로 다른 캠페인에서는 한 User가 모든 컨텍스트 역할을 수행할 수 있습니다.
- Creator Launch 구매자는 해당 pitch draft의 Introducer이고 scope는 `PITCH_DRAFT`여야 합니다.
- Campaign Pass 구매자는 해당 campaign의 `DATER_OWNER`이고 scope는 `CAMPAIGN`이어야 합니다.
- 하나의 RevenueCat App User ID는 Friendword `users.id` 하나에 대응합니다.
- 신원 인증의 재사용은 캠페인별 콘텐츠 동의의 재사용을 뜻하지 않습니다.

## 상태 기계

```text
PitchDraft:
draft → consent_pending → changes_requested → … → published → archived

Campaign:
published ⇄ paused → archived
published/paused --(ends_at 경과, expire_due_campaigns)--> expired → archived
  · expired는 재개(published 복귀) 불가 — set_campaign_status가 서버에서 거부

Interest:
started → verification_pending → submitted
        → accepted | declined | withdrawn | blocked

IntroRoom:
open → left | blocked | closed
```

모든 전이는 서버에서 검증합니다. Introducer는 consent 진입 이후 콘텐츠를 직접 변경할 수 없고(수정은 재제출로 새 immutable revision 생성), Dater는 자신의 문구·사진·audience·기간을 새 revision과 publish preference로 통제하며 publish RPC는 정확히 승인된 snapshot만 발행합니다. 권한은 전역 role이 아니라 현재 resource의 membership과 ownership으로 판정합니다.
