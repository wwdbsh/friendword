# Friendword 5차 적대적 종합 감사 (2026-07-29)

> 감사 기준: 2026-07-29 KST, Git HEAD `101d577` (`Harden web email sign-in against mail-scanner link consumption`)
> 작업 트리: `apps/mobile/src/services/mediaFiles.ts` 1개 파일 미커밋 변경 있음 (감사 범위에 포함)
>
> 감사 방식: Advisor(Fable 5, ultracode) 오케스트레이션 + 3개 병렬 워크플로우 + 독립 딥다이브 에이전트.
> 모든 finding은 **발견 에이전트와 별개의 회의적 검증 에이전트**가 코드를 다시 읽고 반증을 시도한 뒤에만 등재된다(refuted 항목은 §9에 별도 기록).
>
> 감사 범위: 전체 monorepo(웹·모바일·packages·supabase 0001~0043·scripts·media-worker·docs·CI/배포 설정), 하드닝·프라이버시·결제·성장·테스트 진실성·해커톤 제출 준비도.
>
> 이 문서는 4차 감사(`docs/FRIENDWORD_FOURTH_AUDIT_HANDOFF_2026-07-15.md`)를 대체하지 않는다. 4차는 여전히 acceptance 기준이며, 이 문서는 그 이후 변경분을 포함한 **현시점 실측 재검증**이다.

---

## 0. 감사자가 직접 재실행한 검증 결과 (실측)

아래는 에이전트 보고가 아니라 Advisor가 이 세션에서 직접 실행한 명령의 결과다.

| 검증                                        | 결과                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| `pnpm lint`                                 | **PASS** (exit 0)                                              |
| `pnpm typecheck`                            | **PASS** (exit 0, 9 workspace)                                 |
| `pnpm test`                                 | **PASS** — packages 79 + mobile 106 = **185 tests**            |
| `pnpm format:check`                         | **PASS** (4차 감사 시점의 12개 파일 불일치는 `b3ce0aa`로 해소) |
| `pnpm check:env`                            | **PASS** — `.env.example` 20 키 전부 `.env`에 존재             |
| `bash scripts/test-db.sh`                   | **PASS** — 0001~0043 적용 후 base suite 통과                   |
| `bash scripts/test-db-audit.sh`             | **PASS** — `AUDIT REGRESSION: 7/7`                             |
| `bash scripts/test-db-audit2.sh`            | **PASS** — `AUDIT2 REGRESSION: 14/14`                          |
| `bash scripts/test-db-audit3.sh`            | **PASS** — `AUDIT3 REGRESSION: 11/11`                          |
| `pnpm --filter @friendword/web build`       | **PASS** — 18 라우트, static 8 / dynamic 10                    |
| `git log --all --diff-filter=A` 시크릿 스캔 | **CLEAN** — `.env.example`만 추적, 실 시크릿 커밋 이력 없음    |

### 0.1 DB 보안 자세 실측 (scratch DB에 0001~0043 적용 후 카탈로그 직접 질의)

이 프로젝트에서 **가장 잘 만들어진 층은 Postgres 층**이며, 그것은 문서 주장이 아니라 실측으로 확인된다.

- `public` 스키마 실테이블 **35개 전부 `relrowsecurity = true`** (RLS 미적용 테이블 0개).
  - 0002가 `GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`을 부여하므로 RLS가 유일한 방어선인데, 그 방어선에 구멍이 없다.
- **`SECURITY DEFINER` 함수 중 `search_path`가 없는 것 0개.** (search_path 하이재킹 계열 취약점 없음)
- **implicit `PUBLIC EXECUTE`로 남은 `SECURITY DEFINER` 함수 0개** (`proacl IS NULL`인 definer 함수 없음 — 전부 명시적 `REVOKE ALL` + 선별 `GRANT`).
- **anon이 호출 가능한 RPC는 정확히 4개**: `get_ai_disclosure_revision`, `get_consent_preview`, `join_waitlist`, `track_event`.
- Storage 버킷 2개(`pitch-media`, `profile-media`) 모두 **`public = false`**, 정책은 `authenticated`에만 부여.
- RLS enabled + 정책 0개(= service_role 전용 deny-all) 테이블 13개: `app_config`, `cost_ledger`, `analytics_events`, `purchase_events`, `verification_checks`, `media_validations`, `purchase_event_reviews`, `ops_alerts`, `text_moderations`, `referral_claims`, `qa_preview_allowlist`, `provider_usage_events`, `waitlist_signups` — 의도된 설계로 판단.

> 하드닝 노트(P2): 35개 테이블 전부 `relforcerowsecurity = false`다. 테이블 소유자(`postgres`)로 실행되는 `SECURITY DEFINER` 함수 내부에서는 RLS가 적용되지 않는다. 현 설계가 definer RPC에 권한 판정을 몰아넣은 구조이므로 의도된 것이지만, 이는 **모든 권한 판정이 RPC 본문의 명시적 체크에 의존**한다는 뜻이다. RPC 본문에서 체크 한 줄이 빠지면 RLS가 잡아주지 않는다. §2의 SQL finding들을 이 관점에서 읽어야 한다.

---

## 1. Advisor 직접 검증 Finding (에이전트 보고와 독립)

아래 5건은 Advisor가 코드·카탈로그를 직접 읽어 확정한 것으로, 에이전트 보고와 별개의 1차 증거다.

### A-1 (P1) 웹에 보안 헤더가 하나도 설정되어 있지 않다

**증거**: `apps/web/next.config.mjs` 전체에 `headers()` 함수가 없고(`devIndicators`/`distDir`/`htmlLimitedBots`/`images`/`transpilePackages`만 존재), `apps/web/vercel.json`은 `{"$schema":..., "buildCommand":"next build"}` 2줄뿐이다. `apps/web/app/layout.tsx`도 `<head>`에 `themeCss` `<style>`만 넣는다.

따라서 프로덕션 응답에 **CSP·X-Frame-Options/frame-ancestors·X-Content-Type-Options·Referrer-Policy·Permissions-Policy가 전부 부재**하다(HSTS만 Vercel 플랫폼이 기본 부여).

**실패 시나리오**:

