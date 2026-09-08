# PROJECT HANDOFF

> 갱신: **2026-09-08 KST** (fcp Goal `launch-readiness` 종료 시점). 작업 규칙은 [`CLAUDE.md`](../CLAUDE.md)(매 세션 자동 로드), 결정 이력과 근거는 [`docs/DECISIONS.md`](DECISIONS.md)(50건, 각 항목에 날짜·이유·검토한 대안·영향). **이 문서는 "지금 어디에 서 있는가"만 다룹니다** — 왜 그렇게 결정했는지는 DECISIONS를 읽으십시오.
>
> 이 문서는 **세션이 바뀌어도, 기계가 바뀌어도 살아남는 유일한 인계 수단**입니다. Claude의 `~/.claude` 메모리는 머신 로컬이라 따라오지 않습니다. 새 세션은 `CLAUDE.md` → 이 문서 → `DECISIONS.md` 최신 3건 순으로 읽으면 됩니다.

---

## 0. 이 제품이 하려는 일 (여기서 벗어나면 안 됩니다)

친구(**Introducer**)가 자기 목소리로 싱글인 친구(**Dater**)를 소개하는 **세로형 모션 피치**를 만들고, Dater가 **공개 전에 개별 승인**하며, 그 영상이 **릴스/틱톡에 올라가 낯선 사람에게 도달**하고, 마음이 동한 시청자가 **가입 없이 보고 검증 후 관심을 표현**하면, Dater가 응할 때만 매칭·채팅이 열립니다.

**사용자가 2026-08-03에 성장 메커니즘을 명시 확정했습니다** (Advisor가 제안한 "메신저 전달 중심 재정의"는 **기각**):

```
릴스 업로드 → 낯선 사람이 봄 → 그 Dater가 마음에 듦
           → 액션 발화 → 유입 → Dater가 응하면 매칭·채팅
```

바꿀 대상이 아니라 **작동시킬 대상**입니다. `CLAUDE.md` §8의 다섯 경쟁 경계를 훼손하는 변경은 금지입니다.

---

## 1. 지금 상태 (2026-09-08 — fcp Goal `launch-readiness` 종료)

