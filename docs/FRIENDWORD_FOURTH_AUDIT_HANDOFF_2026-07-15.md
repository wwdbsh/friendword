# Friendword 4차 종합 감사 핸드오프

> 감사 기준: 2026-07-15 KST, Git HEAD `1ca6810` (`Prefer selective EAS env registration over pushing the whole .env`)
>
> 최초 기획 기준: 최초 제품 핸드오프가 보존된 Git commit `4e37735`의 `FRIENDWORD_HANDOFF.md`
>
> 감사 범위: 3차 감사 수용 여부, 최초 제품 기획 전체, 음성→AI 구조화→세로형 피치/영상 파이프라인, Dater 동의, Verified Interest, Intro Room, 안전·비용·결제·성장·디자인·TestFlight 준비도
>
> 이 문서는 `SESSION_HANDOFF.md`를 대체하지 않는 **별도 감사 acceptance source**다. Claude 팀은 이 문서를 수정 작업 목록으로 사용하되, 각 수정 뒤 실제 diff와 테스트를 Advisor가 직접 검증해야 한다.

---

## 0. 감사 경계와 결론

### 0.1 고정 기준

- 감사 시작 시 저장소는 clean이었고 HEAD는 `1ca6810`이었다.
- 상헌 님과 다른 팀이 병행 중인 TestFlight 작업은 이 기준 이후 변경될 수 있다. 이 감사는 뒤늦게 생긴 커밋을 암묵적으로 승인하지 않는다. 작업 시작 전에 `git rev-parse HEAD`로 차이를 기록하고, 변경된 파일은 별도 재감사한다.
- 소스 코드는 수정하지 않았다. 이 감사 문서만 추가한다.
- hosted production E2E는 실제 외부 상태를 변경하므로 이번 읽기 중심 감사에서 재실행하지 않았다. 로컬 DB·웹·브라우저 검증은 직접 실행했다.

### 0.2 냉정한 최종 판정

현재 Friendword는 **기능성 내부 베타 골격**은 상당히 잘 만들어졌지만, **최초 확정 기획을 충족한 제품**, **외부 공개 가능한 안전한 베타**, **Grand Prize 제출 준비 완료** 중 어느 것으로도 승인할 수 없다.

잘 구현된 중심 골격은 분명하다.

- Introducer가 30~~60초 원본 음성을 녹음하고 사진 1~~4장을 제안한다.
- 외부 AI 동의 뒤 실제 OpenAI Whisper 전사와 segment timestamp, GPT 구조화 JSON을 만든다.
- Introducer가 headline/body와 구조 필드를 편집한다.
- Dater가 초대를 claim하고 headline/body, 포함 사진, 본인 정보, 공개 범위·기간을 검토한다.
- 승인 뒤 앱 설치 없이 공개 링크를 보고, 프로필을 갖춘 사용자가 관심을 표현하며, Dater가 수락하면 text-only Intro Room이 열린다.
- contextual role, Dater 소유권, 독립 상품 구조, public beta gate, RevenueCat ledger의 큰 틀은 유지된다.

하지만 핵심 계약에서 다음 세 가지가 무너져 있다.

1. **Dater가 승인한 내용과 실제 공개되는 내용이 같지 않다.** Dater는 headline/body만 편집하지만 공개 페이지는 별도의 AI structure와 원문 transcript를 노출한다. 이 structure는 Dater가 보거나 편집하지 않고 moderation에도 포함되지 않는다.
2. **최초 차별점인 AI 구조화 세로형 모션 피치/영상이 구현되지 않았다.** 현재 결과물은 원본 음성 + 업로드 순서 사진 크로스페이드 + segment 자막의 웹 오디오 슬라이드쇼이며, 구조 필드는 플레이어 아래 정적 카드다. `media-worker`는 비어 있고 MP4 산출물은 없다.
3. **Verified Interest, 비용 하드캡, 결제 복구에 새로운 P0 우회가 있다.** 관심 제출 뒤 프로필을 미검증 내용으로 교체할 수 있고, 미디어 검증은 파일 내용이 아닌 경로만 신뢰한다. provider 재시도는 이전 attempt 비용을 지워 월 cap·시간 quota에서 누락한다. 미귀속 RevenueCat 구매 복구는 실제 효익을 만들지 않고도 review를 resolved로 닫을 수 있으며 Campaign Pass는 공개 기간과 entitlement 기간이 서로 다르다.

### 0.3 배포 판정

| 목표                                   | 판정            | 이유                                                                                                    |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Claude/EAS의 내부 TestFlight 빌드 생성 | **계속 가능**   | 설치·실기기 QA 채널 자체는 필요하다. 단 이 빌드를 제품 완성 증거로 간주하지 않는다.                     |
| 상헌 님 단독 내부 QA                   | **조건부 가능** | 테스트 계정·가짜 데이터, launch gate off를 유지하고 실제 사용자를 초대하지 않는다.                      |
| 외부 TestFlight 테스터 초대            | **차단**        | 동의 snapshot 불일치, interest moderation 우회, identity 부재, production origin/deep-link 위험이 있다. |
| public beta / App Store 공개           | **차단**        | 위 안전 P0, 실결제·identity·moderation·운영 증거가 없다.                                                |
| Shipaton Grand Prize 제출              | **차단**        | 실제 음성 대표 데모, 체험 가능한 judge flow, structured motion output, traction 증거가 없다.            |

---

## 1. 이번 감사에서 직접 확인한 증거

### 1.1 실행 결과

| 검증                                     | 결과                                              |
| ---------------------------------------- | ------------------------------------------------- |
| `pnpm lint`                              | PASS                                              |
| `pnpm typecheck`                         | PASS, 9개 workspace 범위                          |
| `pnpm test`                              | PASS, 217 tests                                   |
| `pnpm test:db`                           | PASS, migrations 0001~0041 적용 후 DB suites 통과 |
| `pnpm test:audit`                        | PASS, DB 7/7 + web 13                             |
| `pnpm test:audit2`                       | PASS, DB 14/14 + web 8                            |
| `pnpm test:audit3`                       | PASS, DB 11/11 + web 49                           |
| `pnpm --filter @friendword/web test:e2e` | PASS, Playwright 46/46, 1 worker                  |
| `pnpm --filter @friendword/web build`    | PASS, `.next-build` production build              |
| `pnpm format:check`                      | **FAIL**, 12개 파일                               |
| `pnpm check:env`                         | **FAIL**, `EXPO_PUBLIC_WEB_ORIGIN` 누락           |

포맷 불일치 파일:

- `apps/mobile/src/features/pitch/RecordingStep.tsx`
- `apps/web/app/api/og/route.tsx`
- `apps/web/app/consent/[token]/ConsentFlow.tsx`
- `apps/web/app/p/[campaignSlug]/page.tsx`
- `apps/web/src/pitch/scenes.ts`
- `apps/web/src/pitch/view.ts`
- `apps/web/tests/consent.spec.ts`
- `docs/OPS.md`
- `docs/SESSION_HANDOFF.md`
- `docs/TASKS.md`
- `scripts/demo-pitch/manifest.example.json`
- `scripts/seed-demo-pitch.mjs`

### 1.2 환경·TestFlight 기준 상태

비밀값을 출력하지 않고 설정 여부만 확인한 결과:

| 키                                   | 기준 HEAD 로컬 상태 |
| ------------------------------------ | ------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`           | set                 |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`      | set                 |
| `EAS_PROJECT_ID`                     | missing             |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | empty               |
| `EXPO_PUBLIC_WEB_ORIGIN`             | missing             |
| `OPENAI_API_KEY`                     | empty               |

`expo config --type public`도 `extra.eas.projectId`, `webOrigin`, `revenueCatIosApiKey`를 빈 문자열로 해석했다. EAS remote environment가 병행 작업에서 설정되었을 수 있으므로, Claude 팀은 **remote 설정 증거를 별도로 제출**해야 한다. 현재 저장소만으로는 production TestFlight bundle이 완전한 설정을 받는다고 증명되지 않는다.

