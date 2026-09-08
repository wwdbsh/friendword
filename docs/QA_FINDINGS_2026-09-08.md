# Friendword QA 결과 — 2026-09-08 (Phase 1–2, Claude 자율 QA)

## 실행 환경

- Web: 프로덕션 https://friendword.com, Playwright Chromium 격리 프로필(qa1/qa2/qa3/anon), iPhone 뷰포트
- Mobile: Xcode iOS 26.5 시뮬레이터 iPhone 17 Pro Max, `expo run:ios` 디버그 빌드 (Xcode NODE_BINARY→/opt/homebrew/bin/node)
- 계정: wwdbsh+qa1(Introducer) / +qa2(Dater, 7월 QA 프로필 "Jordan") / +qa3(Interested, 7월 QA 프로필 "Alex")
- 산출물: 캠페인 `jordan-5k4udr` (draft 9d30a21e…, 만료 2026-09-15), 렌더 잡 2206a643…, export.mp4

## 게이트 (Phase 1)

build ✅ typecheck ✅ lint ✅ format ✅ pkg tests 916 ✅ DB/RLS 34 ✅ audit3 233 ✅ UI 96 ✅(수리 후, PR #68) render 98 ✅ e2e 117 ✅
e2e-production.mjs: 66/68 PASS — 6h/10d FAIL = 오래된 테스트(0032/0050 transcript 동결 설계와 불일치), 회귀 아님

## 실증된 것 (프로덕션)

앱 창작(6트랙) → 동의 링크 → 웹 Dater 로그인(8자리 코드) → 리뷰·승인·발행 → 공개 페이지(무가입) → 관심 표현(프로필+AI 동의+moderate-text 200) → 알림 메일 실도착(관심 도착/수락) → 인박스 수락 → 인트로 룸 양방향 채팅 → 신고/차단/나가기 UI → kit MP4 렌더(3.5분, 6.96MB, 1080×1920) → same-origin 다운로드

## 결함

### High

- H-1 무음/빈 전사에도 AI가 피치를 지어냄. transcript.text=". . ." 인데 headline/anecdote/qualities 생성, hard_claims=[]; Dater 리뷰·공개 페이지·MP4까지 전파. 증거: pitch_drafts 9d30a21e, 스샷 sim-ai-result.png
- H-2 소개자 이름이 이메일 로컬파트로 공개됨. profiles.display_name 기본값=이메일 로컬파트(display_name_confirmed=false), 앱에 이름 입력 단계 없음 → 공개 페이지 "WWDBSH+QA1 INTRODUCES", 동의 페이지, 알림에 노출. 증거: anon-01-public-page.png, profiles 조회
- H-4 MP4 비디오가 오디오보다 짧음. scene durationMs=37660(전사 마지막 세그먼트 끝) vs 오디오 54.5s → video stream 39.17s(엔드카드 포함) + 15s 오디오만 남음. 웹 플레이어도 같은 timeline. 증거: ffprobe export.mp4, consent_revisions.scene_definition

### Medium

- M-1 Account 진입 로그인 시트 문구가 피치 제출 맥락("Sign in to send it", "Verify and send pitch")
- M-2 Account 화면에서 로그인 성공 후 화면이 갱신되지 않음(뒤로 갔다 재진입해야 반영). 스샷 sim-account-after-signin-stale / sim-account-reentered
- M-4 사진 선택이 '보관함 전체 접근' 권한 요청 — PHPicker면 권한 불필요(심사·전환율)
- M-7 Dater 동의 Step 3에 표시 이름 확인 없음 — 기존 프로필 이름(Jordan)이 소개자가 적은 이름(Sumin) 대신 그대로 공개
- M-8 My campaigns의 Live 피치 카드가 "0 photos · No voice track" 표시(실제 2장·54초)
- M-9 결제 화면에 RevenueCat SDK 원문 오류/URL 노출("There is an issue with your configuration… rev.cat/…")
- M-10 kit 존재하지 않는 id에 "We hit a snag… Refresh to try again"(영구 오류에 재시도 유도)

### Low

- L-1 robots.txt / sitemap.xml 404
- L-2 First name 입력 placeholder "J o r d a n" 자간 이상
- L-3 e2e-production.mjs 6h/10d 기대값 갱신 필요(전사 동결 설계 반영), 게이트 원복 로그 없음
- L-4 CI 워크플로 비활성(ci.yml) — 머지 게이트 없음
- L-5 PRODUCT.md에 MP4 내보내기 "미구현" 표기(실제 완료) — 문서 드리프트
- L-6 handoff §4 Node 22 → 이 머신 Node 26 / brew node@22 깨짐(simdjson)

### 확인됨/비결함

- 7월 실기기 캠페인(jordan-ba9m1u) 전사 585자 정상 → 전사 파이프라인 자체는 정상, 시뮬레이터 마이크는 무음
- 동의 페이지 첫 클레임 "Unlocking your review…" 6초+ (P-1, 관찰만)
- 초대 이메일은 발송되지 않고 링크 공유 방식(설계)

## 미검증(대체 불가)

- 실 스토어 sandbox 구매/restore/환불(웹훅 재생은 가능)
- 실기기 마이크 녹음 품질, iOS Safari blob 다운로드
- App Store 제출

## 추가 발견 (3단계 중)

- H-5 **Vercel 프로덕션 배포가 8/12 이후 전부 실패** — `packageManager: pnpm@11.12.0`을 Vercel이 "broken release"로 거부(`pnpm install` exit 1). PR #68·#81이 배포되지 않은 채 friendword.com은 8/12 빌드. 알림 없음(배포 실패 감시 부재). 핫픽스 PR #82(pnpm@11.26.0). 후속: 배포 실패 알림(GitHub deployment status → 이메일/Actions) 필요 → T007 범위에 추가.
- T002 처리 중 확인: Dater 이름 확인 단계는 이미 존재(M-7 기각), 대신 웹 동의·관심 플로우가 이메일 로컬파트를 **프리필**하던 문제를 수정(PR #81).
- L-8 Vercel 프로젝트가 둘(`friendword-web`, `friendword-web-nmsi`) — 매 push마다 두 번 빌드. 어느 쪽이 friendword.com을 서빙하는지 확인 후 중복 제거(T007).
- 2026-09-08 11:xx: 핫픽스 #82 배포 성공(두 프로젝트 모두), 0061 hosted 적용 완료, anon get_consent_preview → "Minji"(확정 이름) 확인.
- M-11 모바일 AI 초안 실패 배너에 **스택 프레임(entry.bundle:248152…)이 사용자에게 노출** — errorDiagnostics의 B4 계측(의도적)이지만 스토어 빌드에선 숨겨야 함(T004 범위에 추가).
- 2026-09-08 12:0x T001 프로덕션 실증: 무음 37s 테이크 → `/api/transcribe` 422 insufficient_speech, voice.m4a 삭제 확인(스토리지 목록), 앱에 "We couldn't hear enough…" 카드 표시 ✓. **그러나 모바일 복구 경로 결함(H-6)**: (A) 새 초안 경로에선 위저드가 Track 1로 초기화되고 로컬 초안 CTA가 사라짐, (B) 재개 경로에선 카드 표시 후 수 초 뒤 빈 화면. 후속 PR(task/T001-followup-rerecord)로 수리 중.
- M-13 웹 동의 승인 시 비즈니스 규칙 거부("owner already has an active campaign; only one…")가 사용자에게 **"We hit a snag… Refresh the page"** 일반 오류로 보임. 실제 원인(이미 라이브 페이지가 있음 → 먼저 내려야 함)을 말해야 함. (T006 범위에 추가)
- 2026-09-08 12:5x 프로덕션 재QA(T001~T003 배포 후): 실제 음성(TTS 40.6s) → transcribe durationMs=40530 저장 → mobile 방식 scene(40530ms, 14 shots) 제출 → DB assert 통과 → 승인·발행(jordan-tbn8xp) → 공개 페이지: 이메일 누출 0, "MINJI INTRODUCES", 실제 전사 내용 표시 ✓. 렌더 ffprobe 진행 중.
- M-15(nit) 소개자가 적은 이름("Haneul")과 Dater 확정 이름("Jordan")이 다를 때 동의 단계에서 불일치 안내 없음 — 공개 페이지에 "introducing my friend Haneul … Jordan, 30"이 공존. QA 계정 재사용 상황이지만 실사용에서도 가능(별명 vs 본명).
- 확인: "Take it down for good"는 window.confirm 사용(정상), 웹 동의 승인 실패 문구 M-13은 T006에.
- M-16(nit) 폰에서 로그아웃(글로벌)하면 웹 세션의 access token은 만료 전까지 페이지·RPC는 동작하지만 `render-download`(getUser 세션 검증)는 401 → "The download didn't complete. Please try again." 일반 문구. 401이면 재로그인을 안내해야 함. (원인은 제 QA 조작; 제품 문구만 개선 대상)
- 2026-09-08 13:1x **H-4 해소 실증**: jordan-tbn8xp 렌더(rev cc5d7313) ffprobe → video 42.033s / audio 40.539s (엔드카드 1.5s 포함, video ≥ audio) ✓. 4.19MB.
- 확인 필요(M-17 후보): 웹 "Email me a sign-in link"(magic link, redirect_to 포함)를 13:01·13:02에 요청 → OTP 200이지만 15분 내 Gmail 미도착(앱 8자리 코드 메일은 수초 내 도착). Supabase 매직링크 발송/전달 지연 또는 주소별 rate limit 의심 — T007에서 로그·설정 확인.

## 해소 대조표 (Goal #69 종료 시점, 2026-09-08)

| #                    | 결함                                                          | 처리                                           | 증거                                                                                    |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| H-1                  | 무음 전사에도 AI가 피치 생성                                  | 수리·배포 (#83, #84)                           | 프로덕션 422 `insufficient_speech` + voice.m4a 삭제 + Track 4 복귀(시뮬레이터)          |
| H-2                  | 소개자 이메일 로컬파트 공개                                   | 수리·배포 (#81, 0061)                          | 공개 페이지 "MINJI INTRODUCES", HTML에 로컬파트 0회, anon get_consent_preview 확정 이름 |
| H-4                  | MP4 비디오 < 오디오                                           | 수리·배포 (#85, 0062)                          | ffprobe video 42.03s / audio 40.54s                                                     |
| H-5                  | Vercel 배포 8/12 이후 실패                                    | 수리 (#82)                                     | 이후 모든 배포 success                                                                  |
| H-6                  | 거부 후 모바일 복구 경로                                      | 수리 (#84) + 원인 절반은 Metro 재로드 아티팩트 | 조용한 트리에서 40s 안정                                                                |
| M-1/M-2/M-8/M-9/M-11 | 앱 표면 5건                                                   | 수리·배포 (#86)                                | 시뮬레이터 전후 스크린샷                                                                |
| M-4                  | 사진 전체 접근 권한                                           | 수리·배포 (#87)                                | PHPicker 배너, 다이얼로그 없음                                                          |
| M-10/M-13/M-16/L-1   | kit·동의 문구, robots/sitemap                                 | 수리·배포 (#90)                                | 라우트 200, e2e 126                                                                     |
| M-7/M-15             | 입력 이름 vs 확정 이름 불일치 안내                            | 백로그                                         | —                                                                                       |
| M-17                 | 웹 매직링크 미도착                                            | 백로그(소유자 Supabase Auth 로그 확인)         | OPS.md 메모                                                                             |
| L-3/L-4/L-5/L-6/L-8  | e2e 스크립트·CI·문서·Vercel 중복                              | 수리 (#89) / 중복 프로젝트는 소유자            | e2e 68/68, CI verify pass                                                               |
| 미검증               | 실 스토어 결제, 실기기 마이크·Safari 다운로드, App Store 제출 | 사용자 항목                                    | LAUNCH_STRATEGY D4/D5                                                                   |
