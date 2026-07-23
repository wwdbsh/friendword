# 실기기(TestFlight) 내부 QA 체크리스트

> 4차 감사 배포 판정 준수: **본인 단독 내부 QA만** — 테스트 계정·가짜 데이터, launch gate off 유지, 외부 테스터 초대·실사용자 데이터 금지. beta gate가 off이므로 **발행·공개 열람·관심 제출은 draft 단위 allowlist 필수**:
>
> ```sh
> set -a && source .env && set +a
> node scripts/qa-preview-allowlist.mjs find <헤드라인일부|slug>
> node scripts/qa-preview-allowlist.mjs add <pitch_draft_id> "device QA"
> node scripts/qa-preview-allowlist.mjs list|remove ...
> ```

## 사전 조건

- TestFlight 빌드에 `EXPO_PUBLIC_WEB_ORIGIN`·`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` 포함(EAS production env). 커밋 `03a8adf`(사인인 CTA·헤더 수정) 이후 빌드인지 확인.
- AI 플로우를 보려면 Vercel `OPENAI_API_KEY` 설정(없으면 501 — manual 경로만).
- 테스트 계정은 Gmail 별칭(`wwdbsh+qa1/qa2/qa3@gmail.com` 등), 실계정 사용 금지.

## 1부 — Introducer (앱)

1. 스플래시/아이콘/홈 렌더, 헤더(백 라벨 누출 없음) 확인
2. qa1 별칭으로 SignInSheet 가입/로그인 (campaigns 화면 "Sign in" CTA 동작 확인)
3. Pitch a friend → 관계 → 30초+ 녹음(AI 동의 화면) → 사진 1~4장 → 제출
4. **draft 헤드라인을 Advisor에 전달 → allowlist 등록 후 진행**
5. consent 초대 링크 복사

## 2부 — Dater (아이폰 Safari)

6. qa2로 consent 링크 → 매직링크 로그인 → 6단계 검토(문구/사진/About you/공개설정/claims/실 프리뷰) → 승인·발행
7. `/p/[slug]` 시크릿 탭 무가입 열람

## 3부 — Interest → Intro Room

8. qa3로 공개 페이지 → I'm interested → 프로필(사진2·bio·intent·생년) → 제출
9. qa2 웹 inbox 수락 → Intro Room 채팅 왕복 → 신고/차단/나가기 확인

## 4부 — 결제 표면 (관찰만)

10. paywall 열림·상품 2개 로드 확인. **구매 버튼은 누르지 않는다** — sandbox 구매 왕복은 Advisor가 게이트 드릴(real_payments on→검증→off 원복, OPS.md 게이트 SQL)과 함께 진행. 구매 시 Apple 로그인 시트에는 ASC 샌드박스 테스터 계정 사용.

## 기록

발견한 어색함·깨짐은 스크린샷과 함께 수집 — 4차 감사 Slice 8(대표 데모·디자인 QA) 입력이 된다.
