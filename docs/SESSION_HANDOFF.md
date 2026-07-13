# PROJECT HANDOFF

> 갱신: 2026-07-13 저녁 KST · main `941ef55` 이후 (origin push·CI 3잡 그린)
> 읽는 순서: 이 문서 → `docs/TASKS.md`(작업 원장) → 필요 시 `docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`(1차 감사·해소 완료), `FRIENDWORD_HANDOFF.md`(제품 원본), `docs/DESIGN.md`, `docs/OPS.md`, `docs/REVENUECAT_SETUP.md`, `CLAUDE.md`/`AGENTS.md`(협업 규칙)

## 다음 세션 시작 방식 (사용자 확정, 2026-07-13)

- **대기 후 감사 문서 수령**: 다음 세션의 Claude는 이 문서로 현황만 파악하고 **작업을 시작하지 말고 대기**한다. 사용자가 **추가 감사(2차) 문서**를 제공하면 그것을 읽고 그 문서를 기준으로 작업을 시작한다.
- 이 핸드오프에는 의도적으로 **다음 단계 작업 지시가 없다.** 우선순위·범위는 2차 감사 문서가 정의한다.
- 작업 체제는 아래 "작업 방식" 그대로: **Advisor(Claude, 직접 구현 병행) + `friendword-codex-1` 2인**. codex-2/3는 대기 상태이며 추가 지시 없이는 사용하지 않는다.

## 이번 세션에서 한 것 (2026-07-13, 커밋 32개)

1차 전수 감사(`docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`)를 source of truth로 채택하고, §7의 실행 순서 A→J를 그대로 완주해 **출시 차단 P0 9건과 D-P0(대비)를 전부 해소**했다.

| 감사 항목                | 해소 내용                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 웹 사용자 bootstrap | `auth.users` 트리거+백필(0011), `display_name_confirmed` 온보딩(웹 이름 승인 UI), E2E의 수동 upsert 제거                                                                                                                                                                                                                           |
| P0-2 claim 바인딩        | invite contact의 canonicalized SHA-256 해시 저장, 이메일 claim 바인딩, phone 채널 fail-closed(0012), "verified" 카피·이벤트 전면 제거, `identity_enforcement` 스위치                                                                                                                                                               |
| P0-3 동의 불변성         | 불변 `consent_revisions` 스냅샷+content hash(0013), consent_pending 중 introducer copy/media 동결(RLS+storage), 변경요청/거절 RPC, 5인자 원자 approve(revision+포함 사진+hard claims 결속), 모바일 "AI 초안 검토·편집 후 발송" 플로우(501 시 정직한 직접 작성 폴백)                                                                |
| P0-4 결제                | 서버 발급 purchase intent(0014·0022), 단일 트랜잭션 웹훅 RPC(이중 멱등성·refund 회수·restore 재발급 방지·TRANSFER 검토 플래그), 웹훅 라우트는 얇은 어댑터로 재작성, 모바일 페이월 intent 강제+구매 후 서버 benefit 확정까지 pending UI(0021로 소유자 읽기), 무료 14일 고정·Pass 구매 시 30일 연장                                  |
| P0-4 효익                | Campaign Pass = Pass-게이트 캠페인 퍼널 분석(`get_campaign_analytics`)+인박스 Pass 섹션; Creator Launch = `/kit/[draftId]` 킷(크레딧 1회 소비 unlock → 9:16 share card 렌더+캡션팩), 발행된 share 화면에서 킷/페이월 진입(0020·0022)                                                                                               |
| P0-5 safety              | 4개 표면 `report_content` RPC+공개 피치 무가입 신고(IP 해시 rate limit, 0016·0019), high-severity 2건 자동 pause+ops alert, 계정 삭제 큐+`process-deletions.mjs`(lease fencing·소유권 이관·신고 익명화), `media_validations` 원장+`/api/media/validate`(매직바이트·크기·구조·moderation)+웹·모바일 업로드 배선, erasure 경로(0018) |
| P0-6 growth              | 캠페인별 OG 이미지(`/api/og`, pause/archive 즉시 404), Trust Layer 톤의 루트 랜딩, CTA 2개 실동선 분리, `export-growth-evidence.mjs` 실구현(익명 집계)                                                                                                                                                                             |
| P0-7 CI                  | CI에 format·web production build·웹훅 감사·DB 감사 러너·Playwright(모의 네트워크 dev 서버) 편입 — 3잡 그린                                                                                                                                                                                                                         |
| P0-8 interest 증거       | 사진의 실제 storage object·본인 prefix·MIME 서버 검증(0012)                                                                                                                                                                                                                                                                        |
| P0-9 fixture             | 발행 시 포함 사진 ≥1 강제(0017)+실캠페인 인물 fallback 제거                                                                                                                                                                                                                                                                        |
| D-P0 대비                | onPop→ink, danger `#C63838`+onDanger, textFaint 용도 제한, ui-tokens에 WCAG 대비 자동 테스트(CI), 전 웹 reduced-motion 글로벌 규칙                                                                                                                                                                                                 |
| Trust Layer(모바일)      | TrustCard/QuietNavAction/SafetyAction 분리, 홈 40%·페이월 0~10% 강도 적용                                                                                                                                                                                                                                                          |

