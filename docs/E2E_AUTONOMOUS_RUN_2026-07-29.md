# E2E 결과 로그 (2026-07-29)

draft fdc0d395-385a-4e22-87d5-3071a49ccba0 / campaign slug **jordan-ba9m1u** / consent token 파일: consent-token.txt

## PASS

- **A1 Introducer 풀 플로우**(sim): track1~5 자동화 + TTS 음성(파일 재생→마이크) 0:36 녹음 → AI 동의 → 업로드 **크래시 없음** → 전사/구조화 **영어** → 리뷰 편집 → Send for approval → `consent_pending` + consent_request 생성.
  - 증거: photo-1/2 magic `ffd8ffe0`(JPEG), voice `ftypM4A`, media_validations 3건 전부 mime/magic/decode/size ok + moderation **passed**.
- **B1 Dater 동의·발행**(browser, qa2): claim → 이름 확인 → 5단계 검토(음성 재생기, 문구 편집, 사진 개별 제외, 생년/지역/intent, 공개기간·최소연령·intent 필터, 실사진 프리뷰) → Approve → campaign `published`, slug jordan-ba9m1u, ends_at +14d. allowlist 게이트 통과.
- **B2 /auth/confirm 실 GoTrue 왕복**: 페이지 로드만으로는 미검증(스캐너 방어 실증) → 버튼 클릭 시 로그인 + redirect_to `/inbox` 복귀. `type=email` + magiclink token_hash 조합 실서버 검증 200.
- **N3 소모된 링크**: 재클릭 시 만료 배너 + 재발송 + 8자리 코드 대안 노출.
- **N7 unknown slug**: 404.
- **N10 demo-blair**: "No voice recording in this preview" 정직 카피 + Demo data 배지.
- **F1 waitlist**: 제출 성공 카피 + 폼 비활성화.

## FAIL / 수정 진행

- **BUG-1 (launch blocker)**: 모바일 Track 6 공유 화면이 "Loading your invite…"에서 **무한 대기**(>2분). 서버·로컬 모두 정상(consentToken 저장됨) — 순수 UI 행. Introducer가 초대 링크를 얻을 수 없어 루프 단절. → share-hang-worker 수정 중.
- **BUG-2 (수정 완료·검증됨)**: HEIC 사진이 photo-N.jpg로 업로드되어 서버 검증 거부. → picker `preferredAssetRepresentationMode: Compatible`로 해결(네이티브 모듈 추가 없이). 실증: JPEG magic + moderation passed.
- **BUG-3 (수정 완료·검증됨)**: legacy expo-file-system uploadAsync가 JSI promise를 잘못된 스레드에서 해제해 앱 하드 크래시. → File+expo/fetch 교체. 실증: 업로드 통과, 앱 생존.
- **관찰**: 승인 버튼이 활성화 직후 첫 클릭을 무시(React state 반영 지연 추정). 재클릭 시 정상 — 실사용 영향 낮으나 적대적 검증 대상으로 기록.

## PASS (2차 배치)

- **C1 무가입 열람**: /p/jordan-ba9m1u — audio 요소, 사진 2장, noindex, interest CTA 모두 정상.
- **N4 8자리 코드 로그인**: 웹에서 코드 입력만으로 qa3/qa2 로그인 성공 (신규 코드 대안 경로 실검증).
- **C2 Verified Interest**: AI 안전 검토 동의 → 이름/bio/생년(18+)/intent/지역/사진2장 업로드(검증 통과) → 제출 → interests row `submitted` (sender=qa3). 사진은 profile-media에 저장되고 /api/media/validate 200.
- **C3 수락**: qa2 인박스에 프로필(사진·bio·노트) 표시 → Accept → interest `accepted` + intro_rooms row `open`.
- **C4 Intro Room 왕복**: qa2 발신 → qa3 수신·답장 → DB에 양방향 메시지 2건. 안전 패널에 REPORT/Block/Leave room 노출, "text only + 연락처 비공개" 카피 확인.

## 기록 (도구 특성, 앱 버그 아님)

