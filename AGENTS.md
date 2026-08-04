# Friendword 에이전트 작업 규칙

## 정책 경계

- 이 파일은 저장소 작업 규칙만 정의합니다. 모델 선택, effort, 에이전트 수, 오케스트레이션과 에스컬레이션은 현재 활성화된 하네스가 소유합니다.
- 특정 모델, 고정 워커 수, 고정 세션 이름 또는 과거 Advisor/Worker 체제를 이 파일에서 강제하지 않습니다.

## 기본 원칙

1. 사용자를 상헌 님으로 호칭하고 한국어로는 항상 존댓말을 사용합니다.
2. 작업 전에 관련 제품 문서, schema, contract와 모든 주요 call site를 읽습니다.
3. 동시에 진행하는 작업은 겹치지 않는 파일 소유 범위를 가져야 합니다. 동일 migration, route, contract 또는 핵심 UI를 동시에 수정하지 않습니다.
4. 범위 밖 문제는 임의로 수정하지 않고 파일 경로, 재현 증거와 영향도를 보고합니다.
5. 공통 contract나 schema를 바꾸면 모든 소비자와 migration 영향을 확인합니다.
6. TypeScript strict, DB/RLS, 개인정보, 결제, UGC와 QA 규칙은 CLAUDE.md를 따릅니다.
7. 기존 migration은 수정하지 않고 새 번호 migration과 회귀 테스트를 추가합니다.
8. 사용자 변경을 보존하고 승인 없이 commit, push, 배포 또는 프로덕션 설정 변경을 하지 않습니다.

## 작업 계약

작업을 위임할 때 필요한 항목만 간결하게 포함합니다.

TASK
한 문장으로 정의한 결과물

WHY / CONTEXT
제품 목표, 사용자 흐름, 이미 내린 결정과 관련 위험

SCOPE / OUT OF SCOPE
수정 가능한 정확한 경로와 보호해야 할 영역

INVARIANTS / KNOWN TRAPS
동의, RLS, idempotency, 비용 호출, 기존 실패와 호환성

ACCEPTANCE CRITERIA
관찰 가능한 완료 조건

REQUIRED VERIFICATION
테스트 명령과 실제 manual QA surface

RETURN FORMAT
changed files, decisions, test results, deviations, residual risks

제품·보안 결정을 작업자에게 암묵적으로 떠넘기지 않습니다. 증거가 승인된 계약과 충돌하면 임의로 재설계하지 말고 중단하여 보고합니다.

## 검증과 완료

- 완료 보고만으로 승인하지 않고 실제 diff, 테스트 결과와 사용자 표면을 증거로 판단합니다.
- 새 테스트는 변경 전 실패 또는 mutation red가 실제로 발생하는지 확인합니다.
- UI는 실제 앱·브라우저, API는 실제 요청, 결제는 sandbox와 webhook, media는 실제 render 결과로 검증합니다.
- 테스트가 통과해도 동의, 개인정보, 비용, RLS, product invariant를 위반하면 완료가 아닙니다.
- 검증 실패 시 재현 명령, 기대 결과, 실제 결과와 최소 증거를 보존합니다.
- 완료 시 변경 파일, 사용자-visible 동작, 실행한 검증, 정확한 결과와 남은 위험을 보고합니다.