> **Goal `launch-readiness`(Issue #69) 종료 (2026-09-08).** Claude가 실기기 없이 프로덕션 웹(Playwright 격리 프로필)·iOS 시뮬레이터(orca 좌표 탭 + CGEvent swipe)·hosted e2e 스크립트로 핵심 루프 전 구간을 자율 QA했고, 찾은 결함을 Task #70~#80·PR #81~#92로 수리·배포했다. 사용자는 승인 범위(Issue/PR/머지/db push 전권, sandbox 스위치는 드릴 중 임시)를 주고 자율 실행을 위임했다. 판정 이력은 `docs/DECISIONS.md` 2026-09-08 항목 8건, 결함 원장은 `docs/QA_FINDINGS_2026-09-08.md`.
>
> 핵심 도착점:
>
> - **핵심 루프 프로덕션 실증**: 앱 6트랙 창작 → 동의 링크 → 웹 Dater 로그인(8자리 코드)·리뷰·승인·발행 → 공개 페이지(무가입) → 관심(프로필·AI 동의·실 moderation) → 알림 메일 실도착(관심 도착·수락·렌더 완료) → 인박스 수락 → 인트로 룸 양방향 채팅 → kit MP4 렌더·다운로드. 재QA 캠페인 `jordan-tbn8xp`(QA 계정, 9/15 만료).
> - **High 결함 4건 수리·배포**: H-1 무음 전사 가드(#83·#84 — `/api/transcribe` 422 `insufficient_speech`, 무음 오브젝트 삭제, 앱은 같은 초안의 Track 4로 복귀), H-2 이메일 로컬파트 공개 차단(#81 + 0061 — `publicDisplayName`, 모바일 이름 확정 시트, 동의·관심 폼 프리필 제거), H-4 scene 길이=오디오 길이(#85 + 0062 — `transcript.durationMs`, ffprobe video 42.03s ≥ audio 40.54s 실측), H-5 Vercel 배포 8/12 이후 전부 실패(#82 — `pnpm@11.26.0` 핀).
> - **Medium**: 로그인 시트 문구·Account 즉시 갱신·Live 카드 미디어 표시·결제 화면 SDK 원문 제거·에러 배너 스택 프레임 dev 전용(#86), PHPicker 권한 프롬프트 제거(#87), kit 없음/401 문구·동의 승인 규칙 문구·robots/sitemap·`/privacy` `/terms` `/support` 초안(#90).
> - **하니스·CI**: e2e-production 68/68(앱의 structure 경로로 재작성), CI PR 게이트 활성(typecheck·lint·format·test·web audit3·ui, 약 2분), DB/e2e는 `optional-checks` 수동, `deploy-status`가 Vercel 실패를 실패 워크플로로 승격(#89).
> - **결제**: 0060 드릴을 DB 계층 재생으로 실증(#91 — 창·등록·SANDBOX intent·지급·멱등·restore·환불·원복). HTTP 웹훅 단계는 로컬 `.env` 토큰이 프로덕션과 달라 401 — 실 스토어 왕복은 실기기 항목.
> - **출시 키트**: `docs/APP_STORE_SUBMISSION.md`(#88, 6.9" 스크린샷 6장), `docs/LAUNCH_STRATEGY.md`(#92).
>
> hosted 상태: migration 0062까지 적용. 게이트 `public_beta_enabled=on`, `real_payments_enabled=off`, `sandbox_payments_enabled=off`, 등록부 0행. 라이브 캠페인은 QA용 `jordan-tbn8xp` 1건(9/15 만료 후 정리). 프로필 6개 중 미확정 1개(소유자 본인 계정으로 추정 — 앱 Account에서 이름 확정 필요).

---

## 2. 사용자 결정 대기 (Advisor가 임의로 정하지 않음)

`docs/LAUNCH_STRATEGY.md` §7 D1~D8이 권위다. 요약:

1. **법적 페이지 확정**(D1) — `/privacy` `/terms` `/support`의 `[TO CONFIRM]`(지원 이메일·아동안전 연락처·관할·법인·보존 기간). ASC 제출 필수.
2. **심사자 로그인**(D2) — Supabase test-OTP 주소 등록.
3. **심사 기간 sandbox 창**(D3) — 제출~승인 동안 `sandbox_payments_enabled=on` + 심사 계정 등록, 승인 후 off.
4. **`real_payments_enabled` 시점**(D4) — 권장 B(실기기 드릴 후).
5. **실기기 5분 드릴**(D5) — sandbox 구매·restore·환불 + MP4 저장. `TestFlight` 새 빌드(T003 포함)가 먼저 나가야 한다.
6. **중복 Vercel 프로젝트 삭제**(D6) — `friendword-web`(중복)·`friendword-web-nmsi`(프로덕션 추정). 매 push마다 두 번 빌드 중.
7. **시드 Introducer 10명**(D7), **웹훅 토큰 정합**(D8).

---

## 3. 다음에 할 일 (권장 순서)

1. **[사용자] D1·D2·D3 확정 → `eas build --profile production` → TestFlight → 실기기 드릴(D5) → App Store 제출** (`docs/APP_STORE_SUBMISSION.md` 절차, 첫 제출 상한 9/12).
2. **[사용자] 앱 Account에서 본인 표시 이름 확정** — 0061 이후 미확정 이름은 공개 표면에서 'A friend'로 나온다.
3. **[Claude] 실기기 드릴 결과로 `docs/OPS.md` 드릴 기록의 HTTP 단계를 닫고, 러너북 §3 예시 SQL 컬럼명 정정.**
4. **[사용자+Claude] 시드 캠페인 10개 → 릴스 20개 → 지표 주간 기록**(`LAUNCH_STRATEGY.md` §5·§6).
5. **[Claude] 백로그(우선순위순)**: M-7/M-15 소개자 입력 이름과 Dater 확정 이름 불일치 안내, M-17 웹 매직링크 미도착 원인(Supabase Auth 로그), B1 초대 이메일 교체, 렌더 큐 정체 exit 2 실증, `sumin-n2g2ma`·`jordan-ba9m1u`·QA 캠페인 정리(9/15 이후), 옛 Goal #37의 T011·T012·T016 정리(T012 상품 문구 재설계는 첫 20캠페인 후).

### 미착수·보류 (범위 밖으로 명시적으로 남긴 것)

- 실 스토어 sandbox 구매 왕복(실기기), iOS Safari blob 다운로드 실기기 확인, App Store 제출 버튼.
- scene v-next(B2), 얼굴 검증 벤더, 푸시 알림, 다국어(전사 가드는 영어 우선 — CJK 무공백 문장은 거짓 거부 가능).
- 시뮬레이터 마이크는 무음이라 실제 음성 QA는 TTS m4a를 스토리지에 직접 올려 수행했다(`scratchpad` 절차는 `docs/QA_FINDINGS_2026-09-08.md` 참조).

---

## 4. 새 기계 부트스트랩

```
Node 22+(.nvmrc는 22, 이 머신은 26) · corepack → pnpm 11.26.0(`package.json`의 `packageManager`) · pnpm install
```

- **`.env`는 git에 없습니다. 이전 머신에서 직접 복사하십시오**(변수 목록 `.env.example`). **Claude에게 값을 주지 마십시오** — 형식·연결성만 확인합니다.
- DB 테스트에 **brew Postgres 17** 필요. 러너는 `bash scripts/test-db.sh`(plain Postgres + hosted 권한 에뮬레이션 `supabase/tests/helpers/auth_stub.sql`). `supabase start` 스택과는 별개입니다.
- hosted push는 supabase CLI 로그인 필요. 시뮬레이터 QA는 Xcode.
- **QA 도구**: 웹은 Playwright의 격리 프로필(사용자 Chrome 프로필을 건드리지 않음), iOS 시뮬레이터는 orca 좌표 탭 + CGEvent 스와이프 헬퍼로 조작합니다.
- brew `node@22`는 현재 이 머신에서 깨져 있어 시스템 Node 26으로 실행합니다(`engines`는 `>=22`이므로 유효). CI는 `.nvmrc`대로 22를 씁니다.
- **`test:e2e` 실행 절차** (2026-08-04 교정 — 본질은 "**env가 실린 dev 서버가 :3000에 떠 있어야 한다**"입니다):
  ```
  # dev 서버가 이미 :3000에 있으면 그대로 재사용. 없으면:
  pnpm --filter @friendword/web dev   # (tmux 세션 권장)
  # 그 상태에서
  pnpm --filter @friendword/web test:e2e
  ```
  `apps/web/.env → ../../.env` **심볼릭 링크가 이미 존재**해 dev 서버는 루트 `.env`에서 env를 받습니다(셸 주입 불필요). e2e 스펙은 **네트워크 호출을 전부 mock**하므로(playwright.config.ts:15) 로컬 Supabase 스택도 불필요 — 이 머신에는 컨테이너 런타임이 없어 `supabase start`가 애초에 불가합니다. 57-failure 함정의 본질: 서버가 없으면 Playwright가 `reuseExistingServer: true` 설정으로 **env 없는 서버를 스스로 띄워** 전 스펙이 `missing its Supabase configuration`에서 죽습니다.
- **렌더 e2e**(선택): `NEXT_DIST_DIR=.next-build pnpm exec next start -p 3120` 후 `PITCH_RENDER_E2E=1 pnpm exec vitest run --config vitest.render.config.ts`. `pnpm build`는 `NEXT_DIST_DIR=.next-build`를 쓰므로 `next start`도 같은 값이어야 합니다.

---

## 5. 아키텍처에서 반드시 알아야 할 것

### 권한 모델

**전역 `users.role` 필드가 없습니다.** Creator/Dater/Interested Person 같은 계정 유형도 없습니다. 권한은 **campaign membership · resource ownership · pitch creator · interest sender 관계**로만 판정합니다(`CLAUDE.md` §7). 집행은 3층입니다: **SECURITY DEFINER RPC + BEFORE 트리거 + RLS**.

`0052`가 public 스키마 blanket ACL을 회수하고 컬럼 단위로 재부여했습니다. **anon은 테이블 권한이 0이어야 합니다.** 신규 테이블에는 필요한 GRANT를 컬럼 단위로 명시하고 anon에게는 아무것도 주지 마십시오 — 놓치면 hosted에서 404/403이 납니다. service 전용 RPC는 `REVOKE ... FROM PUBLIC, anon, authenticated`(`0051` 선례)를 반드시 겁니다.

### PitchScene 스키마 (동결됨)

v1(사진 크로스페이드) / **v2(크롭 사다리 + 비트 그리드 + 11효과 닫힌 union + warm/hype)** / v3(클립 샷). **각 버전은 동결이며 시각적 변경은 새 schemaVersion을 요구합니다.** MP4는 다운로드된 파일이라 위반이 영구적이므로, 이 규칙은 이제 **웹·모바일·MP4 세 표면 모두**를 덮습니다.

골든 벡터(scene JSON + 기대 판정)가 vitest와 SQL 하니스에 **바이트 동일**로 공유되고 드리프트 테스트가 지킵니다.

### 언어 간 산술 함정 (네 번 사고남)

moderation 텍스트 해싱 · scene 해시 직렬화 · 분수 `pulseHz` 나눗셈 · 초→ms 반올림. 원인은 **DB `NUMERIC` vs JS IEEE double**입니다. scene 해시는 반드시 `scene_definition::text`를 **재직렬화 없이** 다뤄야 합니다 — JS에서 `JSON.parse` 후 `stringify`로 되돌리면 키 순서·수치 표현이 달라져 절대 일치하지 않습니다.

### 렌더 파이프라인 (Phase 4)

- **프레임은 디스크에 쌓지 않습니다.** 리눅스에서 Chromium이 /tmp에 209MB를 전개하고 남는 게 ~300MB인데, 1080×1920 PNG 1,800장은 GB 단위입니다. ffmpeg stdin 스트리밍이 최적화가 아니라 **제약**입니다.
- **캡처 중 CSS `transition`은 무력화**합니다. 벽시계로 보간되므로 캡처 속도에 따라 출력이 달라져 결정론이 깨집니다. 불투명도 램프는 이미 해석기가 계산하므로 꺼도 승인된 해석만 남습니다. **픽셀 동일성은 약속하지 않습니다**(§12).
- **`elapsedMs` 반영이 한 커밋 늦습니다.** 주입 직후 찍으면 전 구간이 1프레임 밀립니다. "같은 t 두 번 = 동일" 검사로는 **일관되게 밀린 상태를 못 잡으므로** 샷 경계 검사가 따로 있습니다.
- **오디오는 Introducer 원본 그대로**(§8-1). AAC면 `-c:a copy`, 아니면 순수 AAC. `loudnorm` 등 **파형을 바꾸는 필터 전면 금지**. 엔드카드 구간은 무음 패딩이고 `-shortest`를 쓰지 않습니다.
- **엔드카드는 scene 스키마가 아니라 렌더러 크롬**입니다 — 브랜드 상수 + canonical 캠페인 URL을 승인 타임라인 **뒤에 순수 append**(1.5초). Dater 저작 텍스트 0. URL은 **환경 설정값**(하드코딩 금지). 동의 화면에 고지 1줄이 같은 슬라이스에 나갔습니다.
- **번들 예산**: 렌더 라우트 ≈153MB / 250MB. `ffprobe`와 BlazeFace는 **렌더에 불필요하므로 넣지 마십시오**. `outputFileTracingIncludes`는 라우트별입니다.
- **`serverExternalPackages: ['ffmpeg-static', 'ffprobe-static']`를 지우지 마십시오.** 두 패키지는 `path.join(__dirname, …)`로 바이너리를 찾는데, 번들되면 `__dirname`이 청크 디렉터리로 재작성돼 spawn ENOENT가 납니다. `outputFileTracingIncludes`는 **라우트별**입니다 — Chromium/ffmpeg를 exec하는 라우트를 새로 만들면 그 라우트의 엔트리도 추가해야 합니다(render-run·render-bench에 각각 있음).
- **워커 기동은 kick 체인입니다 (cron 없음, `26ebd6e`)**: kit 카드 → `/api/media/render-kick`(세션 게이트 릴레이) → `after()`로 `triggerRenderRun` → 시크릿을 실어 render-run POST. 트리거는 **5초 abort로 응답 대기만 취소**합니다(패스는 계속 돈다는 Vercel 동작 가정 — client-disconnect 취소 설정이 켜지면 이 가정이 깨집니다). 워커는 `processed>0`이면 pass 종료 시 self-kick해 큐를 마저 비웁니다. **queued인 채 claim되지 않는 잡은 ops_alert를 울리지 않습니다**(알림은 터미널 실패에만) — 정체된 큐의 백스톱은 운영자 curl입니다(trigger.ts 주석에 명령 기재).

### 과금 경계 (Phase 4)

무료 렌더 1회는 **구매가 아니라 grant**라서 `purchase_credit_ledger`가 아닌 별도 테이블(`pitch_render_unlocks`, 캠페인당 UNIQUE)에 있습니다. **소비는 성공 시점**입니다 — 실패는 아무것도 태우지 않습니다. 재렌더는 기존 `campaign_pass_30d_1999`로 열립니다(**신규 SKU 없음**).

거절 문구 **두 개는 의미가 다릅니다. 절대 합치지 마십시오**:

- `campaign pass required` — 무료 1회를 **정말로** 썼습니다. 참인 주장입니다.
- `a render for this campaign is already in progress` — **아직 아무것도 소비되지 않았습니다.** 이 사용자는 결제가 아니라 기다리면 되고, 진행 중인 렌더가 실패하면 다음은 무료입니다. 여기서 결제를 권하면 **거짓이자 부당한 결제 유도**입니다.

---

## 6. 반복해서 틀렸던 것 (같은 실수를 다시 하지 마십시오)

- **하니스가 프로덕션보다 약하면 자기가 잡으려던 걸 숨깁니다** — 세 번 발생, `CLAUDE.md` §14.
- **식별자를 기억으로 쓰지 마십시오.** Advisor가 컬럼명·RPC 인자·기본값을 틀리게 지시한 사례가 이 프로젝트에서만 **8건**이고, 그중 하나(`structure_reviewed`를 `dater_reviewed_structure`로 착각)는 **잘못된 이름이 배포까지 갔습니다**. 지시 전에 소스에서 확인하십시오.
- **Worker가 근거를 갖춰 반대하면 대체로 Worker가 맞았습니다.** 상태 전이 조건, ms 반올림(비트 레벨 반례 제시), 과금 경합의 방향, 재시도 분기의 도달 가능성 — 전부 Worker가 Advisor를 실행 증거로 뒤집었습니다.
- **커밋 전에 hosted DB를 먼저** — `CLAUDE.md` §15.
- **문구는 코드가 주는 것만 말합니다**(§12). 과대약속 감사에서 실제로 걷어낸 표현: `will review`, `will reply`, `when Friendword opens`, `beyond their review`, `check back soon`. 렌더 소요 시간 추정도 금지입니다(큐 대기가 무한정).
- **개인정보·동의·identity·moderation·결제를 mock만으로 완료 처리 금지**(§9).
- **hosted 실계정 `wwdbsh@gmail.com` 삭제·조작 금지.**
- **TTS/합성 음성은 공개 데모에서 금지.**

### 운영 함정

DB push는 클린 트리에서만 · `:3000` dev 서버가 떠 있는 채로 `web build` 금지 · RPC 재정의는 최신본 통째 복사 · `apps/mobile/app/` 하위 `*.test.*` 금지(라우트로 번들됨, 가드 테스트 있음) · plpgsql `NOT IN` + NULL · 웹 수동 QA 인증은 localStorage `friendword-web-auth` · ASC IAP ID는 삭제 시 영구 소각(삭제 금지) · EAS는 `eas.json`에 pnpm 버전 핀 · Vercel은 `buildCommand: next build`.

---

## 7. 인프라 (계정 소유는 사용자)

- **DB**: Supabase hosted `oknolcxsvogrhnxnyosr`, **Free 플랜**(파일당 50MB 상한 — Pro 업그레이드 예정). 마이그레이션 `0001~0057` 배포·정합. `0040`은 의도적 미사용 갭.
- **웹**: Vercel, GitHub `wwdbsh/friendword` **`main` push마다 자동 배포**(Root=`apps/web`).
- **모바일**: EAS `@wwdbsh/friendword` → TestFlight 내부 배포 가동.
- **RevenueCat**: 프로젝트 연동 완료, 상품 `creator_launch_credit_499` · `campaign_pass_30d_1999`(ASC 둘 다 **Consumable**), 웹훅 → `/api/revenuecat`.
- **정기 운영 실행**: (기존 기재 정정 — 2026-08-11) "시크릿 등록 여부 미확인"이 아니라 **워크플로 파일 자체가 없었습니다**. `scheduled-ops.yml`은 2026-07-25에 삭제됐고 그 뒤 리포에 schedule 트리거가 하나도 없어 `run-scheduled-ops.mjs`는 한 번도 실행되지 않았습니다. 시크릿 2종은 사용자가 2026-08-11 등록 완료(`gh api …/actions/secrets`로 존재 확인). 이제 `scheduled-ops.yml`(매일 03:10 UTC, Node·Storage 잡)과 `safety-escalation.yml`(매시간 :17, 신고 큐 감시)이 있습니다 — 상세·runbook은 `docs/OPS.md`.
- **GH Actions 과금 미확인 리스크**: 2026-07-24~25 모든 run이 `The job was not started because recent account payments have failed or your spending limit needs to be increased`로 죽었고, 그 뒤 성공한 run이 없습니다(`ci.yml`은 `disabled_manually`). 두 워크플로가 실제로 기동하는지는 **머지 후 첫 `workflow_dispatch`로 확인해야** 합니다. 기동하지 않으면 신고 알림 채널도 함께 죽어 있는 것입니다.

---

## 8. 판정

**공개 베타.** 2026-08-11 사용자가 베타 스위치를 켰습니다 — 외부 관심 전달·publish가 열린 상태. 렌더·자막·퍼널은 실증 완료. 릴스 배포와 `real_payments`는 사용자 판단 항목입니다.