- Orca `click --element <ref>`가 이 React 버튼들에서 종종 무반응 → `eval`로 DOM `.click()` 하면 정상. 승인/제출/수락 3곳에서 동일 패턴이라 **툴링 이슈로 판정**(앱 버그로 보고하지 않음).

## 조사 필요 (관찰됨)

- **OBS-1**: interest 제출이 서버에서 400(submit_interest)으로 거부됐을 때 **UI에 아무 에러도 표시되지 않음**(당시 세션이 Dater 본인이어서 거부된 케이스). 사용자는 "왜 안 되는지" 알 수 없음 → 적대적 검증 대상.

## PASS (3차 배치 — 가드/네거티브 + 수정 재검증)

- **N1 introducer self-claim**: `consent invite was sent to a different contact` 거부.
- **N2 wrong-contact claim(qa3)**: 동일 거부. 대조군(초대받은 qa2)은 claim 성공.
- **N5 allowlist 없는 발행**: `Friendword is in a private beta; publishing is not open yet` 차단. (부수 확인: 소유자당 활성 캠페인 1개 가드도 `owner already has an active campaign`으로 정상 동작.)
- **N8 프로필 없는 interest**: `verified interest requires an adult birth date on your profile` 거부.
- **N-closed**: 이미 승인된 consent 링크 재방문 → "Already answered / You already approved this pitch".
- **D1 pause/resume**: pause → 공개 404, resume → 200.
- **BUG-1 수정 실증**: 2번째 draft(Riley/qa3 초대)로 전 구간 재실행 → share 화면이 "Riley's private invite" + 실제 consent URL 즉시 표시. 무한 로딩 해소.

## BUG-1 진짜 근본 원인 (워커 조사 — 중요)

`getMyDrafts()`가 PostgREST의 `timestamptz`(`2026-07-29T10:39:45.3091+00:00`)를 zod `z.iso.datetime()`(Z 전용)에 그대로 넣어 **매 실기기에서 파싱 실패 → 서버 동기화 전체가 reject**. 화면은 `.catch`로 draft를 비우고, 어떤 경로에도 timeout이 없어 무한 대기가 됐다. 수정: 서버→로컬 경계에서 ISO 정규화 + 8s 타임아웃 후 로컬 폴백 + 연락처 purge를 렌더 차단에서 분리. 부수 효과: 캠페인 목록 화면의 "저장된 피치를 불러올 수 없습니다" 배너도 같은 원인이었을 것으로 추정(워커 보고).

## PASS (4차 배치 — 권한/결제/키트)

- **E1 /kit 익명 접근**: sign-in 게이트 정상(익명에게 킷 내용 비노출). ※ 초기 관찰에서 unlock 화면이 보였던 건 탭에 세션이 남아있던 상태 — 재확인 결과 오탐이라 보고에서 제외.
- **RLS 방 격리**: 비참여자(qa1)가 intro_rooms/messages 조회 시 빈 배열. 타인 대화 노출 없음.
- **P1 결제 게이트**: 본인 소유 draft scope로도 `issue_purchase_intent` → `purchases are not available yet` 차단. (부수: 잘못된 scope는 `creator purchase scope is not a draft owned by caller`로 별도 거부.)

## 전체 회귀 게이트 (Advisor 직접 실행)

- typecheck 전 패키지 green / lint green
- unit: ui-tokens 20, adapters 8, data 71, mobile 116 (+web e2e는 Codex-B가 실행 중)
- DB 하니스: base green, audit **7/7**, audit2 **14/14**, audit3 **11/11**

## 적대적 검증 1차 (Codex A — 모바일/미디어)

반박된 내 주장(수정 착수):

