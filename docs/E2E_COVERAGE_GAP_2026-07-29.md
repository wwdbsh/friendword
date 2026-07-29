# Friendword 자율 E2E 캠페인 커버리지 갭 감사

감사일: 2026-07-29  
감사 대상 HEAD: `dc54f08892a0626c3281c2cd6fdce68fdc781e94`

## 최종 판정

**“테스트를 다 했다”고 말할 수 없습니다.**

오늘 캠페인은 최초로 실제 모바일 Introducer → 웹 Dater → 웹 Interested Person → Intro Room의 happy path를 연결했고, 몇몇 실제 결함을 찾고 고쳤다는 점에서 가치가 큽니다. 그러나 제품의 전체 출시 계약과 비교하면 다음이 남습니다.

- 4차 감사의 P0 10개 가운데 해당 finding의 완료 기준을 직접 검증한 것은 0개입니다.
- GP-P0 4개 가운데 해당 finding의 완료 기준을 직접 검증한 것은 0개입니다.
- H 17개 가운데 campaign expiration runtime 한 조각(H-13)만 부분 검증됐습니다.
- 모바일 8개 화면 라우트 중 `/interests`, `/paywall`, 홈 `/`의 실제 사용자 실행 증거가 없습니다.
- 웹의 `/rooms` 목록과 authenticated `/kit/[draftId]` 성공 경로가 실행되지 않았습니다.
- 웹 API 7개 중 `/api/kit-image`, `/api/report`, `/api/revenuecat`의 실제 사용자/외부 시스템 왕복이 없습니다.
- `packages/data`가 노출하는 RPC 24개 중 5개는 전혀 실행 증거가 없고, 2개는 거부 경로만, 여러 개는 한 branch만 실행됐습니다.
- 오늘 수정한 다수의 edge path는 unit/mock/SQL test만 green이고 실제 사용자 경로에서는 실행되지 않았습니다.

판정 원칙은 보수적으로 잡았습니다. 오늘 결과 문서에 실제 surface 실행이 명시되지 않은 경로는 “미실행”으로 분류했습니다. mock Playwright, unit test, SQL harness는 회귀 방지 증거로 인정하되 실제 브라우저·기기·hosted vendor 왕복을 대신한다고 보지 않았습니다.

감사 도중 worktree에 다른 작업이 계속 추가되고 있었습니다. 현재 미커밋 상태의 `apps/web/app/api/report/route.ts`, `apps/web/tests-audit3/report-rate-limit.audit3.test.ts`, `supabase/migrations/0044_accept_time_and_expiry_invariants.sql`, `supabase/tests/20_accept_and_expiry_invariants.sql` 등은 오늘 결과 문서가 green으로 승인한 HEAD가 아니므로 해결로 인정하지 않았습니다. 특히 미커밋 0044도 스스로 immutable interest snapshot은 닫지 않는다고 명시합니다(`supabase/migrations/0044_accept_time_and_expiry_invariants.sql:23-27`).

---

## 우선순위가 매겨진 미검증 경로

### P0-1. 승인한 문구와 공개되는 문구의 동일성 + 전체 공개 텍스트 moderation

- **[경로/기능]** Dater가 body에서 문장을 삭제·수정한 뒤 public player, structure card, transcript, OG, Creator Kit 어디에도 원문이 남지 않는지; structure/transcript direct mutation이 moderation과 길이 제한을 우회하지 않는지.
- **[왜 중요한가]** **출시 차단입니다.** 동의하지 않은 민감 문구·오인식 transcript가 공개될 수 있는 동의·개인정보 위반이며 4차 감사 P0-1, P0-2, H-4를 동시에 막습니다.
- **[검증하려면]** immutable/versioned published snapshot을 먼저 구현하고, Dater가 삭제할 sentinel 문구를 structure와 transcript에도 넣은 뒤 승인 전 preview, 승인 후 public player/story/transcript/OG/kit 전부에서 부재를 검증해야 합니다. structure 각 field의 최대 길이·총량·moderation hash를 direct RPC negative test로 고정해야 합니다.
- **[근거 파일:라인]**
  - Dater UI는 headline/body와 사진 include/exclude만 편집합니다: `apps/web/app/consent/[token]/ConsentFlow.tsx:1080-1134`.
  - 최종 preview는 still headline/body이고 실제 public renderer가 아닙니다: `apps/web/app/consent/[token]/ConsentFlow.tsx:1489-1565`.
  - revision은 수정된 headline/body에 이전 structure를 그대로 복사합니다: `supabase/migrations/0041_dater_profile_and_location.sql:242-266`.
  - public은 structure가 있으면 approved body 대신 structure를 렌더하고 transcript를 별도 공개합니다: `apps/web/app/p/[campaignSlug]/page.tsx:132-190`.
  - structure schema에는 문자열 길이·non-empty 제한이 없습니다: `packages/contracts/src/pitchStructure.ts:3-10`.
  - moderation canonical text는 headline/body뿐입니다: `apps/web/app/api/moderate-text/route.ts:24-25,87-92,110-112`.
  - 오늘 문서는 B1/C1을 PASS로 썼지만 이 교차-surface assertion은 없습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:9,25`.

### P0-2. Verified Interest immutable snapshot + content-addressed media + accept-time 재검증

- **[경로/기능]** 정상 profile/photo로 interest 제출 → 같은 storage path의 사진 교체 또는 bio/intent/location 변경 → inbox 재조회 → accept; sender suspension/evidence expiry/deletion request 후 accept.
- **[왜 중요한가]** **출시 차단입니다.** Dater가 본 것과 수락되는 것이 달라질 수 있고, 미검증/교체 콘텐츠 또는 부적격 sender가 room에 들어갈 수 있습니다. 4차 감사 P0-3, P0-4, H-12입니다.
- **[검증하려면]** 제출 순간 immutable profile/media/evidence snapshot을 만들고 content hash/version을 validation과 결합한 뒤, same-path replacement, post-submit profile edit, suspended/deletion-pending/expired-evidence sender, expired/paused campaign의 accept를 hosted DB와 실제 inbox에서 검증해야 합니다.
- **[근거 파일:라인]**
  - inbox RPC는 제출 snapshot이 아니라 현재 `profiles`/`dating_profiles`를 join합니다: `supabase/migrations/0037_account_guard_and_erasure.sql:31-67`.
  - HEAD의 `decide_interest`는 sender의 현재 상태·evidence·media를 재검사하지 않습니다: `supabase/migrations/0012_claim_binding_and_evidence.sql:428-473`.
  - validation key는 path뿐입니다: `supabase/migrations/0016_safety_paths.sql:1-15`.
  - profile media owner는 같은 path 삭제 후 재업로드할 수 있습니다: `supabase/migrations/0037_account_guard_and_erasure.sql:457-466`.
  - 오늘 문서도 이 TOCTOU를 발견만 했고 실행하지 않았습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:94`.
  - 미커밋 0044도 live profile 문제를 남긴다고 명시합니다: `supabase/migrations/0044_accept_time_and_expiry_invariants.sql:23-27`.

