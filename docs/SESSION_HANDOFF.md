# PROJECT HANDOFF

> 갱신: **2026-08-04 KST**. 작업 규칙은 [`CLAUDE.md`](../CLAUDE.md)(매 세션 자동 로드), 결정 이력과 근거는 [`docs/DECISIONS.md`](DECISIONS.md)(50건, 각 항목에 날짜·이유·검토한 대안·영향). **이 문서는 "지금 어디에 서 있는가"만 다룹니다** — 왜 그렇게 결정했는지는 DECISIONS를 읽으십시오.
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

## 1. 지금 상태 (2026-08-04)

> **2026-08-05 갱신 (fcp Goal `render-launch-path` — Issue #1, 상세는 각 PR·DECISIONS 당일 항목):**
>
> - 코드는 `88cc9e3` on `main`. 알려진 미해결 2건 종결: `0055`(NULL-digest fail-closed, PR #12) · `0056`(메시지 rate limit 경합 + 인덱스, PR #13) — **둘 다 로컬 전용, hosted 반영은 0054와 함께 T008에서**.
> - **Vercel 배포 3일 중단(bc1c492~) 복구** (PR #15): 원인은 `serverExternalPackages`가 pnpm 심링크를 함수 엔트리로 만들어 심링크 관통 tracing include와 충돌(ENOTDIR→silent ENOENT 가면화). 불변식: 실의존성 include는 `storeGlob`(실경로) 경유 — `./node_modules/` 형태 금지. **아래 §2-1의 "라우트 501" 서술은 당시에도 부정확했다** — 라우트는 배포된 적 자체가 없었다. 지금은 배포·실존한다.
> - **§2-1 해소**: `FRIENDWORD_MEDIA_RENDER_SECRET`·`FRIENDWORD_MEDIA_INGEST_SECRET`·`FRIENDWORD_SHARE_ORIGIN` Vercel Production 설정 완료(사용자). 실증: `friendword.com`의 render-bench/ingest-run/render-run 무토큰·오토큰 **401**(501 소멸).
> - **§2-3 해소**: `friendword.com` 취득(08-04)·Vercel 연결·NS 위임 전파·SSL 정상, apex canonical + www→apex redirect. 홈 200.
> - `vercel.json`의 `memory` 키는 제거됨(Active CPU 과금에서 플랫폼이 무시 — 메모리 상한은 이제 Performance 머신의 4GB). `maxDuration`은 렌더 2종 **800**(T014), ingest-run은 300.
> - ~~다음 사용자 액션은 §3-2 리눅스 실측 벤치(T002)뿐~~ → **벤치 첫 실행이 새 결함을 드러냈다 (세션 종료 시점 미해결, 아래가 다음 세션의 첫 일감):**
>
> **T002 블로커 — 렌더 워커 프로덕션 기동 결함 (2026-08-05 실측, fcp Issue #3 코멘트에 원본):**
>
> - 사용자 벤치 실행 결과: 인증·라우트 진입은 성공(`instanceId` 반환)하나 2.4~5.2초에 `{"error":"NetworkError: A network error occurred."}` 로 500. cold/warm 모두 동일.
> - 런타임 로그 실측: 벤치 POST가 500으로 끝난 **몇 초 뒤에** `/internal/render/bench-…` GET(별도 함수 호출, 캡처 페이지 SSR)이 **200으로 완료** — 즉 Chromium이 기동해 항해까지 발행한 뒤 **Chromium 프로세스가 죽어**(크래시 의심) puppeteer↔Chromium WebSocket이 끊긴 그림. `NetworkError: A network error occurred.`는 그 절단의 전형적 메시지.
> - 이 리눅스 전용 기동 경로(`@sparticuz/chromium` 149 추출 + `headless:'shell'` + sparticuz args, apps/web/src/lib/pitchRender/browser.ts:57-64)는 **프로덕션에서 2026-08-05 처음 실행됐다** — darwin 벤치는 로컬 Chrome을 쓰므로 이 경로를 검증한 적이 없다(하니스가 프로덕션보다 약한 또 하나의 사례).
> - ~~현재 벤치는 에러 메시지만 반환하고 Chromium stderr·스택을 버린다 → 원격 진단 불가~~ → **T012(#17, PR #18)로 진단 계측 배포, 재실행 1회로 원인 확정 (2026-08-06, 증거 원본 Issue #3 코멘트)**: 크래시가 아니었다 — Chromium exit 0. `stage: payload-load`에서 `DOMException: NetworkError`. **원인**: next/font가 생성하는 `src: local("Arial")` 사이즈 조정 fallback face('Unbounded Fallback' 등)를 first-frame 게이트가 계산된 전체 스택으로 `document.fonts.load()`에 넘김 → sparticuz headless-shell(`--single-process`)은 local() 조회 기계가 없어 face가 error 상태로 끝나고 load()가 NetworkError로 reject. darwin 로컬 Chrome은 local() 정상이라 재현 불가(하니스가 프로덕션보다 약한 사례 4호).
> - **수정 = T013(#19)**: ① 게이트가 `@font-face` 규칙을 읽어 **url() 소스가 실재하는 패밀리만** 로드하고 `check()`로 검증(fontGate.ts — 패밀리 이름 하드코딩·스택 순서 의존 없음, 실폰트 미로드 시 여전히 명시 실패 = 결정론 원칙 유지, 전역 next/font 설정 불변). ② 부수 발견: Vercel에 `/sys/fs/cgroup/memory.peak`이 없어 `memorySource: self-maxrss`(Node 단독, 자식 미포함)로 떨어져 있었다 → peakMemory.ts 폴백 체인(v2 peak → v2 current 750ms 샘플링 → v1 max_usage → self-maxrss) + `memorySampled`/`memoryProbes` 정직 보고. **T002 판정 시 sampled 수치는 하한으로 취급**하고 `memoryProbes`로 어느 소스가 실제 가용한지 확인할 것.
> - **현 상태(2026-08-06, T014로 갱신)**: 폰트 결함 해소 → 벤치가 실제로 렌더에 들어갔고, **다음 벽은 처리량**이었다. Hobby 1vCPU에서 캡처가 **~4.2fps**로, 워스트케이스 1,845프레임이 270s 예산 안 1,130프레임에서 정직하게 abort(완주 불가, Issue #3 코멘트에 원본). 하드웨어 격차 3배는 캡처 최적화로 못 메꾼다는 판단으로 **사용자가 Vercel Pro + Performance 머신(4GB/2vCPU)을 결정**(대시보드 설정은 사용자 액션, 새 배포부터 적용 — DECISIONS 2026-08-06 항목). T014가 코드 쪽을 맞췄다: 렌더 두 라우트 `maxDuration: 300 → 800`(vercel.json 포함, ingest-run은 300 불변), 벤치 예산 770s·워커 하드 예산 760s, 예산-천장-리스 관계는 `timeBudget.ts` + `tests-render/timeBudget.render.test.ts`가 상수 관계로 보증.
> - **메모리 계측 보강(T014)**: Vercel에는 cgroup 3경로가 **전부 ENOENT**(v2 peak·v2 current·v1 max_usage — memoryProbes 실측)라 `self-maxrss`(Node 단독, Chromium·ffmpeg 미포함)만 남아 T002 판정이 불가능했다. 체인에 `/proc` 폴백을 추가(`proc-rss-sampled`: self + 전 자손의 VmRSS 합, 750ms 폴링 최대값)해 자식 프로세스를 실제로 센다. **합산은 공유 페이지를 프로세스마다 세므로 상한(upper bound)**이며 sampled — 판정 시 그 성격을 지킬 것.
> - **T002 판정 완료 (2026-08-06, 상세는 DECISIONS 당일 항목·Issue #3)**: Pro/Performance(2vCPU/4GB) 전환·배포(T014, PR #22) 후 재벤치 4회(cold 1·warm 1·동시 2) **전부 1,845프레임 완주**. renderMs 최악 386s(예산 770s의 절반), 자식 포함 peak 1.52GB vs 기준 3.44GB(44%, `proc-rss-sampled` 첫 실측), outputBytes 4회 동일(결정론 프로덕션 성립). **renderMs 기준 p95 ≤ 480s로 재협상(사용자 승인)** · **cap=1 유지**(동시 2회 인스턴스 상이였으나 공유 미배제 + 재사용 런 peak 상승 관찰). 렌더 파이프라인은 이제 프로덕션에서 실증된 상태 — 남은 것은 0054 hosted 적용(T008)과 실렌더 E2E(T009).
>
> **오케스트레이션 상태 (다음 세션 재개용):** fcp Goal `render-launch-path` = GitHub Issue #1, 태스크 #2~#11+#14. 완료: T001(#2, PR #16)·T003(#4)·T006(#7, PR #12)·T007(#8, PR #13)·T011(#14, PR #15). 진행: T012(#17, 벤치 진단 계측). 대기: T002(#3, 위 블로커)·T008~T010. T004(#5) 결정 완료(2026-08-05): 자막 채택, 단 기성 자막 스타일 금지 — Hype Mixtape 감성의 스타일드 자막 크롬(구현 T005, 시안 승인 게이트; DECISIONS 기록 예정). 로컬 원장: `.claude/fable-control-plane/goals/render-launch-path/`(이 머신 전용, git 미추적 — state.json이 최신 체크포인트). 실행 승인 envelope은 태스크 단위로 사용자에게 재확인.

|             |                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코드        | `26ebd6e` on `main` (렌더 워커 기동 슬라이스)                                                                                                         |
| hosted DB   | **0053까지 적용**. `0054`는 **로컬 전용 — 의도적 보류**(§3 참조). 시드 교정: `media_render_concurrency_cap` 2→**1**                                   |
| 런치 게이트 | `public_beta_enabled=off` · `real_payments_enabled=off` · `identity_enforcement=off` · `media_validation_enforcement=off` — **전부 사용자 결정 대기** |
| 해커톤      | **Final Official Rules 공개·전면 대조 완료**([`HACKATHON_RULES.md`](HACKATHON_RULES.md) 2026-08-04). 한국 참가 확정, 웹 선공개 무해 확정              |
| 전 게이트   | green (아래 수치, Advisor 재실행)                                                                                                                     |

```
DB 01~29 exit 0 (canonical runner: bash scripts/test-db.sh)
contracts 293 · data 135 · mobile 231
web  audit3 182 · ui 17 · render 38(+gated 43, 벤치 e2e 포함) · e2e 75
build ✓ · typecheck 0 errors · lint/format clean
```

**green test ≠ 완료 증거입니다.** 이 리포에서 전 게이트 green인 채로 프로덕션이 깨져 있던 사고가 세 번 났습니다(`CLAUDE.md` §14).

### 최근 슬라이스

**`26ebd6e` — 큐를 집어갈 손 (렌더 워커 기동, hosted 무관 — 코드만)**
0054의 큐는 완성돼 있었지만 아무것도 워커를 부르지 않았습니다. kit 카드가 내보내기 요청·폴 틱마다 세션 게이트 릴레이(`/api/media/render-kick`)를 기회주의적으로 kick하고(ingest 패턴, cron 없음 유지), 워커는 잡이 남아 있으면 pass 종료 시 **self-kick**합니다(claim 창 90초 < 렌더 1건 ~150초 — 이것 없으면 두 번째 잡이 영원히 방치). `vercel.json`에 render-run·render-bench 등록(300s/2048MB). **DB·스토리지 0의 시크릿 게이트 벤치**(`/api/media/render-bench`)가 워스트케이스(60초/1,845프레임)를 실엔진으로 돌려 리눅스 실측을 0054 이전에 가능하게 합니다. 동시 상한 시드 2→**1**(Fluid 인스턴스 공유 시 1.2GB×2가 2048MB에서 공존 불가 — 실측 후 app_config UPDATE로 상향). 트리거의 5초 abort는 "Vercel이 클라이언트 절단 후에도 invocation을 지속한다"는 가정에 의존합니다(§5).

**`5cef761` — 퍼널 종착지와 채널 귀속 (0053, hosted 적용됨)**
릴스가 트래픽을 데려와도 받을 곳이 없었습니다(베타 게이트가 관심 표현을 거부). 관심을 **단계화**했습니다: S1(의사를 비공개 저장, Dater 도달 0건) → S2(프로필 검증 통과 시 `submit_interest`로 승격) → S3(기존 Dater 승인). S1은 `interests`의 상태 컬럼이 아니라 **별도 테이블 `interest_intents`** 입니다 — 기존 소비자 전부가 "행 = 전달된 관심"을 가정하므로 읽기 하나만 놓쳐도 미검증 관심이 Dater 표면에 뜹니다. 귀속은 `sessionStorage` → `localStorage` `{slug, ch, ts}` + 30일 만료로 옮기고 **모든 로그인 복귀 표면**(root layout)에서 클레임합니다.

**`bc1c492` — 승인된 피치가 MP4가 된다 (0054, hosted 미적용)**
`media-worker/render/index.ts`가 9줄 주석이라 **올릴 파일 자체가 없었습니다**. 브라우저를 합성기로 씁니다 — 웹과 동일한 scene JSON을 동일 컴포넌트로 헤드리스 페이지에 그려 프레임을 캡처하고 ffmpeg로 인코딩합니다(ffmpeg는 인코더이지 합성기가 아닙니다). 해석기는 이미 `(scene, t)` 순수 함수였고 애니메이션 루프가 재생 여부로 게이트돼 있어 **리팩터링이 불필요했습니다**.

---

## 2. 사용자 결정 대기 (Advisor가 임의로 정하지 않음)

1. **`FRIENDWORD_MEDIA_RENDER_SECRET` / `FRIENDWORD_MEDIA_INGEST_SECRET`** — 둘 다 Vercel 미설정이라 해당 라우트가 501을 반환합니다. **키 값은 사용자가 직접 입력하며 Claude는 수신하지 않습니다.** 렌더 시크릿이 설정돼야 §3의 벤치·기동이 시작됩니다.
2. **리눅스 실측 판정** — 벤치 도구는 배포돼 있습니다(§3-2에 실행 절차). 1.2GB는 **macOS RSS 합산 프록시**이고 여유가 7%뿐입니다. 기준 초과 시 실행처(Vercel Fluid, U6) 재협상이 필요하고 그건 사용자 결정입니다. 동시 벤치 2회의 `instanceId`가 같으면 Fluid 인스턴스 공유가 실증된 것이므로 **cap=1을 유지해야 합니다**(상향은 app_config UPDATE).
3. **도메인 / `FRIENDWORD_SHARE_ORIGIN` — 0054 push 전에 결정해야 합니다.** `resolveShareOrigin`은 vercel.app을 거부하지 않으므로(2026-08-04 Deputy 확인 — 'not configured' 501은 실질 데드 코드), 도메인 미확정 상태의 **첫 실렌더는 vercel.app URL을 다운로드 MP4에 영구히 굽습니다**(같은 revision은 재렌더되지 않음). 선택지: `friendword.com` 취득 + `FRIENDWORD_SHARE_ORIGIN` 설정, 또는 QA 전용 파일(배포 안 함)에 한해 vercel.app 엔드카드를 명시적으로 수용.
4. **`public_beta_enabled`** — S2 파이프라인이 완성돼 있어 켜는 즉시 전달이 활성화됩니다. **릴스 배포는 이 스위치 이후**(`CLAUDE.md` §16). 해커톤 규칙상 Grand Prize shortlist가 **RevenueCat 계측 제출-기간-내(~9/30) 매출**로 결정되므로 `real_payments_enabled` 시점도 같은 축에서 판단이 필요합니다(`HACKATHON_RULES.md`).
5. **릴스 음소거 문제(미해결, 열린 제품 질문)** — MP4에 플레이어의 **자막 트랙이 빠져** 있습니다. 장면 자체의 텍스트(wordPop, 헤드라인)는 들어갑니다. 승인 대상이 scene JSON이라는 원칙상 맞는 결정이지만, **릴스는 음소거로 소비되고 Introducer의 목소리가 콘텐츠의 핵심**이라 전달이 반쪽입니다. 사용자가 정한 메커니즘의 효과에 직결되므로 Advisor가 단독으로 바꾸지 않았습니다.
6. **Ship Kit participant form** — Devpost 등록 이메일로 온 폼을 작성해야 스폰서 퍽이 풀립니다(해커톤 자격과 무관, 혜택만).

---

## 3. 다음에 할 일 (권장 순서)

이 순서에는 이유가 있습니다. **뒤집지 마십시오.** (§3-1·§3-3의 코드는 `26ebd6e`로 완료 — 남은 것은 사용자 액션과 검증입니다.)

1. **[사용자] Vercel에 `FRIENDWORD_MEDIA_RENDER_SECRET` 설정**(≥16자; `FRIENDWORD_MEDIA_INGEST_SECRET`도 같이 — ingest 워커도 이것 때문에 한 번도 돈 적이 없습니다). 값은 Claude에게 주지 않습니다.
2. **[사용자] 리눅스 실측** — 배포된 프로덕션에 대해(프리뷰 불가 — deployment protection이 캡처 페이지를 막음):
   ```
   # cold(첫 호출) 1회 + warm 1회 + 동시 2회:
   curl -X POST "$ORIGIN/api/media/render-bench" \
     -H "authorization: Bearer $FRIENDWORD_MEDIA_RENDER_SECRET"
   ```
   판독: `renderMs` p95 ≤ 180,000 · `peakMemoryBytes` ≤ 1,717,986,918(2048MB의 80%) · `coldStart:true` 응답의 추가 소요가 콜드스타트 비용 · **동시 2회의 `instanceId`가 같으면 Fluid 인스턴스 공유 실증 → cap=1 유지 필수**. `memorySource`가 `cgroup-v2-peak`인지 확인(자식 프로세스 포함 수치).
3. **[사용자 결정] 도메인 / `FRIENDWORD_SHARE_ORIGIN`** — §2-3. 첫 실렌더 전에 정해야 엔드카드 URL이 MP4에 올바르게 박힙니다.
4. **그 다음에 `0054`를 hosted에 적용**(클린 트리에서 `supabase db push --linked`). 순서를 뒤집으면 내보내기 버튼이 살아나 잡이 쌓이는데 처리할 워커가 없어 **"Rendering your MP4…"가 영원히 떠 있습니다** — 아무 일도 안 일어나는데 진행 중이라고 말하는 화면이며, 이 트랙 내내 없애온 바로 그 패턴(§12)입니다. 지금 kit 화면의 "상태를 불러오지 못했습니다"는 보기엔 나빠도 **정직합니다**.
5. **push 직후 실렌더 1건 end-to-end QA** — 내보내기 요청 → kick 체인(요청 kick → 워커 claim → self-kick) → MP4 다운로드까지. **기회주의 트리거 패턴은 프로덕션에서 실행된 적이 없습니다**(ingest는 시크릿 미설정으로 한 번도 안 돌았음) — 이 QA가 최초 실증입니다.
6. 베타 스위치 → 7. 릴스 배포 (해커톤 시퀀싱은 `HACKATHON_RULES.md` — 9/30 스토어 출시 마감 역산 유지).

### 미착수·보류 (범위 밖으로 명시적으로 남긴 것)

- **Phase 3b**: 클립을 scene에 넣기, 얼굴 블러 토글. v3 스키마는 있으나 **렌더는 v2 전용**이고 v1/v3는 핀된 에러로 거부합니다.
- **Phase 5**: 비용 가드레일 확장, 사람 검토 큐.
- **Instagram Private Replies 연동** — 낯선 시청자를 옮기는 유일한 공식 수단(댓글 → 자동 DM, 팔로우 무관, 7일·1건). **Meta App Review 필요**(`instagram_manage_comments`, `pages_messaging`).
- **Play Install Referrer**: `apps/mobile/android` 디렉터리 자체가 없어 불가.
- MP4 렌더러의 엔드카드는 완성됐으나, **모바일 앱 쪽 내보내기 표면은 없습니다**(웹 kit 화면만).
- 알려진 미해결: `0044` NULL-digest grandfathering, `enforce_message_rate_limit`(0025)의 비직렬화 카운트 경합.

---

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

- **DB**: Supabase hosted `oknolcxsvogrhnxnyosr`, **Free 플랜**(파일당 50MB 상한 — Pro 업그레이드 예정). 마이그레이션 `0001~0053` 배포, `0054` 로컬 보류. `0040`은 의도적 미사용 갭.
- **웹**: Vercel, GitHub `wwdbsh/friendword` **`main` push마다 자동 배포**(Root=`apps/web`).
- **모바일**: EAS `@wwdbsh/friendword` → TestFlight 내부 배포 가동.
- **RevenueCat**: 프로젝트 연동 완료, 상품 `creator_launch_credit_499` · `campaign_pass_30d_1999`(ASC 둘 다 **Consumable**), 웹훅 → `/api/revenuecat`.
- **scheduled-ops cron**: GH Actions 시크릿(`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY`) 등록 여부 미확인 — 미등록이면 매시간 fail-fast 메일(의도된 동작).

---

## 8. 판정

**기능성 내부 베타.** 외부 노출은 런치 게이트가 막고 있으며 그 스위치는 사용자 결정입니다. 릴스 배포는 베타 스위치 이후, 그리고 렌더 워커가 실제로 도는 것을 확인한 이후여야 합니다.