- **F1 (내 HEIC 수정 미완결)**: Compatible 모드는 HEIC만 트랜스코딩. PNG 스크린샷 등은 원본 바이트 그대로인데 업로드는 여전히 `photo-N.jpg`/`image/jpeg` 하드코딩 → 서버 magic 검증 실패. → media-integrity-worker 수정 중.
- **F2**: validation 실패(401/403/409/5xx/offline)를 `unavailable`로 삼킨 뒤 `mediaUploaded=true` 고정 → 재검증 경로 없음. → 수정 중.
- **F3**: 부분 업로드 후 재시도가 `upsert:false` 때문에 막힘. → 수정 중.
- **F4 (우리 share 수정의 부작용)**: 서버 timeout/error 시 거절·종료된 consent를 로컬 토큰으로 "활성 초대"처럼 표시 가능. 또한 모든 서버 오류를 로컬로 치환해 신규 기기의 server-only draft 누락을 은폐. → 다음 워커.
- **F7 (정직성 위반)**: purge 성공 전에 "contact removed from this device" 표시. 실패/타임아웃 시 raw contact가 남는데 제거됐다고 주장. → 다음 워커.
  유효 판정(내 주장 유지): legacy deleteAsync가 uploadAsync와 동일 크래시 클래스라는 근거는 없음(다른 경로) — 과잉 우려였음이 확인됨.
  오탐 방지 사례: 메시지 rate limit은 60초 20건이라 8건 통과는 정상(버그 아님) — 스펙 확인 후 판정.

## 적대적 검증 2차 — 내 주장 정정 (Opus 적대자 + Codex B, 교차 일치)

**정정 1 (BUG-1 인과 설명 반증)**: 나는 "zod ISO 파싱 실패 → 무한 대기"라고 썼지만 틀렸다. 구 코드의 `.finally`는 reject에서도 실행되므로 파싱 실패는 `loading=false, draft=null` → "Invite not found"를 냈어야 한다. 무한 스피너는 **settle되지 않는 promise**여야만 가능하다. 유력 후보는 `getCurrentUserId()`의 `auth.getSession()`(RN에서 supabase-js auth lock에 무기한 대기 가능) 또는 타임아웃 없는 fetch. **수정(8s/12s 바운드 + purge 분리)은 타당하지만, 진짜 행 원인은 여전히 미증명**이다. zod 오프셋 버그는 별개의 실제 결함(서버 동기화 파손)으로 유효.
**정정 2 (OBS-1 반증, 2개 검증자 독립 일치)**: `submit_interest` 400은 UI에 실제로 표시된다(`This is your own page — interest is for people who want to meet you.`). 내 관찰은 긴 폼 하단 뷰포트 밖이었을 가능성이 높다. 남는 실제 결함은 훨씬 좁다: **Error가 아닌 값이 throw될 때만** unhandled rejection으로 UI가 침묵.
**정정 3 (verified 표현)**: 운영에서 `identity_enforcement=off`, `media_validation_enforcement=off`다. 따라서 "Verified Interest 통과"는 과대주장이며, 올바른 표현은 **"profile-backed interest 제출 성공(해당 실행의 사진은 검증 API 통과)"**이다. 서버가 검증 증거를 강제한다는 증명이 아니다. 제품 카피는 이미 "Profile-backed interest"로 정직하다.
**정정 4 (voice moderation)**: `voice.m4a`의 `moderation_status='passed'`는 오디오 모더레이션이 아니라 **전사 텍스트 모더레이션** 결과다(`/api/media/validate`는 audio를 모더레이션하지 않고 'skipped'를 쓴다). 표현을 "transcript text moderated"로 정정.
**정정 5 (HEIC 수정 범위)**: HEIC/RAW/Live Photo는 JPEG 재인코딩되지만 **PNG·WebP는 우연히 서버 허용 목록에 있어 통과**하고 **GIF·BMP·TIFF·AVIF는 실제로 실패**한다. "사진은 이제 JPEG"는 과대주장.
**정정 6 (보편성)**: 서버 sync 파손은 "매 실기기"가 아니라 **서버 행이 마지막 로컬 쓰기보다 새로울 때** 발생하는 타이밍 의존이다.

## 적대적 검증이 찾은 신규 결함 (수정 착수/기록)

