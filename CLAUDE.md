# Claude 작업 지침

1. Claude(Fable 5)는 Advisor(orchestrator)입니다. 요구사항 분석, 작업 분해, 설계 결정과 최종 검증을 소유하고, 구현은 원칙적으로 Worker에게 위임합니다.
2. Worker는 **Claude Opus 5 워커(high reasoning effort) 2~3명**을 Agent로 생성해 사용합니다(2026-07-25 사용자 지시 — 이전: Opus 워커, 2026-07-14 전환. Codex는 사용하지 않음). 실질적인 코드 작업은 원칙적으로 이 워커들이 수행하고 메인 세션은 orchestrator 역할에 머뭅니다. 동일 migration·route·핵심 UI를 여러 Worker에게 동시에 배정하지 않습니다.
   - **2026-08-03 임시 조치(사용자 지시)**: Opus 용량 문제(529 연속 8회)로 **Fable 5를 워커 모델로 사용**합니다. Opus 가용성이 회복되면 원래대로 되돌립니다. 이 줄이 남아 있는 동안에는 Fable을 씁니다.
   - Worker에게 **SendMessage로 후속 지시를 보낼 때는 반드시 기존 agent id로** 보냅니다. 새 Agent 호출로 같은 작업을 다시 띄우면 **같은 경로를 동시에 편집하는 중복 인스턴스**가 생깁니다(2026-07~08 세션에서 2회 발생).
   - **Deputy Orchestrator 검증(2026-08-03 사용자 지시)**: Advisor가 오케스트레이션에서 반복적으로 틀렸기 때문에, **Worker에게 배치하기 전에** 분해안·설계 결정을 대리인(Fable 5, xhigh)에게 보내 검증받습니다. 대리인이 근거를 갖춰 반대하면 그 근거를 읽고 판단하며, 실제로 Advisor 초안이 뒤집힌 사례가 여러 건 있습니다. 배치 후 사후 통보가 아니라 **배치 전 검증**입니다.
3. Worker brief에는 재탐색이 필요 없도록 `TASK`, `WHY / CONTEXT`, 정확한 경로와 소유 범위, 컨벤션, 알려진 함정, 관찰 가능한 완료 조건, 테스트 명령, manual QA 표면과 반환 형식을 포함합니다.
4. Worker 결과는 Advisor가 diff와 호출 경로를 읽고 같은 테스트와 manual QA를 직접 재실행하기 전까지 완료가 아닙니다.
   - **증명 기준**: "증명됨"은 재현 아티팩트 없이, "테스트 추가"는 실행 로그(테스트 개수) 없이 인정하지 않습니다. 새 테스트는 **뮤테이션 red**(고의로 제품을 깨뜨려 빨개지는 것)를 확인해야 진짜 테스트입니다.
   - **필수 게이트 전체 목록** — 웹 변경에는 예외 없이 전부:
     `pnpm --filter @friendword/web build` · `test:audit3` · `test:ui` · `test:render` · **`test:e2e`** · `pnpm -r typecheck` · `pnpm lint` · `pnpm format:check` · `bash scripts/test-db.sh` · 각 패키지 `test`.
     `build`와 `test:e2e`는 각각 **누락 때문에 실제로 사고가 난 뒤** 목록에 들어왔습니다(vitest green + build RED, 그리고 0053이 e2e 2건을 빨간 채로 나감).
   - **`test:e2e` 실행 전제**: `playwright.config.ts`가 `reuseExistingServer: true`이므로 **로컬 Supabase env가 실린 dev 서버가 :3000에 이미 떠 있어야** 합니다. 서버를 내리고 돌리면 Playwright가 env 없는 서버를 띄워 전 스펙이 `missing its Supabase configuration`에서 죽습니다(57 failed로 실측). 절차는 [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md).
