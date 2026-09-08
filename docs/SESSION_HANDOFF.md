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

|             |                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코드        | `858ccbe` on `main` (자막 크롬 — Goal 마지막 코드 병합)                                                                                                                                                                                                                                      |
| hosted DB   | **0057까지 적용·정합** (`supabase migration list` 로컬=원격, 2026-08-11 push — 릴스 계측 allowlist. 실측: 익명 `reel_visit` 204·익명 `s1_intent_created` 401급 거부·미지 이벤트 거부). `0040`은 의도적 갭. **`0058`(이벤트 알림 outbox)은 브랜치에만 있고 hosted 미적용 — 사용자 push 대기** |
| 런치 게이트 | **`public_beta_enabled=on` (2026-08-11 사용자 전환 — 공개 베타 개방)** · `real_payments_enabled=off` · `identity_enforcement=off` · `media_validation_enforcement=off` · `media_render_concurrency_cap=1`                                                                                    |
| 전 게이트   | green (2026-08-12 T003 리뷰 반영 후 재실행, 브랜치 `fcp/40-event-email-v1`): DB 하니스 31파일 exit 0 · 패키지 743(contracts 293·mobile 268·data 136·domain 13·adapters 11·ui-tokens 22) · audit3 228 · ui 42 · render 98(+14 skip) · Playwright 80 · build·typecheck·lint·format ✓           |

**green test ≠ 완료 증거입니다.** 이 리포에서 전 게이트 green인 채로 프로덕션이 깨져 있던 사고가 이 Goal에서만 3건 더 나왔습니다(폰트 local() 게이트, EAS env 미베이크 2회) — 전부 "하니스가 프로덕션보다 약함" 계열. 산출물(IPA·MP4·실응답)을 직접 검증하는 것이 규칙입니다.

> **진행 중 (2026-08-11 착수 / 2026-08-12 독립 리뷰 반영, fcp Goal `#40` 계열):** T003 —
> **이벤트 이메일 알림 v1**이 브랜치 `fcp/40-event-email-v1`에 있습니다. 관심 도착→Dater,
> 수락·거절→발신자, 렌더 완료→요청자 **4종**이 `notification_outbox`(migration **0058**,
> service-role 전용)에 적재되고 Next.js 발송 라우트가 Resend로 보냅니다.
>
> 리뷰 반영으로 바뀐 운영 사실 5가지: ① `notification_email_enabled`는 **`off`로 시드**되며
> 켜는 것이 OPS.md 활성화 체크리스트의 마지막 단계입니다(첫 발송 = 의도적 행위). ② 한 pass는
> **4건/300초 lease**이고 pass가 자기 데드라인을 넘기면 남은 항목을 leased인 채로 두고 멈춥니다
> (같은 사람에게 두 번 보내지 않기 위해 — 관계는 `timeBudget.ts` + 관계 테스트가 고정).
> ③ 자기 kick 조건은 "배치 가득"이 아니라 **`sent > 0`**. ④ 실패 항목은 **`attempts × 5분`**
> 백오프 뒤에만 재claim되고, 만료는 `expired_before_send`(무시도, 무알림)와
> `expired_after_attempts`(시도 있었음, **알림**)로 갈립니다. ⑤ 인박스 거절 문구는
> "Declined. Your reason and details are never shared with them." — 배달 여부를 단정하지
> 않으므로 배포 전후 어느 날에도 참입니다.
>
> **아직 hosted에 push되지 않았고, 시크릿이 없어 실발송은 한 번도 검증되지 않았습니다** —
> 게이트는 전부 green이지만 이것은 "제어 흐름이 맞다"는 뜻이지 "메일이 도착한다"는 뜻이
> 아닙니다(§6의 반복된 교훈). 켜는 절차와 시크릿 목록은 `docs/OPS.md` →
> **이벤트 이메일 알림 → 활성화 체크리스트**, 설계 근거는 DECISIONS 2026-08-11 T003 항목과
> 그 아래 2026-08-12 리뷰 반영 항목.