- **N-A (착수)**: 우리 수정으로 campaigns 목록의 "저장된 피치를 불러올 수 없습니다" 배너가 **죽은 코드**가 됨 — 지속적 서버 동기화 장애가 기기에서 보이지 않게 됨.
- **N-B (착수)**: 8초 폴백이 `review.tsx`에도 적용되어, Dater가 `changes_requested`로 바꾼 뒤에도 Introducer가 **낡은 draft를 편집·재제출**할 수 있음(share보다 심각).
- **N-C (착수)**: `settleWithin`은 취소 불가 — 타임아웃 후에도 refresh가 계속 로컬에 쓰며 contact purge와 같은 mutex에서 경합.
- **N-D (착수)**: `putLocalFile` 폴백 가드가 import 성공만 검사 → `File`이 undefined면 TypeError. 문서화된 "web/test 폴백"이 그 경우 거짓.
- **N-E (착수)**: 금지한 legacy 모듈이 `deleteLocalMediaFile`로 여전히 프로세스에 로드됨(publish 시 실행). 신규 `File.delete()`로 이전 필요.
- **N-F (기록)**: `toIsoInstant`가 오프셋 없는 타임스탬프를 로컬시간으로 해석해 **9시간 밀림**(현재는 전 컬럼 timestamptz라 잠복), µs→ms 절삭으로 sub-ms 순서 비교가 붕괴 가능.
- **N-G (기록)**: interest 제출 후 sender가 bio/사진을 바꿔도 inbox는 live join을 보여주고 **accept 시 재검증 없음**(계정 상태·evidence 만료·캠페인 상태·현재 프로필) = 4차 감사 P0-3 계열 TOCTOU. 단, 차단 관계만은 room INSERT 트리거가 재검증(같은 트랜잭션 롤백).
- **N-H (착수)**: block 후에도 상대가 이미 열어둔 room UI가 새로고침 전까지 남음 — "immediately" 카피와 불일치.
- **N-I (착수)**: 배포 재현성 — checked-in `supabase/templates/magic_link.html`은 아직 `{{ .ConfirmationURL }}`이라 스캐너 방어가 hosted 대시보드 수동 설정에만 의존.
- **N-J (기록)**: `/api/report`의 count-then-insert rate limit이 비원자적이며 count 오류 시 fail-closed 아님.

## 검증자가 확인해 준 것 (내 주장 유지)

- 업로드 크래시 수정 자체는 유효(4.59MB/1.74MB 객체 실제 적재), Content-Type 계약 유지(bytes 선택이 옳음 — Blob이면 expo/fetch가 덮어씀).
- 캠페인/인터레스트/룸의 서버 상태는 내 주장과 일치(발행 +14d 정확, allowlist 1행, accept와 room 생성이 동일 트랜잭션).
- 이전 draft들의 저장된 사진이 실제 HEIC였음이 바이트로 확인(`ftypheic`) — BUG-2가 실재했음.

## PASS (5차 — 적대자가 "미검증"으로 지적한 표면 보완)

- **OG 실캠페인**: `/api/og?slug=jordan-ba9m1u` → 200 image/png 1200×630, 실제 승인 사진 + "wwdbsh+qa1 introduces / Jordan" 렌더 확인. unknown slug → 404. (기존 og.spec은 demo/unknown만 커버했음.)

## 수정 라운드 2 — 가드 회귀 테스트 (완료·Advisor 검증)

`supabase/tests/19_e2e_guard_regressions.sql` 신설: 손으로 확인했던 8개 거부 가드를 **정확한 서버 메시지**까지 고정하고, 가드마다 양성 대조군을 넣어 공허한 통과를 차단. 변이(mutation) 테스트로 8개 모두 조건 반전 시 red 확인.
Advisor 재실행: base 18파일 green(19_ 포함), audit 7/7, audit2 14/14, audit3 11/11.

테스트가 내 관찰을 정정한 3건 (테스트를 신뢰):

- 가드1은 메시지가 **두 종류**다. 연락처 해시 검사가 introducer 검사보다 먼저 돌아서, 친구 앞으로 온 초대를 introducer가 claim하면 "different contact"가 나온다(내가 본 것). 자기 앞으로 온 초대만 "introducer cannot claim their own consent request"에 도달.
- 가드5는 `dating_profiles`가 아니라 **`profiles.birth_date`**를 본다. 만18세 경계값도 검증에 포함.
- 가드7의 비참여자 거부는 RLS(42501)가 아니라 **BEFORE 트리거**다. RLS는 "참여자 sender_user_id를 사칭한 비참여자"라는 더 미묘한 케이스를 잡는다(두 층 모두 인코딩).

