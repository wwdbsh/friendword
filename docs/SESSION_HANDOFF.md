# PROJECT HANDOFF

> 갱신: 2026-07-13 00:40 KST · 최신 커밋 `5712883` (main, CI 그린)
> 읽는 순서: 이 문서 → `docs/TASKS.md` → 필요 시 `FRIENDWORD_HANDOFF.md`(제품 원본), `docs/DESIGN.md`(디자인), `CLAUDE.md`/`AGENTS.md`(협업 규칙)

## CURRENT STATE

- **제품**: Shipaton 2026 참가작 friend-led dating campaign 앱. 8/1 이후 App Store 최초 출시 필수, RevenueCat IAP 필수.
- **모노레포**: `apps/mobile`(Expo SDK 57, expo-router) · `apps/web`(Next.js 15) · `packages/{domain,contracts,config,ui-tokens,data,adapters}` · `supabase/` · `media-worker`(스텁). pnpm, node-linker=hoisted.
- **백엔드**: hosted Supabase `friendword`(ref `oknolcxsvogrhnxnyosr`, link 완료). 마이그레이션 0001~0005 배포됨. 상태 전이는 전부 SECURITY DEFINER RPC(`submit_pitch_for_consent`, `get_consent_preview`, `claim_consent_request`, `approve_and_publish_pitch`) — 클라이언트에 status/subject 쓰기 권한 없음.
- **파이프라인 (동작 확인됨)**: 모바일 5트랙 피치 작성(로컬) → 제출 시 서버 draft 생성 + 음성 서명 업로드(`pitch-media` 비공개 버킷) + 동의 토큰 발급 → Dater가 토큰으로 클레임 → 승인·발행(campaign+slug+멤버십 생성). 프로덕션 E2E 통과.
- **웹**: `/p/demo-blair` fixture 피치 페이지 완성(재생 시뮬레이션·자막·CTA·Playwright 5 테스트). 실데이터 미연결.
- **실행 환경**: tmux `friendword-web`(:3000) · `friendword-mobile`(expo, iPhone 17 Pro 시뮬레이터) · `friendword-codex-1/2/3`(워커, 현재 미사용).
- **검증**: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` · `bash scripts/test-db.sh`(suite 01~05) · `cd apps/web && pnpm test:e2e` — 전부 그린.

## DONE

- 모노레포 스캐폴드 + CI + 코어 스키마 22테이블/RLS/불변식 (`4e37735`)
- Hype Mixtape 디자인 시스템 + 모바일 피치 플로우 + 데이터/어댑터 레이어 + 웹 피치 페이지 (`b843b96`)
- 모바일 제출 경로 Supabase 실연결 + 이메일 OTP 로그인 시트 (`a8bcf4b`)
- Flow B 백엔드: 동의 preview/claim/approve·발행 RPC + 테스트 (`e55990d`)
- 인프라: Supabase link·배포, `.env` 구성, GitHub CI(db-tests 포함)

## IN PROGRESS

- 없음 (의도적으로 클린 컷에서 중단)

## TODO

1. **(사용자) Resend SMTP 입력** — 대시보드 Authentication→Emails→SMTP Settings. 완료 통보 대기 중
2. **(P1) SMTP 연결 후**: Templates의 Magic Link에 `{{ .Token }}` 반영 + 모바일 OTP 로그인 실검증
3. **(P1) Slice 5B-1**: 웹 `/consent/[token]` — preview 렌더 → 매직링크 로그인(웹은 SMTP 불필요, `detectSessionInUrl`) → claim → 사진·음성 검토 → approve → `/p/[slug]` 리다이렉트
4. **(P1) Slice 5B-2**: `/p/[slug]` 실데이터화 — 서버 컴포넌트에서 service role로 published 캠페인 조회 + 미디어 signed URL. fixture는 fallback 유지
5. **(P2) 모바일**: 제출 시 사진 업로드 추가 (`HybridPitchDraftService.uploadRecording` 옆에), 제출 성공 후 동의 링크 공유 화면 (`draft.server.consentToken` 로컬 보관 중)
6. **(P2)** verified interest flow (인터레스트 프로필 + accept/decline RPC)
7. **(P3)** Intro Room 채팅 + 신고·차단 UI
8. **(P3)** RevenueCat sandbox 연동 (`creator_launch_credit_499` consumable + `campaign_30d_1999`)
9. **(P3)** analytics 이벤트 파이프라인 (`docs/ANALYTICS_PLAN.md` 퍼널)
10. **(게이트)** 공식 Rules 게시 시 `docs/HACKATHON_RULES.md` 재확인

## IMPORTANT DECISIONS

- **워커 운영**: 사용자 특별지시로 codex 위임 중단, Advisor(Fable 5) 단독 구현 모드 (limit 리셋과 무관하게 유지)
- **보안**: API 키는 사용자가 직접 입력. Claude는 위치만 안내, 값 수신 금지
- **디자인**: "Hype Mixtape" 확정 (크림+탠저린/핫핑크/선샤인, 스티커 미학, Unbounded+Bricolage). 초기 "촛불" 컨셉은 사용자 거부로 폐기 — 차분한/무디 방향 금지
- **아키텍처**: 상태 전이·동의·발행은 RPC 전용(클라이언트 GRANT에서 status 제외). 동의 토큰은 raw 1회 반환 + sha256 해시만 저장. 모바일 드래프트는 로컬 작성→제출 시 서버 동기화(하이브리드). `apps/mobile/.env`는 루트 `.env` 심링크
- **테스트**: Docker 부재로 supabase 로컬 스택 대신 로컬 PG17 + plain-SQL 하니스(`scripts/test-db.sh`), CI는 postgres:17 컨테이너

## ISSUES / RISKS

- 무료 티어 기본 메일러로는 OTP 코드 발송 불가 → Resend SMTP 대기 (모바일 로그인 실사용 차단 중, 웹 매직링크는 무관)
- App Review 리스크(데이팅 4.3b + UGC): 7월 말 심사 제출 + 수동 release 계획 준수 필요
- `database.types.ts`는 수동 부분 타입 — 테이블 추가 시 갱신 누락 주의
- 시뮬레이터 탭 자동화 불가 → 인터랙션 QA는 사용자 손 테스트 또는 프로덕션 E2E 스크립트(핸드오프의 QA 패턴: service role로 유저 생성→anon으로 RLS 검증→정리)로 대체
- plpgsql 함정: OUT 파라미터/컬럼 충돌 시 `#variable_conflict use_column`; 캠페인 published insert 전에 consent approved 필요(0001 트리거)

## LOG SUMMARY

2026-07-12~13 단일 세션에서 빈 repo → 프로덕션 연결 제품 뼈대 완성. 커밋 7개(모두 CI 그린): 스캐폴드/스키마 → 디자인+3표면 병렬 구축(codex 워커 3인) → 워커 limit 소진 후 Advisor 단독으로 모바일 실연결·Flow B 백엔드·프로덕션 E2E까지. 마이그레이션 5개 배포, 테스트 34+ / DB 스위트 5 / Playwright 5 통과.