### P0-3. Provider 재시도 비용 cap과 결과 저장/reconcile 복구

- **[경로/기능]** failed/timeout attempt → 유료 retry → success, expired lease retry, month/hour boundary, provider success 뒤 verdict/draft write 실패, DB write success 뒤 reconcile 실패.
- **[왜 중요한가]** **출시 차단입니다.** 실제 OpenAI 비용이 cap에서 누락되고, 결제되는 provider 결과가 영구 유실되거나 같은 request가 409에 갇힐 수 있습니다. 4차 감사 P0-5와 H-1입니다.
- **[검증하려면]** attempt별 immutable ledger 또는 단조 증가 cumulative accounting, durable job/outbox를 구현한 뒤 fault injection으로 각 저장 지점과 reconcile 지점을 끊어 재시도·복구·비용 합계를 검증해야 합니다.
- **[근거 파일:라인]**
  - 같은 row re-arm 시 `actual_cents=NULL`, `attempt_count+1`이고 기존 `created_at`은 갱신하지 않습니다: `supabase/migrations/0036_dater_validation_and_snapshot.sql:514-563`.
  - cap은 row의 최종 actual/estimated 값과 row 수를 셉니다: `supabase/migrations/0036_dater_validation_and_snapshot.sql:534-550,573-588`.
  - reconcile helper는 RPC 실패를 경고만 하고 삼킵니다: `apps/web/src/lib/providerBudget.ts:134-149`.
  - 오늘 A1은 한 번의 성공 provider chain일 뿐 retry/fault path가 아닙니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:7-8`.

### P0-4. 원본 음성 서버 invariant + manual/no-AI + audio/caption 실패 fallback

- **[경로/기능]** no voice, two voices, 29.9초, 60.1초, corrupt audio metadata의 submit/publish direct RPC; `Write it myself`로 작성·승인·public 표시; transcript segment 없음; audio URL/decoder/playback 실패.
- **[왜 중요한가]** **출시 차단입니다.** Friendword의 핵심 입력인 원본 음성이 서버에서 강제되지 않으며 manual pitch가 빈 structure branch로 공개될 수 있습니다. 4차 감사 P0-6, H-2, H-3입니다.
- **[검증하려면]** 서버 decoded duration/hash/codec metadata를 저장하고 exactly-one validated voice 30~60초를 submit/publish에서 강제해야 합니다. manual published E2E와 no-caption/audio-error 브라우저 테스트를 실제 public surface로 수행해야 합니다.
- **[근거 파일:라인]**
  - transcribe route는 실제 decoded duration 대신 60초를 전달합니다: `apps/web/app/api/transcribe/route.ts:84-115`.
  - submit snapshot은 voice path를 수집하지만 voice 존재/개수/길이를 필수로 만들지 않습니다: `supabase/migrations/0016_safety_paths.sql:590-670`.
  - public player는 segment가 없으면 “Captions aren’t available”만 표시하고 waveform 실패에도 playback 성공을 단정합니다: `apps/web/src/components/PitchPlayer.tsx:252-257,314-328`.
  - 오늘 문서가 manual path를 명시적으로 미실행으로 남겼습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:148-152`.

### P0-5. 실제 identity/liveness/face-match/phone verification

