# 운영자 런북 (Safety & Ops)

> 신고 큐·차단·강제 조치는 service role로만 수행합니다. 이 문서의 쿼리는
> Supabase SQL Editor(또는 service role 연결 psql)에서 실행합니다.
> 클라이언트에는 어떤 운영자 권한도 노출되지 않습니다.

## 신고 큐

열려 있는 신고를 최신순으로 확인:

```sql
SELECT r.id, r.created_at, r.target_type, r.target_id,
       r.reason, r.severity, r.status, r.anon_report,
       reporter.display_name AS reporter,
       reported.display_name AS reported,
       c.slug AS campaign_slug
  FROM reports r
  LEFT JOIN profiles reporter ON reporter.user_id = r.reporter_user_id
  LEFT JOIN profiles reported ON reported.user_id = r.reported_user_id
  LEFT JOIN campaigns c ON c.id = r.campaign_id
 WHERE r.status = 'open'
 ORDER BY r.created_at DESC;
```

처리 후 상태 갱신 (`resolved` / `dismissed`):

```sql
UPDATE reports SET status = 'resolved' WHERE id = '<report-id>';
```

## 조치 도구

- **캠페인 강제 중단**: `UPDATE campaigns SET status = 'archived' WHERE id = '<campaign-id>';`
  (공개 페이지는 `status = 'published'`만 읽으므로 즉시 내려감)
- **운영자 차단(양방향 차단 삽입)**:
  `INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ('<a>', '<b>'), ('<b>', '<a>') ON CONFLICT DO NOTHING;`
  → intro room 참여 판정이 즉시 거짓이 되어 채팅·노출이 중단됨
- **계정 정지**: `UPDATE users SET account_status = 'suspended' WHERE id = '<user-id>';`
- **미디어 제거**: Storage에서 `pitch-media/<draft-id>/…`, `profile-media/<user-id>/…` 객체 삭제

## 데이터 삭제 요청 (계정 삭제)

사용자가 `request_account_deletion()`을 호출하면 계정은 즉시 `deleted`가 되고
`deletion_requests`에 한 건만 queued 됩니다. 운영자는 service role 환경에서 먼저
dry-run 결과를 검토한 뒤 같은 processor를 실제 실행합니다.

```sh
node scripts/process-deletions.mjs --dry-run --limit=25
node scripts/process-deletions.mjs --limit=25
```

dry-run은 변경 없이 다음 형식만 출력하며 사용자 ID나 Storage 경로를 노출하지 않습니다.

```text
DRY RUN request 1: drafts=<count> campaigns=<count> rooms=<count> storage_objects=<count>
```

processor는 관련 Storage 객체와 FK 종속 데이터를 역순으로 제거하고 Auth 사용자를
삭제합니다. 타 사용자가 소유한 공동 캠페인은 보존하고 드래프트·업로드 참조를 해당
소유자에게 이관하며, 삭제한 미디어 prefix의 검증 원장도 함께 제거합니다. 안전 신고는
운영 감사 목적으로 보존하되 사용자 참조를 익명화하고, 그 보존 예외를 deletion
request의 `note`에 기록합니다. 실패한 요청은 `failed`와 제한된 운영 로그 확인 안내를
기록하고 로그에는 사용자 식별자 없이 실패 단계만 남기므로, 해당 단계를 확인한 뒤
수동으로 `queued`로 되돌려 재시도합니다. 프로세스 강제 종료로 `processing`에 남은
요청은 처리 시작 후 1시간이 지나면 다음 실행이 자동으로 다시 claim합니다.

## 원칙

- 신고 처리 SLA: 출시 초기에는 매일 1회 이상 큐 확인
- 모든 조치는 이 문서의 쿼리로 수행하고, 애매한 케이스는 결정 기록에 남긴다
- mock 처리 금지 원칙(CLAUDE.md 9)에 따라 이 런북이 최소 실물 운영 도구다 —
  전용 운영자 UI는 출시 후 P1