### 1.3 실제 브라우저 확인

- landing은 데스크톱에서 브랜드 hierarchy, typography, cream/ink/tangerine/flirt 조합이 강하고 일반 데이팅 앱 복제처럼 보이지 않는다.
- `/p/demo-blair`는 정직하게 실음성이 없는 demo라고 알린다.
- 그러나 대표 demo는 한 카드 안에 긴 소개문 전체를 넣고, 390×844에서 written-pitch 영역과 `No voice recording…` 문구가 **60.89px 겹친다**.
- demo interest는 실제 flow로 가지 않고 “Blair는 실존 인물이 아님” 설명에서 종료된다.

---

## 2. 최초 기획 기준을 복원해야 하는 이유

현재 `FRIENDWORD_HANDOFF.md`는 최초 기획 원본이 아니다. commit `90e9516`에서 Creator Launch와 Campaign Pass의 초기 상품 계약을 “historical/post-launch”로 재분류하고 정적 MVP 계약을 canonical로 바꿨다. 이 변경은 당시 감사의 “구현하지 않은 가치를 판매하지 말라”는 정직성 요구에 대한 한 선택이었지만, 상헌 님이 이번에 요구한 것은 **최초 뼈대와 기획이 실제로 구현되었는지 확인하는 것**이다.

따라서 이번 감사의 제품 기준은 commit `4e37735`의 최초 핸드오프다. 현재 문서가 나중에 범위를 축소했다고 해서 최초 기획이 충족된 것으로 판정하지 않는다.

### 2.1 최초 차별화 계약

- 친구의 30~60초 실제 음성 + Dater 승인 사진·문구
- AI 전사와 구조화
- 9:16, 15~60초 세로형 피치
- 원본 음성, 승인 사진, 자막, kinetic text
- 생성형 얼굴·voice clone·lip-sync 금지
- Dater의 신원 확인과 공개 전 최종 통제
- 앱 설치 없는 외부 공유와 referral attribution
- 사진·bio·성인·전화 확인을 갖춘 Verified Interest
- 수락 뒤 private Intro Room
- 무료 핵심 루프, Introducer용 Creator Launch, Dater용 Campaign Pass

### 2.2 최초 상품 계약

Creator Launch $4.99는 Introducer가 특정 pitch 하나에 구매하는 일회성 상품이었다.

- premium motion theme
- AI 추가 composition
- 승인 뒤 server-rendered MP4 1회
- Instagram/TikTok/iMessage share kit
- end-card customization
- 승인 콘텐츠 기준 1회 regeneration

Campaign Pass $19.99는 Dater가 campaign 하나에 구매하는 30일 비자동 갱신 상품이었다.

- 30일 활성
- 승인된 Vouch Card 최대 5개
- source/view/interest/accepted intro analytics
- 관심 필터
- pause/resume 일정 관리
- 승인 version 선택
- 동적 web update
- 향상된 inbox/notification 관리

현재 두 상품은 각각 정적 PNG+caption pack, 30일 연장+기초 funnel+inbox section으로 축소됐다. 이는 코드가 거짓 광고를 하지 않는다는 점에서는 긍정적이지만, 최초 상품 가치와 Grand Prize 차별화가 구현되었다는 뜻은 아니다.

---

## 3. 최초 기획 전체 추적표

| 최초 요구                                 | 현재 증거                                                    | 판정                                                               |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| 하나의 User, contextual roles             | resource membership과 한 auth identity 사용                  | **코드 충족**, native auth 진입 부재로 UX 부분 충족                |
| 18+ 확인                                  | DOB 입력과 publish/interest 18+ DB gate                      | **부분 충족**, identity evidence와 결합되지 않음                   |
| 전화 OTP 또는 동등한 소유 확인            | email OTP/magic link만 실구현, phone claim은 “not available” | **미충족**                                                         |
| Introducer 친구/관계/초대 입력            | friend name, email, 관계 종류·기간                           | **충족**, phone 초대 미구현                                        |
| 사진 제안 1~4장                           | native picker/upload                                         | **충족**, server min/max·content version invariant 보강 필요       |
| 30~60초 원본 음성                         | recorder min/UI와 60초 auto-stop                             | **클라이언트 충족**, 서버 invariant 미충족                         |
| AI 전사                                   | 실제 Whisper `whisper-1`, verbose JSON segment               | **충족**                                                           |
| AI 구조화                                 | 실제 `gpt-4o-mini`, 확정 schema                              | **충족**                                                           |
| Introducer 편집                           | headline/body/structure editor                               | **충족**, structure 길이·필수·moderation 제약 없음                 |
| Dater invitation claim                    | contact-bound email claim                                    | **부분 충족**, phone/liveness 없음                                 |
| selfie liveness + face match              | schema/gate/adapter placeholder, enforcement off             | **미충족**                                                         |
| Dater가 모든 공개 문구 최종 승인          | headline/body만 편집, structure/transcript는 별도 공개       | **P0 미충족**                                                      |
| Dater가 사진 최종 선택                    | 포함/제외/대체 업로드                                        | **부분 충족**, reorder/crop/cover 지정 없음                        |
| Dater가 원본 음성 검토                    | playback과 change/decline 가능                               | **부분 충족**, 무음성 publish 가능, transcript 오류 확인 불가      |
| 9:16 structured motion pitch              | audio/photo crossfade player                                 | **핵심 미충족**                                                    |
| kinetic typography                        | 없음                                                         | **미충족**                                                         |
| semantic scene composition                | 사진을 시간/segment 수로 균등 배치                           | **미충족**                                                         |
| captions로 mute 이해 가능                 | segment가 있을 때만                                          | **부분 충족**, no-segment/manual 실패                              |
| 외부 HTTPS public link                    | Next.js public route                                         | **코드 충족**, production origin 누락                              |
| OG image/video                            | 동적 OG image                                                | **부분 충족**, video preview 없음                                  |
| noindex, pause/revoke/delete              | 구현                                                         | **충족**                                                           |
| referral/UTM                              | waitlist/referral claim                                      | **부분 충족**, install/native 경계 소실                            |
| Verified Interest 2 photos/bio/intent/18+ | 구현                                                         | **형식 충족**, snapshot/검증 TOCTOU로 안전 미충족                  |
| phone verification before interest        | 없음                                                         | **미충족**                                                         |
| Dater accept/decline/report               | 구현                                                         | **충족**, sender evidence 재검사 없음                              |
| Intro Room text chat/report/block/leave   | 구현                                                         | **코드 충족**, 발견 경로와 persistent link 부족                    |
| Free Starter full loop                    | 코드상 가능                                                  | **부분 충족**, auth/navigation/judge path 단절                     |
| Creator Launch original value             | static PNG 1장+captions                                      | **의도적 축소/최초 기획 미충족**                                   |
| Campaign Pass original value              | 30일+기초 funnel+inbox section                               | **의도적 축소/최초 기획 미충족**                                   |
| RevenueCat restore/refund/expiry          | state machine과 webhook code                                 | **P0 미충족**, review 복구·Pass 시간축 결함과 실 sandbox 증거 없음 |
| Vouch Card 1~5                            | 없음                                                         | **P1 미구현**                                                      |
| Introducer 가명 profile/badge             | 없음                                                         | **P1 미구현**                                                      |
| push notification                         | 없음                                                         | **P1 미구현**, 현재 비동기 UX에는 사실상 필요                      |
| growth evidence                           | server outcome exporter/waitlist                             | **부분 충족**, 실사용 traction 없음                                |

---

## 4. 출시 차단 P0 — 동의·안전·비용

### P0-1. Dater가 승인한 내용과 실제 공개 내용이 다르다

#### 증거

