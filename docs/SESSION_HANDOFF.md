# PROJECT HANDOFF

> 갱신: 2026-07-14 KST. 다음 세션의 acceptance source of truth는 [`docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`](FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md)(3차 감사, 기준 `0f9311f`)다. 2차 감사 문서는 역사적 기준으로만 유지한다.

## CURRENT STATE

- 판정(3차 감사): **기능성 내부 베타** — 외부 공개·실결제·Grand Prize 제출 준비 아님. green test는 완료 증거가 아니다(감사 §0-1).
- 게이트 실상(Slice 0 이후): `real_payments_enabled=off`는 결제를 막고, **`public_beta_enabled=off`는 이제 interest 제출 + campaign publish 전이 + 공개 read(공개 페이지·OG)를 모두 차단한다**(migration 0034 + repo/OG 게이트). 내부 QA 예외는 service-role 전용 `qa_preview_allowlist`(pitch_draft 단위)뿐이며, 프로덕션 E2E도 gate 전역 토글 대신 이 allowlist를 쓴다.
- 파이프라인: pnpm 모노레포(`apps/mobile`·`apps/web`·`packages/*`·`supabase`), migrations **0001~0038 hosted 배포**, 모든 전이는 SECURITY DEFINER RPC+트리거. audit2 14/14 + audit3 c01~c06(+웹 26) 그린·CI 편입.
- 분석: outcome 이벤트는 0033 트리거가 기록(`recorded_by:"server"`), client는 검증된 interaction 9종만. 만료는 `expire_due_campaigns()`+`run-scheduled-ops.mjs`.
- 작업 체제: **Advisor(오케스트레이터) + Claude Opus 워커 2~3명(Agent로 생성). Codex는 더 이상 사용하지 않는다.**

## DONE

- 3차 감사 Slice 4(2026-07-14): P0-3·P0-5·P0-6 해소 — 0038로 intent (user,product,scope) 유일성+advisory lock, Campaign Pass `GREATEST(now,ends_at)+30d` 적층·expired 유료 부활(게이트 off 중엔 entitlement 기록+revival review 보류)·paused 창만 연장, restore는 intent 무발급, alias는 payload에서 서버 파생 귀속, `resolve_purchase_event_review`(reassign/dismiss) 운영 도구, refund는 consumed kit 미회수 계약 고정. 모바일 만료 재구매 진입 UX(85 테스트). sandbox 실왕복은 사용자 게이트 잔존.
- 3차 감사 Slice 3(2026-07-14): H-1·H-2·H-4·H-5·H-6 해소 — 0037로 SECURITY DEFINER RPC 계정 가드 전수(예외는 anon 표면·삭제 요청 게이트, 인벤토리 문서화), introducer 삭제 시 voice 즉시 삭제+무성 캠페인 archived(프라이버시 우선), resolved review payload 90일 PII scrub, profile-media owner-prefix client DELETE policy. 모바일 consent token·로컬 미디어 purge lifecycle(82 테스트). 웹 Remove/rollback 실삭제(RLS 무음 실패 감지). scheduled-ops GH cron 워크플로(시크릿 등록 전 비활성 — 사용자 게이트). PRIVACY_DATA_MAP 확정분 반영.
- 3차 감사 Slice 2(2026-07-14): P0-NEW-3·P0-2 해소 — 0036으로 Dater revision·publish에 사진 validation·텍스트 moderation 게이트(enforcement fail-closed), dater_edited 확인 강제(플래그 무관), 승인 transcript snapshot copy(무조건), reserve/consent의 dater(subject) 인가 확장. 웹은 media/validate Dater 403 해소 + moderate-text `dater_pitch_content` + ConsentFlow 동의·moderation 선행. 모바일 manual 제출 차단 정직 카피. 채팅 moderation reactive-only 정책 문서화(H-3). audit3 c04 + 웹 8테스트, e2e-production에 mock 없는 Dater 단계(6k).
- 3차 감사 Slice 1(2026-07-14): P0-NEW-1·2 해소 — 0035로 reserve/reconcile service-role 전용화(+lease/idempotency/보수적 실패 회계/cap 동시성), AI 동의를 모든 kind로 확장하고 `ai_disclosure_current_revision`에 bind(`own_content` scope 신설). 모바일 draft 생성→동의→업로드 순서 분리, `write_manually` 무 AI(구조 검사만), 웹 interest own_content 동의 UI. audit3 c02·c03 + 웹 audit3 10테스트(red→green 증거, CI 편입).
- 3차 감사 Slice 0(2026-07-14): P0-NEW-4 해소 — `qa_preview_allowlist` + campaigns publish 전이 트리거 + interests 트리거 allowlist 인지(0034), 공개 read 게이트(`isCampaignPubliclyVisible` → `/p`·interest·OG 공통), e2e allowlist 전환. audit3 스위트 신설(c01 red→green 증거 확보, CI 편입). 문서 truth reset(README·PRODUCT·COST_MODEL·ANALYTICS_PLAN·TASKS·DECISIONS·본 문서).

