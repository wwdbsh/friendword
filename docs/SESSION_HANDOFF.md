# PROJECT HANDOFF

> 갱신: 2026-07-14 KST. acceptance source of truth는 [`docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`](FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md)(3차 감사). 1·2차 감사 문서는 역사적 기준. 상세 결정 이력은 [`docs/DECISIONS.md`](DECISIONS.md), 작업 소유권은 [`docs/TASKS.md`](TASKS.md).

## CURRENT STATE

- 판정: **기능성 내부 베타**. 3차 감사의 코드 게이트(P0-NEW-1~~4, GP-P0-1·2 코드분, H-1~~H-9)는 Slice 0~~5로, GP-P0-3·CP-1·CP-2·CP-5·CP-6·CP-8 코드분은 Slice 6(`90e9516`)으로 해소. 외부 공개·실결제·Grand Prize 제출은 여전히 아님(잔여: Slice 7~~8 + 사용자 키 게이트 + **데모 실음성 녹음**). green test는 완료 증거가 아니며 acceptance는 감사 문서 기준.
- 게이트: `real_payments_enabled=off`(결제 차단), `public_beta_enabled=off`(interest 제출+publish 전이+공개 read/OG 전부 차단, 0034). 내부 QA 예외는 service-role 전용 `qa_preview_allowlist`(pitch_draft 단위)뿐 — 프로덕션 E2E도 gate 전역 토글 대신 이걸 쓴다.
- 파이프라인: pnpm 모노레포(`apps/mobile`·`apps/web`·`packages/*`·`supabase`). migrations **0001~0041 hosted 배포**(ref oknolcxsvogrhnxnyosr, **0040은 의도적 미사용 갭** — ON CONFLICT 게이트 우회가 실증으로 기각됨, c11 참조). 모든 상태 전이는 SECURITY DEFINER RPC+트리거, authenticated RPC는 전수 active-account 가드(0037). publish는 Dater 확정 birth date 18+ fail-closed(0041).
- 비용·동의: provider reserve/reconcile은 service-role 전용+request_ref lease+보수적 실패 회계(0035). AI 동의는 4개 usage kind 전부에 `ai_disclosure_current_revision` binding으로 선행(무동의 시 구조 검사만, 외부 AI 0회). 채팅은 reactive-only moderation 정책(문서화됨).
- 커머스: intent (user,product,scope) 유일성, Campaign Pass `GREATEST(now,ends_at)+30d`(expired 유료 부활, beta gate 중엔 review 보류), restore는 intent 무발급, TRANSFER는 `resolve_purchase_event_review` 운영 도구(0038).
- 성장: owner당 활성 캠페인 1개 guard, `referral_claims` first-touch chain(publish 시 서버 연결), anon `join_waitlist`, Introducer 무료 공유(`list_my_introduced_campaigns`), exporter는 K-factor 없이 server-recorded·net-paid·메타데이터 출력(0039).
- 회귀: 스위트 01~~18 · audit 7/7 · audit2 14/14 · **audit3 c01~~c11(11/11) + 웹 49 테스트** · unit 203+web · Playwright 41/41 · 프로덕션 E2E 전 체크 PASS 2연속(7w~~7z 신규 게이트 검증 포함, 마지막 커밋 `90e9516`).
- 작업 체제: Advisor(오케스트레이터) + Claude Opus 워커 2~3명(슬라이스당 생성, 승인 후 종료). Codex 미사용.

## DONE