**증거 수치(사실 그대로)**: DB 감사 회귀 **7/7 PASS** · 웹훅 회귀 **11/11 PASS** · DB 스위트 01~17 그린 · 유닛 105 · Playwright 34 · 프로덕션 E2E(hosted) 전 체크 PASS · GitHub CI 3잡 success. 마이그레이션 **0001~0022** hosted 배포 완료.

**미해소로 명시된 것(작업 지시 아님 — 상태 기록)**

- 사용자 키 게이트: identity 벤더(→`identity_enforcement` on), OPENAI_API_KEY(→moderation·`media_validation_enforcement` on), RevenueCat 셋업+dev build(→sandbox 구매 실검증), Resend 도메인, `EXPO_PUBLIC_WEB_ORIGIN`
- 사용자 결정 보류: 18+ 온보딩·법적 문서 표면·App Store 메타데이터(스토어 준비와 일괄, 7월 중하순 재판단)
- 코드성 잔여: 모바일 손 QA 일괄(D~I 변경분 — 워커 시뮬레이터 QA는 완료, Advisor 손 QA는 미실시), MP4 모션 export(킷 v2), seed-demo 스크립트(placeholder 유지), 자막 타임스탬프/실파형

## 작업 방식 (이번 세션에서 확립 — 다음 세션도 동일)

- **체제**: Advisor(Claude)가 분해·설계 결정·검증·커밋·원격 배포·문서를 소유하고 **구현도 절반을 직접** 한다. 나머지 절반은 `friendword-codex-1`(tmux)에 brief 단위로 위임한다. 작업 비중은 Advisor:codex-1 = 동등(사용자 지시).
- **brief 패턴**: `.briefs/NN-이름.md`(gitignore됨)에 TASK / WHY·컨텍스트(정확한 파일 경로·라인) / SCOPE·OUT OF SCOPE / 설계 지시(Advisor 결정은 "변경 금지" 명시) / KNOWN TRAPS / 관찰 가능한 ACCEPTANCE / 감사 §7 반환 형식. 워커에는 `tmux send-keys`로 brief 경로+상황 업데이트를 전달한다(텍스트 후 Enter는 별도 send, 1초 지연).
- **검증 규칙(CLAUDE.md 4·5)**: 워커 보고를 믿지 않고 diff 정독+동일 게이트 재실행+표면 QA 후에만 커밋. 워커의 SCOPE 확장 요청은 "단언 약화 금지" 조건부로 승인한 사례 다수. 워커가 발견한 계약 결함(예: published draft의 creator intent 거부)은 Advisor가 후속 마이그레이션으로 즉시 수정.
- **회귀 스위트 운용**: 감사 acceptance를 **수정 완료 후 기대 동작**으로 먼저 인코딩(초기 FAIL 정상) → 슬라이스가 그린으로 전환 → 전부 그린이 된 뒤 CI 편입. `supabase/tests/audit/`+`scripts/test-db-audit.sh`, `apps/web/tests-audit/`+`pnpm test:audit`.
- **스위치 패턴**: 벤더 없는 강제는 `app_config`(service_role 전용) 스위치로 단계화하고, 테스트는 스위치를 켜서 강제 동작을 검증한다. mock으로 완료 처리 금지 원칙 유지.
- **워커 모니터링**: `tmux capture-pane` 폴링 백그라운드 스크립트(화면 하단 "Worked for" 마커가 ~48초 안정 시 유휴 판정). 상태줄이 잘리므로 "esc to interrupt" 부재만으로 판정하지 말 것.
- **DB push 규칙**: `supabase db push`는 `git status supabase/migrations/`가 깨끗할 때만(미커밋 WIP가 딸려 배포된 사고 1회 — 0015 재조정 마이그레이션으로 수렴시킴).
- **codex 토큰**: `~/.codex/config.toml`의 OmO 플러그인(`omo@sisyphuslabs`)이 도구 호출마다 훅 3종을 실행해 토큰을 과소모했음 → 사용자 승인 하에 비활성화. 이후 워커 속도 4배 개선. 새 codex 세션을 띄우면 훅이 없는지 확인할 것.
- **환경**: tmux `friendword-web`(:3000 dev — apps/web 디렉토리에서 `pnpm dev`), `friendword-mobile`(expo), `friendword-codex-1/2/3`(codex CLI, 2·3는 대기). dev 서버는 **하나만**: 여러 dev 서버가 같은 `.next`를 공유하면 CSS 청크가 오염된다(발생 시 단일 서버로 `rm -rf .next` 후 재시작).

