# DB 2차 감사 회귀 스위트 (audit2)

이 디렉터리는 `docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`의 출시 차단 acceptance를 **수정 완료 후의 기대 동작**으로 인코딩합니다. **초기 상태에서는 b09를 제외하고 FAIL이 정상**이며, Slice 1~9가 계약을 구현할 때 하나씩 PASS로 전환합니다. 기본 DB 스위트와 CI에는 포함하지 않고 Slice 10에서 CI에 편입합니다.

실행: `bash scripts/test-db-audit2.sh` (웹 route 계약은 `pnpm --filter @friendword/web test:audit2`)

| 파일                                | 감사 항목 | 보호하는 계약                                                             | 그린 전환 슬라이스 |
| ----------------------------------- | --------- | ------------------------------------------------------------------------- | ------------------ |
| `b01_anon_report_abuse.sql`         | P0-1      | 익명 신고 distinct identity·dedupe, 단독 신고자의 auto-pause 불가         | Slice 1            |
| `b02_media_voice_enforcement.sql`   | P0-2      | asset kind별 validation matrix, enforcement on에서 정상 voice 제출 가능   | Slice 2            |
| `b03_webhook_event_contract.sql`    | P0-3      | 실이벤트 계약: TRANSFER·속성누락 lifecycle·미귀속 구매의 durable review   | Slice 3            |
| `b04_paid_value_delivery.sql`       | P0-5·P0-6 | 중복 intent 거부, unlocked kit 재진입, 결제 1건=효익 1회                  | Slice 4            |
| `b05_contact_binding_invariant.sql` | P0-7      | 신규 consent request의 verified contact 필수, legacy null claim 불가      | Slice 5            |
| `b06_identity_evidence.sql`         | P0-8      | verification type/provider/photo hash/expiry 기반 publish·interest 게이트 | Slice 5            |
| `b07_cost_control.sql`              | P0-9      | provider usage reserve/reconcile 멱등성, quota·hard cap·kill switch       | Slice 6            |
| `b08_ai_processing_consent.sql`     | P0-10     | 외부 AI 처리 동의 없이는 provider 사용 예약 불가                          | Slice 6            |
| `b09_launch_gates.sql`              | Slice 0   | real payments·public beta 서버 차단 (0023) — **처음부터 그린**            | Slice 0            |
| `b10_expiration_consistency.sql`    | H-5       | 만료 캠페인의 status/public read/resume 일관성                            | Slice 9            |
| `b11_account_read_enforcement.sql`  | H-1       | suspended/deleted 계정의 민감 read 철회 (0024 restrictive 정책)           | Slice 1            |
| `b12_text_moderation_gate.sql`      | H-3       | content-addressed 텍스트 moderation 게이트 (0026)                         | Slice 2            |
| `b13_dater_snapshot_control.sql`    | CP-1      | dater revision·publish preference snapshot 발행, audience 트리거 게이트   | Slice 7            |

route 레벨 계약은 `apps/web/tests-audit2/revenuecat-realistic.audit2.test.ts`가 인코딩하며 Slice 3부터 그린이다. `b13`은 서버 골격(0032)이 Slice 7 groundwork로 선행 커밋된 뒤 작성되어 처음부터 그린이다.

후속 슬라이스는 실제 실행 결과가 바뀔 때 이 표의 상태도 함께 갱신해야 합니다.