- **[경로/기능]** Dater phone invitation claim, 18+ identity evidence, liveness, representative-photo face match, evidence expiration/retry/deletion, enforcement on 상태의 publish와 interest.
- **[왜 중요한가]** **출시 차단입니다.** 제품 P0의 “소개 대상자가 실제 본인인지”를 email 소유만으로는 증명할 수 없습니다.
- **[검증하려면]** 실제 vendor sandbox와 만료 evidence를 연결하고 enforcement를 켠 hosted 환경에서 실제 기기 enrollment → publish/interest → expiry/recheck를 수행해야 합니다.
- **[근거 파일:라인]**
  - real provider mode도 identity placeholder를 반환합니다: `packages/adapters/src/factory.ts:31-44`.
  - placeholder는 모든 실제 호출을 reject합니다: `packages/adapters/src/openAi.ts:190-202`.
  - phone claim은 명시적으로 unavailable입니다: `supabase/migrations/0012_claim_binding_and_evidence.sql:225-238`.
  - 오늘 결과는 identity/media enforcement가 off임을 스스로 정정했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:81`.

### P0-6. RevenueCat purchase/restore/refund/expiration/transfer와 Campaign Pass 시간축

- **[경로/기능]** sandbox INITIAL_PURCHASE, restore, refund day 1/day 20, expiration, transfer/alias, unattributed event review reassign, duplicate/replay, expired revival blocked by beta/one-active guard.
- **[왜 중요한가]** **실결제 출시 차단입니다.** 돈을 받고 benefit이 없거나, public window와 entitlement가 달라지거나, refund 뒤 무료 연장이 남거나, 보이지 않는 campaign에서 기간이 소진될 수 있습니다. 4차 감사 P0-8, P0-9, P0-10, H-14입니다.
- **[검증하려면]** App Store/RevenueCat sandbox의 실제 transaction lifecycle을 webhook까지 왕복시키고 ledger/event/entitlement/campaign window를 각 단계에서 읽기 검증해야 합니다. unattributed review resolver는 누락 benefit을 idempotently 생성해야 하며 SANDBOX/PRODUCTION namespace를 분리해야 합니다.
- **[근거 파일:라인]**
  - review resolver는 기존 ledger/event만 UPDATE/refresh하고 `moved_rows=0`이어도 review를 닫습니다: `supabase/migrations/0042_rename_campaign_pass_product_id.sql:276-325`.
  - purchase는 `GREATEST(now, ends_at)+30d`로 public window를 늘립니다: `supabase/migrations/0042_rename_campaign_pass_product_id.sql:751-782`.
  - entitlement refresh는 최초 purchase/renewal 시각 +30일로 다시 계산합니다: `supabase/migrations/0014_commerce_state_machine.sql:119-180`.
  - blocked revival도 window를 늘리고 entitlement를 시작한 뒤 review를 queue합니다: `supabase/migrations/0042_rename_campaign_pass_product_id.sql:783-838`.
  - refund는 entitlement만 비활성화하고 `ends_at_retained=true`를 반환합니다: `supabase/migrations/0042_rename_campaign_pass_product_id.sql:841-870`.
  - 실제 paywall에는 purchase/restore flow가 존재합니다: `apps/mobile/app/paywall.tsx:79-125,208-265`; 오늘은 `issue_purchase_intent`와 `unlock_share_kit` 거부만 실행했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:57,169`.

### P0-7. 안전 도구 전체 사용자 경로 + 철회 + 개인정보 삭제 복구

- **[경로/기능]** public anonymous report UI→`/api/report`, inbox interest report→`report_content`, room report/block/leave, Interested Person의 withdraw, account deletion request→processor→완료/실패 retry, deletion 중 auth/storage/DB 장애, review PII retention.
- **[왜 중요한가]** **UGC 공개 출시 차단입니다.** 신고·차단·나가기·삭제는 렌더 존재만으로 충분하지 않으며, interest 철회가 아예 없고 deletion 실패가 영구 정지할 수 있습니다. H-7, H-15, H-16입니다.
- **[검증하려면]** 각 UI 버튼으로 실제 hosted row/state 변화를 만들고 양측 UI 반영을 확인해야 합니다. failed deletion bounded retry/dead-letter/alert/SLA를 구현하고 fault injection해야 합니다. `transferred_from/to`와 open review retention을 검증해야 합니다.
- **[근거 파일:라인]**
  - public report UI는 `/api/report`를 호출합니다: `apps/web/src/components/ReportCampaignLink.tsx:23-39`.
  - 오늘 “신고 실동작”은 앱과 같은 직접 INSERT 형태였고 `/api/report`나 `report_content` 사용자 UI 실행 증거가 아닙니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:128-130`.
  - `withdrawn`은 mobile 표시 상태일 뿐 action/RPC가 없습니다: `apps/mobile/app/interests/index.tsx:37-50,86-103`; 오늘 문서도 기능 부재를 확인했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:172-174`.
  - deletion processor는 `queued`와 stale `processing`만 claim하고 실패를 `failed`로 바꿉니다: `scripts/process-deletions.mjs:77-79,378-425`.
  - PII scrub allowlist가 아니라 일부 key subtraction이며 transfer 배열이 빠집니다: `supabase/migrations/0037_account_guard_and_erasure.sql:432-443`.

### P0-8. structured motion 결과물과 대표 demo