- Dater edit UI는 `headline`과 `body`만 제공한다: `apps/web/app/consent/[token]/ConsentFlow.tsx:1118-1151`.
- `create_dater_revision`은 새 headline/body를 저장하면서 `structure`와 `transcript`는 이전 revision 값을 그대로 복사한다: `supabase/migrations/0041_dater_profile_and_location.sql:241-270`.
- 공개 페이지는 `structure != null`이면 Dater가 수정한 `approvedBody`를 숨기고 structure의 hook/context/qualities/anecdote/good_match를 렌더한다: `apps/web/app/p/[campaignSlug]/page.tsx:132-178`.
- 공개 플레이어는 Dater가 편집한 body가 아니라 원본 transcript segments를 자막으로 렌더한다: `apps/web/src/pitch/view.ts:141-175`.
- 전체 transcript도 public `<details>`에 노출되지만 Dater consent 화면은 transcript text를 보여주거나 수정하게 하지 않는다.
- Consent UI는 “Edit every word”, “exactly what people will see”라고 말한다: `ConsentFlow.tsx:1090-1092,1539-1551`.
- public copy도 “every word here was reviewed and approved”라고 단정한다: `page.tsx:180-184`.

#### 실제 영향

Dater가 body에서 민감한 일화나 부정확한 사실을 삭제해도 이전 AI structure와 transcript에 남아 공개될 수 있다. Whisper 오인식도 Dater가 문구로 검토하지 않은 채 public transcript가 된다. 이는 단순 UX 불일치가 아니라 동의·개인정보·신뢰의 핵심 위반이다.

#### 완료 기준

1. 하나의 immutable `PublishedPitchSnapshot` 또는 versioned `PitchComposition`을 canonical public source로 만든다.
2. snapshot에는 headline, 모든 공개 structure fields, transcript/captions, asset IDs+content version/hash, scene plan, theme/version을 포함한다.
3. Dater가 실제 공개되는 **모든 문구**를 보고 편집/제외/승인할 수 있어야 한다.
4. consent preview와 public renderer는 동일 read model·동일 component를 사용한다.
5. Dater가 특정 문장을 삭제한 뒤 player, story card, transcript, OG, kit 어디에도 남지 않는 통합 테스트를 추가한다.

### P0-2. 공개 structure가 moderation과 서버 제약을 우회한다

#### 증거

- `pitchStructureSchema`는 모든 문자열에 길이·non-empty 제한이 없다: `packages/contracts/src/pitchStructure.ts:3-10`.
- Introducer는 structure 전체를 자유롭게 편집하지만 완료 조건은 headline/body만 본다: `PitchReviewEditor.tsx:26,78-159`.
- pitch moderation hash는 `${headline}\n\n${body}`뿐이다: `apps/web/app/api/moderate-text/route.ts:76-118`.
- Dater revision DB gate도 같은 headline/body hash만 검사한다: `0041_dater_profile_and_location.sql:221-230`.
- public은 moderation되지 않은 structure와 transcript를 렌더한다.

#### 영향

공격적·성적·차별적·개인정보성 텍스트를 structure에 넣으면 headline/body moderation을 통과하면서 공개할 수 있다. 길이 무제한으로 public layout과 storage도 공격할 수 있다.

#### 완료 기준

- 실제 public text 전체를 deterministic canonical string/JSON으로 만들고 content hash와 moderation verdict를 결합한다.
- 각 field의 최대 길이, 필수성, 배열 원소 길이, 총량을 Zod와 DB 모두에서 강제한다.
- structure/transcript/composition 변경 시 이전 verdict를 무효화한다.
- direct RPC negative test와 public rendering test를 추가한다.

### P0-3. Verified Interest는 제출 후 프로필 교체로 검증을 우회한다

#### 증거

- `submit_interest`는 제출 시 현재 bio/intent/photos와 moderation을 검사한다: `supabase/migrations/0016_safety_paths.sql:764-807`, `0026_text_moderation_ledger.sql`.
- 인증 사용자는 자기 `dating_profiles`를 직접 UPDATE할 수 있다: `supabase/migrations/0002_rls.sql:125-130`.
- Dater inbox RPC는 제출 당시 snapshot이 아니라 `profiles`와 `dating_profiles`의 **현재 값**을 매번 JOIN한다: `0037_account_guard_and_erasure.sql:30-67`.
- 따라서 정상 bio·사진으로 제출한 뒤 unmoderated bio, 미검증 사진, 다른 intent/location으로 바꿀 수 있다.
- `decide_interest`는 Dater 계정만 active인지 확인하고 sender의 현재 account status, identity evidence, media/text verdict, expiry를 재검사하지 않는다: `0012_claim_binding_and_evidence.sql:428-473`.

#### 영향

Dater는 “검증된 관심 표현”이라고 믿고 실제로는 제출 후 교체된 콘텐츠를 본다. 정지된 사용자나 만료된 identity evidence를 가진 sender도 수락되어 room이 생성될 수 있다.

#### 완료 기준

- 제출 순간 immutable `interest_profile_snapshot`을 생성한다.
- snapshot은 exact bio/note hash, photo object IDs+content hashes/versions, DOB-derived age, location/intent, identity evidence IDs/expiry를 포함한다.
- inbox와 accept는 snapshot만 읽는다.
- 대안으로 mutable profile 변경 시 submitted interest를 `verification_pending`으로 되돌리고 재검증·재제출하게 한다.
- accept 시 sender active/18+/evidence expiry를 defense-in-depth로 재검사한다.

### P0-4. 미디어 검증이 파일 내용이 아니라 경로만 신뢰한다

#### 증거

- `media_validations` unique key는 `(bucket_id, object_name)`뿐이고 content hash/version이 없다: `0016_safety_paths.sql:1-15`.
- profile-media owner는 자기 object를 DELETE할 수 있다: `0037_account_guard_and_erasure.sql:456-466`.
- 같은 경로로 새 object를 INSERT할 수 있다.
- `submit_interest`는 현재 storage object와 과거 validation row의 object name이 같으면 통과한다: `0016_safety_paths.sql:778-807`.
- API의 provider request ref에 `updated_at`을 넣는 것은 비용 중복만 줄일 뿐 DB publication gate가 그 version을 확인하지 않으므로 안전 invariant가 아니다.

#### 공격 순서

1. 정상 사진을 `profile-media/<uid>/a.jpg`로 올리고 validation `passed`를 받는다.
2. 사진을 삭제한다.
3. 같은 경로에 미검증·타인 사진·부적절 사진을 다시 올린다.
4. direct RPC로 interest를 제출하면 이전 `passed` row가 재사용된다.

#### 완료 기준

- validation row를 storage object id/version/content SHA-256과 묶는다.
- profile snapshot도 같은 immutable object version을 참조한다.
- object DELETE/replace 시 관련 validation을 cascade invalidation하거나 content-addressed path를 사용한다.
- same-path re-upload direct RPC red-first 테스트를 추가한다.

### P0-5. Provider retry가 실제 비용을 월 cap과 시간 quota에서 누락한다

#### 증거

최신 `reserve_provider_usage`는 `0036_dater_validation_and_snapshot.sql:517-566`에 있다.

- 같은 `request_ref`의 failed/timeout/expired attempt를 같은 row로 re-arm한다.
- cap 합계에서 기존 row를 `id <> existing.id`로 제외한다.
- re-arm하면서 기존 `actual_cents`를 `NULL`로 지운다.
- 마지막 reconcile 값만 남아 이전 attempt 비용이 사라진다.
- 시간 quota는 row 수 `count(*)`만 세며 attempt_count를 세지 않는다.
- `created_at`도 갱신하지 않아 오래된 request_ref 재시도는 현재 month/hour 범위 밖에서 무제한 가능하다.

예: 첫 provider attempt가 실패하면서 3¢ 과금되고 두 번째가 3¢ 성공하면 ledger에는 3¢만 남을 수 있다. 실제는 6¢다.

#### 추가 결함