- 2차 감사 Slice 7~10 완주: Slice 7 Dater 통제+snapshot 발행+b13(`dddaf2d`) · Slice 8 정직한 데모+영어 기본 locale+Creator kit e2e(`9b29cbd`) · Slice 9 서버 권위 분석+만료 상태기계+CP-7 모바일 컨텍스트+접근성(`ad3a38b`) · Slice 10 release gate+audit2 CI 편입+hosted 드릴(`52d3bf2`).
- README·PRODUCT·DATA_MODEL·PRIVACY_DATA_MAP·THREAT_MODEL·ARCHITECTURE truth reset(`0f9311f`).
- 검증: DB 스위트 01~18·audit 7/7·audit2 14/14·Playwright 39/39·프로덕션 E2E 전 체크 PASS·kill switch/만료/삭제/orphan hosted 드릴·CI 3잡 그린.

## IN PROGRESS

- 3차 감사 대응 Slice 0~~5 진행 중(사용자 goal 지시, 2026-07-14). Slice 0~~3 완료, Slice 4(Commerce state machine) 착수 예정.

## TODO

1. (P0) Slice 5: Introducer 무료 live share(GP-P0-1), acquisition surface·referral chain(GP-P0-2), exporter metric truth(H-8·9), 무료 활성 1캠페인 guard(H-7).
2. (P1) 각 Slice와 같은 turn에 문서 truth reset(감사 §0-6), 새 DB 변경마다 우회·concurrency·retry 회귀 테스트(감사 §0-5).
3. (P2) 사용자 키 게이트: RevenueCat sandbox 실왕복, identity 벤더, OPENAI 키, 실기기 iOS QA, Resend/`EXPO_PUBLIC_WEB_ORIGIN`.

## IMPORTANT DECISIONS

- **워커 체제 전환(2026-07-14, 사용자 지시): Codex 사용 중단(토큰 고갈). Advisor는 오케스트레이터로 복귀하고 구현은 Claude Opus 워커 2~3명에게 brief로 위임.** 검증 규칙은 동일 — Advisor가 diff·테스트·manual QA 재실행 전까지 승인 아님. 동일 migration·route·핵심 UI를 여러 워커에게 동시 배정 금지.
- 다음 세션 시작 프로토콜: 감사 문서 읽기 → 요약 보고 → **대기**. 자동 착수 금지.
- 시스템 구조(2026-07-13 확정, `docs/DECISIONS.md` 상세): ① outcome 분석은 DB 트리거 기록·client interaction만 허용 ② 만료는 `expired` 상태로 수렴하고 재개 불가 ③ Dater 수정은 immutable revision, publish는 승인 snapshot만 ④ 데모는 가짜 재생 금지 ⑤ 공개 표면 영어 기본.
- launch gate off 유지 판정(2026-07-13)은 유효하나, gate의 실제 커버리지 한계는 3차 감사 기준으로 재평가 필요.

## ISSUES / RISKS

- 3차 감사가 신규 P0를 식별(§0 요약: 비용 cap 조작, 동의 순서 위반, moderation 우회, public gate 무력화 등) — 상세·재현·acceptance는 감사 문서가 정본, 이 요약만 믿지 말 것.
- (해소됨, Slice 0) ~~`public_beta_enabled`가 publish·public read를 막지 않음~~ — 0034 이후 차단됨. 단 0034 이전 커밋·문서의 "외부 공개 차단" 주장은 소급 인용 금지.
- identity/moderation enforcement는 벤더·키 전까지 off — 실사용자 노출 전 필수.
- 워커 brief 함정: dater revision `included_asset_ids`는 voice 포함 전체 asset 집합(누락 시 approve가 voice 삭제) · track_event에 outcome 보내면 거부됨 · DB push는 클린 트리에서만 · plpgsql `NOT IN`+NULL, RPC 재정의는 최신본(0027~0033) 통째 복사.
- 웹 수동 QA 인증: 스크립트로 사용자 생성 후 localStorage `friendword-web-auth`에 setSession(magic link 불필요).

## LOG SUMMARY

- 2026-07-13: 2차 감사 Slice 0–10 전체 완주, audit2 14/14 CI 편입, launch gate off 유지 판정, 문서 truth reset. 커밋 `e9de0de` → `0f9311f`.
- 2026-07-14: 3차 감사 수령(`FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`), 워커 체제를 Claude Opus 2~3명으로 전환, 본 핸드오프 갱신. 3차 대응은 다음 세션에서 시작.