- **[경로/기능]** semantic structure→scene plan, kinetic text, approved asset mapping, 동일 preview/public renderer, rights-cleared real person/voice demo, 320/375/390/430 responsive, judge viewer→interest→inbox→room.
- **[왜 중요한가]** **Grand Prize 및 최초 제품 계약 차단입니다.** 현재 출력은 audio+photo slideshow이고 대표 demo에는 실음성이 없습니다.
- **[검증하려면]** versioned composition을 구현하고 실제 권리 확보 자료를 production pipeline에 넣어 전 화면 크기·reduced motion·실기기에서 검증해야 합니다. TTS는 대표 demo acceptance가 될 수 없습니다.
- **[근거 파일:라인]**
  - scene helper는 사진을 segment 또는 시간으로 균등 분배할 뿐 semantic structure를 사용하지 않습니다: `apps/web/src/pitch/scenes.ts:12-73`.
  - player는 audio, photo crossfade, caption, waveform만 렌더합니다: `apps/web/src/components/PitchPlayer.tsx:199-345`.
  - demo fixture는 illustration과 “no live recording”입니다: `apps/web/src/fixtures/pitch.ts:40-64`.
  - 오늘 N10은 정직한 카피만 확인했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:13`; 대표 demo acceptance는 실행하지 않았습니다.

### P0-9. fresh-install 발견성, durable next step, production origin, universal/deep link

- **[경로/기능]** fresh install의 Introducer/Dater/Interested 로그인, 원래 목적지 복귀, approve→inbox, submit→status, accept→room의 새로고침 후 durable link, consent/referral/kit/room universal link 왕복.
- **[왜 중요한가]** **출시 차단입니다.** 오늘은 QA 계정과 직접 URL로 조각을 연결했지만 일반 사용자가 제품 안에서 같은 루프를 발견하고 복귀할 수 있다는 증거가 아닙니다. GP-P0-3, GP-P0-4, H-6입니다.
- **[검증하려면]** production origin fail-fast, associated domains/intent filters, auth handoff, persistent activity hub/room link를 구현한 뒤 fresh install 3역할 실제 기기 E2E를 해야 합니다.
- **[근거 파일:라인]**
  - approve 후 public pitch로만 이동합니다: `apps/web/app/consent/[token]/ConsentFlow.tsx:424-431`.
  - interest submit 후 “Back to the pitch”만 있습니다: `apps/web/app/p/[campaignSlug]/interest/InterestFlow.tsx:414-425`.
  - accept 직후 room CTA는 local `openedRoomId`에만 의존합니다: `apps/web/app/inbox/InboxView.tsx:176-198,326-329`.
  - accepted mobile interest에는 web app을 열라는 문구만 있고 link가 없습니다: `apps/mobile/app/interests/index.tsx:99-103`.
  - web origin은 invalid/empty면 localhost로 fallback합니다: `apps/mobile/src/services/webOrigin.ts:4-18`.
  - app config는 custom scheme만 있고 associated domains/intent filters가 없습니다: `apps/mobile/app.config.ts:9-35`.

### P1-10. notification, returning Dater reuse, install attribution, paid-value UX

- **[경로/기능]** 승인 요청/변경 요청/publish/new interest/accept/new message 알림, 다른 campaign의 Dater profile prefill, browser close/install 후 referral claim, 실제 Creator Kit success와 Campaign Pass analytics.
- **[왜 중요한가]** 4차 감사 H-8~H-11입니다. 개별 항목은 코드 보안 P0보다 낮지만, 현재 비동기 루프와 유료 가치에서는 출시 품질을 크게 해칩니다.
- **[검증하려면]** durable outbox+retry+민감정보 없는 transactional notification, owner-only profile prefill, TTL referral bridge/native claim, authenticated kit image/download와 active-pass analytics를 실제 계정으로 검증해야 합니다.
- **[근거 파일:라인]**
  - Dater profile 값은 consent 진입 때 빈값으로 초기화됩니다: `apps/web/app/consent/[token]/ConsentFlow.tsx:264-267,303`.
  - referral dedupe는 sessionStorage에 의존합니다: `apps/web/src/components/ReferralTracker.tsx:39-59`.
  - kit image success/download 경로는 존재하지만 오늘 성공 실행이 없습니다: `apps/web/app/kit/[draftId]/KitView.tsx:80-117,206-260`.
  - analytics는 버튼을 눌러 `get_campaign_analytics`를 호출해야 하지만 오늘 active pass가 없습니다: `apps/web/app/inbox/InboxView.tsx:201-213`.

### P1-11. 운영 자동화의 남은 실패 경로

- **[경로/기능]** expiration cron 반복 상태/실패 alert, scheduler 지연 중 새 campaign publish, deletion/orphan media scheduler, failed deletion retry, review scrub runtime.
- **[왜 중요한가]** H-13, H-15, H-17입니다. 오늘 expiration 한 번은 중요한 runtime proof지만 운영 전체가 자동화됐다는 증거는 아닙니다.
- **[검증하려면]** job history/heartbeat/alert를 만들고 cron 중단 또는 15분 지연 상태에서 `ends_at<=now()`인 기존 campaign과 새 publish를 함께 재현해야 합니다. Storage API가 필요한 deletion/orphan pass도 실제 scheduler에 연결해야 합니다.
- **[근거 파일:라인]**
  - 0043은 expiration과 resolved-review scrub만 pg_cron에 등록하고 deletion/orphan은 advisor-run으로 남깁니다: `supabase/migrations/0043_pg_cron_scheduled_ops.sql:8-17,34-49`.
  - one-active trigger는 status만 보고 `ends_at`을 무시합니다: `supabase/migrations/0039_core_growth_loop.sql:49-86`.
  - 오늘은 expiration 한 번만 관찰했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:154-159`.

### P2-12. OG pause/revoke cache 정책