- `/api/transcribe`는 transcription + voice text moderation + structure를 하나의 `transcribe` reservation 3¢로 묶는다.
- structure 실패 시 재시도는 transcription부터 다시 한다.
- provider 작업 뒤 draft UPDATE error/경합에서 500/409를 early return하며 reconcile하지 않는다: `apps/web/app/api/transcribe/route.ts:166-187`.
- `reconcileProviderUsage`는 RPC 실패를 log만 하고 삼켜 route가 정상 응답을 계속할 수 있다: `apps/web/src/lib/providerBudget.ts:134-149`.

#### 완료 기준

- attempt마다 immutable ledger row를 만들거나 cumulative `reserved_cents/actual_cents`를 절대 감소시키지 않는다.
- cap과 quota는 attempt 단위로 계산한다.
- request operation을 transcribe, moderate_voice, structure로 분리하거나 각 성공 중간 산출물을 idempotently 저장한다.
- provider 결과 저장과 cost reconcile을 outbox/state machine으로 묶고, reconcile 실패를 호출자에게 실패로 전파한다.
- failed→retry→success, expired lease retry, month/hour boundary, reconcile failure, partial pipeline failure 테스트를 추가한다.

### P0-6. 원본 음성 존재와 실제 30~60초 길이가 서버 invariant가 아니다

#### 증거

- 30초 minimum은 mobile local service에서만 검사한다: `apps/mobile/src/services/pitchDrafts.ts:316-323`.
- schema의 60초 maximum과 recorder auto-stop도 client-side다.
- `/api/transcribe`는 실제 audio duration을 디코딩하지 않고 무조건 `durationMs: 60_000`을 provider에 넘긴다: `route.ts:112-116`.
- media validation은 signature/size/structure만 검사하고 decoded duration을 저장하지 않는다.
- `submit_pitch_for_consent`는 headline/body만 필수이며 voice asset이 없어도 revision을 만든다: `0016_safety_paths.sql:593-650`.
- publish RPC는 승인 photo 1장 이상만 요구하고 voice를 요구하지 않는다: `0036_dater_validation_and_snapshot.sql:266-320`.
- Consent preview도 voice가 null이면 “Not ready to play here”라고 표시하면서 approve를 막지 않는다.

#### 완료 기준

- 서버가 audio를 decode하여 duration, codec, channels, sample rate, content hash를 validation row에 기록한다.
- submit과 publish에서 validated·moderated voice exactly one, duration 30~60초를 강제한다.
- 제품이 최종 pitch 15~~60초를 유지할지 recording 30~~60초와 일치시킬지 문서로 결정한다.
- no voice, two voices, 29.9초, 60.1초, corrupt metadata direct RPC 테스트를 추가한다.

### P0-7. Identity/liveness/face-match가 여전히 구현되지 않았다

- real provider mode도 `UnconfiguredIdentityVerificationProvider`를 반환한다: `packages/adapters/src/factory.ts`, `openAi.ts`.
- phone invitation claim은 명시적으로 unavailable이다: `0029_mandatory_contact_binding.sql:77-80`.
- identity enforcement는 off이며, 공개 copy에서도 identity verified 표현을 제거한 상태다.
- 현재 email 소유와 invitation contact match는 “소개 대상자가 실제 사진 속 사람인지”를 증명하지 못한다.

이 항목은 외부 vendor와 키가 필요한 사용자 gate이지만 제품 P0에서 제거할 수 없다. provider sandbox, expiring evidence, 대표 사진 content version과 face-match binding, 재시도·privacy·deletion을 실제 기기에서 증명하기 전 public beta를 열지 않는다.

### P0-8. 미귀속 RevenueCat 구매 review를 “resolved”로 닫아도 효익이 지급되지 않는다

#### 증거

- 구매 이벤트가 intent/alias/lineage에 귀속되지 않으면 `record_revenuecat_event`는 `purchase_events`와 credit/pass 효익을 만들기 전에 `purchase_event_reviews`로 빠진다: `supabase/migrations/0039_core_growth_loop.sql:497-507`.
- `resolve_purchase_event_review(..., 'reassign', target_user_id)`는 creator 상품이면 **이미 존재하는** `purchase_credit_ledger` row를 UPDATE하고, Campaign Pass면 **이미 존재하는** `purchase_events` lineage로 entitlement refresh만 한다: `0038_commerce_state_machine.sql:766-796`.
- 처음부터 ledger/event가 만들어지지 않은 unattributed purchase에서는 `moved_rows = 0`이어도 review를 `resolved`로 닫는다: `0038:799-815`.
- Campaign Pass reassign은 `target_user_id`를 실제 scope 복구에 사용하지 않는다.
- creator credit의 user만 다른 계정으로 옮겨도 `pitch_draft.created_by_user_id`는 원 계정이므로 새 사용자는 `unlock_share_kit`의 draft ownership을 통과하지 못한다: `0020_paid_benefits.sql:134-169`.

#### 영향

실제 돈을 받은 transaction이 운영 화면에서는 해결된 것처럼 보이지만 사용자는 상품을 받지 못할 수 있다. 이는 실결제 공개를 차단하는 P0다.

#### 완료 기준

- review resolver가 raw event를 authoritative validation한 뒤 누락된 purchase event·credit/entitlement를 idempotently **생성**한다.
- `moved_rows = 0` 또는 scope/ownership 불일치면 review를 open으로 유지하고 실패한다.
- Creator transfer의 의미를 계정 alias 복구와 draft ownership 이전으로 구분한다. 단순 user_id 이동으로 해결하지 않는다.
- unattributed initial purchase, TRANSFER, pass scope, no-ledger recovery, double-resolve 테스트를 red-first로 추가한다.

### P0-9. Campaign Pass에 서로 다른 두 시간축과 환불 후 무료 연장이 있다

#### 증거

- campaign 공개 기간은 구매 시 `GREATEST(now, campaign.ends_at) + 30 days`로 연장된다: `0039_core_growth_loop.sql:764-778`.
- entitlement refresh는 최초 `purchased_at + 30 days`를 계산해 `campaign_entitlements.expires_at`을 덮어쓴다: `0014_commerce_state_machine.sql:119-180`.
- 무료 14일이 남은 campaign이 Pass를 사면 public `ends_at`은 약 44일 뒤지만 Pass analytics entitlement는 약 30일 뒤 끝난다.
- REFUND/CANCELLATION은 entitlement만 refresh/deactivate하고 `campaign.ends_at`을 의도적으로 유지한다: `0039:837-868`.

#### 영향

같은 “30-day Campaign Pass”가 공개 기간과 유료 기능에서 다른 날짜에 끝난다. 환불 후에도 유료로 늘어난 public 기간이 무료로 남아 매출·비용·사용자 설명이 어긋난다.

#### 완료 기준

- 하나의 authoritative `benefit_window`를 정하고 campaign visibility와 모든 Pass 기능이 같은 start/end를 사용한다.
- 잔여 무료 기간 위에 30일을 적층할지 구매일부터 30일만 줄지 상헌 님의 명시적 product decision을 받는다.
- refund policy를 확정하고 미사용/부분 사용/완료된 기간의 rollback 또는 운영 처리 규칙을 구현한다.
- 무료 잔여 14일+Pass, paused, expired revival, refund day 1/day 20, replay 테스트를 추가한다.

### P0-10. blocked revival에서도 Pass 기간이 소진되고 resolver가 campaign을 살리지 못한다

#### 증거

- expired campaign을 Pass로 되살릴 때 private beta gate 또는 owner의 다른 active campaign 때문에 `published` 전환이 실패하면, 코드는 `ends_at`을 먼저 30일 늘리고 entitlement를 즉시 시작한 뒤 review를 queue한다: `0039_core_growth_loop.sql:764-835`.
- review resolver의 Campaign Pass branch는 entitlement refresh만 하고 expired campaign을 published로 전환하지 않는다: `0038_commerce_state_machine.sql:784-793`.

#### 영향

사용자는 보이지 않는 expired campaign에 돈을 내고 30일을 소진할 수 있으며, 운영자가 review를 resolved로 닫아도 campaign이 살아나지 않는다.

