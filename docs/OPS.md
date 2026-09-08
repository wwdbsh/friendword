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

**사용자가 스스로 하는 경로가 두 곳 있습니다** (2026-08-12, T007): 모바일 홈 →
`Account` → 두 단계 확인(`DELETE` 타이핑), 웹 `/inbox` 하단 "Your account". 둘 다
같은 RPC `request_account_deletion()`을 부릅니다 — 별도 경로는 없습니다. 즉 문의가
와도 운영자가 대신 눌러 줄 필요가 없고, **눌러 주어서도 안 됩니다**(RPC는 호출자
본인 계정만 삭제하며, 대리 삭제 수단은 의도적으로 없습니다).

### 탈퇴 문의가 왔을 때

1. **"앱에서 지우는 법을 모르겠다"** → 위 두 경로를 안내합니다. 모바일은 홈 화면
   "Your activity" 아래 `Account`, 웹은 `/inbox` 맨 아래입니다. 로그인 상태여야
   합니다(삭제는 요청한 계정에만 적용됩니다).
2. **"눌렀는데 아직 데이터가 남아 있다"** → 정상입니다. 요청 즉시 되는 것은 계정
   폐쇄(`account_status='deleted'`, 모든 RPC 거부)이고 물리 소거는 아래 processor가
   합니다(자동 실행은 하루 1회). 큐 확인:
   ```sql
   SELECT id, status, requested_at, processed_at FROM deletion_requests
    WHERE user_id = '<user-id>';
   ```
   `queued`면 다음 실행을 기다리면 되고, 급하면 아래 명령을 수동으로 돌립니다.
   **시각을 약속하지 마십시오** — 제품 문구도 약속하지 않습니다.
3. **`failed`로 남아 있다** → 아래 "실패한 요청" 절차. 재시도의 성질은 아래
   "재시도가 수렴하는 이유와 그 한계"에 정확히 적혀 있습니다. 요약하면 재시도는
   **중복 삭제를 만들지 않고 남은 일을 마저 합니다**. 다만 원자적이지 않으므로
   재시도 사이의 계정은 반쯤 지워진 상태로 존재합니다.
4. **"계정을 지웠는데 초대 메일이 온다"** → `waitlist_signups`는 users와 연결이 없어
   계정 삭제 경로가 닿지 않습니다. 아래 **waitlist 초대와 삭제**의 `--forget`으로
   해당 주소를 지웁니다(주소를 argv·셸 히스토리에 남기지 않는 경로입니다). 이
   예외는 `docs/PRIVACY_DATA_MAP.md`의 삭제 후 표에도 적혀 있습니다.
5. **"친구가 계정을 지웠는데 내 캠페인이 archived가 됐다"** → 설계된 동작입니다.
   목소리가 사라진 피치를 계속 공개하지 않습니다(0037). 캠페인 행·사진·관심·룸은
   남아 있고, 되살리려면 새 피치가 필요합니다.
6. **삭제된 계정의 복구 요청** → 불가능합니다. `done`이면 auth 사용자까지 사라진
   상태이고 되돌릴 백업 경로를 두지 않았습니다.

운영자는 service role 환경에서 먼저 dry-run 결과를 검토한 뒤 같은 processor를
실제 실행합니다.

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

보존되는(=타인에게 이관되는) draft에 대해서는 목소리를 담은 객체를 이름으로
지목해 지웁니다 — `<draft>/voice.m4a`와 **`<draft>/renders/*.mp4` 전부**, 그리고
그 `media_render_jobs` 행(렌더러가 원본 오디오 스트림을 그대로 복사하므로 MP4는
같은 녹음의 두 번째 사본입니다 — T007에서 수리). 이 stage는 세 걸음이 정해진
순서로 돌아갑니다: ① `media_render_jobs` 행 삭제(`output_storage_path`가 없는
객체를 광고하는 상태는 허용해도, 살아 있는 객체를 광고하는 행이 남는 것은
허용하지 않습니다) → ② renders 폴더 **재나열** 후 객체 삭제 → ③ 종료 직전 한 번 더
재나열해 목소리 유래 객체가 0개임을 확인. ③이 필요한 이유는 supabase-js의
`remove()`가 객체 단위 실패를 bucket 오류로 올려 주지 않기 때문입니다 — "오류
없음"은 "객체 없음"이 아닙니다. 남아 있으면 stage가 실패하고 요청은 `failed`로
유지됩니다.

### 재시도가 수렴하는 이유와 그 한계

재시도는 저장된 계획을 이어서 실행하는 것이 아니라 **매번 DB에서 범위를 다시
만듭니다**(`collectScope`). 따라서 이미 지워진 것은 다시 지우려 해도 no-op이고,
남은 것만 처리됩니다.

이것이 성립하려면 **범위를 좁히는 stage가 마지막이어야 합니다.** 범위 질의는
`pitch_drafts`를 `created_by_user_id = <user> OR subject_user_id = <user>`로 찾는데,
소유권 이관 stage가 바로 그 `created_by_user_id`를 새 소유자로 바꿉니다. 이관이
끝난 draft는 이후 어떤 시도에서도 보이지 않습니다. 그래서 "이 사용자가 그 draft를
만들었다"에서 파생되는 모든 작업 — 실질적으로 목소리 소거 — 은 **이관보다 앞에**
둡니다(T007 리뷰에서 수정). 반대 순서였을 때는 이관 성공과 목소리 소거 사이에서
실패한 실행이 녹음을 storage에 영구히 남겼고, 이후 재시도는 전부 "할 일 없음"으로
성공을 보고했습니다.

한계 두 가지를 그대로 적습니다. ① **원자적이지 않습니다.** REST 호출 다수이므로
재시도 사이의 계정은 반쯤 지워진 상태로 존재합니다. ② 수렴은 **남은 작업이
완료된다**는 뜻이지 **이미 실패한 시도가 되돌려진다**는 뜻이 아닙니다. 되돌릴
경로는 없습니다.

### 합성 계정으로 왕복 검증을 했을 때

소거 경로를 hosted에서 실증하면 `deletion_requests`에 `done` 행이 하나 남습니다.
이 행은 **원칙적으로 보존 대상**입니다 — 소거가 실행됐다는 운영 기록이고
`docs/PRIVACY_DATA_MAP.md`도 그렇게 적고 있습니다. **예외는 합성·테스트 계정
한 가지뿐입니다**: 실제 사용자가 존재한 적 없는 계정의 감사 행은 남길 대상이
없으므로, **사유를 기록한 뒤** 정리할 수 있습니다.