- **[경로/기능]** published OG가 CDN에 cache된 뒤 pause/archive/block/delete 직후 최대 1시간 남는 경로.
- **[왜 중요한가]** 현재 코드가 의도한 정책이지만 동의 철회 직후 이미지를 계속 노출할 수 있어 정책 승인이 필요합니다. 즉시 출시 차단 여부는 상헌 님의 명시적 정책 결정에 달렸습니다.
- **[검증하려면]** 실제 CDN cache HIT 상태에서 pause/archive/delete하고 cache purge 또는 허용된 최대 잔존 시간을 측정해야 합니다.
- **[근거 파일:라인]**
  - 정상 OG는 `s-maxage=3600`입니다: `apps/web/app/api/og/route.tsx:265-267`.
  - 오늘도 만료 404의 no-store와 정상 cache를 혼동했다가 정정했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:167-178`.

---

## 4차 감사 P0 / GP-P0 / H 전체 대조

여기서 “핵심 미접촉”은 주변 happy path를 열어봤더라도 해당 finding의 공격/완료 기준을 실행하지 않았다는 뜻입니다.

| 감사 항목                           | 오늘 해당 finding 검증                 | 현재 코드 판정                                                                    |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| P0-1 승인/public 동일성             | 핵심 미접촉                            | 미해소 — `0041:242-266`, public `page.tsx:147-190`                                |
| P0-2 structure moderation           | 미접촉                                 | 미해소 — `pitchStructure.ts:3-10`, moderate route `:87-112`                       |
| P0-3 interest snapshot              | 핵심 미접촉                            | 미해소 — live join `0037:31-67`; 미커밋 0044도 snapshot은 남김                    |
| P0-4 media content version          | 미접촉                                 | 미해소 — path-only validation `0016:1-15`                                         |
| P0-5 provider retry cost            | 미접촉                                 | 미해소 — row re-arm `0036:514-563`                                                |
| P0-6 voice server invariant         | 미접촉                                 | 미해소 — transcribe hardcoded duration `route.ts:115`                             |
| P0-7 identity/liveness              | 미접촉                                 | 미구현 — `factory.ts:43`, `openAi.ts:195-202`                                     |
| P0-8 unattributed purchase recovery | 미접촉                                 | 미해소 — resolver `0042:276-325`                                                  |
| P0-9 Campaign Pass 시간축/refund    | 미접촉                                 | 미해소 — `0014:119-180`, `0042:769-870`                                           |
| P0-10 blocked revival               | 미접촉                                 | 미해소 — `0042:783-838`                                                           |
| GP-P0-1 structured motion           | 기존 slideshow만 관찰                  | 미구현 — `scenes.ts:12-73`, `PitchPlayer.tsx:199-345`                             |
| GP-P0-2 representative demo         | honesty copy만 관찰                    | 미해소 — fixture `pitch.ts:40-64`                                                 |
| GP-P0-3 발견 가능한 loop            | 직접 URL/기존 세션으로 loop 연결       | 부분 미해소 — post-action links와 fresh-install acceptance 미충족                 |
| GP-P0-4 origin/deep link            | 미접촉                                 | 미해소 — localhost fallback, associated domain 없음                               |
| H-1 provider persistence/reconcile  | 미접촉                                 | 미해소 — `providerBudget.ts:134-149`                                              |
| H-2 manual/no-AI                    | 명시적 미실행                          | 미해소                                                                            |
| H-3 caption/audio failure           | 미접촉                                 | 미해소 — `PitchPlayer.tsx:252-257,324-328`                                        |
| H-4 preview/public renderer         | 두 surface를 각각 봤지만 동등성 미검증 | 미해소                                                                            |
| H-5 photo semantic composition      | 미접촉                                 | 미구현                                                                            |
| H-6 native role actions/account     | signed-out/일부 campaign 상태만        | 부분 미해소 — home에는 account/settings/sign-out 없음; owned card는 Pass CTA 중심 |
| H-7 withdraw                        | 기능 부재 확인                         | 미구현                                                                            |
| H-8 notifications                   | 미접촉                                 | 미구현                                                                            |
| H-9 returning Dater reuse           | 미접촉                                 | 미해소 — form empty init                                                          |
| H-10 install attribution            | 미접촉                                 | 미해소 — sessionStorage 중심                                                      |
| H-11 paid value                     | 거부 gate만                            | 실제 value 미검증                                                                 |
| H-12 accept-time sender check       | 미접촉                                 | HEAD 미해소; 미커밋 0044는 부분 보강이지만 snapshot 미해소                        |
| H-13 runtime automation             | expiration 1회만                       | 부분 — deletion/orphan/vendor runtime 미검증                                      |
| H-14 sandbox/prod benefit 분리      | 미접촉                                 | 미해소                                                                            |
| H-15 deletion retry                 | 미접촉                                 | 미해소 — failed 영구 제외                                                         |
| H-16 review PII retention           | 미접촉                                 | 미해소                                                                            |
| H-17 delayed scheduler→new publish  | expiration과 one-active를 별도로만 봄  | 미해소 — trigger가 `ends_at` 무시                                                 |

---

## 실제 화면·라우트 전체 대조

### 모바일 `apps/mobile/app`

| route           |                    오늘 실제 실행 | 남은 경로                                                                                                         |
| --------------- | --------------------------------: | ----------------------------------------------------------------------------------------------------------------- |
| `/_layout`      | △ 모든 실행의 wrapper로 간접 실행 | cold start auth transition, RevenueCat identity init, error boundary                                              |
| `/`             |       ❌ 문서에 홈 진입 증거 없음 | fresh install home→각 역할 진입, account entry                                                                    |
| `/campaigns`    |                                ✅ | Dater campaign의 실제 View/Share/Pause/Archive/analytics 부재 또는 미실행, Introducer live share/copy/open branch |
| `/interests`    |                                ❌ | signed-out sign-in, submitted/accepted/declined/expired 상태, room durable link                                   |
| `/paywall`      |                                ❌ | catalog, purchase, restore, confirmed, timeout, existing benefit, revival                                         |
| `/pitch/new`    |                             ✅ A1 | `Write it myself`, permission denial, recorder start/error, 29.9/60.1                                             |
| `/pitch/review` |             ✅ A1 및 session 복구 | manual review/publish, stale server revision 실제 resubmit, recovered server-only media                           |
| `/pitch/share`  |                   ✅ BUG-1 재검증 | timeout 후 늦은 refresh 경합, purge failure, revoked/declined local-token fallback                                |

근거 route entry: `apps/mobile/app/_layout.tsx:41`, `apps/mobile/app/index.tsx:8-30`, `apps/mobile/app/campaigns/index.tsx:92`, `apps/mobile/app/interests/index.tsx:113-176`, `apps/mobile/app/paywall.tsx:23-126`, `apps/mobile/app/pitch/new.tsx:37`, `apps/mobile/app/pitch/review.tsx:33`, `apps/mobile/app/pitch/share.tsx:147`.

### 웹 page routes `apps/web/app`

| route                        |                           오늘 실제 실행 | 남은 경로                                                                            |
| ---------------------------- | ---------------------------------------: | ------------------------------------------------------------------------------------ |
| `/`                          |                      ✅ waitlist/landing | referral의 browser-close/install persistence                                         |
| `/auth/confirm`              |                 ✅ real GoTrue link+code | fresh install/native return, concurrent/scanner operational recurrence               |
| `/consent/[token]`           | ✅ claim/approve/request changes/decline | canonical content equality, no voice, stale revision, returning profile              |
| `/inbox`                     |       ✅ accept 및 campaign pause/resume | actual decline, interest report UI, account deletion, active-pass analytics, archive |
| `/kit/[draftId]`             |       △ anonymous gate와 no-credit RPC만 | authenticated unlocked kit, `/api/kit-image`, download/caption copy                  |
| `/p/[campaignSlug]`          |                  ✅ real+unknown+expired | deleted-text cross-surface, audio error/no caption, cached pause/archive             |
| `/p/[campaignSlug]/interest` |                                ✅ submit | same-path/photo/profile TOCTOU, resubmit/withdraw, immutable status destination      |
| `/rooms`                     |                                       ❌ | signed-out, empty, list, open-room navigation                                        |
| `/rooms/[roomId]`            |                      ✅ chat/block-close | actual report, leave, rate limit, offline/reconnect                                  |

근거 route entry: `apps/web/app/page.tsx:49`, `apps/web/app/auth/confirm/page.tsx:12`, `apps/web/app/consent/[token]/page.tsx:15`, `apps/web/app/inbox/page.tsx:10`, `apps/web/app/kit/[draftId]/page.tsx:10`, `apps/web/app/p/[campaignSlug]/page.tsx:115`, `apps/web/app/p/[campaignSlug]/interest/page.tsx:24`, `apps/web/app/rooms/page.tsx:10`, `apps/web/app/rooms/[roomId]/page.tsx:14`.

### 웹 API routes

| route                      |                   오늘 실제 실행 | 남은 경로                                                                            |
| -------------------------- | -------------------------------: | ------------------------------------------------------------------------------------ |
| `GET /api/kit-image`       |                               ❌ | authenticated unlocked success, wrong owner, missing unlock, render failure          |
| `POST /api/media/validate` |           ✅ pitch+interest JPEG | PNG/WebP actual, invalid bytes, provider outage, object replace/version race         |
| `POST /api/moderate-text`  |        ✅ happy path에 간접 포함 | structure/transcript 전체, flagged text, verdict write/reconcile failure             |
| `GET /api/og`              |          ✅ real/unknown/expired | pause/archive CDN cache, approved snapshot parity                                    |
| `POST /api/report`         | ❌ 오늘 report는 이 route가 아님 | 실제 public UI success, IP/campaign cap, multi-instance concurrency, DB count outage |
| `POST /api/revenuecat`     |                               ❌ | 모든 sandbox lifecycle/transfer/alias/replay                                         |
| `POST /api/transcribe`     |                   ✅ one success | retry/cost/fault states, invalid duration/audio, partial pipeline recovery           |

근거 entry: `apps/web/app/api/kit-image/route.tsx:24-50`, `apps/web/app/api/media/validate/route.ts:85-105`, `apps/web/app/api/moderate-text/route.ts:35-55`, `apps/web/app/api/og/route.tsx:272-282`, `apps/web/app/api/report/route.ts:74-92`, `apps/web/app/api/revenuecat/route.ts:86-105`, `apps/web/app/api/transcribe/route.ts:17-30`.

---

## `packages/data` 공개 RPC 호출 전체 대조

`packages/data/src/index.ts:1-13`이 아래 repo들을 모두 공개 export합니다.

| RPC                            |                           오늘 실행 판정 | 남은 branch                                                                              |
| ------------------------------ | ---------------------------------------: | ---------------------------------------------------------------------------------------- |
| `track_event`                  |     △ 여러 화면에서 fire-and-forget 호출 | row 저장/attribution 결과는 확인하지 않음; 오류도 의도적으로 삼킴 (`analytics.ts:21-42`) |
| `get_campaign_pass_state`      | △ `/campaigns`/`/inbox` load에 간접 실행 | active/expired/revoked entitlement 실제 상태                                             |
| `get_campaign_analytics`       |                                       ❌ | active pass analytics success/denial                                                     |
| `unlock_share_kit`             |                                 △ 거부만 | credit consume, replay, existing kit, image render                                       |
| `get_consent_preview`          |                                       ✅ | malformed/unknown은 UI regression만                                                      |
| `claim_consent_request`        |                                       ✅ | phone claim은 구현 자체 없음                                                             |
| `get_ai_disclosure_revision`   |                                       ✅ | revision rotation/unknown revision                                                       |
| `record_ai_processing_consent` |                                       ✅ | expired/changed disclosure                                                               |
| `create_dater_revision`        |                                       ✅ | public canonical equality와 structure/transcript 수정은 미검증                           |
| `set_dater_profile`            |                                       ✅ | returning reuse/evidence expiration                                                      |
| `set_publish_preferences`      |                                       ✅ | every precision/filter boundary                                                          |
| `approve_and_publish_pitch`    |                                       ✅ | no voice, structure moderation, stale/changed snapshot direct attack                     |
| `respond_consent_request`      |               ✅ request_changes+decline | decline 상태 자체의 publish refusal은 사진 gate와 분리되지 않음 (`E2E doc:157`)          |
| `submit_interest`              |                                       ✅ | same-path replacement, post-profile-change, enforcement-on                               |
| `list_my_interests`            |                                       ❌ | 모바일 `/interests` 전 상태                                                              |
| `list_campaign_interests`      |                                       ✅ | immutable snapshot이 아니라 live profile인 문제                                          |
| `decide_interest`              |                          △ accept만 실제 | 실제 decline, suspended/evidence-expired sender accept                                   |
| `set_campaign_status`          |    △ pause/resume/expired→published 거부 | actual archive, scheduler-delay H-17                                                     |
| `list_my_intro_rooms`          |           △ room detail auth에 간접 실행 | `/rooms` 목록/empty/signed-out                                                           |
| `leave_intro_room`             |                                       ❌ | 양측 반영, 재진입, message refusal                                                       |
| `submit_pitch_for_consent`     |                                       ✅ | no voice/two voice/duration/direct moderation bypass                                     |
| `issue_purchase_intent`        |                                 △ 거부만 | valid intent→sandbox purchase lifecycle                                                  |
| `report_content`               |                                       ❌ | campaign/interest/room/message actual UI RPC                                             |
| `request_account_deletion`     |                                       ❌ | actual request→processor→retry/completion                                                |

근거 호출부:

- analytics/benefits: `packages/data/src/analytics.ts:35-42`, `packages/data/src/benefitsRepo.ts:99-142`
- consent: `packages/data/src/consentRepo.ts:198-221,311-325,421-488,507-513`
- interest: `packages/data/src/interestRepo.ts:177-267`
- room: `packages/data/src/introRoomRepo.ts:30-81`
- draft/purchase/safety: `packages/data/src/pitchDraftRepo.ts:203-217`, `packages/data/src/purchasesRepo.ts:31-40`, `packages/data/src/safetyRepo.ts:18-46`

---

## PASS 중 “실환경 관찰 1회”이고 실통합 회귀로 고정되지 않은 것

아래는 unit/mock/SQL의 인접 계약이 있더라도, 문서가 주장하는 실제 hosted/vendor/device 왕복 자체를 반복 가능한 non-mock 회귀로 고정하지 못한 항목입니다.

1. **A1 실제 모바일 upload → 실제 OpenAI transcription/structure → consent pending**
   - 한 draft의 TTS-through-mic 성공입니다. provider retry, media variety, network failure, cold-start 재실행을 포함하는 committed E2E가 아닙니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:7-8`.

