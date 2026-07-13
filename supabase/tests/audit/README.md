# DB 감사 회귀 스위트

이 디렉터리는 `docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`의 출시 차단 acceptance를 수정 완료 후의 기대 동작으로 인코딩합니다. 초기 상태에서는 FAIL이 정상이며, 후속 slice가 계약을 구현할 때 하나씩 PASS로 전환합니다. 기본 DB 스위트와 CI에는 포함하지 않고 Slice J에서 CI에 편입합니다.

| 파일                                 | 감사 항목 | 보호하는 계약                                                              |
| ------------------------------------ | --------- | -------------------------------------------------------------------------- |
| `a01_web_user_bootstrap.sql`         | P0-1      | 신규 auth 사용자의 public user/profile 자동 생성과 consent claim           |
| `a02_claim_and_verification.sql`     | P0-2      | invite contact 일치 claim과 provider 검증 기반 publish                     |
| `a03_consent_immutability.sql`       | P0-3      | consent_pending copy/media freeze, revision 불변성, exact revision publish |
| `a04_commerce_ledger.sql`            | P0-4      | 원자 webhook ledger, 멱등성, refund, transaction ID, 기간 entitlement      |
| `a08_verified_interest_evidence.sql` | P0-8      | 실제 storage·phone·verification 증거 없는 interest 거부                    |
| `a09_publish_photo_guard.sql`        | P0-9      | 포함 사진이 없는 실제 pitch publish 거부                                   |
| `a10_account_status_enforcement.sql` | §10       | suspended 계정의 draft·interest·chat mutation 거부                         |

## 2026-07-13 최초 실행 현황

명령: `bash scripts/test-db-audit.sh`

| 파일                                 | 결과 |
| ------------------------------------ | ---- |
| `a01_web_user_bootstrap.sql`         | PASS |
| `a02_claim_and_verification.sql`     | PASS |
| `a03_consent_immutability.sql`       | PASS |
| `a04_commerce_ledger.sql`            | PASS |
| `a08_verified_interest_evidence.sql` | PASS |
| `a09_publish_photo_guard.sql`        | FAIL |
| `a10_account_status_enforcement.sql` | PASS |

후속 slice는 실제 실행 결과가 바뀔 때 이 표도 함께 갱신해야 합니다.

Slice E의 최종 기간 정책은 무료 캠페인 14일 고정이며, Campaign Pass는 구매 시점부터 30일까지 연장합니다. 30일 직접 발행과 90일 경로는 허용하지 않습니다.
