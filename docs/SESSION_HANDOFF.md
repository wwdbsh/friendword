# PROJECT HANDOFF

> 갱신: 2026-07-13 KST · 2차 감사 대응 (Slice 0~**8** 완료 · Slice 9 진행 예정)

## Slice 8 완료 (CP-3·CP-4·Creator kit e2e)

- Blair 데모의 가짜 재생 제거: no-audio pitch는 Play/타임라인 없이 전체 서면 피치+정직 표기 렌더. 랜딩 데모 밴드 카피 정직화.
- 영어 기본 locale: 랜딩·OG·모바일 잔여 문자열 영어 전환. Playwright에 `lang="en"`+한글 0자 회귀(§8-16), 데모 무재생 회귀(§8-15). 남은 한글은 코드 주석의 문서 섹션명 인용뿐.
- Creator kit e2e: 프로덕션 E2E 10g~10j(재구매→unlock 1회 소비→재진입 idempotent→9:16 카드 렌더).
- 검증: Playwright 39/39 · E2E 전 체크 PASS · 전 게이트 그린 · 브라우저에서 영어 랜딩·정직 데모 QA.

> 읽는 순서: 이 문서 → [`docs/FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md`](FRIENDWORD_SECOND_AUDIT_HANDOFF_2026-07-13.md)(**acceptance source of truth**) → `docs/TASKS.md` → `docs/DECISIONS.md`(이번 세션 결정 8건) → `docs/OPS.md`, `docs/REVENUECAT_SETUP.md`

## 다음 세션 시작 방식 (사용자 확정, 2026-07-13)

- **2차 감사 §7 순서로 Slice 7 → 8 → 9 → 10을 이어서 완주한다.** Slice 0~6은 승인 완료. Slice 7은 서버 골격이 이미 그린 상태로 커밋돼 있다(아래 "Slice 7 groundwork" 절).
- 작업 체제 동일: Advisor(직접 구현 병행) + `friendword-codex-1`. **codex가 usage limit에 걸리면 Claude Opus worker 2명을 생성해 3인 분업**(사용자 지시, memory에도 기록됨).
- 완료 판정은 항상 2차 감사 acceptance 기준. §11 완료 주장 금지 목록과 §12 승인 형식 준수.

## 이번 세션에서 한 것 (2차 감사 Slice 0~6)

| Slice | 내용                                                                                                                                              | 핵심 커밋                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 0     | launch gates(0023: 실결제·공개베타 서버 차단, hosted 기본 off), audit2 실패 회귀 스위트(`test:audit2`), truth reset                               | e9de0de, 7fe7c5a           |
| 1     | P0-1 신고 dedupe·distinct identity pause·proxy trust(0024), H-1 restrictive read+API 계정 가드, 브라우저 dedupe 실검증                            | 236d5de                    |
| 2     | P0-2 voice transcript moderation(전사 라우트가 verdict 승격), H-3 text_moderations 원장+게이트(0026), 길이·rate·quota(0025, 워커), orphan cleanup | 5a59b4e, 0d66cd7           |
| 3     | P0-3 실이벤트 계약+`purchase_event_reviews` durable 큐(0027)+route 재작성, P0-4 SDK identity 동기화(워커)                                         | 451b28e, 8f4bf3a           |
| 4     | P0-5/P0-6 중복 구매 서버 거부+intent 재사용(0028), unlocked kit 재진입, Campaign Pass 모바일 진입(워커), CP-5/6 정직 축소 확정                    | fd5a6f9, ea946fd           |
| 5     | P0-7 contact binding invariant(0029 트리거+claim fail-closed), P0-8 typed identity evidence(0030, face_match 사진 결합 publish 트리거)            | 3bdf089                    |
| 6     | P0-9 usage reserve/reconcile·월간 cap($200)·kill switch·시간당 quota(0031), P0-10 AI 동의(서버 게이트+모바일 disclosure, 워커), H-2 삭제 FK 순서  | (이 세션 마지막 커밋 참조) |

**증거**: DB 스위트 01~18 그린 · 1차 audit 7/7 · **audit2 11/12** (남은 red는 b10 만료 상태기계 — Slice 9 대상) · 웹 audit 11/11 + audit2 8/8 · 유닛(전 워크스페이스) 그린 · Playwright 35/35 · 프로덕션 E2E 21체크 전부 PASS(launch gate 토글 포함) · migrations **0001~0032 hosted 배포 완료**.