## 수정 라운드 2 완료 — Advisor 검증 + 커밋 3건

- `fa6315b` SQL 가드 회귀 8종 (base 18파일 green)
- `76402c0` 모바일 미디어: 바이트 정직 명명(실제 mime→확장자/Content-Type), 형식 필터(GIF/BMP/TIFF/AVIF 픽 시점 거부), per-asset 검증 상태(미실행을 완료로 latch하지 않음), 재개 가능한 부분 업로드, File 인스턴스 기반 가드, legacy 모듈 제거
- `64c187f` 웹: 이메일 템플릿 2종을 /auth/confirm 경유로 소스에 고정(8자리 코드 유지), 차단 시 상대 방 UI 종료(4s 틱에서 멤버십 재확인, 일시 실패는 전이로 구분), interest 비-Error rethrow 침묵 제거, Playwright 8종 추가(61/61)

Advisor 실기기 재검증: 크래시 없음, 업로드 객체 `photo-1.jpg/photo-2.jpg/voice.m4a` + 검증 3종 mime/magic/decode true·moderation passed.

## PASS (6차 — 적대자가 "실동작 미검증"으로 지적한 안전 도구)

- **신고 실동작**: 앱과 동일한 형태의 INSERT → 201, 서버에 `status=open, severity=low` 행 생성 확인 후 정리. 임의 컬럼(target_type/severity)을 덧붙인 위조 시도는 RLS가 42501로 차단 — "렌더만 확인"이 아니라 서버 반영까지 확인함.

## PASS (7차 — 프로덕션 배포 후 재검증)

- 배포 스모크: landing/pitch/auth-confirm 200.
- **W2 차단→방 종료 실증(프로덕션)**: qa3가 방을 연 상태에서 qa2가 차단 → **12초 내 "This room isn't open for you."로 자동 전환**. 수정 전에는 새로고침 전까지 대화와 입력창이 그대로 남았다. 검증 후 차단 정리 완료.

## 수정 라운드 3 (완료·커밋 e94ae2e) — Advisor 실기기 검증

- 만료 세션 → 캠페인 화면이 "Sign in to see your campaigns"로 **정직하게** 표시(빈 목록 위장 없음), 로컬 draft는 계속 표시, 미제출 draft는 오프라인에서도 편집 가능.
- **제출된 draft + 확인 불가 상태 → "This pitch has not been checked" 차단 카드**("Riley가 이미 답했는지 확인 못 함, 재전송 시 변경 요청을 덮어쓸 수 있음"). 세션 복구 후 차단 해제되고 편집 화면 복귀 — dead-end 아님.
- 워커가 D4의 마이크로초 복원을 **근거를 들어 거부**(로컬은 ms 3자리라 6자리 복원 시 로컬이 잘못 이기는 실제 버그가 생김) — 타당해 수용.

## PASS (루프 4)

- **N-suspended**: 계정 정지 상태에서 메시지 전송 → `account must be active` 차단. 검증 후 active 복구.
- **만료 창 공개 가드**: `ends_at`이 2시간 지난 캠페인은 DB가 아직 `published`여도 `/p/[slug]`와 `/interest` 모두 **404**. cron 지연이 노출 사고로 이어지지 않음이 실증됨.

## 미실행 / 정직한 갭

- **A2 매뉴얼 경로("Write it myself")**: UI 자동화로 해당 링크에 닿지 못해 **미실행**. 코드상 OpenAI 무호출 경로지만 실행으로 확인하지 않았음.
- **D-expire pg_cron 실동작**: `ends_at` 백데이트 후 관찰 중이나 이 시점까지 상태 전이 미확인(다음 15분 틱 대기). 공개 노출은 위 404로 이미 차단됨.
- **W3(a) submit_interest 실패 UI 스펙**: 서버 컴포넌트의 slug 조회 때문에 hermetic 작성 불가 — 별도 stub 프로젝트 필요(오늘 범위 밖). 동작 자체는 검증자 2명이 확인.

## PASS (루프 4 계속)