#### 완료 기준

- revival preconditions를 purchase 전 intent 발급 단계와 webhook grant 단계에서 authoritative하게 검사한다.
- visibility를 줄 수 없으면 benefit clock을 시작하지 않고 durable pending grant로 둔다.
- blocker 해소 뒤 resolver가 정확히 한 번 publish+window activation을 수행한다.
- gate blocked, active campaign blocked, blocker 해소, refund-before-activation 테스트를 추가한다.

---

## 5. Grand Prize·최초 제품 차단 P0

### GP-P0-1. 결과물이 structured motion/video pitch가 아니다

현재 실제 출력:

- `<audio>` 재생
- 업로드 순서 사진 crossfade
- transcript segment 자막
- 브라우저가 audio를 decode해 그리는 waveform
- structure는 player 아래 일반 정적 카드

현재 없는 것:

- AI가 정한 semantic scene plan
- hook/relationship/qualities/anecdote/good-match의 timed composition
- kinetic typography
- 사진과 이야기의 의미 기반 mapping
- Dater preview와 public의 동일 motion renderer
- server render queue와 video artifact
- MP4/H.264/AAC export

`apps/web/src/pitch/scenes.ts`는 사진을 duration/segment 경계에 균등 분배할 뿐 structure 의미를 사용하지 않는다. `media-worker/render/index.ts`는 빈 placeholder이고 Remotion/FFmpeg dependency가 없다.

MP4는 최초 P1이므로 “MP4 부재만으로 P0”는 아니다. 그러나 최초 P0도 kinetic text를 포함한 9:16 motion pitch를 요구했다. 현재 generic audio slideshow는 Friendword의 핵심 차별점을 충족하지 못한다.

#### 완료 기준

- versioned `PitchComposition` contract: scene kind, approved content ref, asset ref, start/end, crop/focal point, layout, theme, schema version.
- AI structure→scene plan은 deterministic validation을 통과하고 Dater가 수정·승인한다.
- player 안에서 structure scenes와 kinetic text를 실제 시간축으로 렌더한다.
- preview/public/OG/kit가 동일 approved composition을 사용한다.
- MP4를 다시 상품 가치로 채택한다면 승인 snapshot hash 기반 idempotent render job, 1080×1920 H.264/AAC, timeout/retry/cost cap을 구현한다.

### GP-P0-2. 대표 demo가 핵심 차별점을 체험시키지 못한다

- `demo-blair`는 권리 확보 실음성이 없다.
- illustration placeholder와 written pitch만 있다.
- 모바일에서 긴 written pitch와 no-audio note가 겹친다.
- demo interest는 실제 interest→inbox→accept→room을 체험하지 못한다.
- `scripts/seed-demo.mjs`는 아직 exit 1 placeholder다. 실음성용 `seed-demo-pitch.mjs`는 준비됐지만 입력 파일과 hosted seed가 없다.
- reviewer seed, reviewer identities, promo unlock, teardown, 제출용 사용법이 없다.

#### 완료 기준

1. 권리 확보된 실제 사람의 30~60초 영어 음성과 승인 사진을 사용한다. TTS 금지.
2. production pipeline의 transcription, structure, captions, waveform, scene composition을 그대로 거친다.
3. 320/375/390/430px에서 absolute layer intersection 0을 시각 회귀로 고정한다.
4. idempotent judge seed+teardown으로 viewer→interest→Dater inbox→accept→Intro Room을 체험하게 한다.
5. Creator Launch와 Campaign Pass는 실결제 없이 reviewer promo/unlock으로 가치를 볼 수 있게 하되 production entitlement를 오염시키지 않는다.

### GP-P0-3. 핵심 growth loop가 사용자에게 발견 가능하지 않다

- native fresh install에 일반 Sign in/Account entry가 없다.
- signed-out `My dating campaigns`와 `My interests`는 “Sign in” 문구만 있고 버튼이 없다.
- Dater approve 뒤 public pitch로만 이동하고 inbox/manage 진입이 없다.
- Interested submit 성공 뒤 back-to-pitch만 있다.
- accepted interest의 mobile card는 “web app에서 room을 열라”는 문구만 있고 링크가 없다.
- Dater accept 직후 room CTA는 새로고침하면 사라지는 local state다.

코어 loop가 DB와 화면 조각으로 존재하는 것과 사용자가 완주할 수 있는 제품은 다르다.

#### 완료 기준

- 홈과 각 signed-out state에 재사용 가능한 auth/account surface를 연결한다.
- 로그인 뒤 원래 목적지로 복귀한다.
- contextual activity hub에 campaigns/interests/rooms/settings를 노출한다.
- approve/submit/accept 후 명확하고 durable한 next-step CTA와 deep link를 제공한다.
- fresh-install Introducer/Dater/Interested 각각의 실기기 E2E를 만든다.

### GP-P0-4. production origin과 universal/deep link가 없다

- `getWebOrigin()`은 설정 누락/오류를 `http://localhost:3000`으로 조용히 fallback한다: `apps/mobile/src/services/webOrigin.ts:4-18`.
- `app.config.ts`에는 custom scheme만 있고 iOS associated domains와 Android intent filters가 없다.
- consent/public/inbox/room의 native deep-link contract도 없다.
- `pnpm check:env`가 실제로 실패한다.

production/TestFlight build에서는 empty, localhost, non-HTTPS origin을 build-time fail로 막고 `EXPO_PUBLIC_WEB_ORIGIN`을 필수로 바꾼다. invitation/referral/kit/room 링크를 실제 기기에서 왕복 검증한다.

---

## 6. High — 기능·신뢰·운영

### H-1. Provider 결과 저장과 비용 reconcile이 원자적이지 않다

- text moderation은 provider 성공을 `succeeded`로 reconcile한 뒤 verdict를 upsert한다. upsert 실패 시 같은 content hash는 provider ledger에서 영구 succeeded지만 verdict가 없어 retry가 409에 갇힌다.
- media validation도 provider reconcile 뒤 validation upsert를 한다. 저장 실패 뒤 replay는 prior succeeded인데 재사용할 stored verdict가 없어 skipped로 덮이거나 영구 차단될 수 있다.
- 비용 reconcile 자체가 실패해도 helper가 오류를 삼킨다.

Provider call, business result persistence, cost accounting을 하나의 durable job/outbox state machine으로 만든다. “provider success but DB write fail”과 “DB write success but reconcile fail” recovery test가 필요하다.

### H-2. Manual/no-AI path가 public에서 깨진다

- manual review는 schema-valid `EMPTY_PITCH_STRUCTURE`를 그대로 둔다.
- public parser는 이를 non-null structure로 받아 structure branch를 선택하고 approvedBody를 숨긴다.
- 결과는 빈 hook/context, 빈 quality 3개, 빈 anecdote/good match가 될 수 있다.
- manual path는 transcript segment도 없어 mute caption이 없다.

Manual은 structure를 `null`로 저장해 approved headline/body+typed recap을 canonical로 쓰거나, manual composition을 완전히 입력하게 한다. manual published E2E가 필요하다.

### H-3. 무자막·audio failure fallback이 약하다

- transcript segments가 없으면 `Captions aren’t available`만 보이고 음소거로 이해할 수 없다.
- audio element에 명확한 `onError` 상태가 없고 `play().catch`는 재생 상태만 false로 돌린다.
- waveform 오류 문구는 실제 audio signed URL도 실패했을 수 있는데 “playback still works”라고 단정한다.

usable segments가 없으면 publish를 막거나 승인 transcript/recap을 stage에 표시한다. waveform decode failure와 audio availability/playback failure를 분리한다.

### H-4. Dater preview와 public output이 다른 renderer다

Consent preview는 cover+headline+body+looking-for summary의 still이다. public은 transcript captions, 사진 timing, waveform, structure cards를 사용한다. `exactly what people will see`라는 카피는 거짓이다. P0-1의 canonical snapshot과 함께 duplicated presentation model을 제거한다.

