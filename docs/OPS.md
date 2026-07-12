# 운영자 런북 (Safety & Ops)

> 신고 큐·차단·강제 조치는 service role로만 수행합니다. 이 문서의 쿼리는
> Supabase SQL Editor(또는 service role 연결 psql)에서 실행합니다.
> 클라이언트에는 어떤 운영자 권한도 노출되지 않습니다.

## 신고 큐

열려 있는 신고를 최신순으로 확인:

```sql
SELECT r.id, r.created_at, r.reason, r.status,
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

1. `auth.users`에서 사용자 삭제(`supabase.auth.admin.deleteUser`) — public.users가
   CASCADE로 profiles/dating_profiles 등을 정리
2. 남는 참조(REFERENCES without CASCADE: pitch_drafts.created_by 등)는 삭제 전에
   해당 캠페인·드래프트를 먼저 archived/삭제 처리
3. Storage의 `profile-media/<user-id>/`와 사용자가 만든 draft 폴더 제거

## 원칙

- 신고 처리 SLA: 출시 초기에는 매일 1회 이상 큐 확인
- 모든 조치는 이 문서의 쿼리로 수행하고, 애매한 케이스는 결정 기록에 남긴다
- mock 처리 금지 원칙(CLAUDE.md 9)에 따라 이 런북이 최소 실물 운영 도구다 —
  전용 운영자 UI는 출시 후 P1