- **B-revision**: `request_changes` → draft `changes_requested` + response_note 저장. 이미 응답한 요청에 재응답 시 차단.
- **B-decline**: `decline` → draft `archived`, request `declined`. (발행 재시도는 400이나 사진 게이트가 먼저 걸려 "거절 상태 자체의 차단"은 분리 검증 안 됨 — 코드상 `status='consent_pending'`만 승인 대상이라 불가함을 확인.)
- **D-expire pg_cron 실동작 실증**: `ends_at` 백데이트 → **12:15:52Z에 자동으로 `expired` 전환**. 어제 GH Actions에서 pg_cron으로 옮긴 스케줄러가 hosted에서 실제로 도는 것이 처음 확인됨(migration 0043 remote 배포도 확인).
- **만료 재개 불가**: 소유자 RPC `set_campaign_status(expired→published)` → `cannot move campaign from expired to published` 차단.

## 관찰 (심층방어 갭, 사용자 경로 아님)

- **O-1**: service-role 직접 PATCH로는 `expired → published` 되돌리기가 통과한다(트리거 부재). 사용자 경로(RPC)는 정상 차단되고 service role은 우리 서버/운영 도구이므로 취약점은 아니지만, launch gate·one-active-campaign 등 다른 불변식은 트리거로 강제하는 것과 **일관성이 없다**. 트리거 추가를 권고(운영 실수·향후 service-role 코드 경로에서 유료 Campaign Pass 창을 되살릴 수 있음).

## 루프 5 (goal 미달성 확인 후 계속 진행)

### PASS

- **E-kit unlock**: 크레딧 없이 `unlock_share_kit` → `creator launch credit required` 차단(결제 게이트와 일관).
- **OG 만료 처리**: 만료된 캠페인의 `/api/og`는 404 + `Cache-Control: no-store`.

### 확인된 기능 부재 (테스트 실패 아님)

- **C-withdraw**: `withdrawn`은 상태값으로만 존재하고 RPC·UI가 없다 → 4차 감사 H-7 그대로 **미구현**. 관심을 보낸 사람이 스스로 철회할 수단이 없다.

### 내 판단 정정

- OG CDN 캐시에 대해 나는 "no-store라 우려 없음"이라고 판단했으나 **틀렸다**. 만료 후(404 경로)를 측정한 결과였고, 정상 렌더 경로는 `s-maxage=3600`이다. 코드가 "Paused or archived campaigns may remain in a social cache for at most this accepted hour"로 명시한 의도된 창이며, 적대자의 지적이 유효하다. 이는 버그가 아니라 **정책 승인이 필요한 항목**(일시정지·차단 직후 최대 1시간 동안 소셜 캐시에 기존 OG 이미지가 남을 수 있음).

### 미증명 항목의 현재 분석 (수정 미착수 — 다음 라운드 입력)

무한로딩의 진짜 원인은 여전히 미증명이나, 후보가 하나로 좁혀졌다. `HybridPitchDraftService.getCurrentUserId()`(`apps/mobile/src/services/pitchDraftsSupabase.ts:577`)는 `client.auth.getSession()`을 호출하고, 모바일 클라이언트는 `autoRefreshToken: true` + `persistSession: true`(`packages/data/src/client.ts:59-60`)로 구성된다. supabase-js v2는 이 조합에서 auth lock을 사용하므로, 토큰 갱신이 타임아웃 없는 네트워크 호출에 걸리면 `getSession()`이 무기한 대기할 수 있다. 이것이 관찰된 "settle되지 않는 promise"와 유일하게 부합하는 후보다.

주의: 이 호출을 단순 제거할 수는 없다. `listMyDrafts()`의 RLS는 **본인이 만든 draft와 본인이 대상(subject)인 draft를 모두** 반환하므로, `created_by_user_id === currentUserId` 필터는 "내가 만든 것"만 남기는 의미 있는 경계다. 따라서 올바른 방향은 제거가 아니라 (a) 이 호출 자체를 짧게 바운드하고 사용자 id 미상일 때 enrich 단계를 건너뛰거나, (b) 저장된 세션에서 id를 읽어 auth lock을 타지 않는 경로를 쓰는 것이다. 현재는 바깥 8초 바운드가 증상을 막고 있어 사용자 영향은 없다.
