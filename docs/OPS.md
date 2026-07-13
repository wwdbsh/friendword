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