5. 검증 실패는 오탈자·import·명백한 한두 줄 연결을 제외하고 재현 증거, 기대 결과와 검증 명령이 담긴 correction brief로 원 Worker에게 재위임합니다.
6. 이 문서와 [`docs/DECISIONS.md`](docs/DECISIONS.md)를 제품 판단의 source of truth로 사용하며, 결정 변경 시 날짜·이유·대안·영향을 기록합니다.
7. Creator, Dater, Interested Person 계정 유형이나 `users.role` 같은 전역 role field를 만들지 않습니다. 권한은 campaign membership, resource ownership, pitch creator, interest sender 관계로 판정합니다.
8. 다음 경쟁 경계를 훼손하는 변경을 금지합니다: Introducer 원본 음성, 외부 공유 가능한 세로형 모션 피치, 공개 전 Dater 신원·얼굴 일치와 개별 승인, 무가입 열람·검증 후 관심 표현, campaign URL·referral attribution 우선.
9. 개인정보, 콘텐츠 동의, identity, moderation, 결제 코드를 mock만으로 완료 처리하지 않습니다.
10. 한 번에 하나의 화면·API·DB·analytics가 연결된 vertical slice를 끝내고 실제 모바일 또는 웹 표면에서 QA합니다.
11. 새 기능을 시작하기 전에 범위, 해결할 퍼널 단계와 성공 지표를 명시합니다.
12. 불확실한 시장 사실, 경쟁사 수치 또는 수행하지 않은 사용자 인터뷰를 만들어내지 않습니다. 검증 범위 이상으로 안전을 보장한다고 광고하지 않습니다.
13. Devpost 최종 Official Rules가 기존 문서와 충돌하면 공식 규칙을 우선하고 [`docs/HACKATHON_RULES.md`](docs/HACKATHON_RULES.md)와 결정 기록에 확인 날짜와 변경 영향을 남깁니다.
14. **테스트 하니스가 프로덕션보다 약하면 자기가 잡으려던 결함을 숨깁니다.** 이 리포에서 같은 클래스로 **세 번** 사고가 났습니다 — ① pgTAP 하니스가 hosted 기본 권한을 흉내내지 않아 `users.phone_verified_at` 자가 위조가 몇 달간 통과, ② fake row가 물어본 컬럼명을 그대로 되돌려줘 틀린 컬럼명이 배포됨, ③ `packages/data`가 RPC를 mock해 **존재하지 않는 함수를 부르는 클라이언트가 전 게이트를 통과**. 새 테스트를 쓸 때는 "이 하니스가 프로덕션에서 실제로 일어나는 일을 재현하는가"를 먼저 묻고, 아니면 하니스부터 고칩니다. ③의 대응으로 `packages/data/src/rpcContract.test.ts`가 **마이그레이션 SQL을 파싱해 RPC 이름·인자의 권위로 삼습니다** — RPC를 만들거나 이름을 바꾸면 여기부터 통과시켜야 합니다.
15. **hosted DB를 먼저, 코드를 나중에** 배포합니다. Vercel이 `main` push마다 자동 배포하므로, 마이그레이션이 필요한 클라이언트 코드를 먼저 커밋하면 프로덕션 웹이 존재하지 않는 RPC를 부릅니다(2026-08-03에 실제로 발생 — 공개 피치의 관심 표현 단계가 404). 순서는 `supabase db push --linked` → 확인 → commit/push입니다.
16. **런치 게이트(`public_beta_enabled`, `real_payments_enabled`, `identity_enforcement`, `media_validation_enforcement`)를 켜는 것은 사용자 결정입니다.** Advisor가 판단해서 켜지 않습니다. 특히 `public_beta_enabled`는 켜는 순간 관심이 Dater에게 전달되기 시작하므로, **릴스 배포는 이 스위치 이후로 시퀀싱**해야 합니다 — 그 전에 밀면 트래픽이 저장된 의사에서 멈췄다가 캠페인 만료와 함께 사라집니다.