- **3차 감사 Slice 0~5 완주** (모두 2026-07-14, red-first + Advisor 재검증 + hosted 드릴 + 프로덕션 E2E):
  - Slice 0 `f4b4b06`: public beta gate authoritative(publish·read·OG), qa_preview_allowlist, audit3 신설.
  - Slice 1 `165efb7`: 비용 원장 service-only+lease, AI 동의 선행·revision binding·own_content scope, manual 무 AI.
  - Slice 2 `d0e084e`(+`fcf6694`): Dater 사진 403 해소, revision/publish validation·moderation 게이트, dater_edited 확인, transcript snapshot copy, manual 제출 차단 정직 카피.
  - Slice 3 `0a79451`(+`357c4e9`): RPC 계정 가드 전수, introducer 삭제 시 voice 물리 삭제+무성 캠페인 archived, review payload 90일 scrub, token/로컬 미디어 purge, storage 실삭제, scheduled-ops GH cron.
  - Slice 4 `971e43c`: intent 유일성, Pass 적층·부활 상태기계, restore 무 intent, alias 귀속, resolve 도구, refund/kit 계약.
  - Slice 5 `358a2ae`: 활성 1캠페인 guard, referral chain, waitlist, Introducer 무료 공유, exporter 진실화.
- 문서 truth reset 동반: README·PRODUCT·COST_MODEL·ANALYTICS_PLAN·PRIVACY_DATA_MAP·OPS·REVENUECAT_SETUP·GROWTH_EVIDENCE·COMMUNITY_GUIDELINES·DECISIONS(9건 추가)·TASKS.
- **Slice 6 `90e9516`** (2026-07-14, 워커 s6-demo·s6-dater·s6-truth + Advisor 재검증·hosted 0041 배포·프로덕션 E2E 2연속 PASS):
  - 데모: age/vouch 미구현 정보 제거, structure 기반 scene(실 segment 타이밍), segment-level caption 정직화, waveform 실패 접근성 상태, 실음성 seed 파이프라인(파일은 사용자 게이트, TTS 금지).
  - judge-safe: allowlist 한정 interest→inbox→accept→room을 c09로 잠금, ON CONFLICT 재제출 우회는 실증 기각(0040 미사용, c11 잠금).
  - Dater 통제(0041): consent 실 출력 스냅샷 프리뷰, birth date 18+ publish fail-closed, canonical location(legacy region은 null fail-closed), dating intent, dater revision voice 자동 포함(Advisor 파생 하드닝).
  - recap 이원화: AI path는 transcript 파생(요구 제거), manual path만 필수.
  - 커머스 truth: canonical 계약 단일화(HANDOFF historical 분리), kit·OG 가짜 waveform 제거, kit 승인 콘텐츠 경계 c10.
  - DECISIONS 3건 추가, audit3 c08~c11 신설.

## IN PROGRESS

- Slice 7 착수(워커 s7-web·s7-mobile): trust flow 시각 강도 하향·consent 단계화·접근성·소화면 QA.

## TODO

1. (P0) Slice 7 잔여 — §8 acceptance 전체 + §11 browser/device 회귀 + 실기기 iOS QA(사용자 게이트).
2. (P0) 데모 실음성: 상헌 님의 권리 확보 30~60초 영어 녹음 도착 시 `scripts/seed-demo-pitch.mjs`(manifest+`rightsCleared:true`) 1회 실행→hosted seed→육안 QA. TTS 금지(DECISIONS 07-13).
3. (P0) Slice 8 — 외부 release proof: identity 벤더 sandbox, moderation enforcement on 실증, RevenueCat sandbox 실왕복, gate-on smoke/gate-off rollback 드릴(감사 §10 Slice 8) — 대부분 사용자 키 선행 필요.
4. (P1) 사용자 키 게이트 안내: RevenueCat 셋업, identity 벤더 계약, OPENAI 키, Resend/`EXPO_PUBLIC_WEB_ORIGIN`, **GH Actions 시크릿(SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY) 등록 시 scheduled-ops cron 활성화**.
5. (P1) 새 DB 변경마다 direct RPC 우회·RLS·concurrency·retry·실 UI 소비자 회귀 테스트 유지(감사 §0-5), 수정과 같은 turn 문서 truth reset(§0-6).
6. (P2) waitlist 초대 발송·보존 정책 확정(Resend 이후), 채팅 moderation 정책 외부 베타 전 재평가.

## IMPORTANT DECISIONS

