# PROJECT HANDOFF

> 갱신: 2026-07-13 11:50 KST · 최신 커밋 기준 main (CI 그린)
> 읽는 순서: 이 문서 → **`docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`(감사·현행 작업의 source of truth)** → `docs/TASKS.md` → 필요 시 `FRIENDWORD_HANDOFF.md`(제품 원본), `docs/DESIGN.md`(디자인), `docs/OPS.md`(운영), `docs/REVENUECAT_SETUP.md`(결제 셋업), `CLAUDE.md`/`AGENTS.md`(협업 규칙)

## 현행 목표 (사용자 확정, 2026-07-13)

- **감사 문서(`docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`)의 P0 전부 해소 — 다음 감사 all-pass.**
- 실행 순서는 감사 §7 고정: A(문서 truth reset+회귀 테스트) → B(web bootstrap) → C(identity 게이트) → D(immutable consent) → E(결제 원장) → F(유료 효익) → G(safety) → H(growth) → I(Trust Layer) → J(release 게이트). 순서 변경 금지.
- codex 워커 협업 재개 (`friendword-codex-1/2/3`). Advisor가 분해·brief·통합 검증 소유, 워커 결과는 diff·테스트·manual QA 직접 재검증 전까지 미완료.
- App Store 심사 준비는 보류(출시 창구 8/1~9/30). 단, 7월 중하순 착수 시점 재판단.

## CURRENT STATE

