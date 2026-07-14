# DB 3차 감사 회귀 스위트 (audit3)

이 디렉터리는 `docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`의 P0-NEW 결함을 **수정 완료 후의 기대 동작**으로 인코딩합니다. red-first로 작성하므로, 대응 migration이 없는 시점에는 FAIL이 정상이며 fix가 랜딩하면 PASS로 전환합니다.

실행: `bash scripts/test-db-audit3.sh` (또는 `pnpm test:audit3`)

러너는 audit2와 동일하게 로컬 PostgreSQL을 강제하고, 임시 DB에 `auth_stub → migrations → seed.sql`을 적용한 뒤 `supabase/tests/audit3/c*.sql`을 순서대로 돌립니다.

| 파일                       | 감사 항목 | 보호하는 계약                                                                                | 그린 전환 슬라이스 |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------- | ------------------ |
| `c01_public_beta_gate.sql` | P0-NEW-4  | public_beta off는 campaign publish 전이와 interest를 authoritative 차단, QA allowlist만 예외 | Slice 0            |

## c01 커버리지

- 구조 존재: `qa_preview_allowlist` 테이블, `private.public_beta_or_preview_allowed(uuid)`, `campaigns_public_beta_gate` 트리거.
- gate off: (a) published 캠페인 직접 INSERT 차단, (b) paused→published 전이 차단, (c) published 캠페인의 `ends_at`만 갱신하는 UPDATE 허용, (d) published→paused 전이 허용.
- allowlist 예외: draft를 allowlist에 넣으면 gate off에서도 그 캠페인의 publish 전이와 interest 제출이 성공. allowlist에 없는 캠페인 interest는 여전히 차단.
- gate on: allowlist 없이 publish 전이·interest 모두 성공.

`approve_and_publish_pitch` RPC는 publish 단계가 campaigns 대상 `INSERT … ON CONFLICT DO UPDATE`라, `campaigns_public_beta_gate`가 direct INSERT probe와 동일한 트리거 경로에서 이미 게이트합니다. 별도 consent_pending 픽스처는 새 커버리지 없이 표면만 늘리므로 생략했습니다.

후속 슬라이스는 실제 실행 결과가 바뀔 때 이 표의 상태도 함께 갱신해야 합니다.