2. **B1 실제 Dater claim/edit/publish와 +14d**
   - Playwright consent tests는 RPC/API를 intercept합니다. hosted DB+storage+browser의 한 번 성공을 동일하게 반복 고정하지 않습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:9`; mock route 증거 `apps/web/tests/consent.spec.ts:250-376`.

3. **B2/N4 실 GoTrue magic-link와 8자리 code 왕복**
   - local Playwright는 verify endpoint를 mock합니다. hosted email template/GoTrue scanner behavior를 반복 검증하지 않습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:10-11,26`; `apps/web/tests/auth-confirm.spec.ts:67-118`.

4. **C2 실제 profile photo upload/validate/interest submit**
   - web UI와 DB tests가 별도로 있지만 hosted storage+validation+submit 전체의 non-mock 회귀가 없습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:27`.

5. **실 campaign OG 1200×630**
   - 문서가 기존 `og.spec`은 demo/unknown만 커버한다고 직접 인정합니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:105-107`; `apps/web/tests/og.spec.ts:7-29`.

6. **hosted pg_cron expiration**
   - 한 campaign이 한 틱에서 expired 된 관찰입니다. cron job failure/heartbeat/지연/H-17 publish 경로는 회귀 고정되지 않았습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:158`; `supabase/migrations/0043_pg_cron_scheduled_ops.sql:34-49`.

7. **expired OG 404+no-store**
   - 현재 `og.spec`에는 expired campaign regression이 없습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:169-170`; `apps/web/tests/og.spec.ts:7-29`.

