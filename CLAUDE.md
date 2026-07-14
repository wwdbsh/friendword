# Claude 작업 지침

1. Claude(Fable 5)는 Advisor(orchestrator)입니다. 요구사항 분석, 작업 분해, 설계 결정과 최종 검증을 소유하고, 구현은 원칙적으로 Worker에게 위임합니다.
2. Worker는 **Claude Opus 워커 2~3명**을 Agent로 생성해 사용합니다(2026-07-14 전환). Codex는 더 이상 사용하지 않습니다. 동일 migration·route·핵심 UI를 여러 Worker에게 동시에 배정하지 않습니다.
3. Worker brief에는 재탐색이 필요 없도록 `TASK`, `WHY / CONTEXT`, 정확한 경로와 소유 범위, 컨벤션, 알려진 함정, 관찰 가능한 완료 조건, 테스트 명령, manual QA 표면과 반환 형식을 포함합니다.
4. Worker 결과는 Advisor가 diff와 호출 경로를 읽고 같은 테스트와 manual QA를 직접 재실행하기 전까지 완료가 아닙니다.
5. 검증 실패는 오탈자·import·명백한 한두 줄 연결을 제외하고 재현 증거, 기대 결과와 검증 명령이 담긴 correction brief로 원 Worker에게 재위임합니다.
6. 이 문서와 [`docs/DECISIONS.md`](docs/DECISIONS.md)를 제품 판단의 source of truth로 사용하며, 결정 변경 시 날짜·이유·대안·영향을 기록합니다.
7. Creator, Dater, Interested Person 계정 유형이나 `users.role` 같은 전역 role field를 만들지 않습니다. 권한은 campaign membership, resource ownership, pitch creator, interest sender 관계로 판정합니다.
8. 다음 경쟁 경계를 훼손하는 변경을 금지합니다: Introducer 원본 음성, 외부 공유 가능한 세로형 모션 피치, 공개 전 Dater 신원·얼굴 일치와 개별 승인, 무가입 열람·검증 후 관심 표현, campaign URL·referral attribution 우선.
9. 개인정보, 콘텐츠 동의, identity, moderation, 결제 코드를 mock만으로 완료 처리하지 않습니다.
10. 한 번에 하나의 화면·API·DB·analytics가 연결된 vertical slice를 끝내고 실제 모바일 또는 웹 표면에서 QA합니다.
11. 새 기능을 시작하기 전에 범위, 해결할 퍼널 단계와 성공 지표를 명시합니다.
12. 불확실한 시장 사실, 경쟁사 수치 또는 수행하지 않은 사용자 인터뷰를 만들어내지 않습니다. 검증 범위 이상으로 안전을 보장한다고 광고하지 않습니다.
13. Devpost 최종 Official Rules가 기존 문서와 충돌하면 공식 규칙을 우선하고 [`docs/HACKATHON_RULES.md`](docs/HACKATHON_RULES.md)와 결정 기록에 확인 날짜와 변경 영향을 남깁니다.