### H-5. 사진이 AI composition에 사용되지 않는다

OpenAI structure 입력은 transcript와 relationship metadata뿐이다. 사진은 moderation에만 전달되고, scene은 upload order에 따라 균등 배치된다. Dater도 reorder/crop/focal point를 지정할 수 없다.

최초 입력 범위가 arbitrary 자료가 아니라 사진 1~4장과 관계 정보였다는 점은 명확히 해야 한다. 그러나 “AI가 음성과 자료를 받아 영상을 제작한다”고 주장하려면 approved scene→asset mapping 또는 실제 multimodal composition이 필요하다.

### H-6. native role surfaces가 읽기 전용·불완전하다

Dater campaign card에는 Pass 구매만 있고 View/Share/Inbox/Pause/Archive/analytics가 없다. native account deletion, safety/settings, sign-out surface도 없다. 역할 전환 스위치를 만들지 말고 한 계정의 resource별 action을 activity hub에 보여준다.

### H-7. 관심 철회 경로가 없다

domain은 `withdrawn` 상태를 인식하지만 앱/웹에 withdraw RPC·버튼이 없다. submitted 전후 정책, accepted 뒤 room leave/block와의 차이를 확정하고 철회 UI와 상대방 반영 테스트를 추가한다.

### H-8. 알림이 없는 비동기 제품이다

승인 요청, 변경 요청, publish, 새 interest, accept, 새 message를 알리는 transactional email/push가 없다. 초기 문서에서는 push가 P1이었지만 현재 navigation 단절과 결합하면 core loop가 사실상 멈춘다.

최소 transactional email+durable target link+outbox/retry+preference를 먼저 구현하고 민감정보를 notification 본문에 넣지 않는다. 이후 push/deep link를 연결한다.

### H-9. Returning Dater profile reuse가 없다

Consent 진입 때 birthDate/region/city/intent를 매번 빈값으로 초기화한다. 같은 User가 다른 캠페인에서 Dater가 될 때 기존 verified profile을 재사용한다는 contextual-role 기획과 어긋난다. owner-only prefill RPC로 confirm/edit만 요구한다.

### H-10. growth attribution이 web session과 install 경계를 넘지 못한다

web first-touch가 sessionStorage 중심이라 브라우저 종료·설치 뒤 소실된다. TestFlight/App Store install attribution bridge가 없고 native share events도 campaign identity가 충분하지 않다. privacy-safe ref token, TTL cookie/server pending claim, native sign-in claim을 연결한다.

### H-11. Creator Launch와 Campaign Pass의 체감 가치가 약하다

- Creator Launch $4.99는 무료 live voice link와 비교해 정적 PNG 1장+caption 3개다.
- native purchase 뒤 kit을 web으로 열면 web session이 없어 다시 로그인할 수 있다.
- Campaign Pass analytics는 raw source/count 목록 수준이고 native Dater가 진입할 링크가 없다.

현재 copy가 정직하다는 것은 해결된 점이다. 그러나 willingness-to-pay를 입증하지 못했고 최초 commercial thesis는 축소됐다. auth handoff, 즉시 가치 체험, insight 중심 analytics, 실제 가격 실험이 필요하다.

### H-12. account/evidence 상태가 interest accept 시 재검사되지 않는다

`decide_interest`는 sender가 suspended인지, identity evidence가 만료되었는지, snapshot media/text가 여전히 valid한지 확인하지 않고 room을 만든다. P0-3 snapshot과 accept-time defense-in-depth로 해결한다.

### H-13. 운영 자동화는 코드와 runtime을 구분해야 한다

scheduled ops workflow와 삭제/만료 스크립트는 존재한다. 하지만 GitHub Actions secrets가 실제 등록되었다는 증거가 없고, identity/moderation/RevenueCat sandbox도 미검증이다. “automated”, “real payments ready”는 runtime proof 전까지 금지한다.

### H-14. SANDBOX와 PRODUCTION 효익이 같은 namespace에 지급된다

RevenueCat payload의 `environment`는 기록되지만 credit/pass grant의 namespace나 expected environment를 제한하지 않는다. `real_payments_enabled=on` 이후 SANDBOX 이벤트도 production campaign에 같은 실 credit/entitlement를 지급할 수 있다. 출시 전 expected environment를 deployment config로 강제하고, sandbox receipts와 production benefits를 분리하거나 sandbox 전용 계정·scope를 명시적으로 제한한다.

### H-15. 실패한 개인정보 삭제 요청은 자동 재시도되지 않는다

`process-deletions.mjs`의 claim filter는 `queued`와 stale `processing`만 포함하고 `failed`는 제외한다: `scripts/process-deletions.mjs:77-79,418-425`. 일시적인 Storage/Auth/DB 오류도 status를 `failed`로 바꾸며 다음 cron에서 영원히 건너뛴다: `:378-403`. OPS 문서는 운영자가 수동으로 queued 복구하게 한다.

개인정보 삭제가 무기한 멈추면서 전체 cron은 다음 실행에서 green일 수 있다. bounded retry/backoff, retry count, terminal dead-letter, operator alert/SLA, 사용자-visible 상태를 구현한다.

### H-16. RevenueCat review payload의 PII 보존이 불완전하다

resolved/discarded review scrub은 app user IDs, aliases, transaction IDs 등은 제거하지만 RevenueCat TRANSFER payload의 `transferred_from`/`transferred_to` 같은 식별자 배열을 제거하지 않는다: `0037_account_guard_and_erasure.sql:432-439`. open review는 retention 없이 raw payload를 무기한 보존한다. 필드 allowlist 방식으로 scrub하고 open review에도 최대 보존·escalation 정책을 둔다.

### H-17. 만료 scheduler 지연이 새 campaign publish를 막는다

one-active trigger는 status가 `published/paused`인지 만 보고 `ends_at <= now()`를 무시한다: `0039_core_growth_loop.sql:49-86`. cron이 미연결·지연되면 시간상 만료된 campaign이 계속 active로 계산되어 새 publish를 차단한다. predicate에 `ends_at > now()`를 포함하거나 새 publish transaction 안에서 due campaign을 먼저 atomic expire한다.

---

## 7. 디자인·Gen Z 감성 최종 평가

### 7.1 잘 반영된 부분

- cream/ink 기반에 tangerine, flirt pink, fresh teal을 신호색으로 쓰는 palette가 독자적이다.
- Bricolage 계열의 큰 display typography와 sticker 언어는 북미 젊은 사용자 acquisition surface에 잘 맞는다.
- landing hierarchy와 one-line proposition이 강하다.
- Trust Layer의 hairline, soft shadow, tilt 0 원칙과 contrast token이 consent/report/delete surface에 상당 부분 반영됐다.
- 공개 피치와 kit는 일반적인 보라색 gradient 데이팅 앱처럼 보이지 않는다.
- 실제 음성 없음을 숨기지 않고 demo라고 표시한 정직성은 좋다.

### 7.2 미진한 부분

- 가장 중요한 demo mobile stage가 실제로 겹쳐 깨진다. 브랜드 평가보다 먼저 고쳐야 한다.
- demo 한 카드에 전체 서술을 몰아넣어 정보 밀도가 지나치게 높다.
- 핵심 visual이 실제 사람·실제 음성·semantic scene이 아니라 illustration과 장식 waveform에 머문다.
- `SignInSheet`의 2px hard border, sticker shadow, -2° badge는 identity/trust surface의 1px soft/no-tilt 원칙과 충돌한다.
- public trust copy는 실제로 단순 승인했을 수도 있는데 “edited the wording, photos, and claims”라고 항상 단정한다. “reviewed and could edit/chose”가 정확하다.
- Dater consent의 6단계 scroll rail은 접근성은 좋아졌지만, 실제 output과 다른 preview 때문에 인지 부담을 들인 만큼 신뢰를 주지 못한다.

### 7.3 디자인 판정