- 실제 사용자 계정의 `deletion_requests` 행은 어떤 이유로도 지우지 않습니다.
- 합성 계정 정리는 대상 `user_id`, 왕복을 수행한 날짜와 목적(예: "T007 소거
  실증")을 `docs/DECISIONS.md`의 해당 항목 검증 문단에 남긴 뒤 수행합니다.
- 정리 쿼리는 단건으로만 씁니다:
  `DELETE FROM deletion_requests WHERE user_id = '<synthetic-user-id>';`

## 원칙

- 신고 처리 SLA: 출시 초기에는 매일 1회 이상 큐 확인
- 모든 조치는 이 문서의 쿼리로 수행하고, 애매한 케이스는 결정 기록에 남긴다
- mock 처리 금지 원칙(CLAUDE.md 9)에 따라 이 런북이 최소 실물 운영 도구다 —
  전용 운영자 UI는 출시 후 P1

## Launch gates (0023 — 2차 감사 Slice 0, 0060에서 sandbox 분기)

`app_config`의 스위치가 실결제와 외부 공개 베타를 서버에서 차단합니다. 기본값은 모두 `off`이며 **Slice 10 release gate(2차 감사 §7) 통과 전에는 hosted에서 `real_payments_enabled`를 켜지 않습니다.**

| key                        | off일 때 차단되는 것                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `real_payments_enabled`    | PRODUCTION `purchase_intents` INSERT(구매 시작), PRODUCTION environment `purchase_events`(효익 지급)           |
| `public_beta_enabled`      | `interests` INSERT(외부 사용자의 관심 표현 제출)                                                               |
| `sandbox_payments_enabled` | SANDBOX `purchase_intents` INSERT, 그리고 **SANDBOX 구매 이벤트의 효익 지급**(닫혀 있으면 review로만 남습니다) |

- 0060 이후 게이트는 environment로 갈립니다. **프로덕션 기본 off는 그대로입니다** — PRODUCTION intent는 여전히 `real_payments_enabled`를 요구하고, PRODUCTION 이벤트는 여전히 `purchase_events_production_gate`가 막습니다.
- SANDBOX intent는 `sandbox_payments_enabled=on` **그리고** `sandbox_test_accounts`에 등록된 계정에만 발급됩니다. 스위치만 열려도 다른 사람의 구매는 열리지 않습니다. 절차는 아래 "RevenueCat sandbox 결제 드릴".
- 웹훅도 **지급 직전에 두 조건을 다시 봅니다**(창이 열려 있는가, 지급 대상이 등록되어 있는가). intent는 발급 시점의 사실만 증명하므로, 드릴 도중 등록을 해제했거나 이전 창의 intent가 뒤늦게 도착한 웹훅은 지급 없이 `sandbox_purchase_not_enrolled` / `sandbox_payments_closed` review로 남습니다.
- **환불·취소·만료(효익 회수) 이벤트에는 두 제한이 모두 적용되지 않습니다.** 창을 닫고 등록을 지우는 것이 드릴의 정상 종료 상태인데, 그 뒤 도착한 환불을 거부하면 이미 지급된 효익이 그대로 남기 때문입니다.
- 로컬 테스트 DB는 `supabase/seed.sql`이 세 게이트를 모두 켭니다(스위트가 SANDBOX 이벤트를 재생하므로). hosted에는 seed가 적용되지 않으므로 기본 off가 유지됩니다.
- `scripts/e2e-production.mjs`는 실행 시작 시 `real_payments_enabled`·`sandbox_payments_enabled`를 열고 종료 시(finally) 이전 값으로 원복합니다. 중단으로 원복이 누락됐는지 확인하려면:

```sql
SELECT key, value, updated_at FROM app_config
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled', 'sandbox_payments_enabled');
```

- 게이트 상태 변경은 service role SQL로만 하며, 변경 시 이 문서와 `docs/DECISIONS.md`에 날짜·이유를 남깁니다:

- **변경 이력**: 2026-08-11 `public_beta_enabled` off→**on** (사용자 실행 — Goal `render-launch-path` 완료로 베타 개방, DECISIONS 당일 항목). `real_payments_enabled`는 off 유지.

```sql
UPDATE app_config SET value = 'on'  -- 또는 'off'
 WHERE key = 'real_payments_enabled';
```

## RevenueCat sandbox 결제 드릴 (0060 이후 — 사용자 실행)

목적: **실결제 게이트를 켜지 않고** 실 스토어 sandbox 왕복(구매 → 웹훅 멱등 → restore → 환불)을 한 번 통과시킵니다. 아래 전 과정은 `real_payments_enabled=off` 상태로 수행합니다. 드릴 중 이 스위치를 켜지 않습니다.

SQL은 전부 **service role**(Supabase Studio SQL editor)에서 실행합니다.

### 0. 전제 점검 — 하나라도 아니면 시작하지 않습니다

| 확인                     | 방법                                                                                                                                                          | 기대                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0060이 hosted에 있다     | `SELECT to_regclass('public.sandbox_test_accounts');`                                                                                                         | NULL이 아님                                                                                       |
| 스위치가 기본값이다      | `SELECT key, value FROM app_config WHERE key IN ('real_payments_enabled', 'sandbox_payments_enabled');`                                                       | 둘 다 `off`. sandbox가 이미 `on`이면 앞선 드릴이 창을 닫지 않은 것 — 먼저 7단계로 닫고 시작합니다 |
| 등록부가 비어 있다       | `SELECT user_id, note, enrolled_at FROM sandbox_test_accounts;`                                                                                               | 0행. 남아 있으면 그 계정은 드릴 밖에서도 sandbox 대상이므로 이유를 확인하고 지웁니다              |
| 웹훅이 도달한다          | Vercel 환경변수에 `REVENUECAT_WEBHOOK_AUTH_TOKEN`이 있고 RevenueCat 웹훅 URL이 production origin `/api/revenuecat`                                            | 없으면 라우트가 **501**을 답하고 이벤트가 영영 안 옵니다                                          |
| 빌드에 iOS 키가 구워졌다 | `cd apps/mobile && pnpm dlx eas-cli env:list production` 에 `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`가 보이고, 그 뒤 빌드한 TestFlight 앱의 paywall이 가격을 표시 | paywall이 "Billing isn't live yet"이면 키가 안 구워진 것 — env 등록 **후 재빌드**해야 반영됩니다  |
| sandbox 테스터 계정      | ASC → Users and Access → Sandbox → Test Accounts                                                                                                              | 계정 존재                                                                                         |
| 기기가 sandbox 로그인    | iPhone 설정 → App Store → 하단 SANDBOX ACCOUNT                                                                                                                | 위 테스터 계정                                                                                    |

### 1. 드릴 창 열기 (등록 + 스위치)

**등록하는 순간부터 이 계정은 프로덕션 구매를 할 수 없습니다**(그 사람의 구매는 정의상 테스트로 취급됩니다 — 0060의 fail-safe 방향). 그러니 등록 전에 그 계정에 진행 중인 구매가 없는지 한 번 봅니다: `SELECT id, product_id, status, environment, expires_at FROM purchase_intents WHERE user_id = '<user_id>' AND status = 'issued' AND expires_at > now();` — 0행이어야 하고, 남아 있으면 그 결제를 끝내거나 만료를 기다린 뒤 시작합니다.

```sql
-- 앱에서 로그인할 계정의 user id (TestFlight에서 쓰는 이메일로 찾습니다)
SELECT u.id FROM users u
  JOIN auth.users a ON a.id = u.id
 WHERE a.email = '<TestFlight 로그인 이메일>';

INSERT INTO sandbox_test_accounts (user_id, note)
VALUES ('<user_id>', 'sandbox drill <YYYY-MM-DD>');

UPDATE app_config SET value = 'on' WHERE key = 'sandbox_payments_enabled';

SELECT key, value FROM app_config
 WHERE key IN ('real_payments_enabled', 'sandbox_payments_enabled');
```

기대: `real_payments_enabled=off`, `sandbox_payments_enabled=on`. **real payments가 on이면 여기서 멈춥니다** — 이 드릴은 off 상태를 증명하는 절차입니다.

Campaign Pass($19.99)까지 드릴한다면, Pass는 **캠페인 상태를 바꿉니다**(`ends_at` +30일, `expired`였다면 `published`로 부활). 되돌리려면 바꾸기 전 값이 필요하니 지금 적어 둡니다:

```sql
SELECT id, status, ends_at FROM campaigns WHERE id = '<대상 campaign_id>';
```

Creator Launch만 드릴한다면 캠페인은 손대지 않으므로 이 줄은 건너뜁니다.

### 2. 구매 (앱, Creator Launch $4.99)

앱에서 pitch draft를 하나 만들고 Creator kit 잠금 해제로 들어가 결제합니다. Apple 결제 시트에 **[Environment: Sandbox]** 문구가 있어야 합니다(없으면 실계정으로 실결제를 하려는 것이니 취소).

기대: 결제 후 앱이 확인 대기로 넘어가고 60초 안에 kit이 열립니다.
막히면: "purchases are not available yet"는 1단계 등록/스위치가 안 된 것, "Billing isn't live yet"는 키가 안 구워진 것입니다.

### 3. 서버 확인

```sql
SELECT provider_event_id, event_type, environment, product_id,
       original_transaction_id, purchased_at
  FROM purchase_events ORDER BY created_at DESC LIMIT 5;

SELECT credit_state, environment, pitch_draft_id, idempotency_key
  FROM purchase_credit_ledger ORDER BY created_at DESC LIMIT 5;

SELECT id, status, environment FROM purchase_intents
 WHERE user_id = '<user_id>' ORDER BY created_at DESC LIMIT 5;
```

기대: 이벤트 `environment='SANDBOX'`, 원장 `credit_state='available'`·`environment='SANDBOX'`, intent `status='consumed'`·`environment='SANDBOX'`.
행이 하나도 없으면 웹훅이 안 온 것입니다 — RevenueCat 대시보드의 이벤트 delivery 로그와 아래 review 큐를 함께 봅니다.
**3단계의 `original_transaction_id`를 적어 둡니다.** 6단계에서 씁니다.

### 4. 웹훅 멱등

RevenueCat 대시보드에서 그 이벤트를 **재전송(resend)** 합니다.

```sql
SELECT provider_event_id, count(*) FROM purchase_events
 WHERE original_transaction_id = '<3단계 값>' GROUP BY 1;
SELECT count(*) FROM purchase_credit_ledger WHERE idempotency_key = '<3단계 값>';
```

기대: 이벤트 id별 1행, 원장 1행. 숫자가 늘면 즉시 중단하고 보고합니다.

### 5. Restore

앱 삭제 → TestFlight에서 재설치 → 같은 계정으로 로그인 → paywall에서 **Restore purchases**.

```sql
SELECT count(*) FROM purchase_intents WHERE user_id = '<user_id>';
SELECT count(*) FROM purchase_credit_ledger WHERE user_id = '<user_id>';
```

기대: 두 숫자 모두 **변하지 않습니다**. restore는 새 purchase intent를 발급하지 않는 것이 계약입니다(3차 감사 Slice 4 (d)). 앱에서는 kit이 다시 보여야 합니다.

### 6. 환불

- **경로 A (선호)**: RevenueCat 대시보드 → 해당 Customer → 그 transaction → Refund.
- **경로 B (A가 불가능할 때 — 서버 계약만 검증)**: 3단계의 transaction id로 REFUND 웹훅을 직접 재생합니다.

```sh
curl -sS -X POST "https://friendword-web-nmsi.vercel.app/api/revenuecat" \
  -H "Authorization: $REVENUECAT_WEBHOOK_AUTH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"event":{"id":"drill-refund-<YYYYMMDD>","type":"REFUND",
       "app_user_id":"<user_id>","product_id":"creator_launch_credit_499",
       "environment":"SANDBOX","transaction_id":"<3단계 값>",
       "original_transaction_id":"<3단계 값>"}}'
```

기대 응답: `benefit.kind='creator_credit_revocation'`. 아직 kit을 만들지 않았으면 `revoked=true`·`state='revoked'`, 이미 kit이 만들어졌으면 `revoked=false`·`state='consumed'`입니다(배달된 kit은 회수하지 않는 것이 계약 — 3차 감사 (f)). 원장으로 재확인:

```sql
SELECT credit_state, environment FROM purchase_credit_ledger
 WHERE idempotency_key = '<3단계 값>';
```

경로 B는 **스토어가 아니라 서버 계약만** 증명합니다. B로 끝냈다면 "실 스토어 환불 왕복 미검증"을 남은 위험으로 기록합니다.

### 7. 창 닫기와 정리

```sql
UPDATE app_config SET value = 'off' WHERE key = 'sandbox_payments_enabled';
DELETE FROM sandbox_test_accounts WHERE user_id = '<user_id>';

-- 닫혔는지 확인 (등록부는 0행이어야 합니다)
SELECT key, value FROM app_config
 WHERE key IN ('real_payments_enabled', 'sandbox_payments_enabled');
SELECT count(*) AS still_enrolled FROM sandbox_test_accounts;
```

창이 닫히면 뒤늦게 재전송된 sandbox 웹훅은 효익을 만들지 못하고 `sandbox_payments_closed` review로만 남습니다(설계된 동작). **회수 이벤트(환불·취소·만료)는 창과 무관하게 계속 처리됩니다** — 6단계 환불이 드릴 종료 후에 도착해도 정상 회수됩니다.

**드릴이 남긴 산출물**은 이번 드릴의 것만 봅니다. `environment = 'SANDBOX'` 전체를 훑으면 예전 드릴 잔재까지 섞여 "이번에 뭘 만들었는지"를 못 읽습니다:

```sql
-- 이번 드릴의 산출물만 (3단계에서 적어 둔 transaction id로 한정)
SELECT 'credit' AS kind, id::TEXT, credit_state::TEXT AS state, environment, created_at
  FROM purchase_credit_ledger
 WHERE idempotency_key = '<3단계 값>'
UNION ALL
SELECT 'entitlement', id::TEXT, active::TEXT, environment, created_at
  FROM campaign_entitlements
 WHERE original_transaction_id = '<3단계 값>'
UNION ALL
SELECT 'event', provider_event_id, event_type, environment, created_at
  FROM purchase_events
 WHERE original_transaction_id = '<3단계 값>';

-- 이번 드릴이 만든 review가 남았는지 (있으면 아래 진단표대로 종결합니다)
SELECT id, provider_event_id, reason, status, created_at
  FROM purchase_event_reviews
 WHERE status = 'open'
   AND payload ->> 'original_transaction_id' = '<3단계 값>';
```

이 행들은 지우지 않고 남깁니다 — 라벨이 있어서 집계에서 빠지고(`docs/COST_MODEL.md`), 지우면 드릴이 실제로 무엇을 통과했는지 증거가 사라집니다. 다만 **오래된 드릴 잔재 전체를 세는 감사용 쿼리**가 필요하면 라벨로 훑되 `purchase_events`는 계약이 달라 `upper(coalesce(environment, ''))`로 봅니다:

```sql
SELECT count(*) FROM purchase_credit_ledger WHERE environment = 'SANDBOX';
SELECT count(*) FROM campaign_entitlements  WHERE environment = 'SANDBOX';
SELECT count(*) FROM purchase_events WHERE upper(coalesce(environment, '')) = 'SANDBOX';
```

#### 7b. Campaign Pass를 드릴했다면 — 캠페인 상태 원복

Creator Launch는 draft에만 크레딧을 만들고 끝나지만, **Pass는 캠페인 자체를 바꿉니다**: `ends_at`이 30일 늘고, `expired`였던 캠페인은 `published`로 되살아납니다. 그대로 두면 무료 sandbox 구매가 실제 노출 기간을 연장한 셈이 됩니다. 순서대로 되돌립니다.

1. entitlement를 계약대로 비활성화합니다(직접 UPDATE 대신 만료 이벤트를 재생합니다 — 상태 기계를 우회하지 않기 위해서. 창이 닫혀 있어도 회수는 처리됩니다):

```sh
curl -sS -X POST "https://friendword-web-nmsi.vercel.app/api/revenuecat" \
  -H "Authorization: $REVENUECAT_WEBHOOK_AUTH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"event":{"id":"drill-pass-expire-<YYYYMMDD>","type":"EXPIRATION",
       "app_user_id":"<user_id>","product_id":"campaign_pass_30d_1999",
       "environment":"SANDBOX","original_transaction_id":"<Pass의 transaction id>"}}'
```

기대 응답: `benefit.kind='campaign_pass_expiration'`, `active=false`.

2. 1단계에서 적어 둔 값으로 캠페인 창을 돌립니다(**그 캠페인 하나만**):

```sql
UPDATE campaigns
   SET ends_at = '<1단계에 적어 둔 ends_at>',   -- 원래 NULL이었으면 NULL
       status  = '<1단계에 적어 둔 status>'
 WHERE id = '<대상 campaign_id>';

SELECT id, status, ends_at FROM campaigns WHERE id = '<대상 campaign_id>';
SELECT active, expires_at, environment FROM campaign_entitlements
 WHERE campaign_id = '<대상 campaign_id>' AND product_id = 'campaign_pass_30d_1999';
```

기대: `status`·`ends_at`이 드릴 전 값과 같고 entitlement는 `active=false`.

3. entitlement 행 자체는 남습니다(라벨 `SANDBOX`, 비활성). 다만 그 캠페인에 **실제 결제 이력이 있었다면 라벨은 `PRODUCTION`으로 유지됩니다** — (campaign, product)당 행이 하나뿐이라 실매출 행을 테스트로 강등하지 않는 쪽을 택했기 때문입니다(0060, `docs/COST_MODEL.md`). 그 경우 이번 드릴 산출물은 위 `purchase_events` 조회로 식별합니다.

### 실패 진단 — `purchase_event_reviews.reason`

review로 빠진 이벤트는 **아무 효익도 만들지 않은 채 보류**된 것입니다(원장·entitlement에 행이 없습니다). 되살리는 길은 두 가지뿐이고, 어느 쪽이든 review 행은 종결시켜야 큐가 깨끗해집니다.

- **재생(권장)** — 원인을 고친 뒤 RevenueCat 대시보드에서 같은 이벤트를 재전송합니다. 웹훅은 멱등이므로 안전하고, 이때 효익이 정상 생성됩니다. 재생이 성공했으면 남은 review 행은 `SELECT resolve_purchase_event_review('<review_id>', 'dismiss');`로 닫고 무엇을 고쳐서 재생했는지 `resolution_note`에 남깁니다.
- **수동 귀속** — 재생이 불가능한 경우에만. creator credit은 `SELECT resolve_purchase_event_review('<review_id>', 'reassign', '<target_user_id>');`로 대상 사용자에게 귀속합니다. Campaign Pass는 reassign 대상이 아니라 refresh만 수행됩니다(위 "RevenueCat review resolve").

review id는 위 7단계의 조회나 `SELECT id, provider_event_id, reason FROM purchase_event_reviews WHERE status = 'open';`으로 찾습니다.

| reason                          | 뜻                                                       | 조치                                                                                                            |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sandbox_payments_closed`       | 창이 닫힌 상태에서 sandbox **구매** 이벤트 도착          | 드릴을 계속할 거면 1단계로 창을 열고 재전송 → 성공 후 `dismiss`. 이미 끝난 드릴이면 그대로 `dismiss`(정상 동작) |
| `sandbox_purchase_not_enrolled` | 창은 열려 있으나 구매자가 `sandbox_test_accounts`에 없음 | 1단계 등록을 다시 확인(드릴 중 등록을 지웠거나 다른 계정으로 로그인) → 등록 후 재전송 → `dismiss`               |
| `environment_mismatch`          | PRODUCTION 이벤트가 SANDBOX intent를 소비 시도           | 실결제가 섞인 것 — **재생하지 않습니다.** 창을 닫고 원인 확인 후 보고                                           |
| `unattributed_purchase`         | intent 없이 도착한 구매                                  | 등록 전에 구매했거나 subscriber attribute 누락 — 재구매로 재현, 재현 불가면 `reassign`                          |
| `pass_scope_ownership_changed`  | Pass 대상 캠페인 소유가 바뀜                             | 대상 캠페인 확인 후 수동 판단(자동 reassign 대상 아님)                                                          |

나머지 reason과 종결 절차는 아래 "RevenueCat review resolve", "RevenueCat review 큐" 절을 따릅니다.

### 2026-09-08 드릴 실행 기록 (T008 / Issue #77 — 경로 B, 자율 실행)

- **범위**: Campaign Pass, 대상 캠페인 `jordan-tbn8xp`(QA 계정 소유, 라이브). `real_payments_enabled`는 시작·종료 모두 `off`로 확인.
- **§1 창 열기**: `sandbox_test_accounts` 등록 + `sandbox_payments_enabled=on` — 정상.
- **§2 구매 의도**: 앱과 같은 인자로 `issue_purchase_intent(product_id, scope_id)` 호출 → `purchase_intents.environment='SANDBOX'`, status `issued` — 정상.
- **§3 지급**: `NON_RENEWING_PURCHASE`(SANDBOX, intent 첨부) → `recorded=true, needs_review=false`, `campaign_entitlements` active·environment SANDBOX, 캠페인 `ends_at` +30일, 성장 이벤트 `campaign_pass_purchased`의 `properties.environment='SANDBOX'` — 정상.
- **§4 멱등**: 같은 event id 재전송 → `deduplicated=true`; 같은 transaction·새 event id(restore) → 효익 중복 없음(`expires_at` 동일) — 정상.
- **§6 환불**: `REFUND` → `campaign_pass_deactivation`, entitlement `active=false`, `needs_review=false` — 정상.
- **§7 정리**: 스위치 `off`, 등록 삭제, 캠페인 `status`/`ends_at` 원복 — 전부 확인. 남는 흔적은 SANDBOX 라벨의 비활성 entitlement 1행과 24시간 뒤 만료되는 intent 1행(집계 제외 대상).
- **HTTP 웹훅 단계는 실행하지 못함**: `https://friendword.com/api/revenuecat`이 로컬 `.env`의 `REVENUECAT_WEBHOOK_AUTH_TOKEN`으로 `401` — 로컬 파일이 Vercel 값과 다르다. 위 결과는 `record_revenuecat_event(payload)`를 service-role로 직접 호출한 것(라우트의 검증·매핑은 audit3 테스트가 덮음). **실 스토어 구매→RevenueCat→웹훅 전달**은 여전히 실기기 항목이다.
- 러너북 정정: §3 조회 SQL의 `purchase_events.app_user_id`·`needs_review`, `campaign_entitlements.ends_at` 컬럼은 존재하지 않는다(실제: `purchase_events.provider_event_id/event_type/environment`, `campaign_entitlements.active/expires_at/environment`). 다음 개정 때 예시 SQL을 실제 컬럼으로 맞출 것.

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

## 피치 정리 삭제 (0059 이후 — T010, Issue #47)

Introducer가 **캠페인이 되지 못한 자기 pitch draft**를 앱에서 직접 지웁니다(모바일
`My campaigns` → "Pitches I'm making" 카드 → `Delete this pitch` → 사실 목록 + 명시
확인). 서버 RPC는 `public.delete_my_pitch_draft(target_draft_id)`이고 `authenticated`
전용입니다. **운영자가 대신 눌러 줄 수단은 없습니다** — RPC가 `auth.uid()`의 소유
draft만 지우며, 대리 삭제 경로는 의도적으로 두지 않았습니다(계정 삭제와 같은 규율).

**이것은 소거(erasure)가 아니라 정리(cleanup)입니다.** 차이는 한 곳에서 관찰됩니다:
`erase_pitch_draft`(0018)는 `friendword.erasure`를 켜서 0051의 flagged-clip 삭제
추적(`ops_alerts` `video_moderation_review_deleted`)을 **의도적으로 침묵**시키지만,
0059는 별도 플래그 `friendword.cleanup`을 쓰므로 그 추적이 **정상적으로 남습니다**.
사용자가 draft를 지워도 안전 기록은 사라지지 않습니다.

### 서버가 거부하는 세 가지와 문의 대응

| 서버 메시지                                                     | 뜻                                                       | 대응                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a published pitch is taken down by the person it is about`     | 이미 캠페인이 있는 pitch. 공개 페이지는 Dater 것         | Dater의 웹 `/inbox` → "Take it down for good"(archived)을 안내합니다. Introducer에게 대신 지워 주지 않습니다                                                                                   |
| `this pitch is still being processed and cannot be deleted yet` | 그 draft의 clip ingest 또는 렌더 잡이 `queued`/`leased`  | 일시적입니다. 잡이 종결되면 지워집니다. 잡이 오래 `queued`에 머물면 워커 상태를 먼저 봅니다(§정기 운영 실행)                                                                                   |
| `this pitch has a purchase attached and cannot be deleted here` | `purchase_credit_ledger`에 그 draft를 가리키는 행이 있음 | **운영 판단 사항입니다.** 결제 기록은 사용자의 정리 제스처로 지우지 않습니다. 환불·크레딧 이전 여부를 먼저 정하고, 정해진 뒤에만 service-role로 원장을 조정한 다음 사용자가 다시 지우게 합니다 |

확인 쿼리(service role):

```sql
SELECT d.id, d.status,
       (SELECT count(*) FROM campaigns c WHERE c.pitch_draft_id = d.id) AS campaigns,
       (SELECT count(*) FROM media_ingest_jobs j
          JOIN pitch_assets a ON a.id = j.asset_id
         WHERE a.pitch_draft_id = d.id AND j.status IN ('queued','leased')) AS live_jobs,
       (SELECT count(*) FROM purchase_credit_ledger l WHERE l.pitch_draft_id = d.id) AS credits
  FROM pitch_drafts d WHERE d.id = '<draft-id>';
```

### 바이트는 orphan sweep이 회수합니다

RPC는 **DB 행만** 지웁니다(0046 선례: SQL에서 `storage.objects`를 지우면 Storage의
메타데이터만 사라지고 바이트는 남아 아무도 회수할 수 없는 객체가 생깁니다). draft가
사라지면 그 prefix를 붙잡고 있던 참조가 전부 함께 사라지므로 — `pitch_assets`는
CASCADE, `consent_revisions`도 CASCADE(= 위 "consent revision이 있는 prefix는 보호"
규칙이 풀립니다), campaign은 애초에 거부됨 — 다음 sweep이 48시간 뒤 회수합니다.
따라서 **"몇 시간 안에 지워집니다"라고 답하지 않습니다.** 제품 문구도 시각을
약속하지 않습니다. `media_validations` 행은 cascade가 없어 RPC가 prefix로 직접
지웁니다.

문의가 "지웠는데 파일이 남아 있는 것 같다"이면: 앱 목록과 서버에서는 이미 사라졌고
저장소 정리는 정기 잡이 한다고 안내합니다(계정 삭제와 같은 설명). 확인:

```sh
node scripts/cleanup-orphan-media.mjs   # dry-run, 집계만 출력
```

### hosted 왕복 증명 (0059 push 직후 1회, 그리고 이 경로를 손댈 때마다)

```sh
node scripts/qa/hosted-pitch-draft-cleanup-proof.mjs
```

`scripts/qa/hosted-pitch-draft-cleanup-proof.mjs`는 **연결된 실프로젝트에 쓰는**
스크립트입니다. `.env`의 `SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·
`SUPABASE_SERVICE_ROLE_KEY`를 읽고, 합성 계정으로 로그인해 PostgREST를 통해 실제로
RPC를 호출합니다(service_role은 `auth.uid()`가 NULL이라 0059가 거부하므로 증명이
되지 않습니다).

**로컬 하니스(`bash scripts/test-db.sh`)로는 증명할 수 없는 것만** 여기서 봅니다:
① hosted 기본 권한이 새 public 함수마다 anon에게 EXECUTE를 주므로, `REVOKE … FROM
PUBLIC, anon`이 실제로 걷어냈는지는 hosted에서만 관찰됩니다(P0 — anon 키 호출이
함수 본문에 닿기 전에 권한 거부여야 하며, `authentication required`가 돌아오면 그건
anon이 EXECUTE를 들고 있다는 뜻이라 **실패로 처리**합니다). ② 실제 JWT·PostgREST
경계에서 거부 문장이 그대로 도착하는지(P1~P4, P6).

건드리는 범위는 스크립트 상단 상수가 전부입니다:

| 상수                               | 값                                    | 뜻                                   |
| ---------------------------------- | ------------------------------------- | ------------------------------------ |
| `SYNTHETIC_ID_PREFIX`              | `59010000-0000-4000-8000-0000000000…` | 만드는 모든 행의 id 접두             |
| `SYNTHETIC_EMAIL_LOCALPART_PREFIX` | `t010-cleanup`                        | 합성 계정 local part                 |
| `SYNTHETIC_EMAIL_DOMAIN`           | `friendword.invalid`                  | RFC 2606 예약 도메인(발송 불가)      |
| `UNTOUCHABLE_CAMPAIGN_SLUGS`       | `sumin-n2g2ma`, `jordan-ba9m1u`       | 이름으로 생존을 대조하는 불가침 대상 |

픽스처 생성 시점부터 `try/finally`이므로 어느 단계에서 던져도 합성 행·저장소 객체·
계정을 정리합니다. **정리 실패는 삼키지 않습니다** — 지우지 못한 항목을 이름으로
나열하고 종료 코드를 non-zero로 만듭니다. 그 출력이 보이면 남은 항목을 손으로 지운 뒤
다시 실행합니다.

마지막 P5는 **전체 테이블 총계를 비교하지 않습니다.** 라이브 프로젝트에서는 실사용자
가입 한 건이 무관한 실패를 만들고, 반대로 같은 크기의 맞교환은 총계로 잡히지 않기
때문입니다. 대신 (a) 합성 네임스페이스 잔존 0(저장소는 합성 prefix만 조회 — 버킷
루트를 훑지 않습니다), (b) 실행 전 존재하던 모든 id가 여전히 존재하는지 **id 단위**로
확인합니다.

## RevenueCat review resolve (0038 이후)

TRANSFER 등 자동 귀속 불가 이벤트는 `purchase_event_reviews`에 open으로 남습니다. 운영 종결은 service-role 전용 RPC로만 합니다:

```sql
-- 벤핏(user-scoped creator credit)을 대상 사용자로 재귀속
SELECT resolve_purchase_event_review('<review_id>', 'reassign', '<target_user_id>');
-- 조치 없이 종결(사유는 resolution_note에 남음)
SELECT resolve_purchase_event_review('<review_id>', 'dismiss');
```

- 이미 resolved인 review는 재실행이 거부됩니다(idempotent 가드). `resolved_at`/`resolved_by='service'` 기록.
- Campaign Pass(campaign-scoped entitlement)는 사용자 이동 대상이 아니라 refresh만 수행됩니다 — 소유권 분쟁은 수동 판단 후 reassign은 credit에만.
- resolved 후 90일이 지난 payload는 정기 ops의 PII scrub 대상입니다(위 scheduled-ops 참조).

## RevenueCat review 큐 (0027 이후)

자동 귀속되지 못한 결제 이벤트는 버려지지 않고 `purchase_event_reviews`에 남습니다.

```sql
SELECT provider_event_id, event_type, reason, created_at
  FROM purchase_event_reviews
 WHERE status = 'open'
 ORDER BY created_at;
```

- `reason` 값: `transfer_requires_ops_review`, `unattributed_purchase`, `unmatched_lifecycle_lineage`, `unknown_product`, `unhandled_event_type`, `lifecycle_user_mismatch`, `intent_transaction_conflict`, `malformed_purchase_intent`, `missing_product_id`, `pass_scope_ownership_changed`.
- 처리: payload를 확인해 올바른 사용자·scope를 특정한 뒤, 필요한 경우 서비스 role로 정정 처리하고 `status='resolved'`, `resolution_note`를 남깁니다. 처리 전까지 효익은 지급되지 않습니다(돈이 확인되면 반드시 처리해야 합니다).

## Legacy 무접점 consent 요청 (0029 이후)

- claimable 상태(pending/claimed)의 consent 요청은 verified contact 바인딩 없이는 존재할 수 없고, 바인딩 없는 legacy 요청은 claim 시 "reissued with a verified contact" 오류로 거부됩니다.
- 구제 절차: introducer가 draft를 다시 제출하며 접점을 입력하거나(기존 요청이 rebind됨 — 단 무접점 요청은 재제출도 거부되므로), 실질적으로는 **draft 삭제 후 재생성** 또는 ops가 확인된 접점으로 hash를 직접 세팅하는 방법뿐입니다. raw contact는 저장하지 않으므로 자동 백필은 불가능합니다(의도된 설계).

## Provider 비용 원장과 kill switch (0031 이후)

- 모든 provider 호출(전사·구조화·텍스트/이미지 moderation)은 호출 전 `reserve_provider_usage`로 예약되고 호출 후 reconcile됩니다. 동일 request_ref replay는 재과금되지 않습니다.
- 강제 경계: `provider_kill_switch`(on이면 즉시 전면 차단), `provider_monthly_cap_cents`(기본 20000 = $200), `provider_user_hourly_limit`(기본 60건/시간/사용자), suspended/deletion-requested 계정 차단, draft-scoped AI 작업의 사전 동의(`ai_processing_consents`).
- 현재 burn 조회:

```sql
SELECT date_trunc('month', now()) AS month,
       sum(coalesce(actual_cents, estimated_cents, 0)) AS spent_cents,
       (SELECT value FROM app_config WHERE key = 'provider_monthly_cap_cents') AS cap_cents
  FROM provider_usage_events
 WHERE created_at >= date_trunc('month', now())
   AND status <> 'released';
```

- 긴급 차단: `UPDATE app_config SET value = 'on' WHERE key = 'provider_kill_switch';`

## 정기 운영 실행 (pg_cron + GitHub Actions — 2026-08-11 현재)

실행처는 잡의 성격으로 갈립니다.

| 실행처                                     | 담당                                                   | 주기           |
| ------------------------------------------ | ------------------------------------------------------ | -------------- |
| hosted Supabase **pg_cron**(0043)          | 순수 SQL pass                                          | 15분 / 매일    |
| **GitHub Actions** `scheduled-ops.yml`     | Node·Storage API가 필요한 pass(계정 삭제, orphan 스윕) | 매일 03:10 UTC |
| **GitHub Actions** `safety-escalation.yml` | 신고·ops alert 큐 감시(아래 섹션)                      | 매시간 :17     |

GitHub Actions는 2026-07-25에 **분량 소진·과금 실패로 폐기**했다가 2026-08-11에
용도를 좁혀 재도입했습니다(DECISIONS 당일 항목). 재도입 조건은 분(minute) 예산입니다 —
`scheduled-ops`는 워크스페이스 install이 필요해 실행당 ~3분이므로 **매일 1회**(≈90분/월),
`safety-escalation`은 install 없이 무의존 스크립트만 돌려 1분 최소 과금으로 **매시간**
(≈730분/월). 과거 실패의 원인이던 "무거운 잡을 매시간"(≈1,460분/월) 조합은 금지입니다.
CI 워크플로(`ci.yml`)는 2026-09-08에 **빠른 PR 게이트**로 재설계했습니다 — `pull_request`와
main push에서 단일 job으로 checkout → pnpm(`packageManager` 핀을 그대로 읽음) →
Node `.nvmrc`(22) + pnpm store 캐시 → `pnpm install --frozen-lockfile` →
`pnpm -r typecheck` → `pnpm lint` → `pnpm format:check` → `pnpm -r test` →
`pnpm --filter @friendword/web test:audit3` → `pnpm --filter @friendword/web test:ui`.
DB·브라우저가 필요 없는 검사만 남겼고, `concurrency`로 같은 브랜치의 이전 run을 취소합니다.
DB/RLS 하니스와 web E2E는 `.github/workflows/optional-checks.yml`로 옮겨
**`workflow_dispatch` 수동 실행**만 남겼습니다(마이그레이션·RLS·동의/발행 흐름을 건드린 뒤,
그리고 릴리스 전에 돌립니다). 루트 `test:audit3`는 `scripts/test-db-audit3.sh`(로컬 Postgres)를
함께 돌리므로 PR 게이트에서는 web 필터 버전만 씁니다.

**이 워크플로는 아직 GitHub에서 `disabled_manually`입니다.** 머지 후
`gh workflow enable CI`로 켜야 동작합니다. 켜기 전까지는 push 전 로컬
게이트(`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` + DB 하니스)가
회귀 검증의 본체입니다.

**Vercel 배포 실패 알림** — Vercel의 실패한 배포는 워크플로 실패가 아니라서 소유자의
"failed workflows only" 메일 채널(아래 안전 에스컬레이션 섹션과 같은 채널)에 잡히지
않았습니다. `.github/workflows/deploy-status.yml`이 `deployment_status` 이벤트를 받아
`state == 'failure'`일 때만 checkout·install 없이 배포 URL·로그 URL·설명을 찍고 exit 1
합니다(1 빌링 분 미만). 이 워크플로도 머지 후 활성화가 필요합니다.

**Vercel 프로젝트 중복(미해소)** — 레포에 연결된 Vercel 프로젝트가 `friendword-web`과
`friendword-web-nmsi` **두 개**이고 push마다 둘 다 배포됩니다. 어느 쪽이 friendword.com을
서빙하는지는 저장소만으로 확인할 수 없습니다. **소유자가 Vercel 대시보드에서 확인한 뒤
중복 프로젝트를 삭제해야 합니다** — 그때까지 배포 실패 알림이 두 배로 오고, 어느 프로젝트의
환경변수를 고쳐야 하는지도 모호합니다.

**매직 링크 이메일 전달 점검 (2026-09-08, 미해소)** — 웹의 "Email me a sign-in link" 요청
2건이 **200을 반환했지만 15분 내에 메일이 도착하지 않았습니다**. 같은 시각 앱의 OTP 코드
메일과 알림 메일은 수 초 내에 도착했으므로 SMTP 전체 장애는 아닙니다. 소유자가 Supabase
Auth 로그(magiclink 이벤트)와 Auth SMTP 설정·rate limit(특히 시간당 메일 상한과 magiclink
템플릿)을 확인해야 합니다. 원인 확정 전까지 웹 매직 링크를 **유일한 로그인 경로로 안내하지
마십시오**.

pg_cron이 실행하는 순수 SQL pass 2종:

| job 이름                                  | 주기           | 내용                                             |
| ----------------------------------------- | -------------- | ------------------------------------------------ |
| `expire-due-campaigns`                    | 15분마다       | `expire_due_campaigns()` — 기한 지난 캠페인 만료 |
| `scrub-resolved-purchase-review-payloads` | 매일 03:30 UTC | resolved 후 90일 지난 review payload PII 스크럽  |

상태 확인(SQL Editor, service role):

```sql
SELECT jobname, schedule, active FROM cron.job;
SELECT jobname, status, return_message, start_time
  FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

**Storage API가 필요한 pass**(계정 삭제 처리, orphan 미디어 스윕)는 pg_cron으로 옮길 수
없어 `.github/workflows/scheduled-ops.yml`이 **매일 03:10 UTC(12:10 KST)**에
`node scripts/run-scheduled-ops.mjs`를 실행합니다. orphan 스윕은 워크플로에서 항상
**dry-run**이며 `--apply`는 사람이 검토한 뒤 수동으로만 돌립니다. 매일 주기는 이 문서가
orphan 스윕에 이미 전제한 "초기에는 매일 1회"와 삭제 요청의 lease 안전성(1시간 재claim)에
맞춘 것이고, 동시에 Actions 분 예산(위 표) 때문이기도 합니다. 계정 삭제가 **매일** 자동
처리된다는 것 이상으로("즉시 처리") 주장하지 않습니다.

수동/로컬 실행:

```bash
node scripts/run-scheduled-ops.mjs          # 캠페인 만료 + 삭제 처리 + orphan dry-run
node scripts/run-scheduled-ops.mjs --apply  # orphan 실제 삭제 포함(검토 후에만)
node scripts/expire-campaigns.mjs           # 만료만 단독 실행
```

- 캠페인 만료(Slice 9, 0033): `expire_due_campaigns()`는 service role 전용이며 `ends_at`이 지난 published/paused 캠페인을 `expired`로 전환한다. 공개 페이지는 `ends_at` 기준으로 이미 404이므로 잡이 늦어도 노출 사고는 없지만, inbox 상태·`campaign_expired` 이벤트·재개 차단의 일관성이 필요하고, 만료 지연은 다음 캠페인 발행을 막는다(4차 감사 H-17) — 15분 주기는 그 창을 좁힌다. 만료된 캠페인은 재개 불가, 아카이브만 가능하다.
- **실패 시 확인 순서:** ① `cron.job`에 잡 2종이 active인지 → ② `cron.job_run_details`의 `return_message` → ③ 해당 RPC를 SQL Editor에서 단독 실행해 재현. GH Actions 쪽이면 Actions 탭의 실패 step 로그 → 같은 커맨드를 로컬에서 재현. 계정 삭제는 `process-deletions.mjs`가 `processing` 1시간 lease로 자동 재claim하므로 재실행이 안전. orphan `--apply`는 dry-run의 `unknown_age=0`과 후보 수를 검토한 뒤에만.

수동 실행(GitHub): Actions 탭 → **Scheduled ops** → Run workflow(`workflow_dispatch`).
`Safety escalation`도 같은 방법으로 즉시 돌릴 수 있습니다. 두 워크플로 모두 레포 시크릿
`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`를 씁니다(2026-08-11 사용자 등록 완료 —
`gh api /repos/wwdbsh/friendword/actions/secrets`로 이름만 확인). `scheduled-ops`는
시크릿이 비면 preflight에서 즉시 실패해 DB 없이 도는 일이 없습니다.

## 이벤트 이메일 알림 (0058 — fcp Issue #40, T003)

제품 이벤트 **4종**이 이제 이메일로 나갑니다(관심 도착·수락·**거절**·렌더 완료). 구조는
**outbox**입니다 — 이벤트를 만든 트랜잭션은 행 하나만 쓰고(발송 안 함), 별도 발송기가
나중에 비웁니다. Resend 장애가 관심 표현을 거부하는 일이 없습니다.

| 이벤트                   | 수신자                 | 착지             |
| ------------------------ | ---------------------- | ---------------- |
| `interest_received`      | 캠페인 소유자(Dater)   | `/inbox`         |
| `interest_accepted`      | 관심 발신자            | `/rooms`         |
| `interest_declined`      | 관심 발신자            | `/rooms`         |
| `pitch_render_completed` | 내보내기를 요청한 사람 | `/kit/<draftId>` |

**메일에 들어가는 개인정보는 수신자 본인의 display name 하나뿐입니다.** 상대 이름·프로필·
사진·관심 노트·메시지 본문·campaign slug는 들어가지 않습니다. 이메일 주소는 `auth.users`에만
있고 발송 순간에만 해석되며 `notification_outbox`에는 **저장되지 않습니다**(`last_error`
컬럼은 `'@'`를 포함하면 CHECK가 거부합니다).

### 켜는 데 필요한 설정 (사용자 — 값은 Claude에게 주지 않습니다)

| 이름                                                 | 위치                   | 내용                                                                         |
| ---------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `FRIENDWORD_NOTIFY_SECRET`                           | Vercel env (Sensitive) | 발송 라우트 게이트. 16자 이상 랜덤 문자열. 없으면 라우트가 501               |
| `FRIENDWORD_NOTIFY_FROM`                             | Vercel env             | 발신 신원 (예: `Friendword <notify@friendword.com>`). 인증된 도메인이어야 함 |
| `RESEND_API_KEY`                                     | Vercel env (Sensitive) | 이미 등록됨(2026-08-11)                                                      |
| `FRIENDWORD_SHARE_ORIGIN`                            | Vercel env             | 이미 사용 중(렌더 엔드카드). 메일 링크의 호스트                              |
| `FRIENDWORD_NOTIFY_SECRET` · `FRIENDWORD_WEB_ORIGIN` | GitHub Actions secrets | 일일 백스톱(`scheduled-ops.yml`)이 발송 라우트를 두드릴 때 사용              |

셋 중 하나라도 없으면 발송 라우트는 **아무것도 claim하지 않고 501**을 답합니다(미설정
상태에서 claim하면 큐에 쌓인 모든 항목의 재시도 예산만 태우기 때문입니다). 그동안 outbox는
계속 쌓이고, 72시간이 지난 항목은 발송되지 않고 `expired_before_send`로 종결됩니다 — 스위치를
켠 날 일주일 치 묵은 메일이 한꺼번에 나가는 사고를 막기 위한 의도된 동작입니다(0058 결정 5).

### 활성화 체크리스트 (순서를 지킵니다 — 마지막 항목이 첫 발송입니다)

`0058`은 `notification_email_enabled`를 **`off`로 시드합니다.** 마이그레이션은 시크릿보다
먼저 도착하므로, 기본값이 `on`이면 "마지막 환경변수를 저장하는 순간, 아무도 안 보는 사이에
이 제품의 첫 메일이 나간다"가 됩니다. 그래서 켜는 것은 **의도적인 마지막 한 줄**입니다.

1. `supabase db push --linked` 로 `0058`을 hosted에 적용하고 `supabase migration list`로 정합 확인.
2. 위 표의 Vercel env 3종(`FRIENDWORD_NOTIFY_SECRET`·`FRIENDWORD_NOTIFY_FROM` + 기존
   `RESEND_API_KEY`·`FRIENDWORD_SHARE_ORIGIN`)과 GitHub Actions 시크릿 2종을 등록하고 재배포.
3. **아직 켜지 마십시오.** 배포된 라우트를 먼저 두드려 501/401이 아닌 200과
   `{"claimed":0,...}`가 오는지 확인합니다(스위치가 off라 claim은 0입니다 — 이 단계에서
   확인하는 것은 "게이트를 통과했다"이지 "메일이 나갔다"가 아닙니다):
   ```bash
   curl -sS -X POST "$ORIGIN/api/notifications/send" \
     -H "authorization: Bearer $FRIENDWORD_NOTIFY_SECRET"
   ```
4. 큐에 뭐가 들어 있는지 먼저 봅니다. 오래된 항목은 켜자마자 종결되고, 신선한 항목은
   켜자마자 나갑니다 — 나가도 되는 것들인지 눈으로 확인합니다:
   ```sql
   SELECT status, event_type, count(*), min(created_at) AS oldest
     FROM notification_outbox GROUP BY 1, 2 ORDER BY 1, 2;
   ```
5. **메일함을 열어 둔 채로** 스위치를 켭니다. 이것이 첫 발송입니다:
   ```sql
   UPDATE app_config SET value = 'on' WHERE key = 'notification_email_enabled';
   ```
6. 본인 계정으로 관심 표현 1건을 실제로 발생시키고 **메일 도착을 눈으로 확인**합니다.
   이 확인 전까지 "알림 완료"라고 주장하지 않습니다 — 게이트 green은 "제어 흐름이 맞다"는
   뜻이지 "메일이 도착한다"는 뜻이 아닙니다.
7. 이상하면 되돌리는 것도 한 줄입니다: `value = 'off'`. claim이 즉시 0건을 반환합니다.

### 언제 나가는가 (cron 없음)

렌더 kick 체인과 같은 방식입니다. **이벤트를 만든 웹 요청 경로가 한 번 밀어줍니다**:
관심 제출(`InterestFlow`), 인박스 결정(`InboxView`), 렌더 워커 pass 종료(`render-run`).
브라우저는 시크릿을 들지 않으므로 `/api/notifications/kick`(세션 게이트 릴레이)을 거칩니다.
**한 pass는 4건**을 claim하고(300초 lease), **1건이라도 실제로 발송됐으면** 스스로 다시 kick해
큐를 마저 비웁니다. 조건이 "배치가 가득 찼으면"이 아니라 "**보낸 게 있으면**"인 이유: 4건 전부
실패한 배치가 자기를 다시 부르면, 공급자 장애 하나에 큐 전체의 재시도 예산을 몇 초 만에 태우고
운영자가 손쓸 새도 없이 알림만 쌓입니다. 배치 크기·lease·pass 데드라인의 관계는
`apps/web/src/lib/notifications/timeBudget.ts`가 정의하고 관계 테스트가 고정합니다
(`batch × 엔트리당 상한 + 시계 오차 여유 < lease` — 이것이 깨지면 같은 사람에게 같은 메일이
두 번 갑니다).

**재시도는 즉시 하지 않습니다.** 실패한 항목은 `attempts × 5분`이 지나야 다시 claim됩니다
(0058 결정 5b). 그래서 3회 예산은 몇 초가 아니라 최소 15분에 걸쳐 소진되고, kick을 아무리
많이 눌러도(=kick 라우트에 rate limit이 없어도) 예산을 태울 수 없습니다.

**백스톱은 하루 1회**입니다(`scheduled-ops.yml` → `scripts/drain-notifications.mjs`).
즉 kick이 전부 실패한 경우의 최악 지연은 **최대 하루**이며, 이것은 바닥값이지 약속이 아닙니다 —
제품 UI나 메일 어디에도 배달 시각을 약속하지 마십시오. 백스톱은 응답을 240초까지 기다리고,
그 안에 답이 없으면 **실패가 아니라 "전달됐고 서버에서 계속 돌고 있다"로 기록하고 exit 0**
합니다(pass는 자기 lease와 데드라인 안에서 계속 돕니다). 수동 push:

```bash
curl -X POST "$ORIGIN/api/notifications/send" \
  -H "authorization: Bearer $FRIENDWORD_NOTIFY_SECRET"
node scripts/drain-notifications.mjs   # 같은 일을 .env로 하는 래퍼
```

### 정지 스위치와 큐 조회

```sql
-- 즉시 전면 정지(claim이 0건을 반환합니다 — 배포된 라우트가 계속 호출해도 안 나갑니다)
UPDATE app_config SET value = 'off' WHERE key = 'notification_email_enabled';
-- 만료 기준(기본 72시간). 정수가 아닌 값을 넣으면 큐가 멈추는 대신 72로 degrade합니다 —
-- 오타가 전면 통지 장애가 되지 않게 한 것이지, 아무 값이나 써도 된다는 뜻은 아닙니다.
UPDATE app_config SET value = '72' WHERE key = 'notification_max_age_hours';

-- 큐 상태 (본문·주소가 없는 테이블이라 그대로 조회해도 안전합니다)
SELECT status, event_type, count(*), min(created_at) AS oldest
  FROM notification_outbox GROUP BY 1, 2 ORDER BY 1, 2;
```

### 장애 대응

- 3회 실패하면 항목이 `failed`로 종결되고 `ops_alerts`에 **`notification_send_failed`**가
  남습니다 — 위 신고 에스컬레이션 워크플로가 매시간 이 큐를 읽으므로 통지 채널은 이미 있습니다.
  발송기가 **답을 못 하고 죽는** 경우(lease만 만료되고 complete 호출이 없음)에도 claim이
  직접 종결·알림합니다(`retry_budget_spent`) — 조용히 썩지 않습니다.
- `detail.reason`이 진단입니다: `resend_http_4xx`(발신 도메인·수신 주소 거부),
  `resend_http_429`(레이트 리밋), `resend_request_TimeoutError`, `no_mailbox`(해당 계정에
  이메일 없음), `unroutable_event`(착지 파라미터 결손 — 코드 버그),
  `retry_budget_spent`(발송기가 3회 모두 답 없이 죽음),
  `expired_after_attempts`(시도는 있었는데 72시간 동안 끝내 못 보냄 — 아래 참조).
- **만료는 두 종류이고, 하나만 알림입니다.** `expired_before_send`는 `attempts = 0` —
  아무도 시도한 적 없는 항목이 72시간을 넘긴 것이고(스위치 off·시크릿 미설정 기간의 설계된
  결과), **알림하지 않습니다.** `expired_after_attempts`는 `attempts > 0` — 뭔가 계속
  시도하다 실패했는데 아무도 못 들은 것이고, **`ops_alerts`에 1건 남깁니다.** 큐를 볼 때
  둘을 섞지 마십시오: 앞엣것은 정상, 뒤엣것은 사고입니다.
- 재발송은 되살리기가 아니라 **새 이벤트**로 합니다. 종결된 행을 되돌리는 전이는 트리거가
  거부합니다(`a sent notification is final`). 알림 종결은
  `UPDATE ops_alerts SET resolved_at = now() WHERE id = '<id>';`.
- 수신 거부 링크는 없습니다 — 전부 거래성(transactional) 메일이고, 계정 자체를 끊는 경로는
  계정 삭제입니다(`docs/DECISIONS.md` 2026-08-11 T003 항목).

## 신고 자동 에스컬레이션 (2026-08-11 신설 — fcp Issue #39; 2026-08-12 렌더 큐 편입 — Issue #52)

공개 베타에서 `reports`·`ops_alerts`에는 **자동 소비자가 없었습니다**. 신고가 들어와도
운영자가 위 SQL을 기억해 돌릴 때까지 아무도 모릅니다. 이제
`.github/workflows/safety-escalation.yml`이 **매시간 :17**에
`node scripts/check-safety-escalations.mjs`를 돌려 **세 큐**를 service role로 조회합니다
(신고·ops alert·**렌더 큐 정체**).

- 미처리 건이 하나라도 있으면 **잡을 고의로 실패**시킵니다(exit 2). 실패한 run에 대해
  GitHub가 레포 소유자(wwdbsh@gmail.com)에게 보내는 알림 메일이 **v1 통지 채널**입니다 —
  이 저장소에 이미 존재하는 유일한 push 채널이라 실패 자체를 알림으로 씁니다.
- 따라서 **빨간 run = "운영자 손이 필요하다"**이지 "인프라가 깨졌다"가 아닙니다. 구분은
  exit code로 합니다: `2` = 큐에 미처리 건 존재, `1` = 검사 자체 실패(시크릿 누락·HTTP 오류), `0` = 클린.
- 소유자 계정에서 GitHub → Settings → Notifications → Actions → _failed workflows only_
  알림이 켜져 있어야 채널이 살아 있습니다. 꺼져 있으면 조용히 실패만 쌓입니다.
- 로그 위생: 스크립트는 **건수·row id·경과 시간·allowlist된 유형 라벨**만 출력합니다.
  신고 본문(`detail`), reporter/reported user id, 이메일, 캠페인 slug, alert payload는
  절대 출력하지 않습니다. `reason`은 DB에서 자유 TEXT이므로 allowlist 밖 값은 `unlisted`로
  뭉갭니다. 이 로그는 메일로 나가므로 출력 항목을 늘릴 때 이 경계를 다시 확인하십시오.

수동 실행:

```bash
node scripts/check-safety-escalations.mjs   # 0=클린 / 2=미처리 존재 / 1=검사 실패
```

### 렌더 큐 정체 (2026-08-12 편입 — Issue #52, GAP-8)

세 번째 줄 `render queue: N stalled (> 30m)`가 이 검사입니다. **렌더 큐에는 cron이
없습니다** — 무언가가 워커를 부를 때만 전진합니다(kit 페이지 폴링의
`/api/media/render-kick`, 워커 pass 종료 시 자기 kick, 운영자 curl). 그 전부가
멈추면 잡은 `queued`/`leased`인 채 남고 **아무도 모릅니다**: `ops_alerts`의
`pitch_render_failed`는 claim이 재시도 예산을 소진해야 생기는데, 지금 안 일어나는
것이 바로 그 claim입니다. 사용자 화면은 "Rendering your MP4…"에 머뭅니다.

- **임계 30분의 근거**: claim 지연 실측 1.2초(T009), 자막 포함 최악 렌더 실측
  364초 ≈ 6.1분(SESSION_HANDOFF §1), 기본 lease 900초 = 15분(죽은 워커의 잡은 lease가
  끝나야 재claim 가능), `media_render_concurrency_cap=1`이라 뒤 잡은 앞 잡을 기다림.
  즉 **정상적인 최악의 수명이 15 + 6.1 ≈ 21분**이고 30분은 그 위 40% 여유입니다.
  25분 아래로 내리면 건강한 재시도가 알림이 되고, 한 시간 이상으로 올리면 요청한
  사람의 주의를 넘겨 버립니다. 조정은 env `FRIENDWORD_RENDER_STALL_MINUTES`(5~1440,
  범위 밖·오타는 30으로 degrade — `notification_max_age_hours`와 같은 태도).
- **세는 대상**: `campaigns.status = 'published'`인 캠페인의 잡만 셉니다.
  `claim_media_render_job`은 **paused 캠페인의 잡을 의도적으로 두므로**(resume을
  기다림) 그것까지 세면 운영자가 종결할 수 없는 빨간 run이 매시간 반복됩니다.
- **로그에 나오는 것**: 잡 id·상태(`queued`/`leased`)·경과뿐입니다. `last_error`(워커가
  쓰는 자유 TEXT), campaign id·slug, 요청자, output 경로는 **조회하지도 출력하지도**
  않습니다.
- **대응**: 먼저 워커를 밀어 봅니다 — 백스톱 curl 절차는 이 문서의
  **정기 운영 실행**과 **이벤트 이메일 알림 → 언제 나가는가**에 이미 있는
  `render-kick`/`render-run` 경로입니다. 그래도 안 움직이면 Vercel 함수 로그와
  `media_render_concurrency_cap`을 봅니다. 캠페인이 이미 만료·아카이브됐다면 다음
  claim이 `campaign is no longer renderable`로 종결시키므로 kick 한 번이 정리입니다.
- **초록으로 되돌리는 법은 "잡을 끝내는 것"뿐입니다.** 상태를 손으로 바꾸는 SQL은
  0054의 전이 트리거가 거부하며, 우회할 이유도 없습니다.

### 대응 runbook (알림 메일을 받았을 때)

1. run 로그의 요약 줄에서 건수와 id를 확인합니다(본문은 로그에 없습니다 — 의도된 것).
2. 신고 본문·대상은 이 문서 맨 위 **신고 큐** 쿼리로 SQL Editor에서 확인합니다.
   ops alert는 `SELECT * FROM ops_alerts WHERE resolved_at IS NULL;`.
   렌더 정체는 위 절을 따릅니다.
3. 조치는 **조치 도구** 섹션(캠페인 강제 중단 / 차단 / 계정 정지 / 미디어 제거)으로 합니다.
4. 종결: 신고는 `UPDATE reports SET status='resolved'`(또는 `dismissed`),
   alert는 `UPDATE ops_alerts SET resolved_at = now() WHERE id = '<id>';`.
   **이 종결을 해야 다음 정시 run이 초록으로 돌아옵니다.**

### 알려진 트레이드오프

- **"이미 알린 건 다시 알리지 않기"가 없습니다.** ack 컬럼을 새로 만들지 않고
  `reports.status='open'`·`ops_alerts.resolved_at IS NULL`이라는 기존 상태만 씁니다. 즉
  미처리 건이 남아 있는 한 매시간 실패 메일이 반복됩니다(의도된 nag). 부작용은 알림 피로와
  "빨간 run이 일상"이 되는 둔감화이며, 방치가 길어지면 신규 마이그레이션으로 ack 상태를
  도입하거나 주기를 늦추는 쪽을 재검토합니다.
- 채널이 GitHub 메일이라 **지연·스팸함·Actions 분량 소진**에 취약합니다. 실제 알림
  파이프라인(예: Slack/webhook)은 후속 과제입니다.

## waitlist 초대와 삭제 (2026-08-12 신설 — fcp Issue #52, GAP-10)

`waitlist_signups`(migration 0039)는 **평문 이메일**을 모읍니다. 목적은 하나 —
초대할 것이 생겼을 때 그 사람들에게 **한 번** 쓰는 것입니다. 2026-08-12까지 이
저장소에는 그 메일을 보낼 코드도, 주소를 지울 경로도 없었습니다(계정 삭제 잡은 이
테이블에 닿지 않습니다 — users FK가 없습니다). 이제 `scripts/send-waitlist-invites.mjs`가
둘 다 합니다.

```bash
node scripts/send-waitlist-invites.mjs                                # dry-run(기본): 집계만
node scripts/send-waitlist-invites.mjs --send --invite-url=https://…  # 발송 + 성공한 행 삭제
node scripts/send-waitlist-invites.mjs --forget < addresses.txt       # 삭제 요청 처리(stdin)
```

- **기본이 dry-run입니다.** 건수·최고령·source 라벨만 출력하고 아무것도 보내거나
  지우지 않습니다.
- **`--send`에는 `--invite-url=`이 필수이고 기본값이 없습니다.** 지금은 초대할 대상
  자체가 없기 때문입니다(앱이 어느 스토어에도 없습니다). 스토어 URL이 생긴 뒤에만
  이 플래그가 의미를 갖고, 그래서 실수로 밟을 수 없습니다.
- **발송 성공 = 그 행 삭제.** 목적이 한 번으로 끝나므로 주소를 계속 들고 있을 근거가
  사라집니다. 그래서 별도 `invited_at` 컬럼(=migration)이 없습니다 — **"아직 남아 있음"이
  곧 "아직 안 보냄"**이고, 실패한 발송은 행을 남겨 다음 실행이 재시도합니다. 삭제는
  provider가 수락한 **뒤에** 합니다(반대 순서면 provider 장애 한 번에 주소가 사라지고
  그 사람은 영영 못 받습니다). 실행 영수증은 `scripts/.out/waitlist-invites.log`에
  **행 id와 결과만** 남습니다(gitignore `*.log`).
- **로그 위생**: 주소는 쿼리에서 Resend 요청 본문으로만 갑니다. 콘솔·영수증·에러 어디에도
  들어가지 않으며, 출력 직전 `containsAddress`가 `@`가 든 줄을 발견하면 **출력 대신
  종료**합니다. provider 실패는 상태 코드로만 기록합니다(Resend 에러 본문은 거절한
  주소를 그대로 인용합니다).
- **`--forget`은 stdin으로만 받습니다** — 주소가 argv·셸 히스토리·`ps`에 남지 않게.
  대소문자는 접어서 찾고(`lower(email)` unique index와 같은 기준), `ilike`의 `%`·`_`가
  삭제를 넓히지 못하도록 **정확히 일치하는 행만** id로 지웁니다. 출력은
  `requested/forgotten/absent` 카운트뿐입니다.
- 삭제 요청이 올 수 있는 두 경로: 탈퇴 문의(위 **데이터 삭제 요청** 4번)와 초대 메일을
  받은 사람의 회신. 메일 본문이 "이 주소는 발송과 함께 삭제된다"고 말하므로 정상
  경로에서는 요청 자체가 거의 생기지 않아야 정상입니다.
- **실발송은 사용자 결정입니다.** 실인원 대상 커뮤니케이션이므로 Claude는 dry-run까지만
  수행합니다.

### Interest 사진 저장소 정리 (3차 감사 H-5)

웹 interest 플로우(`apps/web/.../InterestFlow.tsx`)는 이제 사진 Remove와 제출 실패
rollback에서 **이번 세션에 업로드한** `profile-media` 객체를 실제로 삭제합니다
(`apps/web/src/lib/profileMedia.ts`). 삭제는 호출자 owner prefix(`<user-id>/…`)로 한정되며,
서버 측 권한은 migration 0037의 owner-prefix client DELETE policy입니다. prefill된(저장된
프로필이 참조 중인) 사진은 Remove 시 storage에서 바로 지우지 않고 로컬에서만 내려
재제출로 참조 해제한 뒤 orphan cleanup이 수거합니다. 즉 orphan 미디어 스윕은 **잔여
안전망**이며, 정상 경로에서는 대부분의 객체가 즉시 정리됩니다. rollback 실패는 사용자
플로우를 막지 않고 콘솔 경고(`interest rollback: …`)로 남으며, 남은 객체는 스윕이 처리합니다.

## TestFlight 배포 채널 (2026-07-14 신설)

목표: 상헌 님 실기기에서 장소 제약 없이 최신 빌드를 TestFlight로 수령. Shipaton 규칙과 정합 — 8/1 전 **비공개 테스트는 허용**, 첫 **공개** App Store release만 8/1~9/30 창구 내(App Review 조기 제출 + 수동 release 전략, HACKATHON_RULES.md).

### 구성 (커밋됨)

- `apps/mobile/eas.json` — development(내부·dev client)/preview(내부 배포)/production(TestFlight, `autoIncrement`+remote 버전) 프로필.
- `apps/mobile/assets/` — icon.png(1024, Devpost 요건 겸용)·adaptive-icon.png·splash-icon.png. app.config.ts에 배선.
- `extra.eas.projectId`는 루트 `.env`의 `EAS_PROJECT_ID`에서 주입(비밀 아님).

### 1회 셋업 (사용자 게이트 — 대화형이라 직접 실행)

1. Apple Developer Program 멤버십(연 $99, 미가입 시 승인까지 최대 48h).
2. Expo 계정: `pnpm dlx eas-cli login`
3. `cd apps/mobile && pnpm dlx eas-cli init` → 출력된 project ID를 루트 `.env`에 `EAS_PROJECT_ID=<uuid>`로 추가.
4. 빌드 env 등록(선별 — 서버 전용 키는 EAS에 올리지 않는다): `pnpm dlx eas-cli env:create production` 를 반복 실행해 `EAS_PROJECT_ID`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`(및 설정 시 `EXPO_PUBLIC_WEB_ORIGIN`) 5개만 plain visibility로 등록. 값은 사용자가 직접 입력(Claude 미수신 원칙).
5. 첫 빌드: `pnpm dlx eas-cli build --platform ios --profile production` (Apple 로그인·인증서/프로파일은 EAS가 자동 관리 — 첫 실행에서 대화형 승인).
6. 제출: `pnpm dlx eas-cli submit --platform ios --latest` (App Store Connect 앱 레코드 자동 생성 가능).
7. App Store Connect → TestFlight → Internal Testing 그룹 생성 → 본인 Apple ID 추가 → 폰의 TestFlight 앱에서 설치. 이후 새 빌드는 5~6번 반복이면 자동 알림.

### 반복 릴리스

`cd apps/mobile && pnpm dlx eas-cli build -p ios --profile production && pnpm dlx eas-cli submit -p ios --latest`

- 내부 테스터 전용인 동안 App Review 불필요(Internal Testing). External 그룹·공개 App Store release는 8/1 이후.
- `real_payments_enabled=off`·`public_beta_enabled=off` 서버 게이트는 TestFlight 빌드에도 동일하게 적용됨(클라이언트 배포와 무관).

## 웹 프로덕션 배포 채널 (2026-07-15 신설)

- **Production origin: `https://friendword-web-nmsi.vercel.app`** (Vercel, GitHub `wwdbsh/friendword` main 연동 — push마다 자동 배포. Root Directory=`apps/web`).
- Vercel 빌드는 `apps/web/vercel.json`의 `buildCommand: next build`를 사용(로컬 build 스크립트의 `.next-build` 리다이렉트는 dev 서버 충돌 방지용 — Vercel에는 불필요).
- Vercel env: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`(Sensitive). `OPENAI_API_KEY`·`REVENUECAT_WEBHOOK_AUTH_TOKEN`은 후속 게이트에서 추가(없으면 해당 라우트만 401/501).
- 배포 스모크(2026-07-15): landing/demo/inbox/rooms 200, unknown slug 404, OG 200 png, 공개 피치 noindex, lang=en, transcribe 401 graceful.
- 모바일 연동: `EXPO_PUBLIC_WEB_ORIGIN`을 EAS production env와 루트 .env에 이 origin으로 설정 후 앱 재빌드. 커스텀 도메인 도입 시 EAS env·RevenueCat 웹훅 URL 함께 갱신.
