# 에이전트 작업 규칙

## 기본 원칙

1. 사용자를 `상헌 님`으로 호칭하고 한국어로는 항상 존댓말을 사용합니다.
2. Advisor와 `friendword-codex-1`, `friendword-codex-2`, `friendword-codex-3`은 같은 파일을 동시에 수정하지 않습니다.
3. 각 Worker의 session, owned paths, dependency, acceptance criteria와 상태를 [`docs/TASKS.md`](docs/TASKS.md)에 기록합니다.
4. Worker 완료 보고를 그대로 승인하지 않습니다. Advisor가 diff·test·matching-surface manual QA를 직접 재실행합니다.
5. 검증 실패 시 원 Worker에게 원인, 재현 증거, 기대 결과와 검증 명령이 포함된 수정 브리프를 전달합니다.
6. 작업 전에 관련 제품 문서, schema, contract와 call site를 읽습니다.
7. TypeScript는 strict로 유지하고 `any`, `@ts-ignore`, `@ts-expect-error`, 근거 없는 type assertion을 사용하지 않습니다.
8. DB schema 변경에는 migration과 RLS test를 함께 작성합니다.
9. 동일 User가 서로 다른 캠페인에서 여러 역할을 가질 수 있음과 동일 캠페인에서 `DATER_OWNER`와 `INTRODUCER`를 겸할 수 없음을 테스트로 보호합니다.
10. UI 변경은 실제 기기 또는 브라우저에서 manual QA합니다.
11. 결제는 sandbox purchase, restore, expiration, refund 경로를 검증합니다. consumable credit은 서버 ledger와 webhook에서 idempotent하게 처리합니다.
12. UGC 기능은 신고, 차단, moderation 경로 없이 merge하지 않습니다.
13. 사용자 데이터와 secret을 로그, 스크린샷, fixture 또는 Devpost 자료에 노출하지 않습니다.
14. 완료 시 변경 파일과 동작, 실행한 검증, 결과와 남은 위험을 기록합니다.
15. Worker는 owned paths 밖의 문제를 임의 수정하지 않고 증거와 함께 반환합니다.

## Worker brief 필수 형식

모든 Worker brief에는 다음 항목을 빠짐없이 포함합니다.

```text
TASK
한 문장으로 정의한 결과물

WHY / CONTEXT
제품 목표, 사용자 흐름, 이미 내린 결정, 관련 위험

SCOPE
수정 가능한 정확한 파일 경로와 소유 범위

OUT OF SCOPE
건드리면 안 되는 기능·파일·정책

CONVENTIONS
프로젝트 구조, 타입·오류 처리·테스트·로그 규칙

KNOWN TRAPS
동의, RLS, idempotency, 비용 호출, 기존 실패 등 알려진 함정

ACCEPTANCE CRITERIA
관찰 가능한 완료 조건

REQUIRED VERIFICATION
통과해야 할 명령, 테스트, manual QA surface

RETURN FORMAT
changed files, diff summary, test output, residual risks
```

브리프는 Worker에게 제품 결정을 떠넘기지 않도록 decision-complete해야 합니다. 남은 설계 선택은 Advisor가 먼저 결정하거나 선택지와 판단 기준을 명시한 조사 태스크로 분리합니다.

## 세 Worker 세션 운영 규칙

1. 세 세션에 겹치는 파일을 동시에 배정하지 않습니다.
2. `docs/TASKS.md`에 session, owned paths, dependency, acceptance criteria와 상태를 남깁니다.
3. dependency가 있는 작업은 선행 diff를 Advisor가 승인한 뒤 시작합니다.
4. 공통 contract나 schema를 바꾸는 Worker의 브리프에는 소비자 목록과 migration 영향을 포함합니다.
5. 범위 밖 문제는 수정하지 않고 증거와 함께 반환합니다.
6. 장시간 작업의 중간 산출물이나 Worker의 자체 테스트 성공은 Advisor 승인 전까지 완료 또는 통합으로 간주하지 않습니다.