## Slice 7 완료 (CP-1·CP-2)

- 서버(0032, hosted 배포됨): `pitch_drafts.transcript`+revision snapshot 트리거, `create_dater_revision`, `set_publish_preferences`, dater 사진 업로드 정책, approve의 preference 복사(7일 허용), `interests_audience_gate`.
- 웹 ConsentFlow(codex-1, `.briefs/29`): "Make it yours" 텍스트 편집→새 immutable revision, 본인 사진 업로드(+`/api/media/validate`), 공개 설정(7/14일·city/region/hidden·나이·intent), 프로필 요약, approve가 선택 기간 전달. **함정: revision의 included_asset_ids는 voice 포함 전체 asset 집합** — 사진만 넘기면 approve가 voice를 삭제한다.
- 공개 페이지: 승인 body 섹션 + `<details>` 전체 transcript, 실 세그먼트 caption, trust 카피를 실제 통제권 범위로 갱신.
- 검증: audit2 **12/13**(신규 b13 그린, 잔여 red는 b10뿐) · 프로덕션 E2E 전 체크 PASS(신규 6h/6i/6j/8c/8d/10c/10d) · 전 게이트 그린 · 실브라우저에서 세션 주입으로 편집→7일/hidden 설정→발행→공개 페이지 QA 완료.

## Slice 8~10 요약 (감사 §7)

- **8**: Blair 데모 실음성 확보 또는 정직한 Play 제거(CP-3) · 영어 기본 locale 전환(랜딩 lang=ko!) + E2E 영어 회귀(§8-16) · Creator 결과물·공유 CTA e2e.
- **9**: server-authoritative analytics(§H-4, client outcome 이벤트 차단) · expire_due_campaigns(b10 그린 전환) · CP-7 컨텍스트 내비 · Trust Layer·접근성 QA(H-8).
- **10**: release gate 전체(§7 Slice 10 체크리스트) + audit2 CI 편입 + launch gate 해제 재판단.

## 작업 방식·함정 (이번 세션 추가 학습)

- 기존 세션 규칙 전부 유지(brief 패턴, 검증 규칙, DB push 클린 트리, dev 서버 1개).
- **게이트/트리거 패턴**: 강제는 RPC 재정의 대신 BEFORE 트리거(재정의에도 생존, direct insert 커버). RPC 재정의가 필요하면 최신 정의를 통째로 복사(0016/0017/0022가 최신이었음 — 이제 0027~0032가 최신).
- plpgsql: `NOT IN`은 NULL에서 raise 안 함(`IS NULL OR NOT IN` 필요), 파라미터/컬럼 충돌은 파라미터명 자체를 다르게, ON CONFLICT 컬럼 리스트도 충돌 대상.
- Next route 파일은 HTTP 메서드 외 export 금지(헬퍼는 src/lib로).
- 테스트 fixture가 구계약을 고정하고 있으면 새 계약으로 갱신하고 DECISIONS에 기록(이번 세션: 14/17/a04/a08 등 다수 이행 완료).
- `service_role`은 purchase_intents 등에 INSERT 권한 없음 — 테스트 fixture는 superuser 구간에서 삽입.
- audit2에서 트리거 이전 상태(legacy row)가 필요하면 `ALTER TABLE … DISABLE TRIGGER` 패턴 사용(b05, 12 참조).
- 워커 codex-1 컨텍스트가 ~30%까지 소모됨 — 다음 세션 시작 시 `/compact` 또는 새 codex 세션(OmO 훅 부재 확인) 고려.

## CURRENT STATE

- 제품 판정: **기능성 베타 — 실결제·외부 공개 서버 차단 유지**(`real_payments_enabled`/`public_beta_enabled` off). 해제는 Slice 10 release gate 통과 후.
- 사용자 키 게이트(변동 없음): identity 벤더, OPENAI_API_KEY, RevenueCat 셋업+dev build(sandbox 왕복 검증), Resend 도메인, `EXPO_PUBLIC_WEB_ORIGIN`.
- 신규 운영 표면: `purchase_event_reviews` 큐, provider 비용 원장·kill switch, launch gates, orphan cleanup — 전부 `docs/OPS.md` 런북에 절차 있음.
- 잔여 리스크: 모바일 손 QA(시뮬레이터 시각 검증)는 Slice 10 기기 패스로 이연 · RevenueCat sandbox 실왕복 미검증(코드 게이트는 해소) · b10(만료) red · 랜딩 여전히 한국어(Slice 8).