- **public_beta_enabled=off = 외부 공개 차단**(publish 전이+공개 read+interest). QA는 gate 토글이 아니라 `qa_preview_allowlist`로만.
- **비용 원장**: reserve/reconcile service-role 전용, 라우트가 user/kind/scope/estimate 결정(1~50¢), lease로 attempt당 provider 1회, 실패는 estimate 이상 보수 유지. **record_revenuecat_event는 payload 단일 시그니처**(alias는 서버가 payload에서 파생 — 신규 RPC의 라우트-DB 시그니처는 mock-free 검증 필수).
- **AI 동의**: 모든 usage kind, 서버 관리 revision binding, scope는 draft(`pitch_draft`, creator+subject)와 사용자(`own_content`). 무동의 업로드는 Supabase까지만(구조 검사, 외부 AI 0회). **enforcement on 동안 manual(no-AI) 제출은 의도적 차단**(정직 카피+AI 전환 제안).
- **Dater 통제**: revision·publish에 사진 validation+content-addressed 텍스트 verdict(hash는 raw `headline\n\nbody`, 0026/라우트와 동일), dater edit 시 hard-claims 확인 강제(AI 재추출 없음), approve가 transcript를 draft로 무조건 copy.
- **삭제 정책**: introducer 삭제 시 voice(행+물리 바이트) 삭제, 무성 캠페인 archived. review payload는 resolved 90일 후 PII scrub. 채팅은 reactive-only(사적 대화 상시 외부 전송 안 함).
- **커머스**: 만료 재개는 유료 Pass만("30일"=`GREATEST(now,ends_at)+30d`), 무료 resume 불가 유지. restore는 intent 무발급. refund는 consumed kit 미회수. beta gate 중 부활은 entitlement 기록+review 보류(돈 유실 금지).
- **성장**: 활성(published/paused) 캠페인 owner당 1개(Pass는 기간 상품). referral은 first-touch `claim_referral`+publish 시 서버 연결. acquisition은 waitlist(K-factor 주장 금지, exporter에서 명칭 제거).

## ISSUES / RISKS

- identity/moderation enforcement는 벤더·키 전까지 off — 실사용자 노출 전 필수. cap의 enforcement-on 실증, RevenueCat sandbox 실왕복, 실기기 iOS QA 미실시(사용자 게이트).
- 감사 §13 금지 표현("Grand Prize ready", "launch ready", "identity verified", "K-factor" 등)은 acceptance 증거 전까지 계속 금지.
- hosted에 실사용자 계정 1개(`wwdbsh@gmail.com`, 사용자 본인 추정) 존재 — 삭제·조작 금지.
- 프로덕션 E2E에서 일시 실패 1회 관측(원인 미확보, 이후 연속 2회 전 체크 PASS) — 재발 시 로그 전체 캡처로 조사.
- 운영 함정: DB push는 클린 트리에서만 · dev 서버(:3000 tmux) 실행 중 `web build` 금지(.next 오염→Playwright 대량 실패) · 통합 Playwright는 워커 편집이 멈춘 조용한 창에서 · RPC 재정의는 최신본(0035~0039 포함) 통째 복사 · plpgsql `NOT IN`+NULL · dater revision `included_asset_ids`는 voice 포함 전체 집합 · 신규 트리거는 owner당 활성 1캠페인 invariant와 픽스처 충돌 주의.
- 웹 수동 QA 인증: 스크립트로 사용자 생성 후 localStorage `friendword-web-auth`에 setSession.

## LOG SUMMARY

- 2026-07-13: 1·2차 감사 대응 완주(migrations ~0033, audit2 14/14 CI 편입), launch gate off 유지 판정. `e9de0de`→`0f9311f`.
- 2026-07-14: 3차 감사 수령 → **Slice 0~5 완주**(0034~~0039 hosted 배포, audit3 c01~~c07+웹 41 CI 편입, hosted 드릴 4회 클린, 프로덕션 E2E PASS). Advisor(Fable 5)+Opus 워커 체제로 진행, 워커 계약 불일치 2건(웹훅 시그니처, H-7 픽스처)을 통합 검증에서 잡아 correction으로 해결. `f4b4b06`→`358a2ae`.