## Launch gates (0023 — 2차 감사 Slice 0)

`app_config`의 두 스위치가 실결제와 외부 공개 베타를 서버에서 차단합니다. 기본값은 둘 다 `off`이며 **Slice 10 release gate(2차 감사 §7) 통과 전에는 hosted에서 켜지 않습니다.**

| key                     | off일 때 차단되는 것                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `real_payments_enabled` | `purchase_intents` INSERT(구매 시작), PRODUCTION environment `purchase_events`(효익 지급) |
| `public_beta_enabled`   | `interests` INSERT(외부 사용자의 관심 표현 제출)                                          |

- SANDBOX environment 결제 이벤트는 `real_payments_enabled=off`여도 처리됩니다(내부 sandbox 검증용).
- 로컬 테스트 DB는 `supabase/seed.sql`이 두 게이트를 켭니다. hosted에는 seed가 적용되지 않으므로 기본 off가 유지됩니다.
- `scripts/e2e-production.mjs`는 실행 시작 시 게이트를 열고 종료 시(finally) 이전 값으로 원복합니다. 중단으로 원복이 누락됐는지 확인하려면:

```sql
SELECT key, value, updated_at FROM app_config
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');
```

- 게이트 상태 변경은 service role SQL로만 하며, 변경 시 이 문서와 `docs/DECISIONS.md`에 날짜·이유를 남깁니다:

```sql
UPDATE app_config SET value = 'on'  -- 또는 'off'
 WHERE key = 'real_payments_enabled';
```

## 신고 auto-pause 정책 (0024 이후)

- 24시간 내 **distinct reporter identity 2개 이상**의 high-severity 신고(campaign 대상)가 있어야 자동 pause됩니다. identity는 authenticated user id 또는 익명 salted IP hash이며, hash 없는 legacy 익명 행은 카운트되지 않습니다.
- 같은 target+reason+identity의 24시간 내 반복 신고는 저장되지 않습니다(dedupe).
- 자동 pause 시 `ops_alerts`에 `campaign_auto_paused`가 남습니다. 확인 쿼리:

```sql
SELECT * FROM ops_alerts WHERE alert_type = 'campaign_auto_paused' AND resolved_at IS NULL;
```

## Orphan media cleanup (0025 이후)

`pitch-media`와 `profile-media`의 미참조 객체는 기본 dry-run으로 먼저 점검합니다.
스크립트는 Storage 경로나 사용자 ID를 출력하지 않고 bucket별 집계만 기록합니다.

```sh
node scripts/cleanup-orphan-media.mjs
node scripts/cleanup-orphan-media.mjs --apply
```

삭제 후보는 다음 조건을 모두 만족해야 합니다.

- 생성 후 48시간이 지남
- `pitch_assets.storage_path`에서 참조되지 않음
- `dating_profiles.photos`에서 참조되지 않음
- `consent_revisions.voice_asset_path` 또는 현재 남아 있는 `asset_ids`에서 참조되지 않음
- published/paused campaign의 convention voice path가 아님

`consent_revisions.asset_ids`는 과거 사진의 immutable path를 직접 보존하지 않습니다.
따라서 consent revision이 하나라도 있는 draft prefix는 보수적으로 전부 보호합니다. 이
경계는 승인·검토된 과거 사진을 orphan으로 오인해 삭제하는 것보다 일부 객체를 더
보존하는 쪽을 선택한 것입니다.

운영자는 dry-run의 `unknown_age`가 0인지 확인하고 bucket별 후보 수가 예상 범위인지
검토한 뒤에만 `--apply`를 실행합니다. 실행 중 참조 원장 조회나 Storage listing이 하나라도
실패하면 삭제 단계에 진입하지 않습니다. 초기에는 매일 1회 실행하고, 후보 수와 실패율이
안정된 뒤 주기를 조정합니다.