브랜드 방향 자체는 유지한다. 전체 redesign은 필요 없다. 우선순위는 **실제 음성·실제 사람·실제 scene을 중심에 놓고, trust surface의 정보 정확도와 mobile layout을 고치는 것**이다.

---

## 8. 3차 감사 수용 재판정

| 3차 감사 항목                             | 4차 판정                                  | 설명                                                                                     |
| ----------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0-NEW-1 provider hard cap                | **REOPENED / CRITICAL**                   | service-role+lease는 해결했지만 retry cumulative cost/quota가 깨짐                       |
| P0-NEW-2 AI consent before provider bytes | **CODE RESOLVED**                         | mobile creator/dater 주요 경로에서 consent 선행. runtime key proof는 없음                |
| P0-NEW-3 Dater photo validation           | **부분 해결**                             | 사진 업로드/validation은 동작하나 content version binding과 final public snapshot이 깨짐 |
| P0-NEW-4 public beta authoritative gate   | **RESOLVED IN CODE**                      | DB regression 통과. hosted operational drill은 이번 turn 미실행                          |
| 2차 P0-3 RevenueCat webhook/review        | **REOPENED / CRITICAL**                   | unattributed purchase resolver가 효익 없이 review를 resolved 처리 가능                   |
| 2차 P0-4 RevenueCat app identity          | **CODE PARTIAL / RUNTIME UNVERIFIED**     | alias 경로는 개선, transfer/sandbox 실제 계약 미검증                                     |
| 2차 P0-5 Creator Launch paid delivery     | **PARTIAL**                               | 정상 귀속 happy path는 있음, review reassign 후 ownership 불일치 가능                    |
| 2차 P0-6 Campaign Pass                    | **REOPENED / CRITICAL**                   | campaign/entitlement 이중 시간축, refund 잔존 기간, blocked revival burn                 |
| GP-P0-1 Introducer free sharing           | **RESOLVED IN CODE**                      | live link open/share/copy 존재                                                           |
| GP-P0-2 public acquisition surface        | **PARTIAL**                               | waitlist/referral은 생겼지만 install/native attribution과 auth entry 부족                |
| GP-P0-3 representative demo               | **UNRESOLVED / REGRESSION**               | 가짜 age/vouch 제거는 해결, 실음성·judge flow 없음, mobile overlap 발견                  |
| H-1 active account guards                 | **대체로 해결**                           | sender evidence accept-time 재검사는 별도 신규 finding                                   |
| H-2 deletion                              | **CODE PARTIAL**                          | processor/retention 개선, scheduler runtime proof 없음                                   |
| H-3 chat proactive moderation             | **ACCEPTED RISK**                         | reactive-only 정책은 명시됨. 외부 베타 전 재평가                                         |
| H-4 token/local media lifecycle           | **대체로 해결**                           | publish purge 개선. canonical snapshot/content hash는 별도 미해결                        |
| H-5 interest photo cleanup                | **cleanup 개선 / safety REOPENED**        | delete 허용이 same-path validation TOCTOU를 만들었음                                     |
| H-6 expiration automation                 | **CODE RESOLVED / RUNTIME UNVERIFIED**    | cron secret proof 없음                                                                   |
| H-7 active campaign limit                 | **RESOLVED**                              | DB guard와 tests 존재                                                                    |
| H-8 fake K-factor naming                  | **RESOLVED**                              | exporter 명칭 정직화                                                                     |
| H-9 server-authoritative outcomes         | **RESOLVED IN CODE**                      | 실 traction은 없음                                                                       |
| CP-1 Dater final control                  | **REOPENED / CRITICAL**                   | preview, approved body, public structure/transcript가 불일치                             |
| CP-2 voice→structured pitch               | **PARTIAL**                               | real transcription/structure는 있음, motion composition 없음                             |
| CP-3 fake playback                        | **RESOLVED FOR REAL AUDIO**               | demo no-audio layout은 깨짐                                                              |
| CP-4 English-first                        | **RESOLVED**                              | public surface English                                                                   |
| CP-5 Creator Launch                       | **HONESTLY NARROWED, PRODUCT UNRESOLVED** | static kit은 truth-aligned, 최초 가치 미충족                                             |
| CP-6 Campaign Pass                        | **STATE MACHINE IMPROVED, VALUE WEAK**    | 30일 의미는 명확, 최초 feature 대부분 없음                                               |
| CP-7 contextual roles                     | **DATA RESOLVED / UX PARTIAL**            | native auth/account 진입과 resource action 부족                                          |
| CP-8 voice-first/manual recap             | **REOPENED**                              | AI path recap 해제는 해결, manual public output은 깨짐                                   |
| CP-9 dating fit/filter                    | **PARTIAL**                               | DOB/location/intent/audience 존재, immutable interest snapshot 없음                      |
| CP-10 Introducer reward/closure           | **PARTIAL**                               | share/referral 존재, pseudonymous profile/badge/vouch/feedback 없음                      |

---

## 9. 기존 테스트가 놓친 blind spot

Green test 수가 많지만 다음 핵심 계약을 검증하지 않는다.

- Dater가 삭제한 문구가 public player/story/transcript/OG/kit 모두에서 사라지는가
- structure 전체가 moderation과 길이 제한을 거치는가
- consent preview와 public renderer가 pixel/semantic 동등한가
- voice 없는 direct RPC publish가 실패하는가
- 실제 decoded duration 29.9/60.1초가 실패하는가
- manual published pitch가 body/recap을 정상 표시하는가
- transcript segment 없는 real audio가 mute 상태에서도 이해 가능한가
- benign validation 뒤 same-path re-upload가 제출을 실패시키는가
- interest 제출 뒤 profile 변경이 inbox snapshot을 바꾸지 않는가
- suspended/expired-evidence sender accept가 실패하는가
- failed provider attempt 뒤 retry 성공 시 두 attempt 비용을 모두 합산하는가
- reconcile 실패 뒤 route가 성공을 응답하지 않는가
- provider success 뒤 verdict write failure가 recover 가능한가
- unattributed purchase review를 resolve했을 때 실제 credit/pass가 생성되는가
- Campaign Pass의 public ends_at과 analytics entitlement가 항상 같은가
- blocked revival에서 benefit clock이 시작되지 않는가
- refund 뒤 policy에 맞게 paid window가 회수되거나 명시적 review로 가는가
- SANDBOX receipt가 production benefit을 만들지 않는가
- failed deletion request가 bounded retry되고 운영 alert를 만드는가
- `ends_at <= now()` campaign이 scheduler 지연 중 새 publish를 막지 않는가
- fresh install에서 Dater/Interested가 로그인하고 원래 목적지로 돌아가는가
- approve→inbox, interest submit→status, accepted→room 링크가 새로고침 뒤에도 남는가
- 320/375/390/430px에서 demo absolute layers가 겹치지 않는가
- production build에서 empty/localhost/non-HTTPS web origin이 실패하는가

`tests-audit3/pitch-scene-timing.audit3.test.ts`는 사진의 generic 시간 분배만 검증하며 structured motion을 검증하지 않는다. Playwright의 structure acceptance도 player 밖 정적 label이 보이는지만 확인한다. 현재 test suite는 “코드 조각이 존재한다”는 증거이지 “최초 제품 계약이 성립한다”는 증거가 아니다.

---

## 10. Claude 팀 수정 실행 순서

### Slice 0 — 기준 동결과 외부 노출 freeze

1. `public_beta_enabled=off`, `real_payments_enabled=off`, identity/moderation enforcement 상태를 확인하고 기록한다.
2. 최초 commit `4e37735`의 product contract를 immutable historical baseline으로 별도 보존한다.
3. 현재 canonical contract와 최초 baseline의 explicit diff를 한 문서에 만든다. 기존 handoff 뒤쪽의 stale MP4/비용/미결정 문구를 정리한다.
4. ongoing TestFlight build는 internal-only로 표시하고 외부 테스터를 초대하지 않는다.

### Slice 1 — Canonical approved output

