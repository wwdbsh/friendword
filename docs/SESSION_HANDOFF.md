# 세션 핸드오프 — 2026-07-13 00:25 (Asia/Seoul)

> 이전 세션(Claude Fable 5, Advisor)이 다음 세션에게 남기는 문서.
> 제품 판단의 source of truth는 `FRIENDWORD_HANDOFF.md`, 협업 규칙은 `CLAUDE.md`/`AGENTS.md`, 디자인은 `docs/DESIGN.md`("Hype Mixtape"), 작업 상태는 `docs/TASKS.md`.

## 현재 상태 요약

Shipaton 2026 참가작 Friendword. 스캐폴드부터 Flow B 백엔드까지 하루 만에 완료. 모든 커밋이 CI 그린, 프로덕션 Supabase에 마이그레이션 0001~0005 배포됨.

| 커밋      | 내용                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `4e37735` | 모노레포 스캐폴드 + 코어 스키마/RLS + 문서 골격                                                       |
| `b843b96` | Hype Mixtape 디자인 시스템 + 모바일 피치 플로우(5트랙) + 데이터 레이어 + 웹 공개 피치 페이지(fixture) |
| `a8bcf4b` | 모바일 제출 경로 실연결 (submit RPC 0004, 서명 업로드, 이메일 OTP 시트)                               |
| `e55990d` | Flow B 서버 측 (0005: consent preview/claim/approve_and_publish RPC)                                  |

## 실행 중인 환경 (죽었으면 재기동)

- **tmux `friendword-web`**: `pnpm --filter @friendword/web dev` → http://localhost:3000 (피치 데모: `/p/demo-blair`)
- **tmux `friendword-mobile`**: `cd apps/mobile && npx expo start --ios` → iPhone 17 Pro 시뮬레이터 (부팅: `xcrun simctl` 목록에서 iPhone 17 Pro)
- **tmux `friendword-codex-1/2/3`**: codex 워커. **주의: 특별지시로 당분간 워커 위임 없이 Advisor(Fable 5) 단독 진행** (limit은 07-13 00:15 리셋됨)
- Supabase: hosted `friendword` (ref `oknolcxsvogrhnxnyosr`), `supabase link` 완료, `supabase db push`가 비밀번호 없이 동작

## 검증 명령 (모두 현재 그린)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
bash scripts/test-db.sh            # 로컬 PG 하니스 (suite 01~05)
pnpm --filter @friendword/web build
cd apps/web && pnpm test:e2e       # Playwright 5개 (dev 서버 필요)
```

프로덕션 E2E QA 스크립트(scratchpad, 세션 종료로 소실 가능 — 필요시 재작성):
submit 경로 8단계 / consent 여정 7단계 모두 통과 이력 있음. 패턴: service role로 QA 유저 생성 → anon 클라이언트로 RLS 하 작업 → 정리.

## 다음 작업: Slice 5B — 웹 동의 페이지 + 실데이터 공개 피치

1. **`/consent/[token]` 페이지** (apps/web):
   - 서버 컴포넌트: `get_consent_preview` RPC(anon)로 미리보기 렌더
   - 로그인: **웹은 매직링크가 무료 티어로도 동작** (`signInWithOtp` + `emailRedirectTo`, `detectSessionInUrl` 기본 on) — 모바일과 달리 SMTP 불필요
   - 세션 확보 후 `claim_consent_request` → 사진·음성 검토 UI (signed URL은 storage select 정책상 subject 클레임 후 접근 가능) → `approve_and_publish_pitch` → `/p/[slug]`로 이동
2. **`/p/[slug]` 실데이터화**: 서버 컴포넌트에서 service role 클라이언트(서버 전용 env)로 published 캠페인 조회 + 미디어 signed URL 발급. fixture(`demo-blair`)는 fallback으로 유지
3. **모바일 잔여**: 사진 업로드가 아직 미구현 (제출 시 음성만 업로드 — `HybridPitchDraftService.uploadRecording` 참조), 제출 성공 후 동의 링크 공유 UI 없음 (`draft.server.consentToken`은 로컬 저장됨)
4. 이후: verified interest flow → Intro Room → RevenueCat

## 대기 중인 사용자 액션

- **Resend SMTP**: 상헌 님이 직접 Supabase 대시보드(Authentication → SMTP Settings)에 키 입력 예정. 완료 통보 받으면 Management API로 매직링크 템플릿에 `{{ .Token }}` 추가(무료 티어는 SMTP 연결 후에만 가능) 후 모바일 OTP 로그인 검증
- API 키류는 **절대 채팅으로 받지 않음** — 위치만 안내 (메모리 `security-api-keys-user-only` 참조)

## 함정·주의사항 (이번 세션에서 배운 것)

- **워커 규칙**: 특별지시로 현재 Advisor 단독 모드. 이후 위임 재개 시 `.briefs/` 패턴 사용 (gitignored)
- pnpm 빌드 스크립트 차단 → `pnpm-workspace.yaml` `allowBuilds`에 추가
- `apps/mobile/.env`는 루트 `.env`로의 **심링크** (Expo dotenv 로딩용, gitignored). app.config.ts에서 Node fs 사용 시 expo tsconfig에서 타입 에러 남 — process.env 방식 유지할 것
- plpgsql에서 `RETURNS TABLE` OUT 파라미터와 컬럼명 충돌 시 `#variable_conflict use_column`
- 0001의 `validate_campaign_publication` 트리거: 캠페인 published insert 전에 consent_requests가 approved여야 함 (순서 중요)
- RLS 하에서 campaign_memberships는 본인 행만 보임 — 테스트에서 전체 검증은 RESET ROLE로
- codex 워커에 장문 브리프는 파일로 쓰고 경로만 send-keys; Enter는 별도로 한 번 더
- 시뮬레이터 화면 이동은 딥링크 `xcrun simctl openurl booted "exp://127.0.0.1:8081/--/<path>"` (탭 자동화는 불가 — 시각 QA만)
- Metro/dev 서버가 있는 tmux 세션은 죽이지 말 것; next build는 `NEXT_DIST_DIR`로 분리 (`.next*` 전부 gitignore/lint ignore 처리됨)

## 재무·해커톤 게이트 리마인더

- 공식 Rules 게시(≤07/31) 시 `docs/HACKATHON_RULES.md` 재확인 게이트 실행
- 출시는 8/1 이후만. App Review는 7월 말 제출 + 수동 release
- 월 클라우드 hard cap $200 (docs/COST_MODEL.md)