8. **실 report row 201**
   - 사용자 UI가 아니라 “앱과 동일한 형태의 INSERT”였고, public `/api/report` 및 `SafetyRepo.reportContent` actual path를 고정하지 않습니다.
   - 근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:128-130`; 실제 두 사용자 경로 `ReportCampaignLink.tsx:27-39`, `InboxView.tsx:216-232`.

회귀로 잘 고정된 대표 항목은 BUG-1의 bounded load/fallback, media naming/validation retry/resumable upload, room block auto-close, interest non-Error handling, request_changes/decline UI, 8개 SQL refusal guard입니다. 다만 “회귀가 있다”와 “실제 사용자 경로도 실행됐다”는 별개입니다.

---

## 오늘 수정했지만 실제 사용자 경로에서 실행되지 않은 코드

### 커밋 `76402c0` 모바일 media/sync

- PNG/WebP를 실제 MIME/확장자로 업로드하는 branch
- GIF/BMP/TIFF/AVIF picker 거부
- validation 401/403/409/5xx/offline 뒤 재검증
- 중간 asset upload 실패 뒤 부분 재개
- 이미 존재하는 object를 성공으로 간주하는 retry
- 늦게 끝난 refresh의 write 취소
- purge failure/timeout 상태

이들은 unit에서 green이지만 실제 실행 사진은 둘 다 JPEG이고 validation은 success였습니다. 근거 test: `apps/mobile/src/services/mediaFiles.test.ts:6-45`, `apps/mobile/src/services/pitchDraftsMedia.test.ts:181-368`, `apps/mobile/src/services/pitchDrafts.refresh.test.ts:119-298`; 실제 증거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:126`.