> **진행 중 (2026-08-12 착수, fcp Goal `#44` 계열):** T007 — **회원 탈퇴: 모바일 진입 +
> 데이터 소거 실증**이 브랜치 `fcp/44-account-deletion`에 있습니다. 모바일 홈에 `Account`
> 진입점과 탈퇴 화면(2단 확인, 두 번째는 `DELETE` 타이핑)이 생겼고 웹과 **같은 RPC**
> `request_account_deletion()`을 부릅니다 — App Store Guideline 5.1.1(v)의 9/30 출시
> 블로커였습니다. **migration 0건.**
>
> 이 태스크가 찾아 고친 실제 잔존 PII: 삭제 잡은 보존·이관되는 draft에서 `voice.m4a`
> 하나만 지웠는데, 렌더러가 원본 오디오 스트림을 그대로 복사하므로
> **`<draft>/renders/*.mp4`가 같은 녹음의 비트 동일 사본**으로 남아 있었습니다(kit 서명
> URL로 다운로드 가능). 이제 렌더 산출물과 그 `media_render_jobs` 행까지 함께 지웁니다.
>
> **hosted 합성 계정 왕복 1회로 소거를 실증했습니다**(신규 계정 → PII 적재 → 앱과 동일한
> 인증 RPC로 탈퇴 → `run-scheduled-ops.mjs` 수동 1회 → 전 테이블 0행·auth 404·storage 0).
> 실행 전후 hosted 총계가 동일해 오폭이 없음도 확인했습니다. 다만 **공유 캠페인·렌더가 있는
> 경로는 하니스로만 증명**했고 실계정으로 재현하지 않았습니다(불가침 대상 보호).
>
> **고위험 독립 리뷰 반영 완료(같은 브랜치, hosted 왕복 불필요 — 로컬 증명만):** 가장 큰 것은
> **재시도 비수렴 blocker**였습니다. 잡의 범위 질의가 `pitch_drafts.created_by_user_id`로
> 찾는데 소유권 이관 stage가 바로 그 컬럼을 덮어쓰므로, "이관 성공 → 목소리 소거 전 실패"가
> 한 번 나면 녹음이 storage에 **영구히** 남고 이후 재시도는 전부 "할 일 없음"으로 성공을
> 보고했습니다. **목소리 소거를 이관 앞으로** 옮겨 수정하고, 잡을 직접 부르는
> `packages/data/src/accountErasureJob.test.ts`(주입 admin 스텁, 5건)를 신설해 **수정 전 red /
> 수정 후 green을 실증**했습니다. 함께: stage 내부 순서(렌더잡 → 객체 → 사후 재나열 확인),
> 탈퇴 문구의 transcript 보존 명시, 파싱 실패해도 로컬 blob을 비우는 소거,
> 결과 미확정 실패 문구 + 재진입 시 `account_status` 판별, `pitch_render_unlocks`·share kit
> 결제자 케이스 픽스처. 상세와 남은 위험은 DECISIONS 2026-08-12 T007 항목과 그 아래
> 리뷰 반영 절, 삭제 후 잔존/소거 표는 `docs/PRIVACY_DATA_MAP.md`, 문의 대응과 재시도 성질은
> `docs/OPS.md` → 데이터 삭제 요청.

## 2. 사용자 결정 대기 (Advisor가 임의로 정하지 않음)

1. **`public_beta_enabled`** — 켜는 즉시 S2 관심 전달이 활성화됩니다. **릴스 배포는 이 스위치 이후**(`CLAUDE.md` §16). 렌더·자막·퍼널이 전부 실증된 지금, 이것이 유일한 기술 외 관문입니다.
2. **`real_payments_enabled` 시점** — 해커톤 Grand Prize shortlist가 RevenueCat 계측 제출-기간-내(~9/30) 매출로 결정되므로 베타 시점과 같은 축에서 판단(`HACKATHON_RULES.md`). 켜기 전 sandbox 결제 왕복 검증(OPS.md 게이트 드릴) 필요.
3. **릴스 배포 시작** — 베타 스위치 이후. 첫 실사용자 캠페인 MP4부터 자막이 구워집니다(T017 완료로 조건 충족).
4. **Ship Kit participant form** — 스폰서 퍽 해제용(자격 무관).
5. `identity_enforcement`·`media_validation_enforcement` — 베타 운영 데이터를 보고 판단.

## 3. 다음에 할 일 (권장 순서)

