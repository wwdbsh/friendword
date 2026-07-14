# PROJECT HANDOFF

> 갱신: 2026-07-14 KST. 다음 세션의 acceptance source of truth는 [`docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`](FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md)(3차 감사, 기준 `0f9311f`)다. 2차 감사 문서는 역사적 기준으로만 유지한다.

## CURRENT STATE

- 판정(3차 감사): **기능성 내부 베타** — 외부 공개·실결제·Grand Prize 제출 준비 아님. green test는 완료 증거가 아니다(감사 §0-1).
- 게이트 실상: `real_payments_enabled=off`는 결제를 막지만, **`public_beta_enabled=off`는 관심 제출만 막고 publish·public read는 허용한다**(감사 §0-2 교정 — "외부 공개 차단"으로 오인 금지).
- 파이프라인: pnpm 모노레포(`apps/mobile`·`apps/web`·`packages/*`·`supabase`), migrations **0001~0033 hosted 배포**, 모든 전이는 SECURITY DEFINER RPC+트리거. audit2 14/14 그린·CI 편입, CI 그린(마지막 커밋 `0f9311f`).
- 분석: outcome 이벤트는 0033 트리거가 기록(`recorded_by:"server"`), client는 검증된 interaction 9종만. 만료는 `expire_due_campaigns()`+`run-scheduled-ops.mjs`.
- 작업 체제(변경됨): **Advisor(오케스트레이터) + Claude Opus 워커 2~3명(Agent로 생성). Codex는 더 이상 사용하지 않는다.**

## DONE

- 2차 감사 Slice 7~10 완주: Slice 7 Dater 통제+snapshot 발행+b13(`dddaf2d`) · Slice 8 정직한 데모+영어 기본 locale+Creator kit e2e(`9b29cbd`) · Slice 9 서버 권위 분석+만료 상태기계+CP-7 모바일 컨텍스트+접근성(`ad3a38b`) · Slice 10 release gate+audit2 CI 편입+hosted 드릴(`52d3bf2`).
- README·PRODUCT·DATA_MODEL·PRIVACY_DATA_MAP·THREAT_MODEL·ARCHITECTURE truth reset(`0f9311f`).
- 검증: DB 스위트 01~18·audit 7/7·audit2 14/14·Playwright 39/39·프로덕션 E2E 전 체크 PASS·kill switch/만료/삭제/orphan hosted 드릴·CI 3잡 그린.

## IN PROGRESS

- 없음. 3차 감사 대응은 미착수 상태로 인계.

## TODO

1. (P0) 3차 감사 문서 정독 후 **현재 상태·다음 단계 요약을 사용자에게 보고하고 대기** — 지시 전 작업 착수 금지(사용자 확정).
2. (P0) 착수 지시가 오면 Claude Opus 워커 2~3명 생성, `docs/TASKS.md`에 Slice·owned path 기록 후 감사 문서의 실행 순서대로 진행.
3. (P0) 감사 §0이 예고한 코드 결함군 해소: 일반 인증 사용자의 비용 cap 조작, AI 사전 동의 순서 위반, Dater moderation 우회, public gate 무력화.
4. (P0) provider RPC 권한·read RPC account guard·storage DELETE policy·Campaign Pass 상태기계 결함 — 전부 코드·schema 결함이며 사용자 키 게이트로 분류 금지(감사 §0-3).
5. (P1) 수정과 같은 turn에 README·PRODUCT·COST_MODEL·ANALYTICS_PLAN·OPS·REVENUECAT_SETUP·TASKS·DECISIONS·SESSION_HANDOFF truth reset(감사 §0-6).
6. (P1) 새 DB 변경마다 direct RPC 우회·RLS·concurrency·retry·failure accounting·실 UI 소비자 회귀 테스트(감사 §0-5).
7. (P2) 사용자 키 게이트: RevenueCat sandbox 실왕복, identity 벤더, OPENAI 키, 실기기 iOS QA, Resend/`EXPO_PUBLIC_WEB_ORIGIN`.

## IMPORTANT DECISIONS

- **워커 체제 전환(2026-07-14, 사용자 지시): Codex 사용 중단(토큰 고갈). Advisor는 오케스트레이터로 복귀하고 구현은 Claude Opus 워커 2~3명에게 brief로 위임.** 검증 규칙은 동일 — Advisor가 diff·테스트·manual QA 재실행 전까지 승인 아님. 동일 migration·route·핵심 UI를 여러 워커에게 동시 배정 금지.
- 다음 세션 시작 프로토콜: 감사 문서 읽기 → 요약 보고 → **대기**. 자동 착수 금지.
- 시스템 구조(2026-07-13 확정, `docs/DECISIONS.md` 상세): ① outcome 분석은 DB 트리거 기록·client interaction만 허용 ② 만료는 `expired` 상태로 수렴하고 재개 불가 ③ Dater 수정은 immutable revision, publish는 승인 snapshot만 ④ 데모는 가짜 재생 금지 ⑤ 공개 표면 영어 기본.
- launch gate off 유지 판정(2026-07-13)은 유효하나, gate의 실제 커버리지 한계는 3차 감사 기준으로 재평가 필요.

## ISSUES / RISKS

- 3차 감사가 신규 P0를 식별(§0 요약: 비용 cap 조작, 동의 순서 위반, moderation 우회, public gate 무력화 등) — 상세·재현·acceptance는 감사 문서가 정본, 이 요약만 믿지 말 것.
- `public_beta_enabled`가 publish·public read를 막지 않으므로 "외부 공개 차단 중"이라는 과거 기술은 부정확 — 문서·카피에서 재사용 금지.
- identity/moderation enforcement는 벤더·키 전까지 off — 실사용자 노출 전 필수.
- 워커 brief 함정: dater revision `included_asset_ids`는 voice 포함 전체 asset 집합(누락 시 approve가 voice 삭제) · track_event에 outcome 보내면 거부됨 · DB push는 클린 트리에서만 · plpgsql `NOT IN`+NULL, RPC 재정의는 최신본(0027~0033) 통째 복사.
- 웹 수동 QA 인증: 스크립트로 사용자 생성 후 localStorage `friendword-web-auth`에 setSession(magic link 불필요).

## LOG SUMMARY

- 2026-07-13: 2차 감사 Slice 0–10 전체 완주, audit2 14/14 CI 편입, launch gate off 유지 판정, 문서 truth reset. 커밋 `e9de0de` → `0f9311f`.
- 2026-07-14: 3차 감사 수령(`FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md`), 워커 체제를 Claude Opus 2~3명으로 전환, 본 핸드오프 갱신. 3차 대응은 다음 세션에서 시작.
