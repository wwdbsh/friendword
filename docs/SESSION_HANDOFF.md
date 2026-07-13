# PROJECT HANDOFF

> 갱신: 2026-07-13 KST · **2차 감사 Slice 0~10 완주** (release gate 판정 완료 — launch gate는 off 유지)
> 읽는 순서: 이 문서 → [`docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`](FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md)(**acceptance source of truth**) → `docs/TASKS.md` → `docs/DECISIONS.md` → `docs/OPS.md`, `docs/REVENUECAT_SETUP.md`

## 완주 요약 (2차 감사 §7 Slice 0→10)

| Slice | 내용                                                                                                              | 핵심 커밋       |
| ----- | ----------------------------------------------------------------------------------------------------------------- | --------------- |
| 0~6   | launch gates·신고 방어·media/UGC·RevenueCat 계약·유료 1:1 가치·contact binding·identity evidence·비용 cap·AI 동의 | e9de0de~a417930 |
| 7     | CP-1/CP-2: 0032 dater 통제(RPC+웹 ConsentFlow 편집·사진·공개설정), 공개 body+transcript 렌더, b13                 | dddaf2d         |
| 8     | CP-3/CP-4: 가짜 재생 제거·정직 데모, 영어 기본 locale(+한글 0자 회귀), Creator kit e2e                            | 9b29cbd         |
| 9     | H-4/H-5/CP-7/H-8: 0033 트리거 분석·track_event 축소·만료 상태기계·list_my_interests·모바일 컨텍스트·접근성        | ad3a38b         |
| 10    | release gate: audit2 14/14 CI 편입, hosted 드릴(kill switch·만료·삭제·orphan), **launch gate off 유지 판정**      | (이 커밋)       |

**증거**: DB 스위트 01~18 그린 · 1차 audit 7/7 · **audit2 14/14 전부 그린(CI 편입)** · 웹 audit 11/11+audit2 8/8 · 유닛 전 워크스페이스 그린(data 47·mobile 59) · Playwright 39/39 · 프로덕션 E2E 전 체크 PASS(dater 통제·영어·kit·서버 분석 포함) · migrations **0001~0033 hosted 배포 완료** · kill switch/만료/삭제/orphan hosted 드릴 클린.

## CURRENT STATE

- 제품 판정: **기능성 베타 — 실결제·외부 공개 서버 차단 유지**(`real_payments_enabled`/`public_beta_enabled` off). 코드·스키마·테스트 게이트는 전부 통과했고, 해제는 아래 사용자 게이트 5종 실증 후 재판단한다(DECISIONS "Slice 10 release gate 판정" 항목).
- **launch gate 해제 전 필수 사용자 게이트**: ① RevenueCat 셋업+dev build 후 sandbox 실왕복(purchase→restore→refund→transfer) ② identity 벤더 계약·키 후 enforcement on 실증 ③ OPENAI 키 후 moderation enforcement on 실증 ④ 실기기 iOS flow QA ⑤ Resend 도메인·`EXPO_PUBLIC_WEB_ORIGIN`.
- 분석은 server-authoritative: outcome은 0033 트리거(`recorded_by:"server"`)만 신뢰, client는 interaction 9종. 지표 정의·한계는 `docs/ANALYTICS_PLAN.md` "지표 정의" 절.
- 운영: `run-scheduled-ops.mjs`(만료+삭제+orphan)를 최소 일 1회 — 스케줄러 연결은 배포 환경 확정 후(OPS.md). kill switch 드릴 절차 검증됨.
- 다음 자연스러운 작업: 사용자 키 게이트 채우기(위 5종) → 해제 재판단 → 스토어 준비(18+ 온보딩·법적 문서·App Store 메타데이터, TASKS "보류" 행), Shipaton 창구는 8/1~9/30.

## 작업 방식·함정 (누적)

- Advisor(직접 구현 병행) + `friendword-codex-1`(brief 패턴, `.briefs/29`·`30`이 최신 예). 검증은 Advisor가 diff·테스트·manual QA 재실행 후에만 승인.
- 게이트/강제는 RPC 재정의 대신 BEFORE/AFTER 트리거(재정의 생존·direct insert 커버). 최신 RPC 재정의 시 최신본(0027~0033)을 통째로 복사.
- plpgsql: `NOT IN`+NULL, 파라미터/컬럼 충돌, ON CONFLICT 리스트 주의. `service_role`은 일부 테이블 INSERT 권한 없음(테스트는 superuser 구간).
- audit2에서 트리거 이전 상태가 필요하면 `ALTER TABLE … DISABLE TRIGGER`(b05).
- **dater revision의 included_asset_ids는 voice 포함 전체 asset 집합** — 사진만 넘기면 approve가 voice를 삭제한다.
- track_event는 outcome 이벤트를 거부한다 — 새 화면에서 성과 이벤트를 client로 보내지 말 것(트리거가 기록).
- DB push는 클린 트리에서만. dev 서버는 tmux `friendword-web` 1개 유지.
- 웹 수동 QA에 인증이 필요하면: 스크립트로 사용자·세션 생성 후 브라우저 localStorage `friendword-web-auth` 키에 setSession(스크래치패드 qa-setup 패턴).