1. **[사용자] 0059 push + 합성 왕복 1회 (T010 / Issue #47 — 데이터 파괴 경로)** — `supabase/migrations/0059_pitch_draft_cleanup.sql`이 아직 hosted에 없습니다(`delete_my_pitch_draft`가 `PGRST202`로 실측 확인됨, 2026-08-12). 순서: `supabase db push --linked` → hosted에 함수·ACL 존재 확인 → **합성 계정 왕복 스크립트 1회**:

   ```sh
   node scripts/qa/hosted-pitch-draft-cleanup-proof.mjs
   ```

   스크립트는 자기가 만든 `59010000-0000-4000-8000-0000000000…` 접두 id(`SYNTHETIC_ID_PREFIX`)와 `t010-cleanup-*@friendword.invalid` 계정(`SYNTHETIC_EMAIL_LOCALPART_PREFIX`·`SYNTHETIC_EMAIL_DOMAIN`)만 건드립니다. 확인 항목: **P0** anon 키로 호출 시 함수 본문 이전에 권한 거부(로컬 하니스로는 증명 불가 — hosted 기본 권한이 anon에게 EXECUTE를 주므로), 보호 규칙 **P1**(캠페인 있는 pitch 거부)·**P2**(진행 중 잡 거부)·**P3**(타인 draft 거부)·**P6**(결제 크레딧 거부와 원장 제거 후 성공), **P4** happy path의 정확한 파괴 범위(저장소 객체는 sweep 몫으로 **남김**), **P5** 정리 후 합성 네임스페이스 잔존 0과 **실행 전 존재하던 모든 id의 id 단위 생존**(총계 비교가 아니라 — 라이브 프로젝트에서 실사용자 가입 한 건이 총계를 흔들고, 같은 크기의 맞교환은 총계로 잡히지 않습니다). 픽스처 생성 이후는 try/finally이므로 어느 단계가 던져도 합성 행·객체·계정을 정리하고, 정리하지 못한 항목은 삼키지 않고 이름으로 나열한 뒤 non-zero로 끝냅니다. **이 확인 전에는 "정리 삭제 완료"라고 주장하지 않습니다.** 불가침: QA 캠페인 `sumin-n2g2ma`, 만료 캠페인 `jordan-ba9m1u`(둘 다 `UNTOUCHABLE_CAMPAIGN_SLUGS`로 슬러그·id·status까지 대조), 실계정 죽은 draft 26건 — 스크립트는 이들을 **읽고 id 단위로 생존만 확인**하며 쓰지 않습니다.

2. **[사용자] 0058 push + 알림 시크릿 설정 + 스위치 켜기 + 실발송 왕복 1회** — `docs/OPS.md` → 이벤트 이메일 알림 → **활성화 체크리스트**의 7단계를 순서대로. 핵심은 순서입니다: push → 시크릿 등록·재배포 → 스위치 **off인 채로** 라우트 200 확인 → 큐 내용 확인 → 메일함 열어 둔 채 `notification_email_enabled='on'` → 실계정 관심 표현 1건으로 메일 도착 육안 확인. 이 확인 전까지 "알림 완료"라고 주장하지 않습니다.
3. **첫 실사용자 캠페인 1건을 밀착 관찰** — 창작→승인→publish→렌더(자막 포함 첫 실파일)→릴스 업로드까지. B1(초대 이메일 오입력)이 실사용자에게 터지면 백로그 우선순위 상향.
4. **릴스 배포 개시** + `real_payments_enabled` 판단(sandbox 드릴 선행).
5. 9/30 스토어 출시 마감 역산 유지(`HACKATHON_RULES.md`), App Store 제출물 준비 트랙 별도 기립.

### 2026-09-08 상태 (전체 재작성은 T011 몫 — 여기는 델타만)

- **hosted 마이그레이션**: 0058·0059·0060·0061·0062가 모두 hosted에 적용됐습니다. 위 1·2번 항목("0059/0058 push 대기")은 **완료**이며 다음 재작성에서 걷어냅니다.
- **알림**: `notification_email_enabled`가 켜져 있고 실발송 왕복이 2026-09-08에 육안 확인됐습니다.
- **QA 캠페인**: `sumin-n2g2ma`는 만료·아카이브됐습니다(더 이상 라이브 표면이 아님).
- **배포**: pnpm 핀 불일치로 나던 Vercel 배포 실패는 #82에서 수정됐습니다.
- **근거·후속**: 자세한 사유는 `docs/DECISIONS.md`의 2026-09-08 항목을, 남은 작업 목록은 Goal #69(Issues #70–#80)를 따릅니다.

### 미착수·보류 (범위 밖으로 명시적으로 남긴 것)

- 백로그 B1~B4(`docs/TASKS.md` 2026-08-11 절), Phase 3b(클립 in scene·얼굴 블러 — 렌더는 v2 전용), Phase 5(비용 가드레일 확장·사람 검토 큐), Instagram Private Replies(Meta App Review), Play Install Referrer(android 디렉터리 부재), 모바일 내보내기 표면(웹 kit만).

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