1. `frame-ancestors`/`X-Frame-Options` 부재 → `/inbox`와 `/consent/[token]`이 임의 사이트에 iframe 될 수 있다. 로그인 상태의 Dater를 유인해 투명 iframe 위 클릭으로 **관심 수락(accept) 또는 승인 버튼을 클릭재킹**할 수 있다. 이 제품에서 accept는 되돌릴 수 없는 대인 노출 행위다.
2. CSP 부재 + 세션이 `localStorage['friendword-web-auth']`(수동 QA 절차가 이를 명시) → 어떤 경로로든 XSS가 하나 생기면 세션 토큰이 그대로 유출된다. CSP는 그 폭발 반경을 줄이는 유일한 남은 방어선이다.
3. `Referrer-Policy` 부재 → 현대 브라우저 기본값(`strict-origin-when-cross-origin`)에 의존한다. 기본값이 다른 구형/임베디드 웹뷰에서는 `/consent/<raw_token>` **전체 URL이 Referer로 외부에 나갈 수 있다**. 이 토큰은 Dater 승인 권한 그 자체다.

**수정**: `next.config.mjs`에 `async headers()`로 최소 `Content-Security-Policy`(script-src 'self' 기반), `X-Frame-Options: DENY`(+`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`를 추가. `/consent/[token]`에는 특히 `no-referrer`와 `Cache-Control: no-store`를 명시.

### A-2 (P1) `track_event`는 익명 호출에 rate limit도 dedup도 없어 성장 지표가 위조 가능하다

**증거**: `supabase/migrations/0037_account_guard_and_erasure.sql:173` 최신 `public.track_event`는 event 이름 allowlist, 서버 기록 이벤트 차단, property 키 allowlist, 2048 byte 상한, campaign/draft 존재 검증까지 **입력 검증은 매우 촘촘하다**. 그러나:

- `caller IS NULL`(익명)에 대해 `pitch_viewed_unique`, `interest_started` 두 이벤트를 명시적으로 허용한다(`:214-218`).
- 함수 말미는 조건 없는 `INSERT INTO analytics_events ...`(`:281`)이며, **중복 억제 로직이 없다**.
- `analytics_events`에 대한 rate-limit 트리거나 unique 제약이 존재하지 않는다(전 migration grep 결과 `0002_rls.sql:107`의 `ENABLE ROW LEVEL SECURITY` 한 줄뿐).

**실패 시나리오**: 익명 공격자(또는 선의의 재현 스크립트)가 실재하는 `campaign_id`를 넣어 `track_event('pitch_viewed_unique', ...)`를 10,000회 호출하면 조회수가 10,000 증가한다. 이름의 `_unique`는 **아무것도 보장하지 않는다**. `docs/GROWTH_EVIDENCE.md`와 `scripts/export-growth-evidence.mjs`가 이 테이블을 근거로 쓰는 한, **view→interest 퍼널 수치는 심사위원 앞에서 "서버 authoritative"라고 주장할 수 없다**.

**수정**: (a) 이름에서 `_unique`를 떼거나, (b) `(event_name, properties->>'campaign_id', 익명 식별자, date_trunc('day'))` 부분 unique index로 실제 dedup, (c) 최소한 익명 이벤트에 시간창 카운트 상한. 그리고 성장 문서에 **client-reported / server-recorded 구분 표기**를 강제.

### A-3 (P2) waitlist 시간당 상한이 전역 단일 축이라 1인 DoS가 가능하다

**증거**: `supabase/migrations/0039_core_growth_loop.sql:206-278` `join_waitlist`는 advisory lock으로 직렬화한 뒤 `SELECT count(*) FROM waitlist_signups WHERE created_at > now() - INTERVAL '1 hour'`를 `waitlist_hourly_cap`(기본 100)과 비교하고, 초과 시 `RAISE EXCEPTION`한다. 캡의 차원이 **전역 하나뿐**이며 IP·이메일 도메인·세션 축이 없다.

**실패 시나리오**: 공격자가 서로 다른 이메일 100개를 1시간 안에 제출하면, 이후 그 시간창 동안 **모든 정상 사용자의 가입이 예외로 거부**된다. 런칭 트래픽 스파이크 때도 동일하게 정상 사용자를 자른다(100/h는 바이럴 상황에서 낮다).

**수정**: 전역 캡은 유지하되 per-IP 축을 추가하고, 캡 도달 시 예외 대신 "접수됨" UX로 degrade하거나 큐잉. 캡 값도 상향 검토.

### A-4 (정보) 커밋 미포함 작업 트리 변경은 유효하며 회귀가 아니다

`apps/mobile/src/services/mediaFiles.ts`의 미커밋 diff는 `expo-file-system/legacy`의 `uploadAsync`를 버리고 `new File(uri).bytes()` + `expo/fetch`로 교체한다. 근거로 실기기 크래시 리포트(`Friendword-2026-07-27-162640.ips`, `EXC_BAD_ACCESS`)를 인용한다.

Advisor 확인: `apps/mobile/node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts:145`에 `bytes(): Promise<Uint8Array<ArrayBuffer>>`가 실재하고, `expo/fetch`도 설치본에 존재하며, `pnpm typecheck`가 이 변경 포함 상태로 PASS한다. **API 사용은 유효하다.**

단 주의: 전체 파일을 메모리로 읽는다. 60초 m4a는 문제없으나 `expo-image-picker` 원본 해상도 사진 4장을 이 경로로 올린다면 구형 기기에서 메모리 압박이 가능하다 — 업로드 전 리사이즈/압축 여부를 실기기 QA에서 확인해야 한다(관련 딥다이브 §참조).

### A-5 (정보/반증) consent 토큰 설계는 견고하다 — 토큰 추측 공격은 성립하지 않는다

`supabase/migrations/0013_consent_revisions.sql:248`이 `gen_random_bytes(24)`(**192비트**)를 base64url로 만들고, `0005_consent_and_publish.sql:7-18`의 `private.consent_request_by_token`은 `token_hash = encode(digest(raw_token,'sha256'),'hex')`로 **해시 비교만** 한다. anon에 열린 `get_consent_preview`(`0005:24-56`)가 반환하는 필드는 `introducer_display_name`, `relationship_type`, `relationship_duration`, `request_status` 4개뿐이며 **사진·오디오·연락처는 포함되지 않는다**.

→ "익명 토큰 열거로 Dater 신원이 새어나간다"는 계열의 주장은 **기각**한다. 다만 A-1의 Referrer 항목은 별개로 유효하다(토큰이 URL 경로에 있으므로).

---

## 1.5 ★ 최우선 Finding — 공개 페이지가 **거짓 승인 문구**를 표시하고, Dater의 편집은 버려진다

> 이 감사 전체에서 가장 중요한 항목이다. 4차 감사 P0-1("승인 내용 ≠ 공개 내용")은 **해소되지 않았고, 실제로는 4차가 기술한 것보다 더 나쁘다.**

### X-1 (P0) 공개 페이지가 "이 페이지의 모든 단어는 Dater가 검토·승인했다"고 단언하지만 사실이 아니다

**증거**: `apps/web/app/p/[campaignSlug]/page.tsx:183`이 뷰어에게 다음을 렌더한다.

> `every word here was reviewed and approved by ${pitch.daterName} before publishing`

(`:217`에도 유사 문구.) 그런데 바로 그 위 `:147-173`이 렌더하는 5개 AI structure 필드(`hook`, `relationship_context`, `three_specific_qualities`, `evidence_or_anecdote`, `good_match_for`)는 **Dater가 단 한 번도 본 적이 없다.**

`apps/web/app/consent/[token]/ConsentFlow.tsx` 1700줄 전체에서 "structure"라는 단어는 `:69`의 레이아웃 주석 **1회뿐**이다. `ConsentRepo.getConsentReview`(`packages/data/src/consentRepo.ts:255-300`)는 revision의 `structure`를 가져온 뒤 `hard_claims_requiring_confirmation`(`:298`) 하나만 남기고 **나머지를 전부 버린다**. E2E 픽스처가 이를 확증한다 — `apps/web/tests/consent.spec.ts:28`은 `structure: { hard_claims_requiring_confirmation: [...] }`만 mock한다.

**동시에 `ConsentFlow.tsx:1494`의 헤딩 "This is your page — exactly what people will see" 역시 거짓이다** — 프리뷰(`:1477-1565`)에는 5개 structure 필드도, 공개되는 전체 transcript(`page.tsx:185-190`)도 없다.

### X-2 (P0) Dater가 편집한 본문은 **공개 페이지에 렌더되지 않는다** — 원본 AI 텍스트가 대신 게시된다

**증거**: `page.tsx:147`의 분기가 결정적이다.

```tsx
{pitch.structure !== null ? ( /* 5개 AI 필드 */ ) : ( pitch.approvedBody && <p>{pitch.approvedBody}</p> )}
```

AI 경로는 **항상** `structure`를 기록하므로(`apps/web/app/api/transcribe/route.ts:177`), AI로 생성된 모든 피치에서 `approvedBody` — Dater가 직접 고쳐 쓴 바로 그 텍스트 — 는 **영원히 렌더되지 않는다**. `headline`은 어디에도 렌더되지 않는다.

게다가 `create_dater_revision`은 이전 `structure`를 그대로 복사하고(`supabase/migrations/0036_dater_validation_and_snapshot.sql:194`, `:217` — `latest.structure`) 편집된 body로부터 재생성하지 않는다.

**실패 시나리오(구체)**: Dater가 body에서 불편한 문장 한 줄을 지운다 → 프리뷰에서 사라진 것을 확인 → 승인. 그런데 `transcribe/route.ts:159-165`가 애초에 body를 `relationship_context + evidence_or_anecdote + "A good match: " + good_match_for`로 조립했으므로, **지운 문장이 structure 필드를 통해 그대로 공개된다.** 그리고 공개 페이지 하단에는 "당신이 승인했다"고 적혀 있다.

`three_specific_qualities`는 body 조립에 **애초에 포함된 적조차 없다** — 공개 페이지에서 가장 눈에 띄는 "Three specific things" 블록(`page.tsx:158-163`)은 **Dater 플로우 어디에도 대응물이 없다.**

### X-3 (P0) structure는 **어떤 moderation scope에도 속하지 않는다** — 길이 상한도 없다

**증거**: `supabase/migrations/0026_text_moderation_ledger.sql:11-12`가 scope를 하드코딩한다.

```sql
scope TEXT NOT NULL CHECK (scope IN ('pitch_content', 'profile_bio', 'interest_note'))
```

그리고 `pitch_content`는 **`headline || E'\n\n' || body`로 바이트 단위 정의**되어 있다(`0026:57-59`, `0036:173-177`, `apps/web/app/api/moderate-text/route.ts:92,112`). `structure` JSONB는 이 해시에 **들어가지 않으며 자체 scope도 없다**.

초기에는 우연히 부분 커버된다(transcribe가 structure에서 headline/body를 파생하므로). 그러나 `PitchReviewEditor.tsx`가 headline/body(`:67-75`)와 structure(`:82-142`)를 **독립 필드로 편집**하고 body를 structure로부터 재계산하지 않으므로, **Introducer는 깨끗한 headline/body로 moderation을 통과한 뒤 `structure.hook`을 무엇으로든 바꿔 쓸 수 있다.** `three_specific_qualities`는 어떤 경우에도 커버되지 않는다.

가중 요인: `packages/contracts/src/pitchStructure.ts:3-11`은 `.max()` 없는 맨 `z.string()`이고, DB 컬럼도 CHECK 없는 맨 `JSONB`(`0013:2,90`)다. headline 120자·body 2000자 상한(`consentRepo.ts:33-34`, `0036:130-132`)은 있는데 **실제로 공개되는 필드에는 상한이 없다.**

### X-4 스냅샷 기계장치는 정확하다 — 그래서 더 나쁘다

`consent_revisions.structure`는 불변 content hash에 포함되고(`0013:99`, 계산 `0036:194-201`), 승인 시 `pitch_drafts`로 복사된다(`0036:355-361`). **즉 (d) 스냅샷됨=YES는 (a) Dater가 봄=NO이기 때문에 성립한다 — 검토된 적 없는 콘텐츠에 암호학적 무결성을 씌우고 있다.**

### X-5 최소 수정 경로 (이 순서를 지킬 것)

1. **오늘 당장(1줄)**: `page.tsx:183`·`:217`의 "every word here was reviewed and approved" 문구를 실제 보장 범위로 축소. CLAUDE.md 규칙 12(검증 범위 이상 안전 광고 금지) 위반이며, App Store 심사 리스크이기도 하다.
2. `ConsentFlow.tsx`에 5개 structure 필드를 편집 가능하게 렌더하고 `:1477-1565` 프리뷰에 포함. transcript도 노출(공개되므로).
3. `0026:11-12` scope CHECK를 넓히거나 `pitch_structure` scope 추가 → `create_dater_revision`(`0036:172-178`)과 `approve_and_publish_pitch`에 게이트 추가 → `create_dater_revision`에 structure 파라미터를 받아 `latest.structure` 복사(`0036:194,217`)를 대체.
4. `packages/contracts/src/pitchStructure.ts:3-11`에 전 문자열·배열 요소 `.max()` 부여.

---

## 1.6 (P0, 제출 차단) 데모 피치에 실제 음성이 없고, 픽스처→플레이어 배선도 없다

**증거**: 저장소 전체에 오디오 파일이 **0개**다(`*.m4a|wav|mp3|aac|ogg` 검색, node_modules 제외). `scripts/demo-pitch/manifest.example.json:8-9`가 `"audio": null, "rightsCleared": false`이며, **비-example manifest 자체가 존재하지 않는다**. `seed-demo-pitch.mjs:271-277`이 올바르게 emit을 거부한다.

**더 중요한 것 — 바이트만 문제가 아니다**: `PitchFixture` 타입(`apps/web/src/fixtures/pitch.ts:16-38`)에 **오디오 필드가 없고**, `fromFixture`가 `audioUrl: null`을 하드코딩한다(`apps/web/src/pitch/view.ts:97`). 즉 권리 확보된 녹음을 구해 와도 **타입+매퍼 변경 없이는 플레이어에 도달할 수 없다.** `scripts/demo-pitch/README.md:53`은 "recording bytes만 gate되어 있다"고 적었으나 사실이 아니다.

현재 `/p/demo-blair`는 `hasRealAudio === false` 분기를 렌더한다 — `<audio>` 없음, 재생 버튼 없음, "No voice recording in this preview"(`PitchPlayer.tsx:338-341`). **정직하지만, 심사위원이 체험해야 할 유일한 핵심 기능이 부재한다.** 필요한 것: 권리 확보 녹음 + 약 20줄의 픽스처 배선.

---

## 1.7 (P1) `media-worker/`는 첫 커밋 이후 한 번도 변경되지 않은 빈 껍데기인데 README는 여전히 motion pitch를 주장한다

**증거**: 추적 파일 4개·총 27줄. `media-worker/render/index.ts`는 9줄 전부 주석이고 `export {};`로 끝난다. `package.json:6` description이 `"FFmpeg/Remotion decision pending"`, `dependencies` 블록 자체가 없다. `git log -- media-worker`는 커밋 **1개**(`4e37735` 최초 스캐폴드)만 반환한다. 코드 참조 0건(`pnpm-workspace.yaml:4`·lock·docs에만 등장).

저장소 전체에 `mp4|ffmpeg|remotion|MediaRecorder|VideoEncoder|captureStream` 기반 **영상 생성 코드가 없다** — 모든 `mp4` 히트는 `.m4a` 음성 MIME 검증이다.

**공개 피치의 실제 모션 총량**: 사진 크로스페이드 420ms + 1.26s 줌(`PitchPlayer.module.css:28-40`) — 사진 3장/60초 기준 씬당 ~1.3초 움직임, 즉 **런타임의 약 94%가 그라디언트 아래 정지 JPEG**. 자막은 하드컷(키네틱 타이포그래피용 `.wordActive` CSS는 `:125-131`에 있으나 **어떤 TSX도 적용하지 않는 죽은 코드**). 파형 펄스는 진폭과 무관한 240ms 고정 루프.

`scenes.ts:59-73`의 `distributePhotoScenes`는 `(photoCount, durationMs, segments)`만 받아 **structure에 접근조차 하지 않는다**. `PitchPlayer.tsx`에 `pitch.structure` 참조가 **0건**이다.

**모순**: `docs/DECISIONS.md:122-124`가 2026-07-14에 MP4·premium motion을 **의도적으로 descope**했다고 기록하는데, `README.md:5,11`과 `docs/PRODUCT.md:113`은 여전히 "shareable vertical motion pitch"를 5대 경쟁 경계로 단언한다. **descope 결정이 최상위 제품 주장에 전파되지 않았다.**

**권고**: MP4를 만들 게 아니라 `README.md:5,11`에서 주장을 내리는 것이 정확한 최소 조치다. 차별점을 살리려면 `scenes.ts`에 `planStructureScenes(structure, segments, durationMs)`를 추가해 structure 필드를 transcript segment에 시간 매핑하고 플레이어 내부 오버레이로 재생하는 것이 **가장 작은 진짜 변경**이다(새 AI 호출 불필요). 단 **X-1~X-3 해소가 선행되어야 한다** — 안 그러면 미검토 텍스트를 더 크게 재생하는 셈이 된다.

---

## 2. 결제(RevenueCat) — 심사 직결 영역

> 해커톤 심사 축이므로 별도 절로 분리한다. 아래 4건은 발견 에이전트와 **별개의 검증 에이전트가 코드를 다시 읽어 CONFIRMED**(전부 confidence=high) 판정한 것이다.

### C-1 (P1) `restorePurchases()` 결과를 버려서, 복원할 게 없는 사용자에게 60초 대기 후 "구매 완료"라고 거짓 안내한다

**증거**: `apps/mobile/src/services/purchases.ts:273-275`가 `restorePurchases()`의 `CustomerInfo`를 폐기한다(의존성 타입이 `Promise<void>`, `:46`). `runFlow`의 restore 분기(`:187-194`)는 `setAttributes` → `restore` 후 **결과와 무관하게** `onAwaitingConfirmation()`을 부르고 `pollForBenefit`을 기본 `timeoutMs = 60_000`(`:203`)으로 돌린다. 사전 체크가 없다.

**실패 시나리오**: 갓 가입한 사용자가 Apple이 요구하는 'Restore purchases' 버튼(`apps/mobile/app/paywall.tsx:259-265`, 무조건 렌더)을 누른다 → **60초 동안 "Confirming your purchase" 스피너** → 존재한 적 없는 구매에 대해 "Purchase received, 지원팀에 문의하라"는 안내. 심사위원이 이 버튼을 누르면 이 경로를 그대로 밟는다.

**수정**: `restorePurchases()`의 `CustomerInfo`를 반환받아 entitlement가 비었으면 즉시 "복원할 구매가 없습니다"로 종료. 폴링은 실제로 복원된 경우에만.

### C-2 (P2) 사용자가 구매를 **취소**하면 빨간 에러 카드가 뜬다 — `userCancelled` 판별이 통합 어디에도 없다

**증거**: `purchases.ts:271`의 `await purchases.purchasePackage(pkg);`는 모든 rejection을 그대로 전파한다. `paywall.tsx:113-125` catch가 기존-혜택 문자열 매칭(`:335-353`)에 실패한 뒤 `setNote(error.message)`로 떨어지고, `:253-257`이 이를 `<TrustCard tone="danger">`로 렌더한다. 저장소 전체에 `PURCHASES_ERROR_CODE`/`userCancelled` 참조가 없다.

**실패 시나리오**: StoreKit 시트에서 Cancel을 누르는 **완전히 정상적인 행동**이 "Purchase was cancelled."라는 위험톤 카드로 표시된다. Family Sharing의 Ask to Buy(승인 대기)도 같은 에러 취급을 받는다.

**수정**: `react-native-purchases`의 `PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR`(및 `e.userCancelled`)를 분기해 조용히 종료. 결제 실패와 사용자 취소는 다른 사건이다.

### C-3 (P2) 일시적 네트워크 장애가 "Billing isn't live yet"으로 표시되고, 재시도 경로가 없다

**증거**: `purchases.ts:131-136`의 catch가 `getSession`(:104)·`syncPurchasesIdentity`(:105)·`getOfferings`(:114) **전부의 실패를 구분 없이** `{ state: 'unconfigured', reason: error.message }`로 접는다.

**실패 시나리오**: 정상 구성된 사용자가 순간적 접속 불량에 페이월을 열면 "결제가 아직 활성화되지 않았고 자동으로 나타날 것"이라는 **사실이 아닌 안내** + 원시 SDK 에러 문자열을 본다. 아무것도 refetch하지 않으므로 화면을 나갔다 다시 들어오는 수밖에 없다.

**수정**: 네트워크/구성 오류를 분리하고 재시도 버튼을 노출.

### C-4 (P2) 위 3건을 잡을 수 있는 테스트가 하나도 없다

**증거**: `apps/mobile/src/services/paywallScreen.test.tsx:69-74`가 `./purchases`를 통째로 mock하며 `parseProductIntentParams: () => null`을 주입한다. 유일한 render 테스트(`:87-95`)는 **invalid-link 카드만** 만들 수 있고, 나머지는 순수 헬퍼 호출이다. 따라서 `paywall.tsx:145-269`의 confirming/confirmed/timed_out/ready/기존혜택 분기, 두 버튼 핸들러, catch 분류 로직이 **전부 미검증**이다.

→ "mobile 106 tests green"이 페이월 정확성에 대한 증거가 아님을 뜻한다.

### C-5 (P0, 런칭 시점 기준) SANDBOX/PRODUCTION 구분이 **혜택 부여 시점에 존재하지 않는다**

**Advisor 직접 교차 확인**: `0042_rename_campaign_pass_product_id.sql:394`가 `incoming_environment`를 파싱해 `purchase_events`에 저장(`:639,654`)하지만, **혜택을 주는 경로 어디에서도 이 값을 검사하지 않는다**. 유일한 environment 검사는 `0023_launch_gates.sql:70-89`의 `block_production_purchase_events` 트리거인데, 이는 방향이 반대다 — `real_payments_enabled`가 **off일 때 PRODUCTION 이벤트를 차단**하고 SANDBOX는 주석대로 "계속 흘려보낸다".

**현재 상태 정확한 판정**: 게이트가 off인 지금은 **의도된 QA 설계이며 즉시 위험은 아니다**. 그러나 런칭을 위해 `real_payments_enabled`를 on으로 돌리는 순간, 트리거는 아무것도 막지 않고 **SANDBOX 이벤트가 실제 30일 Campaign Pass를 부여**한다. Apple 샌드박스 계정은 누구나 만들 수 있으므로 이는 무료 상품 취득 경로다. `docs/SESSION_HANDOFF.md`가 H-14로 인지하고 있으나 미해소다.

**수정**: 혜택 부여 RPC 본문에서 `real_payments_enabled` AND `environment='PRODUCTION'`을 요구하거나, sandbox 이벤트를 별도 namespace의 non-production 혜택으로 격리. **게이트를 켜기 전 반드시 선행되어야 한다.**

### C-6 (P1, 검증 대기) 두 시간축 불일치 — `0014`의 `refresh_campaign_pass_entitlement`가 `0038`의 누적 창을 덮어쓴다

`0014_commerce_state_machine.sql:121`의 함수가 여전히 살아 있어, 캠페인 창은 0038 규칙대로 day 44까지 늘어나는데 entitlement `expires_at`은 day 30으로 설정된다. day 30~44 구간에서 **캠페인은 공개 상태인데 `get_campaign_analytics`는 "campaign pass required"로 거부**한다 — 돈을 낸 사용자가 산 가치를 못 받는다.

### C-7 (P1, 검증 대기) REFUND가 캠페인 공개 창을 회수하지 않는다

`0042:758` — 환불 이벤트는 entitlement만 inactive로 뒤집고 `campaigns.ends_at`은 되돌리지 않는다. 구매 직후 Apple 환불을 받으면 **환불받은 채로 30일간 공개 캠페인이 유지**된다.

### C-8 (P1, 검증 대기) `resolve_purchase_event_review`의 `reassign`이 아무 가치도 전달하지 않고 리뷰만 resolved로 닫는다

`0042:287` — 24시간 만료 후 도착한 실구매(사용자는 결제 완료)를 ops가 reassign으로 처리하면 **0 rows 이동, 크레딧·entitlement·창 연장 전부 없음**인데 리뷰는 해결됨으로 닫힌다. 돈은 받고 가치는 안 준 상태가 조용히 종결된다.

---

## 3. 공개 피치·공유 표면

### S-1 (P1) 클라이언트 사이드 내비게이션 후에도 피치 오디오가 계속 재생된다

`apps/web/src/components/PitchPlayer.tsx:73` — 언마운트 시 pause 처리가 없다. 시청자가 재생 중 "I'm interested"를 누르면 Next.js 라우트 전환이 일어나고, **플레이어가 사라진 뒤에도 Introducer의 목소리가 관심표현/로그인 화면 위에서 계속 말한다.** 정지할 UI가 없다. 심사위원이 데모에서 가장 먼저 밟는 경로다.

### S-2 (P1) Kit 공유 카드가 캠페인 내림 이후에도 Dater의 사진·이름을 렌더한다

`apps/web/app/api/kit-image/route.tsx:53` — Dater가 'Take it down for good'(archived, terminal)을 눌렀거나 캠페인이 만료된 뒤에도 `GET /api/kit-image?draftId=...`가 **200과 함께 Dater의 승인 사진·표시 이름이 박힌 1080x1920 카드를 새로 렌더**한다(`KitView` `:93`이 호출). 동의 철회가 공유 자산에 전파되지 않는다 — 프라이버시 사건이 될 수 있는 부류다.

### S-3 (P2) 자막 세그먼트가 없는 피치에서 잘못된 사진이 활성으로 표시된다

`apps/web/src/pitch/scenes.ts:84` — 전사 실패로 segment가 0인 피치(플레이어는 `PitchPlayer.tsx:255`에서 이 상태를 명시적으로 지원)에서 초기 `activePhotoIndex`가 1이 되어, **1번 사진 대신 2번 사진이 활성**으로 뜬다.

### S-4 (P2) iOS에서 요소가 스스로 pause하면 UI 상태가 어긋나 토글에 두 번 눌러야 한다

`PitchPlayer.tsx:212` — 화면 잠금·전화 수신·제어센터 정지 시 `pause` 이벤트가 발생해도 UI는 재생 중 아이콘과 파형 애니메이션을 유지한다.

---

## 4. Intro Room·인박스

### R-1 (P1) `listMessages`가 무제한·오름차순이라 1,000건에서 대화가 조용히 깨진다

`packages/data/src/introRoomRepo.ts:49` — `.limit()`도 페이징도 없다. PostgREST 기본 max-rows(1000)에 걸리는 순간부터 **가장 오래된 1,000건만** 반환된다. 1,001번째부터는 보낸 메시지가 본인 화면에서도 사라지고 상대에게도 렌더되지 않는다 — 대화가 죽은 것처럼 보인다.

**수정**: 내림차순 + 커서 페이징으로 전환.

### R-2 (P2) 차단이 인박스에는 반영되지 않는다

`supabase/migrations/0037_account_guard_and_erasure.sql:51` 계열 — 룸은 양쪽에서 사라지지만 **Dater의 인박스에는 차단자의 dating profile(사진·bio·나이·위치)이 수락된 관심 카드로 영구히 남는다**. `decide_interest`도 block을 보지 않는다.

### R-3 (P2) 조회 실패를 "룸 없음"으로 단정 렌더한다

`apps/web/app/rooms/RoomsList.tsx:37` — RPC가 실패하면 화면이 **"No rooms yet."이라고 확언**한다. 진행 중인 매치가 3건 있어도 사용자는 상대가 떠났거나 삭제됐다고 오해한다.

### R-4 (P2) `messages(intro_room_id)` 인덱스 부재

`supabase/migrations/0001_core_schema.sql:170` — 4초 폴링마다, 그리고 메시지 전송 시 rate-limit 트리거 안에서 **messages 전체 스캔**이 발생한다. 총 메시지 수 × 동시 시청자 수로 부하가 증가한다.

---

## 5. 해커톤 제출 준비도 (Devpost 공식 페이지 2026-07-29 대조)

### H-1 (P0) 제출 필수 자료 6종 중 **1종만** 존재한다

| #   | 필수 항목                  | 상태                                                                                                                                                                        |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | 텍스트 설명                | **부분** — `README.md:5`가 미구현 "motion pitch"를 주장(§1.7). 그대로 쓰면 자체 정직성 기준 위반                                                                            |
| b   | 2분 이내 실기기 영상       | **없음** — 저장소에 YouTube/Vimeo URL 0건. 상류 차단(녹음 없음·모션 없음)                                                                                                   |
| c   | **공개 스토어 URL**        | **없음 — 핵심 차단 요인.** TestFlight 내부 전용. `apps/mobile/eas.json:27-31`의 `submit.production.ios`가 빈 객체. `apps/mobile/android/` 디렉터리 부재로 Play 대안도 없음  |
| d   | 1024×1024 아이콘           | **준비됨** — `apps/mobile/assets/icon.png` 실측 1024×1024, alpha 없음                                                                                                       |
| e   | 1179×2556 이상 스크린샷    | **없음** — 저장소의 유일한 커밋 이미지는 아이콘 PNG 3개                                                                                                                     |
| f   | 무료 체험 또는 프로모 코드 | **없음, 구조적으로 곤란** — 두 상품 모두 Consumable이라 Apple 도입 체험 불가(Offer Code만 가능). 게이트 off 상태에서 코드를 받은 심사위원은 "Billing isn't live yet"을 본다 |

추가 App Review 하드스톱: `apps/web/app/` 전체에 **개인정보 처리방침·이용약관·지원 URL 페이지가 없다**.

### H-2 (P0) 필수 자격 요건 #4(RevenueCat SDK 실구매)가 **미증명**이다

코드는 진짜다 — `react-native-purchases ^10.4.2` 네이티브 포드 빌드됨, `Purchases.configure`(`purchasesIdentity.ts:75`), mock 분기 없는 `purchasePackage`(`purchases.ts:262-272`), 실동작 웹훅·Postgres 상태기계.

그러나 **샌드박스 포함 단 한 건의 구매도 발생한 적이 없다**. `0042_rename_campaign_pass_product_id.sql:8`이 명시한다: _"No hosted purchase data exists yet (pre-sandbox)."_ `docs/DEVICE_QA.md:38`은 *"구매 버튼은 누르지 않는다"*로 지시한다. 또한 **`apps/web`에는 RevenueCat 의존성이 아예 없어** "in-app **or web** purchase" 중 웹 경로도 없다.

→ 해소는 기계적으로 작다(`real_payments_enabled` SQL 1회 flip + 이미 만들어 둔 ASC 샌드박스 테스터로 왕복 1회). **단 C-5(SANDBOX 구분 부재)를 먼저 처리해야 안전하다.**

### H-3 (P1) `docs/HACKATHON_RULES.md`가 6일 경과했고 여러 항목이 사실과 다르다 — CLAUDE.md 규칙 13 적용 대상

| 문서 기재                                                | 공식 페이지(2026-07-29 확인)                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 상금 `$490,000+ / $700,000+ / $1M+` 3개 수치 혼재(`:69`) | **"$685,000 in cash"** + 총 $1M+ 상당                                                                                                                |
| "사이드 어워드 8개, 각 1위 $15k/2위 $10k/3위 $5k"(`:61`) | **OneSignal 카테고리는 $25k/$15k/$5k** — 균일 $15k 서술은 오류                                                                                       |
| 등록 "마감일 미표기"(`:18`)                              | **Registration: May 15 – September 30, 2026**                                                                                                        |
| 심사 기간 미기재                                         | **Judging: October 1 – 13, 2026**                                                                                                                    |
| 스폰서를 회사명으로만 나열(`:62`)                        | 카테고리명·기준 공개(Ship Kotlin Everywhere, Most Viral App, Keep Them Coming Back, Idea to Income, Growth Loop, Funnel Vision, Best App for Galaxy) |
| —                                                        | **Influencer Awards 5종**(각 $15k/$10k/$5k), **Conflict of Interest Award** 누락                                                                     |
| Next Gen "학생 전용"(`:61`)                              | 공식 문구에 학생 한정 서술 없음 — **미검증 주장**                                                                                                    |

Official Rules는 여전히 미공개이며 **제출 개시까지 2일** 남았다. Korea 자격·IP 조항·팀 규모가 전부 TBD다.

### H-4 (P1) 운영 문서 2건이 게이트 동작을 서로 다르게 설명한다

`docs/OPS.md:78-81`은 `public_beta_enabled`가 `interests` INSERT만 막는다고 적었다 — 이는 **0034 이전 동작**이며 3차 감사에서 이미 한 번 거짓으로 지적된 주장이다. `docs/SESSION_HANDOFF.md:10`이 올바른 버전이다. 운영자가 어느 문서를 읽느냐에 따라 외부 노출 차단 범위를 오판한다.

또한 `docs/SESSION_HANDOFF.md:16`·TODO #3이 여전히 **GitHub Actions scheduled-ops**를 서술하는데, `3ad2b0c`/`docs/DECISIONS.md:274-279`(2026-07-25)로 pg_cron에 이관되어 폐기됐다. `docs/TASKS.md`에는 **4차 감사 Slice 0~9·App Store 제출·스크린샷·데모 영상 행이 하나도 없다** — 제출 작업이 어디에도 추적되지 않는다.

### H-5 (P1) migration 0043(pg_cron)의 hosted 배포 여부가 미확인이다

`SESSION_HANDOFF.md:12`는 0001~0042 배포라고 기록하고, `DECISIONS.md:279`는 hosted `db push`가 사용자 게이트라고 적는다. 0043이 실행되지 않았다면 **hosted에서 `expire_due_campaigns()`가 돌지 않고 있다** — 만료 캠페인이 계속 공개된다.

### H-6 심사위원이 오늘 실제로 할 수 있는 것 (실측)

라이브 사이트 HTTP 실측 결과: `/` 200, `/p/demo-blair` 200(noindex), `/p/demo-blair/interest` 200이지만 **폼 없는 안내 카드**, 그 외 모든 slug **404**, `/robots.txt` 404.

`demo-blair`는 **DB 기반이 아니다** — `apps/web/app/p/[campaignSlug]/page.tsx:46-51`이 Supabase에 닿기 전에 하드코딩 TypeScript 픽스처로 단락한다. 그래서 게이트를 우회한다. 사진 3장은 SVG 일러스트 플레이스홀더다.

**심사위원이 DB에 쓸 수 있는 유일한 행동은 waitlist 가입이다.**

즉 심사위원이 보는 표면에는 CLAUDE.md 규칙 8의 경쟁 경계 4개 중 **어느 것도 없다** — Introducer 음성 없음, 모션 피치 없음, identity/face match `identity_enforcement='off'`, 관심 표현 불가.

> **유일하게 우호적인 사실**: 제품 표면이 일관되게 정직하다. 랜딩은 "App Store에 없다"고, 데모는 "녹음이 없다"고, interest 페이지는 "Blair는 실존 인물이 아니다"라고 말한다. **아무것도 가짜로 꾸미지 않았다.** 그리고 바로 그 때문에 심사위원이 볼 수 있는 것이 거의 없다.

---

## 6. Playwright 재실행 결과 — 46/46 재현 실패 (귀속 주의)

Advisor가 이 세션에서 `pnpm --filter @friendword/web test:e2e`를 실행한 결과: **20 passed, exit code 1**(12.7분). 문서가 기록한 46/46이 재현되지 않았다.

**다만 이 결과를 회귀로 단정하지 않는다.** `docs/SESSION_HANDOFF.md:60`이 _"Playwright는 편집 멈춘 창에서"_ 실행하라고 명시하는데, 본 실행은 14개 에이전트가 저장소를 동시에 읽고 dev 서버가 살아 있는 상태에서 이뤄졌다. 실패 원인이 실제 결함인지 실행 환경 오염인지 **구분되지 않았다.**

**조치**: 다음 세션에서 조용한 트리 상태로 1회 재실행해 귀속을 확정할 것. 이것이 확정되기 전까지 "Playwright 46/46"을 증거로 인용해서는 안 된다.

별도로 확정된 사실: `apps/web/playwright.config.ts:17-18` 주석이 *"Specs mock every network call"*이라고 밝힌다. 즉 **46/46이 green이어도 실제 서버 왕복을 증명하지 않는다.**

또한 `pnpm test`(루트)는 `pnpm -r run test`인데 **`apps/web`에 `test` 스크립트가 없다**(`test:audit`/`test:audit2`/`test:audit3`/`test:e2e`만 존재). 즉 문서가 말하는 "web 유닛 49"는 **루트 `pnpm test`에 포함되지 않는다.**

---

## 7. 종합 판정

**현재 Friendword는 "정직하게 만들어진, 아직 보여줄 수 없는 제품"이다.**

**강점(실측 근거 있음)**: Postgres 층은 해커톤 프로젝트 기준으로 이례적으로 견고하다 — 35/35 테이블 RLS, search_path 누락 0건, implicit PUBLIC EXECUTE 0건, anon 표면 정확히 4개 RPC, 비공개 스토리지 버킷. 커머스 상태기계는 alias·refund·transfer·durable review queue까지 실제로 구현되어 있고 mock 분기가 없다. 43개 migration에 대응하는 SQL 회귀 스위트(base+7+14+11)가 전부 통과한다. 제품 카피가 과장하지 않는다.

**치명적 약점**:

1. **§1.5 — 공개 페이지가 거짓 승인 문구를 표시하고, Dater의 편집이 버려지며, 공개 텍스트가 moderation·길이 제한 어디에도 걸리지 않는다.** 이것이 이 감사의 최우선 항목이며, 제품의 3번 경쟁 경계이자 CLAUDE.md 규칙 8·12를 동시에 위반한다.
2. **§1.6 — 데모에 음성이 없고, 픽스처→플레이어 배선조차 없다.** 심사위원이 체험해야 할 유일한 차별점이 부재하다.
3. **§1.7 — 모션 피치가 존재하지 않는데 README는 계속 주장한다.** descope 결정이 최상위 주장에 전파되지 않았다.
4. **§5 — 제출 자료 6종 중 5종이 없고, 필수 자격 요건(RevenueCat 실구매)이 미증명이다.** 제출 개시까지 2일.

**권고 순서 (앞의 2건은 오늘 처리 가능)**

1. **오늘, 1줄**: `page.tsx:183`·`:217`의 "every word here was reviewed and approved" 문구를 실제 보장 범위로 축소. (거짓 진술 제거 — 가장 값싸고 가장 중요)
2. **오늘, 2줄**: `README.md:5,11`에서 "motion pitch" 주장을 현재 구현에 맞게 수정하거나 삭제.
3. **C-5 선행 후** `real_payments_enabled` 샌드박스 왕복 1회 → 필수 자격 요건 #4 충족.
4. **§1.5 Slice B**(consent에 structure 노출 + moderation scope 확장 + `.max()` 부여) — 외부 노출의 전제 조건.
5. 권리 확보 영어 녹음 확보 + 픽스처 배선 20줄 → 데모 성립.
6. `docs/HACKATHON_RULES.md` 오늘 날짜로 재확인 기록(H-3 표 반영), `docs/OPS.md:78-81` 정정, `docs/TASKS.md`에 제출 작업 행 추가.

**배포 판정 (4차 감사 판정을 유지·강화)**: 본인 단독 내부 QA만 조건부 허용. 외부 테스터 초대·공개 베타·Grand Prize 제출은 **§1.5 해소 전까지 차단**. §1.5는 4차 감사가 이미 지적했던 항목이며, 이번 감사에서 **더 나쁜 형태로 확인**됐다.

---

## 9. 반증되어 기각된 주장

- **"익명 토큰 열거로 Dater 신원 유출"** — 기각. 토큰은 192비트(`0013:248`), SHA-256 해시 비교(`0005:7-18`), anon 프리뷰는 4개 필드만 반환(`0005:24-56`). §A-5 참조.
- **"RLS 미적용 테이블이 있다"** — 기각. `public` 실테이블 35개 전부 RLS enabled(실측).
- **"`search_path` 미설정 SECURITY DEFINER 함수가 있다"** — 기각. 0개(실측).
- **"시크릿이 git에 커밋됐다"** — 기각. `.env.example`만 추적됨(`git log --all --diff-filter=A` 실측).
- **"SANDBOX 이벤트가 지금 실혜택을 준다"** — **부분 기각·재분류**. 현재 게이트 off 상태에서는 의도된 QA 설계다. 게이트를 켜는 순간 P0이 된다 → C-5로 재기술.

---

## 10. 미완 항목 (이 감사 세션에서 결론 못 낸 것)

시간 제약으로 아래는 실행 중 상태로 남았다. 다음 세션의 최우선 입력이다.

- Wave 1(12개 차원: SQL/RLS, 웹 API, consent·interest 플로우, 모바일 피치, packages/data, 시크릿·프라이버시, ops 스크립트, 테스트 진실성, 제품 계약, UI 런타임, 동시성·정합성) 결과 수확.
- Wave 3(SQL 불변식 실증, 계층 간 계약 diff, 문서-코드 진실성, 디자인·접근성, 빌드·공급망, i18n·타임존) 결과 수확.
- 독립 딥다이브 11건: 해커톤 규칙 대조, git 히스토리 포렌식(RPC 재정의 시 사라진 체크 추적), iOS 실기기 현실, structured motion 미구현 실태, 웹 하드닝·ops, 테스트 무결성, 익명 공격면 실증, 신선한 눈 전수 스윕, 비용·남용 경제학, 승인 스냅샷 불변식 증명, 타입·null 안전성.
- **Playwright 46건 재실행**: 이 세션에서 시작했으나 완료 전 종료 — `apps/web/playwright.config.ts`가 "Specs mock every network call"이라 밝히고 있어, **46/46 green이 실제 서버 왕복을 증명하지 않는다**는 점만 먼저 기록한다.