### 커밋 `64c187f` 웹

- `InterestFlow`의 non-`Error` throw 처리 branch는 Playwright/unit성 검증만 있고 실제 Supabase failure로 실행되지 않았습니다.
- room의 report와 leave는 Playwright에서만 실행됐고 오늘 actual room에서는 노출만 확인했습니다.
- block auto-close는 production actual 실행됐으므로 이 목록에서 제외합니다.

근거: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:124,134-135`; tests `apps/web/tests/interest-decision.spec.ts:127-170`, `apps/web/tests/rooms.spec.ts:244-280`.

### 커밋 `fa6315b` SQL guard

새 regression은 green이지만 다음은 실제 사용자 surface에서 실행되지 않았습니다.

- 2001자 message 거부와 2000자 boundary
- 비참여자의 participant sender spoof
- 21번째/60초 rate limit과 다른 sender 대조군
- closed room post

근거: `supabase/tests/19_e2e_guard_regressions.sql:506-739`. 오늘 actual에서는 양방향 2개 message, suspended sender, block-close만 실행했습니다: `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:29,135,145`.

### 커밋 `e94ae2e` 모바일 truth states

- offsetless timestamp의 UTC 처리, non-UTC offset, sub-ms truncation은 unit only입니다.
- refresh timeout 뒤 작업 취소 경합은 unit only입니다.
- signed-out campaign, offline unsubmitted edit, submitted-unconfirmed block은 실제 기기에서 실행됐으므로 제외합니다.

근거: `apps/mobile/src/services/pitchDraftsTimestamps.test.ts:21-50`, `apps/mobile/src/services/pitchDrafts.refresh.test.ts:215-298`; actual evidence `docs/E2E_AUTONOMOUS_RUN_2026-07-29.md:137-141`.

### 감사 시점 미커밋 변경

- `/api/report` in-process serialization/fail-closed count는 fake PostgREST test만 있으며 실제 public UI, multi-instance race, DB trigger가 없습니다. 코드 스스로 multi-instance race가 남는다고 명시합니다: `apps/web/app/api/report/route.ts:31-40`.
- 미커밋 0044의 accept-time sender recheck/expired transition trigger는 오늘 결과 문서의 green gate에 포함되지 않았습니다. immutable interest snapshot을 남기며, 별도 migration/test가 아직 worktree 상태입니다.

---

## “테스트 완료” 선언을 위한 최소 집합

아래 9개가 모두 0이 되기 전에는 “테스트 완료”라고 말할 수 없습니다.

1. **Canonical consent/public snapshot**
   - Dater가 삭제한 sentinel 문구가 player/story/transcript/OG/kit 어디에도 남지 않음.
   - structure/transcript 전체 moderation·길이·hash/version direct RPC test.

2. **Immutable Interest**
   - immutable profile/media/evidence snapshot.
   - same-path re-upload, post-submit edit, suspended/deletion-pending/expired-evidence sender의 accept가 실패.

3. **Provider와 voice server invariant**
   - failed→retry→success cumulative 비용, reconcile/write fault recovery.
   - no/two/29.9/60.1/corrupt voice가 submit/publish에서 실패.
   - manual/no-AI published path와 no-caption/audio-error fallback 성공.

4. **실 identity enforcement**
   - phone ownership, 18+, liveness, face match, expiry/retry/deletion을 vendor sandbox+실기기에서 enforcement on으로 통과.

5. **실 commerce lifecycle**
   - sandbox purchase→webhook→benefit, restore, expiration, refund, transfer, unattributed review, replay.
   - campaign/entitlement 단일 시간축, blocked revival pending grant, SANDBOX/PRODUCTION 분리.

6. **대표 제품 결과물**
   - semantic structured motion composition과 동일 preview/public renderer.
   - rights-cleared real person/voice demo, 320/375/390/430 responsive, judge full loop.

7. **fresh-install navigation/deep links**
   - Introducer/Dater/Interested 각각 로그인 후 원래 목적지 복귀.
   - approve→inbox, submit→status, accept→room이 새로고침 후에도 durable.
   - production HTTPS origin fail-fast와 universal/app links 실기기 왕복.

8. **안전·철회·삭제의 actual path**
   - public report, interest report, room report/block/leave, withdraw, account deletion을 UI에서 실제 hosted state까지 검증.
   - failed deletion bounded retry/dead-letter/alert와 PII retention 검증.

9. **전 surface branch closure**
   - 위 route 표의 ❌/△와 RPC 표의 ❌/거부-only를 모두 실제 사용자 또는 실제 외부 시스템 경로로 실행.
   - one-shot hosted/vendor PASS에는 반복 가능한 non-mock smoke 또는 운영 monitor를 붙임.

**결론: 이 최소 집합이 0이 되기 전에는 “테스트 완료”라고 말할 수 없습니다.**
