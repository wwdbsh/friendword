# Friendword 프로젝트 지침

## 정책 경계

- 모델 선택, reasoning effort, 에이전트 역할, 병렬성, 리뷰와 에스컬레이션은 설치된 fable-control-plane 플러그인이 소유합니다.
- 이 저장소는 플러그인의 오케스트레이션 정책을 다시 정의하거나 덮어쓰지 않습니다.
- 이 문서는 Friendword의 프로젝트 사실, 제품 불변 조건, 검증 명령과 운영 안전 경계만 정의합니다.
- 동시에 진행하는 작업이 있다면 같은 파일, migration, route 또는 핵심 UI를 둘 이상에게 배정하지 않습니다. 이미 진행 중인 동일 범위 작업을 중복 생성하지 않습니다.

## 주요 명령

- Install: pnpm install
- Build web: pnpm --filter @friendword/web build
- Type check: pnpm -r typecheck
- Unit/package tests: pnpm -r test
- Lint: pnpm lint
- Format check: pnpm format:check
- Base DB/RLS tests: bash scripts/test-db.sh
- Third-audit acceptance: pnpm test:audit3
- Web UI tests: pnpm --filter @friendword/web test:ui
- Render tests: pnpm --filter @friendword/web test:render
- Web E2E: pnpm --filter @friendword/web test:e2e

웹 변경에는 관련 focused test 뒤에 build, audit3, UI, render, E2E, 전체 typecheck, lint, format check, DB/RLS 하니스와 관련 package test를 실행합니다. 적용 불가능한 게이트가 있으면 이유와 남은 위험을 명시합니다.

test:e2e의 playwright.config.ts는 reuseExistingServer: true입니다. 로컬 Supabase 환경이 실린 dev server가 :3000에서 실행 중이어야 합니다. 서버를 내린 상태에서 실행하면 환경변수 없는 서버가 시작되어 스펙이 missing its Supabase configuration으로 실패할 수 있습니다. 세부 절차는 docs/SESSION_HANDOFF.md를 따릅니다.

## 아키텍처와 source of truth

- Monorepo: apps/mobile(Expo), apps/web(Next.js), packages/{domain,contracts,config,ui-tokens,data,adapters}, supabase.
- 제품 판단은 이 문서와 docs/DECISIONS.md를 우선합니다.
- 작업 상태와 운영 전제는 docs/SESSION_HANDOFF.md를 확인합니다.
- 결정이 바뀌면 날짜, 이유, 대안과 제품·데이터·비용·안전·배포 영향을 docs/DECISIONS.md에 기록합니다.

## 제품 불변 조건

- Creator, Dater, Interested Person 계정 유형이나 users.role 같은 전역 role field를 만들지 않습니다.
- 권한은 campaign membership, resource ownership, pitch creator와 interest sender 관계로 판정합니다.
- 동일 User가 서로 다른 캠페인에서 여러 역할을 가질 수 있지만, 동일 캠페인에서 DATER_OWNER와 INTRODUCER를 겸할 수 없습니다.
- Introducer의 원본 음성, 외부 공유 가능한 세로형 모션 피치, 공개 전 Dater 신원·얼굴 일치와 개별 승인, 무가입 열람·검증 후 관심 표현, campaign URL·referral attribution 우선 경계를 훼손하지 않습니다.
- 개인정보, 콘텐츠 동의, identity, moderation 또는 결제 코드를 mock만으로 완료 처리하지 않습니다.
- 한 번에 하나의 화면·API·DB·analytics가 연결된 vertical slice를 끝내고 실제 모바일 또는 웹 표면에서 QA합니다.
- 새 기능 전에 범위, 해결할 퍼널 단계와 성공 지표를 명시합니다.
- 불확실한 시장 사실, 경쟁사 수치 또는 수행하지 않은 사용자 인터뷰를 만들어내지 않습니다. 검증 범위 이상으로 안전을 보장한다고 광고하지 않습니다.
- Devpost Final Official Rules가 기존 문서와 충돌하면 공식 규칙을 우선하고 docs/HACKATHON_RULES.md와 결정 기록에 확인 날짜와 영향을 남깁니다.

## 보안·데이터·테스트 규칙

- TypeScript는 strict로 유지하고 any, @ts-ignore, @ts-expect-error와 근거 없는 type assertion을 사용하지 않습니다.
- 기존 supabase/migrations 파일을 수정하지 않습니다. DB 변경은 새 번호 migration으로 추가하고 관련 RLS/RPC 회귀 테스트를 함께 작성합니다.
- 새 테이블에는 hosted 기본 권한을 신뢰하지 말고 역할별 GRANT/REVOKE와 ACL 테스트를 명시합니다.
- RPC를 만들거나 이름·인자를 바꾸면 packages/data/src/rpcContract.test.ts를 먼저 통과시킵니다. Migration SQL이 RPC 이름과 인자의 권위입니다.
- 새 테스트는 가능하면 변경 전 실패와 변경 후 성공을 증명합니다. “테스트 추가”는 실제 실행 결과와 테스트 개수 없이 인정하지 않습니다.
- 고의로 제품 동작을 깨뜨렸을 때 새 테스트가 실패하는 mutation red를 확인합니다.
- 테스트 하니스가 hosted 권한, PostgREST 호출 형태와 실제 provider 경계를 재현하는지 먼저 확인합니다. 하니스가 프로덕션보다 약하면 하니스부터 수정합니다.
- UI 변경은 실제 기기 또는 브라우저에서 QA합니다.
- 결제는 sandbox purchase, restore, expiration, refund와 webhook idempotency를 검증합니다.
- UGC 기능은 신고, 차단과 moderation 경로 없이 완료하지 않습니다.
- 사용자 데이터, 전화번호, 이메일, 법적 이름, 신분증, 사진, 음성, 메시지, token과 secret을 로그·스크린샷·fixture·Devpost 자료에 노출하지 않습니다.

## 배포와 사용자 승인 경계

- Commit, push, hosted DB 변경, 배포, 외부 공개와 프로덕션 설정 변경은 상헌 님의 명시적 승인 없이 수행하지 않습니다.
- 승인을 받아 migration과 이를 소비하는 클라이언트 코드를 배포할 때는 supabase db push --linked와 hosted 확인을 먼저 수행한 뒤 코드를 commit/push합니다. Vercel은 main push마다 자동 배포됩니다.
- public_beta_enabled, real_payments_enabled, identity_enforcement, media_validation_enforcement는 상헌 님만 켤 수 있습니다.
- public_beta_enabled를 켜기 전에는 본격적인 릴스 배포를 시작하지 않습니다. 게이트가 닫힌 동안 유입된 의사는 전달되지 않고 캠페인 만료 시 사라질 수 있습니다.

## 완료 기준

- 승인된 범위와 관찰 가능한 acceptance criteria를 충족합니다.
- 관련 focused test와 필수 게이트를 실제로 실행하고 결과를 기록합니다.
- 실패, 생략한 검증, 사전 존재 실패와 남은 위험을 구분해 공개합니다.
- 최종 diff에 범위 밖 변경이 없고 프로젝트 불변 조건을 유지합니다.
- 고위험 변경은 실제 데이터·권한·실패 복구와 rollback 경계를 검증합니다.
- 사용자에게 변경 파일, 동작, 검증 결과와 남은 위험을 간결하게 전달합니다.