1. `PublishedPitchSnapshot/PitchComposition` schema 설계.
2. structure, transcript/captions, assets, scene plan, theme/version을 content hash에 포함.
3. Dater가 모든 public text와 scene을 검토·편집·제외.
4. consent preview와 public이 동일 renderer/read model 사용.
5. public/OG/kit는 approved snapshot 외 데이터를 읽지 않음.
6. P0-1/P0-2 red-first 통합 테스트.

### Slice 2 — Verified Interest immutable snapshot

1. content-addressed media validation.
2. immutable interest profile snapshot.
3. profile 변경 시 snapshot 불변 또는 재검증 전이.
4. accept-time sender/evidence check.
5. same-path replace, post-submit edit, suspended sender tests.

### Slice 3 — Provider cost/state machine

1. immutable per-attempt ledger 또는 cumulative accounting.
2. attempt-based month/hour cap.
3. transcribe/moderate/structure 단계 분리와 중간 결과 idempotency.
4. provider result persistence+reconcile recovery state machine.
5. retry/concurrency/month boundary/reconcile failure tests.

### Slice 4 — RevenueCat recovery와 Campaign Pass 단일 시간축

1. unattributed purchase resolver가 purchase event와 효익을 idempotently 생성하도록 수정.
2. zero-row resolve 금지와 Creator transfer ownership 정책 확정.
3. Campaign Pass의 campaign/entitlement authoritative window 단일화.
4. refund와 blocked revival을 pending-grant state machine으로 수정.
5. SANDBOX/PRODUCTION benefit namespace 분리.
6. no-ledger review, free-window stacking, refund, blocked revival tests.

### Slice 5 — Voice server invariant와 manual fallback

1. server decoded audio metadata/content hash.
2. exactly-one validated voice + duration DB gate.
3. manual structure null/full composition 결정.
4. recap/mute caption fallback.
5. audio error UX와 direct RPC tests.

### Slice 6 — 실제 structured motion composition

1. structure→timed scene contract.
2. approved asset mapping, reorder/cover/crop/focal point.
3. kinetic typography와 accessible captions.
4. identical preview/public renderer.
5. Creator Launch를 원계약으로 복구할지 static kit 가격을 재정의할지 상헌 님에게 decision gate 제시.

### Slice 7 — Native auth·navigation·links

1. global account/auth entry와 sign-out/settings.
2. role-aware activity hub와 campaign actions.
3. persistent inbox/room links.
4. required production web origin fail-fast.
5. universal/deep links와 auth handoff.
6. transactional notifications.

### Slice 8 — Representative demo와 디자인 QA

1. mobile overlap 즉시 수정.
2. rights-cleared real voice/person campaign seed.
3. judge-safe end-to-end data와 reviewer unlock.
4. responsive/reduced-motion/VoiceOver/real-device QA.
5. demo video와 실제 product output 동일성 확인.

### Slice 9 — 외부 vendor와 release proof

1. identity sandbox+enforcement on.
2. OpenAI moderation enforcement on.
3. RevenueCat purchase→restore→refund→transfer 실왕복.
4. Resend/notification outbox.
5. scheduled ops secret와 실제 cron 실행 증거.
6. gate-on smoke 후 gate-off rollback drill.

---

## 11. 각 Slice의 작업·검증 규칙

상헌 님이 정한 역할 분담을 그대로 지킨다.

### Advisor(orchestrator)가 직접 할 일

- 요구사항 분석, 작업 분해, 설계 결정
- 필요한 구현·리서치·문서 작업
- Worker brief 작성
- Worker diff 직접 검토
- 테스트 직접 실행
- red-first가 실제로 기존 코드에서 실패했는지 확인
- 사용자 보고

### Worker brief 필수 내용

- 이 감사에서 이미 찾은 정확한 원인과 관련 파일/행
- 최초 제품 계약과 현재 canonical contract
- 수정 허용 경로와 금지 경로
- security/consent/cost invariant
- 완료 기준과 통과해야 할 test 명령
- migration 재정의 시 최신 함수를 통째로 복사해야 하는 함정

### 승인 금지

- Worker의 “완료” 보고만으로 승인
- unit test green만으로 제품 acceptance 승인
- 문서 범위를 축소해서 최초 기획 결함을 “해결” 처리
- 실제 vendor proof 없이 “identity verified”, “payments ready”, “launch ready” 표현
- 데모용 TTS/voice clone
- public renderer가 승인 snapshot 이외의 mutable source를 읽는 설계

---

## 12. 사용자·외부 설정 gate

코드 수정과 외부 설정을 섞지 않는다.

상헌 님 또는 외부 계정이 필요한 항목:

- EAS/Apple credentials와 실제 TestFlight processing
- production `EAS_PROJECT_ID`
- production HTTPS `EXPO_PUBLIC_WEB_ORIGIN`
- RevenueCat iOS public SDK key와 App Store Connect products
- RevenueCat sandbox account/transaction lifecycle
- identity vendor 선택·계약·sandbox keys
- OpenAI key와 moderation enforcement proof
- Resend domain 또는 transactional email provider
- GitHub Actions scheduled-ops secrets
- rights-cleared real English voice/photos
- 실제 iPhone과 필요 시 iPad QA

이 항목이 없다고 코드 P0를 미뤄서는 안 된다. 반대로 코드가 있다고 외부 proof가 완료된 것으로 기록해서도 안 된다.

---

## 13. 최종 승인 보고 형식

Claude Advisor는 각 finding을 다음 형식으로 보고한다.

```text
[Finding ID]
상태: RESOLVED / PARTIAL / BLOCKED / ACCEPTED RISK
수정 커밋:
변경 파일:
구현 invariant:
red-first 증거:
실행 테스트와 결과:
수동/실기기 증거:
hosted migration/evidence:
남은 사용자 gate:
문서 truth 갱신:
```

특히 아래 문장은 증거 전까지 금지한다.

- “모든 문구는 Dater가 승인했다”
- “AI가 영상을 제작한다”
- “verified interest”
- “identity verified”
- “hard cost cap”
- “TestFlight ready”
- “public beta ready”
- “Grand Prize ready”

---

## 14. 4차 감사 결론

Friendword의 아이디어는 아직 살아 있고, 핵심 기술 골격도 버릴 단계가 아니다. 실제 음성 전사·구조화, Dater 중심 승인 흐름, 외부 공유, profile-backed interest, Intro Room, contextual role은 좋은 기반이다.

그러나 지금 가장 위험한 것은 기능 수 부족이 아니라 **제품이 주장하는 신뢰와 실제 데이터 흐름의 불일치**다. Dater가 승인하지 않은 structure/transcript가 공개될 수 있고, interest는 제출 후 검증되지 않은 프로필로 바뀔 수 있으며, 비용 ledger는 재시도 비용을 누락한다. 미귀속 결제 review와 Campaign Pass 기간 상태기계도 실제 돈을 받고 효익을 주지 못하거나 서로 다른 종료일을 만들 수 있다. 동시에 Grand Prize의 핵심 데모는 최초 약속인 structured motion/video가 아니라 audio slideshow에 머문다.

따라서 다음 작업은 새 기능을 넓히는 것이 아니라 아래 순서여야 한다.

1. 승인한 것과 공개되는 것을 완전히 동일하게 만든다.
2. Verified Interest와 media validation을 immutable snapshot/content hash로 고친다.
3. provider 비용과 결과 persistence를 attempt-safe하게 만든다.
4. RevenueCat recovery와 Campaign Pass 시간축을 transaction-safe하게 만든다.
5. 원본 음성을 서버 invariant로 만든다.
6. 그 위에 실제 structured motion composition을 구현한다.
7. 사용자가 auth→approval→interest→room을 발견 가능하게 연결한다.
8. 실제 사람·실제 음성·실제 end-to-end judge demo로 증명한다.

이 여덟 단계가 끝나기 전에는 내부 TestFlight QA와 제품 출시·해커톤 제출을 같은 의미로 취급하면 안 된다.
