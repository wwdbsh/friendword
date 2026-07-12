# 작업 소유권 및 상태

## 기록 형식

| Session   | Owned paths             | Dependency                        | Acceptance criteria               | Status                                                       | Updated    |
| --------- | ----------------------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------ | ---------- |
| 세션 이름 | 겹치지 않는 정확한 경로 | 승인되어야 할 선행 작업 또는 없음 | 관찰 가능한 완료 조건과 검증 명령 | 예정 / 진행 중 / Worker 완료·Advisor 검증 대기 / 승인 / 차단 | YYYY-MM-DD |

상태는 Worker의 자체 보고와 Advisor 승인을 구분합니다. Worker 완료는 Advisor가 diff, 동일 테스트와 matching-surface manual QA를 재실행하기 전까지 통합 승인이 아닙니다. 범위가 바뀌면 작업 전에 이 표를 갱신합니다.

## 2026-07-12 진행 중 작업

| Session              | Owned paths                                      | Dependency                                                                       | Acceptance criteria                                                                    | Status                     | Updated    |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | ---------- |
| `friendword-codex-1` | `apps/mobile/**`                                 | Advisor의 root contract/scaffold                                                 | Expo/React Native mobile scaffold가 해당 Worker brief의 검증을 통과함                  | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| `friendword-codex-2` | `supabase/**`                                    | `.briefs/02-supabase-schema.md`; root scaffold와 contract는 Advisor 통합 시 대조 | migration, RLS와 schema test가 brief의 invariant 및 검증을 통과함                      | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| `friendword-codex-3` | `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**` | `.briefs/03-docs-skeleton.md`, `FRIENDWORD_HANDOFF.md`                           | 15개 최종 문서 존재, 12개 docs 반영, 기존 `docs/shipaton-2026.md` 삭제, 필수 검증 통과 | 승인 (Advisor 재검증 완료) | 2026-07-12 |
| Advisor              | 루트 scaffold·설정, `apps/web/**`, CI            | Worker 결과의 contract와 schema를 직접 재검증                                    | root lint/typecheck/test/CI와 web scaffold가 Advisor 검증 및 manual QA를 통과함        | 승인 (초기 스캐폴드 완료)  | 2026-07-12 |

## 2026-07-12 Slice 3 (디자인 시스템 "Hype Mixtape" + 핵심 표면)

| Session              | Owned paths                                                                               | Dependency                                   | Acceptance criteria                                                 | Status                                                         | Updated    |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| `friendword-codex-1` | `apps/mobile/**`                                                                          | `.briefs/04-mobile-pitch-flow.md`, ui-tokens | 5단계 피치 플로우 + 녹음, typecheck/lint/format 통과, 시뮬레이터 QA | 승인 (Advisor 시뮬레이터 QA 완료)                              | 2026-07-12 |
| `friendword-codex-2` | `packages/data\|adapters\|contracts/**`, `supabase/migrations/0003`, `scripts/test-db.sh` | `.briefs/05-data-layer.md`                   | 전체 테스트 + DB 하니스 통과                                        | 승인 (Advisor 재검증 + 원격 배포 완료)                         | 2026-07-12 |
| `friendword-codex-3` | `apps/web/**`                                                                             | `.briefs/06-web-pitch-page.md`, ui-tokens    | `/p/demo-blair` 완전 동작, build/E2E 통과                           | 승인 (usage limit로 최종 보고 누락 — Advisor가 직접 검증 완료) | 2026-07-12 |
| Advisor              | `packages/ui-tokens`, `docs/DESIGN.md`, `.env`, Supabase 링크·배포, ignore 정리           | 사용자 디자인 피드백(액티브·펑키)            | 디자인 시스템 확정, 원격 스키마 0001~0003 배포, 전체 그린           | 완료                                                           | 2026-07-12 |
