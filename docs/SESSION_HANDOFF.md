# PROJECT HANDOFF

> 갱신: **2026-08-11 KST** (fcp Goal `render-launch-path` 종료 시점). 작업 규칙은 [`CLAUDE.md`](../CLAUDE.md)(매 세션 자동 로드), 결정 이력과 근거는 [`docs/DECISIONS.md`](DECISIONS.md)(50건, 각 항목에 날짜·이유·검토한 대안·영향). **이 문서는 "지금 어디에 서 있는가"만 다룹니다** — 왜 그렇게 결정했는지는 DECISIONS를 읽으십시오.
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

## 1. 지금 상태 (2026-08-11 — fcp Goal `render-launch-path` 완료)

> **Goal `render-launch-path`(Issue #1) 종료 (2026-08-11).** 목표였던 두 문장이 전부 실증됐습니다: **승인된 피치가 프로덕션에서 MP4가 되고**(T009 — 실캠페인 내보내기 요청→kick 체인 claim 1.2초→3분19초 완주→오디오 스트림 MD5 원본 동일·엔드카드 canonical), **베타 개방 직전 상태에 도달했습니다**(전 게이트 green, hosted 0056 정합, 런치 게이트 4종 off로 사용자 결정만 대기). 태스크별 증거는 Issue #2~#31과 병합 PR #12~#33, 판정 이력은 DECISIONS 2026-08-05~11 항목.
>
> 핵심 도착점 요약:
>
> - **렌더 파이프라인 프로덕션 실증**: Performance 머신(2vCPU/4GB, Vercel Pro) 위에서 60s 워스트케이스 벤치 완주 — **자막 포함 renderMs 364s**(기준 480s, 여유 24%), peak 메모리 815MB~1.52GB(`proc-rss-sampled`, 기준 3.44GB), 4회 outputBytes 동일(결정론). cap=1 유지. 기회주의 kick 체인·invocation-지속 가정·과금 원자성(소비=성공 시점) 전부 실측 확정.
> - **자막 크롬(T017, A안)**: 웹 플레이어·MP4 공용 — `captionChrome.ts` 순수 함수 하나를 웹은 CSS 키프레임으로, 캡처는 프레임별 평가로 소비(결정론이 seek 시그니처에 편입). 전 치수 컨테이너 단위(dvh 제거 — 어떤 임베드 크기에서도 비율 동일). scene·scene_hash 불변.
> - **모바일 창작 플로우 실기기 검증(T015, TestFlight #9)**: 녹음 무결성 게이트(무음 테이크 거부), AI 초안 실생성(OpenAI), 에러 계측(클래스+프레임 화면 표시). EAS env는 빌드 프로필-환경 연결(eas.json `environment`)로만 주입됨 — **베이크 검증은 IPA 추출로**(대시보드 신뢰 금지, 2회 사고).
> - **운영 수리 이력**: hosted SMTP(Resend 도메인 인증 — 이전엔 소유자 외 전 사용자 가입 불가), Auth Site URL·Redirect(nmsi→friendword.com — 오리진 세션 분열 방지), 이메일 템플릿 통일, OPENAI_API_KEY·REVENUECAT_WEBHOOK_AUTH_TOKEN Vercel 설정(사용자).
> - **QA 데이터(hosted, 무해·보존)**: 캠페인 `sumin-n2g2ma`(allowlist 격리, 2026-08-18 자연 만료), QA 계정 wwdbsh+dater/+sim, 죽은 드래프트 3건(자기초대 등 — B1 백로그의 실증 사례). 삭제하지 않음 — 목록이 곧 기록.
> - **백로그**: `docs/TASKS.md` 2026-08-11 절 — B1(초대 이메일 복구 경로), B2(scene v-next — 새 schemaVersion 필수), B3(계측 잔손질), B4('rest' 크래시 감시).

|             |                                                                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코드        | `858ccbe` on `main` (자막 크롬 — Goal 마지막 코드 병합)                                                                                                                                                                                                  |
| hosted DB   | **0057까지 적용·정합** (`supabase migration list` 로컬=원격, 2026-08-11 push — 릴스 계측 allowlist. 실측: 익명 `reel_visit` 204·익명 `s1_intent_created` 401급 거부·미지 이벤트 거부). `0040`은 의도적 갭                                                |
| 런치 게이트 | **`public_beta_enabled=on` (2026-08-11 사용자 전환 — 공개 베타 개방)** · `real_payments_enabled=off` · `identity_enforcement=off` · `media_validation_enforcement=off` · `media_render_concurrency_cap=1`                                                |
| 전 게이트   | green (2026-08-11 통합 재실행): DB 하니스 29 exit 0 · 패키지 730(contracts 293·mobile 256·data 135·domain 13·adapters 11·ui-tokens 22) · audit3 182 · ui 35 · render 98(+e2e 106, 실 Chromium 자막 포함) · Playwright 75 · build·typecheck·lint·format ✓ |

**green test ≠ 완료 증거입니다.** 이 리포에서 전 게이트 green인 채로 프로덕션이 깨져 있던 사고가 이 Goal에서만 3건 더 나왔습니다(폰트 local() 게이트, EAS env 미베이크 2회) — 전부 "하니스가 프로덕션보다 약함" 계열. 산출물(IPA·MP4·실응답)을 직접 검증하는 것이 규칙입니다.

## 2. 사용자 결정 대기 (Advisor가 임의로 정하지 않음)

1. **`public_beta_enabled`** — 켜는 즉시 S2 관심 전달이 활성화됩니다. **릴스 배포는 이 스위치 이후**(`CLAUDE.md` §16). 렌더·자막·퍼널이 전부 실증된 지금, 이것이 유일한 기술 외 관문입니다.
2. **`real_payments_enabled` 시점** — 해커톤 Grand Prize shortlist가 RevenueCat 계측 제출-기간-내(~9/30) 매출로 결정되므로 베타 시점과 같은 축에서 판단(`HACKATHON_RULES.md`). 켜기 전 sandbox 결제 왕복 검증(OPS.md 게이트 드릴) 필요.
3. **릴스 배포 시작** — 베타 스위치 이후. 첫 실사용자 캠페인 MP4부터 자막이 구워집니다(T017 완료로 조건 충족).
4. **Ship Kit participant form** — 스폰서 퍽 해제용(자격 무관).
5. `identity_enforcement`·`media_validation_enforcement` — 베타 운영 데이터를 보고 판단.

## 3. 다음에 할 일 (권장 순서)

1. **[사용자] 베타 스위치** — `public_beta_enabled=on` (app_config UPDATE, OPS.md 절차). 이전에 유입된 S1 의사는 전달되지 않았음을 인지.
2. **첫 실사용자 캠페인 1건을 밀착 관찰** — 창작→승인→publish→렌더(자막 포함 첫 실파일)→릴스 업로드까지. B1(초대 이메일 오입력)이 실사용자에게 터지면 백로그 우선순위 상향.
3. **릴스 배포 개시** + `real_payments_enabled` 판단(sandbox 드릴 선행).
4. 9/30 스토어 출시 마감 역산 유지(`HACKATHON_RULES.md`), App Store 제출물 준비 트랙 별도 기립.

### 미착수·보류 (범위 밖으로 명시적으로 남긴 것)

- 백로그 B1~B4(`docs/TASKS.md` 2026-08-11 절), Phase 3b(클립 in scene·얼굴 블러 — 렌더는 v2 전용), Phase 5(비용 가드레일 확장·사람 검토 큐), Instagram Private Replies(Meta App Review), Play Install Referrer(android 디렉터리 부재), 모바일 내보내기 표면(웹 kit만).

## 4. 새 기계 부트스트랩

```
Node 22(.nvmrc) · corepack → pnpm 11.12.0 · pnpm install
```

- **`.env`는 git에 없습니다. 이전 머신에서 직접 복사하십시오**(변수 목록 `.env.example`). **Claude에게 값을 주지 마십시오** — 형식·연결성만 확인합니다.
- DB 테스트에 **brew Postgres 17** 필요. 러너는 `bash scripts/test-db.sh`(plain Postgres + hosted 권한 에뮬레이션 `supabase/tests/helpers/auth_stub.sql`). `supabase start` 스택과는 별개입니다.
- hosted push는 supabase CLI 로그인 필요. 시뮬레이터 QA는 Xcode.
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
- **scheduled-ops cron**: GH Actions 시크릿(`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY`) 등록 여부 미확인 — 미등록이면 매시간 fail-fast 메일(의도된 동작).

---

## 8. 판정

**공개 베타.** 2026-08-11 사용자가 베타 스위치를 켰습니다 — 외부 관심 전달·publish가 열린 상태. 렌더·자막·퍼널은 실증 완료. 릴스 배포와 `real_payments`는 사용자 판단 항목입니다.