- **제품**: Shipaton 2026 참가작 friend-led dating campaign 앱. 8/1 이후 App Store 최초 출시 필수, RevenueCat IAP 필수.
- **정확한 상태 (2026-07-13 전수 감사 판정)**: **핵심 루프의 UI·데이터 골격 완성 — 신원·동의 불변성·결제 효익·운영의 출시 경계 미완성.** 브랜드가 분명하고 데이터 모델·RLS·공개 피치·동의·관심·채팅의 골격이 연결된 기능성 알파이며, 실사용자 출시 가능한 1.0이 아니다. 이전 핸드오프의 "핵심 루프 완성" 표현은 과대 기술이었음. 상세 판정·점수표·P0 목록은 감사 문서 §1·§5.
- **골격이 연결된 범위**: Flow A(모바일 피치: 관계→사진→음성→제출+미디어 업로드+동의 링크 공유 화면) → Flow B(웹 동의: preview→매직링크→claim→음성·사진 검토(개별 제외)→공개 기간 선택→발행) → 공개 페이지(실사진·실오디오) → Flow C(interest: 프로필 게이트→제출→Dater 인박스 accept/decline) → Intro Room(1:1 채팅+신고·차단·나가기) → 캠페인 pause/resume/archive. 프로덕션 E2E 39체크 그린 — 단, 이 E2E는 admin 사전 프로비저닝으로 P0-1(신규 웹 사용자 bootstrap 부재)을 우회하며, identity·moderation·결제 sandbox는 검증하지 않는다(감사 §2).
- **모노레포**: `apps/mobile`(Expo SDK 57) · `apps/web`(Next.js 15) · `packages/{domain,contracts,config,ui-tokens,data,adapters}` · `supabase/`. pnpm hoisted.
- **백엔드**: hosted Supabase(ref `oknolcxsvogrhnxnyosr`). 마이그레이션 **0001~0010** 배포. 모든 상태 전이는 SECURITY DEFINER RPC — submit/preview/claim/approve(+공개기간)/exclude_pitch_asset/submit_interest/list_campaign_interests/decide_interest/list_my_intro_rooms/leave_intro_room/set_campaign_status/track_event. 클라이언트 campaigns 쓰기 그랜트 전면 회수.
- **웹 표면**: `/p/[slug]`(실데이터+fixture fallback), `/p/[slug]/interest`, `/consent/[token]`, `/inbox`(관심 인박스+캠페인 관리), `/rooms`·`/rooms/[id]`(채팅), API `/api/transcribe`(OpenAI 전사→구조화 초안, 키 없으면 501), `/api/revenuecat`(웹훅, 토큰 없으면 501).
- **어댑터**: `FRIENDWORD_PROVIDER_MODE=real` + OPENAI_API_KEY → 실 OpenAI 전사/구조화/모더레이션. identity는 Unconfigured(호출 시 명시적 실패 — 절대 fake 안 함).
- **이메일**: Resend SMTP 검증 완료, confirmation/magic_link 템플릿 코드 관리(`supabase config push`, 반영 ~10분), OTP 왕복 프로덕션 검증.
- **RevenueCat**: SDK·페이월(`/paywall`)·웹훅·크레딧 원장·엔타이틀먼트 코드 완성. 활성화는 사용자 셋업 대기(`docs/REVENUECAT_SETUP.md`).
- **analytics**: `track_event` RPC(화이트리스트·2KB 캡·서버 스탬프) + 퍼널 전 구간 이벤트 배선.
- **실행 환경**: tmux `friendword-web`(:3000) · `friendword-mobile`(expo). `apps/web/.env`·`apps/mobile/.env`는 루트 `.env` 심링크.
- **검증 명령**: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` · `bash scripts/test-db.sh`(suite 01~10) · `cd apps/web && pnpm test:e2e`(10) · `node scripts/e2e-production.mjs`(39, dev 서버 필요) — 전부 그린.

## DONE (이번 세션, 2026-07-13)

- Slice 5B-1/5B-2: 웹 동의 플로우 + `/p/[slug]` 실데이터 (`0845a37`, `5f9406d`)
- TODO 2: 이메일 템플릿 {{ .Token }} + OTP 왕복 실검증 (`fee2096`)
- Slice 6A/6B: 모바일 사진 업로드+`pitch_assets`+공유 화면, 동의·공개 페이지 사진 (`52e00c9`)
- Slice 7: verified interest 전체(0006) + `/p/[slug]/interest` + `/inbox` (`dd5f072`)
- Slice 8: Intro Room 채팅·신고·차단·나가기(0007) + `/rooms` (`259eaac`)
- Slice 9: 캠페인 라이프사이클(0008) + `docs/OPS.md` 운영 런북 (`919b0f9`)
- Slice 11: analytics 파이프라인(0009) + 전 표면 이벤트 (`7667cad`)
- Slice 12: OpenAI 어댑터+`/api/transcribe`, 사진 제외·공개 기간(0010), E2E 스크립트 repo 편입 (`5000951`)
- Slice 10: RevenueCat SDK·페이월·웹훅 (`2eb67e7`)

## TODO (감사 대응이 최우선 — 상세는 감사 문서 §5~§8)

1. **(진행 중) 감사 Slice A~J 실행** — 현재 진행 상황은 `docs/TASKS.md`의 2026-07-13 감사 대응 표 참조. 출시 차단 P0: ① 웹 사용자 bootstrap ② claim/verified 실증 ③ 동의 snapshot 불변화+AI 순서 ④ 유료 상품 효익+웹훅 정합성 ⑤ moderation/report/delete ⑥ OG/CTA/growth ⑦ 환경·CI 게이트 ⑧ Verified Interest 서버 증거 ⑨ 실캠페인 fixture 오용
2. **(사용자·출시 게이트) Resend 도메인 인증** — 도메인 인증 + SMTP sender 교체 전엔 실사용자 로그인 불가
3. **(사용자) OPENAI_API_KEY 입력** — 넣는 즉시 `/api/transcribe`가 실전사·구조화 초안 생성 (지금은 501)
4. **(사용자) RevenueCat 셋업** — `docs/REVENUECAT_SETUP.md` 체크리스트. Shipaton 필수. Slice E/F 완료 전에는 "결제 완료" 주장 금지
5. **(사용자+Advisor·출시 게이트) 신원 확인 공급자 선정** — Slice C의 하드 게이트. selfie liveness/face match 벤더 결정 + 키 입력 → `UnconfiguredIdentityVerificationProvider` 교체
6. **(사용자) `EXPO_PUBLIC_WEB_ORIGIN` 설정** — `pnpm check:env` 현재 실패, 실기기 공유 링크가 localhost로 fallback (감사 P0-7)
7. **(P2·Slice F와 연동) 9:16 모션 피치 MP4 export** (media-worker) — Creator Launch 효익의 핵심이므로 P2가 아닌 Slice F 범위로 승격됨
8. **(보류·7월 중하순 재판단) App Store 출시 준비** — 18+ 나이 게이트, dev build, EAS, 심사 메타데이터. 데이팅 4.3(b)+UGC 리스크 대응 포함
9. **(게이트)** Devpost 공식 Rules 게시 시 `docs/HACKATHON_RULES.md` 재확인

## IMPORTANT DECISIONS

- **감사 채택 (2026-07-13)**: `docs/FRIENDWORD_AUDIT_HANDOFF_2026-07-13.md`를 현행 작업의 source of truth로 채택. 실행 순서 A→J 고정, 회귀 스위트(`supabase/tests/audit/`, `pnpm test:audit`)는 기대 동작을 인코딩하며 초기 FAIL이 정상, Slice J에서 CI 편입. 상세는 `docs/DECISIONS.md` 2026-07-13 항목
- **워커 운영**: 2026-07-13부터 codex 워커 협업 재개 (`friendword-codex-1/2/3`). 단독 모드는 2026-07-12~13 코어 루프 구축 구간의 한시 조치였음
- **출시 일정**: App Store 심사 준비는 보류(출시 창구 8/1~9/30, 아직 여유). 개발·보완 우선 (2026-07-13 사용자 결정)
- **보안**: API 키·토큰 값은 사용자가 직접 입력. Claude는 위치만 안내
- **디자인**: "Hype Mixtape" (크림+탠저린/핫핑크/선샤인, 스티커 미학, Unbounded+Bricolage). 웹 공용 스타일 `apps/web/src/styles/flowCard.module.css`
- **아키텍처**: 상태 전이는 전부 RPC. 동의 토큰 raw 1회+sha256. 스토리지 버킷 `pitch-media`(draft 폴더)·`profile-media`(user 폴더, 관심 수신 Dater만 열람). 웹 세션 storageKey `friendword-web-auth`. 채팅은 4초 폴링(텍스트 전용)
- **정직성 원칙(무mock)**: 미설정 기능은 501/명시 안내로 노출 — 전사(키 대기), 결제(셋업 대기), 신원(벤더 대기). fake 완료 경로 없음
- **테스트**: 로컬 PG17 하니스(suite 01~10), CI postgres:17, 프로덕션 풀퍼널 E2E `scripts/e2e-production.mjs`

## ISSUES / RISKS

- Resend 샌드박스 → 도메인 인증 전 타 사용자 이메일 발송 500 (출시 게이트 1)
- 이메일 템플릿 config push 후 auth 서비스 반영 ~10분. config.toml에 원격 값 미러링 필수, SMTP 크리덴셜 금지
- App Review 리스크(데이팅 4.3b + UGC): 심사 준비는 보류 상태지만 8/1~9/30 창구를 놓치면 참가 자격 상실 — 7월 중하순에 준비 착수 시점을 다시 판단할 것
- `database.types.ts` 수동 부분 타입 — 테이블·RPC 추가 시 갱신 필수
- 시뮬레이터 인터랙션 QA는 사용자 손 테스트(모바일 사진 업로드→공유 화면 경로는 코드 검증만 됨, 손 QA 권장)
- plpgsql 함정: `#variable_conflict use_column`; publish 전 consent approved 트리거(0001); RPC 시그니처 변경은 DROP 후 CREATE(기본값으로 하위 호환)
- 만료 캠페인은 읽기 필터로만 처리(status는 published 유지) — 자동 전이는 TODO 8

## LOG SUMMARY

2026-07-12~13 연속 세션. 빈 repo → 코어 루프의 UI·데이터 골격 구축(커밋 9개, CI 그린): 웹 동의/실데이터 → 이메일 검증 → 사진 파이프라인 → interest → Intro Room → 라이프사이클+운영 → analytics → 전사+동의 심화 → RevenueCat scaffold. 마이그레이션 10개 배포, DB 스위트 10, Playwright 10, 프로덕션 E2E 39체크.
2026-07-13 오전: 1차 전수 감사 수행(외부 감사, `5c367ff` 기준) — 판정 "기능성 알파, 출시 경계 미완성". 감사 대응 세션 시작: Slice A(문서 truth reset + 회귀 스위트) 착수, codex 워커 3기 재가동.