## CURRENT STATE

- **제품**: Shipaton 2026 참가작 friend-led dating campaign 앱. 8/1~9/30 App Store 최초 출시 필수, RevenueCat IAP 필수.
- **상태 판정**: 1차 감사의 출시 차단 P0는 코드 레벨에서 전부 해소. 실사용자 수용은 여전히 사용자 키 게이트(identity 벤더·Resend 도메인 등) 뒤에 있다. "1.0 complete" 표현은 감사 §8 체크리스트 전부(특히 sandbox 결제·enforcement on) 충족 전 금지.
- **백엔드**: hosted Supabase(ref `oknolcxsvogrhnxnyosr`), 마이그레이션 0001~0022. 상태 전이는 전부 SECURITY DEFINER RPC. 주요 신규 RPC: `claim_consent_request`(contact 바인딩), `submit_pitch_for_consent`(finalize+revision), `respond_consent_request`, `approve_and_publish_pitch`(5인자), `issue_purchase_intent`, `record_revenuecat_event`, `report_content`, `request_account_deletion`, `erase_pitch_draft`, `get_campaign_pass_state`/`get_campaign_analytics`, `unlock_share_kit`, credit reserve/release/consume.
- **웹**: `/`(랜딩), `/p/[slug]`(+`/api/og`), `/p/[slug]/interest`, `/consent/[token]`(revision 검토·사진 선택·hard claims·변경요청/거절), `/inbox`(관리+Pass 퍼널+신고+계정 삭제), `/rooms/**`, `/kit/[draftId]`, API `/api/transcribe`·`/api/revenuecat`·`/api/media/validate`·`/api/report`·`/api/kit-image`.
- **모바일**: 피치 플로우(이메일 invite 전달·공유 후 연락처 purge), AI 초안 검토·편집 화면, 페이월(intent 강제·pending 확정), Trust Layer primitive, 업로드 서버 검증 호출. 유닛 테스트 28개가 `pnpm test`에 편입됨.
- **검증 명령**: README "Local development" 블록이 최신이다. 전부 그린 상태로 인계.
- **실행 환경 참고**: `.env`는 루트(웹·모바일은 심링크). `pnpm check:env`는 `EXPO_PUBLIC_WEB_ORIGIN` 미설정으로 실패(사용자 게이트).

## IMPORTANT DECISIONS (이번 세션 추가분 — 상세는 docs/DECISIONS.md)

- 1차 감사 채택·A→J 순서 고정 / 회귀 스위트는 기대 동작 인코딩(초기 FAIL 정상, Slice J에서 CI 편입 완료)
- 웹 bootstrap 표준은 DB 트리거 / 무료 공개 기간 14일 고정·90일 폐지(Pass 구매가 30일 연장)
- 워커 운용 2인 체제(토큰 과소모) + OmO 플러그인 비활성화
- Trust Layer 3레이어·표면별 강도 표(docs/DESIGN.md), saturated fill 위 텍스트는 ink
- raw invite contact는 DB에 저장하지 않음(해시만) / consent revision은 UPDATE 불가·삭제는 erasure 플래그 경로만

## ISSUES / RISKS

- identity/media enforcement가 off인 동안 "signed in" 수준의 보증만 존재 — 카피는 이미 정직화됨. 스위치 on 전 실사용자 수용 금지.
- RevenueCat sandbox 실경로(구매·restore·webhook 왕복)는 대시보드 셋업+dev build 전까지 미검증. 코드 경로는 회귀 스위트가 고정.
- App Review 리스크(데이팅 4.3b+UGC): 8/1~9/30 창구 — 스토어 준비 착수 시점은 7월 중하순 재판단(사용자 결정).
- `database.types.ts`는 수동 부분 타입 — 테이블·RPC 추가 시 갱신 필수.
- OG 캐시 최대 1시간: pause 직후 소셜 미리보기 잔존 가능(주석으로 명시된 수용 리스크).
- plpgsql 함정: `#variable_conflict use_column`, RPC 시그니처 변경은 DROP 후 CREATE, 0001 publish 트리거(consent approved 선행).

## LOG SUMMARY

2026-07-12~13: 빈 repo → 코어 루프 골격(커밋 9) → **1차 전수 감사 수령 → 감사 대응 세션(커밋 32)으로 P0 전부 해소**. 워커 3기→2인 체제 전환, OmO 훅 비활성화, WIP push 사고 1회 재조정. 최종: audit DB 7/7·웹훅 11/11·CI 3잡 그린·프로덕션 E2E 전 체크 PASS. 다음 세션은 사용자가 제공할 **2차 감사 문서 대기**로 시작한다.
