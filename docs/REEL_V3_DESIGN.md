# 릴스 재설계 설계서 — "하이라이트 MP4" (2026-09-09, Goal #96 T001, 아키텍트 반박 반영 확정본)

> 목적: `docs/PRODUCT_COLD_REVIEW_2026-09-09.md` §1이 프레임으로 입증한 릴스 결함(첫 2초 정보 없음·통짜 60초·문장 카드·스테이지 부재·세이프존 위반·약한 엔드카드)을 해소한다. 사용자 지시(2026-09-09)로 **셀피 클립·음악 베드·사진 보정**을 포함한다. 이 문서는 T002~T005의 계약이다. 초안은 opus-architect 반박(블로커 7건)을 거쳐 아래처럼 판정·수정했다.

## 0. 핵심 결정 — "승인된 씬은 그대로, MP4는 파생물"

아키텍트가 코드로 확인한 사실(초안의 전제 2개를 뒤집음):
- 크롬·자막·엔드카드는 **이미 렌더러 전용**이다. `jobRunner.ts:294-303`이 동결된 전사에서 캡션 페이로드를 파생하고("renderer chrome, never part of the approved scene"), `renderScene.ts:52-59`가 옵션으로 받는다. 스테이지 타이틀·파형·단어 자막·엔드카드에는 **스키마 변경이 필요 없다**. goal.json의 "v3 스키마로 추가" 제약은 동의 스냅샷 재승인·빌더·해시 변동 비용만 치르고 얻는 게 없으므로 **이 문서로 정정**한다(DECISIONS 기록).
- scene v3(클립 샷)의 DB assert는 `0050_video_ingest.sql:1023-1255`에 **이미 배포**돼 있고 `approve_and_publish`는 `snapshot_video_asset_ids`를 넘긴다(0050:2263-2280). 없는 것은 빌더(`pitchSceneBuilder.ts:1070`은 v2 방출), 플레이어, 렌더러(`validate.ts`가 v3 거부)다.
- `media_render_jobs.revision_id`는 `NOT NULL UNIQUE`(0054:79)이고 `request_pitch_render`의 멱등·진행중·무료 소진 판정(0054:384-500)은 **리비전당 잡 1행**을 전제한다. 무료 렌더 unlock은 **캠페인당**(0054:232-243)이다.
- Dater의 **클립 개별 승인 UI는 없다**. `ConsentFlow.tsx:158-165`가 클립을 읽기 전용으로 두고, `revisionAssetIds()`(:432-447)는 비사진 자산을 자동 유지한다.
- 캡처 페이지(`RenderStage.tsx`)에는 `<video>`가 없고 결정론 증명은 DOM 시그니처(:40-141)다. 헤드리스 `<video>` 시크는 비결정론의 고전적 원인이다.
- 렌더 경로의 단어 타입 `SceneWord`(`apps/web/src/pitch/sceneV2.ts:46-50`)·`CaptionWord`(`captionChrome.ts:36-39`)는 **밀리초가 없다**. 타이밍은 `packages/contracts/src/transcriptWords.ts`(`startMs/endMs`, 텍스트 없음)에 따로 있다. 프로덕션 조사(2026-09-09, hosted): 8/9 이후 생성된 전사 **전부**에 `transcript.words`(108~129개)가 있고, 7월 구 데이터만 없다 → 단어 자막이 기본, 세그먼트 캡션은 폴백.
- 오디오 원칙 P5(`encode.ts:36-42`): "AAC는 비트 단위 복사, 파형을 건드리는 필터 없음". 컷·음악은 이 원칙을 **MP4에 한해** 바꾸는 결정이다.

**판정(확정)**
1. **씬·scene_hash·웹 플레이어·동의 스냅샷 규칙은 손대지 않는다.** 하이라이트·크롬·자막·엔드카드·보정·음악은 렌더 워커 + 캡처 페이지 + 인코더의 변경이다.
2. **리비전당 MP4는 1개**(0054 구조 유지). kit은 **렌더 전에** Highlight(기본)/Full과 음악 on/off를 고르고, 선택은 `media_render_jobs.variant/options`에 기록된다. 렌더 후 변형 교체는 없다(무료 1회·멱등 판정 무변경). 하이라이트 불가(세그먼트<2)면 워커가 Full로 폴백하고 잡에 기록한다.
3. **웹 페이지 = 원본 음성 무손실, MP4 = 파생물.** MP4 오디오만 컷·페이드·음악 믹스·AAC 재인코딩을 허용한다(DECISIONS 항목 + `encoderArgs.render.test.ts` 의도적 재작성).
4. **셀피 클립은 승인 스냅샷을 통해서만 MP4에 들어간다.** 씬 v3 빌더·플레이어를 만들지 않는다. 대신 (a) 동의 화면에 클립 포함/제외 토글을 만들어 리비전 저장·`snapshot_video_asset_ids`에 반영하고(현재 자동 유지 → **명시 승인**으로 변경), (b) 워커는 스냅샷에 포함된 `asset_role='selfie'` 비디오 자산이 있을 때만 프록시에서 **ffmpeg로 프레임을 추출**해 `image2pipe` 앞에 붙인다. 캡처 페이지에는 `<video>`를 두지 않는다.
5. **단어 자막은 타이밍 결합 페이로드**(`TimedCaptionWord {segmentIndex, wordIndex, text, startMs, endMs}`)를 새로 정의해 `payload.ts`·`domSignature()`에 통과시킨다. `words` 없으면 기존 세그먼트 캡션.
6. 결정론 수용 기준: CI는 **프레임 해시 + 오디오 PCM 해시** 동일(4회), 바이트 동일은 수동 벤치 1회. 인코더에 `-fflags +bitexact -flags +bitexact`를 명시한다.

롤백: env 플래그 `RENDER_HIGHLIGHT_ENABLED=false`면 워커가 모든 잡을 기존 Full 경로(무필터 copy)로 처리한다. 데이터는 파생물이라 MP4 삭제로 원복된다.

## 1. 컷 플랜(하이라이트 선택기) — `packages/contracts/src/highlightPlan.ts`

입력: 전사 세그먼트(`{start,end,text}`), 구조화 필드(`hook`, `evidence_or_anecdote`, `good_match_for`, `three_specific_qualities`), Dater 표시 이름, 씬 샷 경계(있으면), 옵션(`targetMs` 24_000, `minMs` 15_000, `maxMs` 30_000).
출력: `HighlightPlan = { version: 1, windows: Array<{ startMs, endMs, reason }>, totalMs, hash } | null`.

규칙(전부 결정론):
1. 후보 단위는 **세그먼트**(문장 경계). 세그먼트 내부는 자르지 않는다.
2. 우선순위: ① Dater 이름 첫 등장 세그먼트(없으면 첫 세그먼트) ② `evidence_or_anecdote`와 토큰 겹침 최대 연속 세그먼트 묶음(≤3) ③ `good_match_for` 겹침 최대 ④ `three_specific_qualities`로 채움.
3. 창은 원래 순서로 정렬·인접 병합. 총길이 > `maxMs`면 ④→③→② 순 제거, < `minMs`면 인접 세그먼트 추가.
4. 경계에 40ms 여유, 다른 세그먼트 침범 금지. 샷 경계가 120ms 안에 있으면 그쪽으로 스냅(켄번즈 중간 컷 완화).
5. 세그먼트 < 2 또는 전사 없음 → `null`(워커는 Full 폴백).
6. `hash = sha256(JSON(windows))`; 같은 입력 100회 동일 테스트.

## 2. 렌더 — 잡·워커·캡처·인코딩

### 2.1 잡 모델(migration `0063_render_variant.sql`)
- `media_render_jobs` 컬럼 **추가만**: `variant TEXT NOT NULL DEFAULT 'highlight' CHECK (variant IN ('full','highlight'))`, `options JSONB NOT NULL DEFAULT '{}'`(`{music:boolean}`), `cut_plan JSONB`, `cut_hash TEXT`, `effective_variant TEXT`(폴백 기록). UNIQUE·멱등 로직 불변.
- `request_pitch_render(p_revision_id UUID, p_variant TEXT DEFAULT 'highlight', p_options JSONB DEFAULT '{}')` — **오버로드 금지**: 기존 1-인자 함수를 DROP하고 DEFAULT 있는 단일 함수로 재생성(구 번들의 1-인자 호출도 동작 → 배포 순서 안전). 유효성: variant CHECK, options 키 화이트리스트.
- `get_pitch_render_state`: 반환 컬럼 **끝에** `variant, effective_variant, options` 추가(DROP/CREATE). `renderJobRepo.ts:80-92`·`rpcContract.test.ts`를 먼저 갱신(migration SQL이 권위).
- `pitch_assets.asset_role TEXT NULL CHECK (asset_role IN ('selfie'))` 추가(T002). 업로드 경로에서 셀피만 설정. 저장 경로 규칙에 의존하지 않는다.
- ACL: 새 컬럼은 기존 테이블 GRANT를 따르되 `pitch_assets.asset_role`은 업로더만 쓸 수 있음을 RLS 테스트로 확인.

### 2.2 워커 흐름(`jobRunner.ts` / `renderScene.ts`)
1. 잡 클레임 → 씬·전사·스냅샷 로드 → `variant='highlight'`면 컷 플랜 계산·저장(`null`이면 `effective_variant='full'`).
2. 오디오: 원본 → PCM(s16le 48k mono, ffmpeg) → **엔벨로프**(프레임당 RMS, fps 해상도; ~23MB/60s, 예산 무관). 하이라이트면 창 구간 `atrim`+`concat`, 경계 20ms `afade`.
3. 음악(옵션 on): §2.6 절차 생성 WAV → `sidechaincompress`(음성 사이드체인, threshold −30dB, ratio 8, attack 5, release 250) → `amix` → AAC 128k, `-fflags +bitexact -flags +bitexact -threads 2`. 목표: 베드 RMS ≤ 음성 RMS −18dB(`astats`로 테스트 측정).
4. 셀피 오프닝: 스냅샷 포함 + `asset_role='selfie'` + 인제스트 `succeeded` 프록시가 있으면 ffmpeg로 처음 2.5s를 fps로 PNG 추출(1080×1920 cover crop) → 파이프 선두. 셀피 구간의 스테이지 타이틀은 캡처 페이지의 **오버레이 전용 모드**(투명 배경 위 크롬만)를 캡처해 ffmpeg `overlay`로 합성. 시각 결정론은 PNG 해시로 검증.
5. 캡처: 캡처 페이지에 `renderOverlay` 페이로드(변형·창·엔벨로프·타임드 단어·크롬 텍스트·보정 프리셋)를 전달, **창 안의 t만** 캡처. 총 프레임 = 셀피 + 창 합계 + 엔드카드 3.0s.
6. **불변식 단언**: 비디오 길이 ≥ 오디오 길이(음성 컷 + 음악 테일 포함). 음악 베드는 정확히 (컷 합계 + 엔드카드)로 잘라 페이드아웃한다.
7. 인코딩: 기존 `image2pipe`→libx264 유지, 오디오만 `-c:a aac`(Full 변형 + 음악 off면 기존 copy 경로 그대로).

### 2.3 스테이지 크롬 + 파형(`RenderOverlay.tsx`, 캡처 페이지 전용)
- 상단 세이프존(130px) 아래: 모노 라벨 "{INTRODUCER} INTRODUCES" / 이름 **{Dater name}** / 칩 "Friends for N years"(있을 때). 공개 페이지와 같은 토큰·서체(fontGate 자동 발견). 이름은 `publicDisplayName` 규칙.
- 파형: 측정 엔벨로프 60바, 자막 위, 재생 위치는 핑크·나머지 잉크 40%. 웹 플레이어는 변경하지 않는다.
- `domSignature()`에 `(variant, windowIndex, activeWordIndex, envelopeFrame)` 포함.

### 2.4 단어 자막(`wordCaptionFrame` 순수 함수)
- 입력: `TimedCaptionWord[]`, 원본 타임라인 `elapsedMs`, 창. 출력: 현재 줄(≤5단어, 세그먼트 경계 줄바꿈), 활성 인덱스.
- 스타일: Bricolage 700 44px 흰색 + 잉크 외곽선 3px, 활성 단어 머스터드 스티커, 정적 `scale(1.06)`. 위치: 하단 세이프존(484px) 위, 좌 44/우 140px 안. 좌표 단언 테스트.
- 타이밍 없으면 기존 세그먼트 캡션(`captionChrome`) 그대로.

### 2.5 엔드카드 3.0s(`endCard.ts` 확장)
- 크림 배경, "Approved by {Dater name}" 배지, 중앙 QR(페이지 URL, `qrcode` MIT, 결정론 SVG), URL 텍스트, CTA "DM FRIEND for the page". 자유 텍스트 없음.

### 2.6 음악 베드(`musicBed.ts`)
- 시드 = `cut_hash ?? scene_hash`. 정수 샘플 연산으로 PCM 합성: 템플릿별 BPM(warm 84 / hype 104), 4마디 루프, 고정 코드 세트에서 시드 선택, 사인+삼각 패드(+hype 소프트 킥). 길이 = 컷 합계 + 엔드카드, 마지막 1.5s 페이드. 자체 생성이라 저작권 없음. kit `music` 기본 on.

### 2.7 사진 보정(비생성형, `photoGrade.ts`)
- 캡처 페이지 CSS만: warm `contrast(1.06) saturate(1.08) brightness(1.02)` + 비네트 18% + 시드 고정 SVG 그레인 6%; hype `contrast(1.12) saturate(1.18)` + 그레인 4%. 기하 변형은 기존 크롭 래더만, 얼굴 픽셀 재생성 없음. 상수 테스트.

## 3. 셀피 클립(앱 + 동의, T004)
- `expo-camera` 추가(네이티브 리빌드·TestFlight 필요 — 앱은 다음 빌드), `NSCameraUsageDescription` 추가.
- 녹음 화면에 "Add a 3-second selfie clip (optional)" 카드: 전면 프리뷰 → 3~5s 캡처 → 미리보기·재촬영·삭제. 권한 거부 시 카드 숨김 + 설정 안내. 업로드는 기존 `clipIngest.ts` 경로, `pitch_assets.asset_role='selfie'` 설정. 문구: "Only your own face. Your friend approves it before it's used."
- **동의 화면(웹)**: 클립 카드에 포함/제외 토글(기본 제외 → Dater가 켜야 포함). `revisionAssetIds()`의 자동 유지를 제거하고 선택값을 리비전 저장 → `snapshot_video_asset_ids`. 기존 0050 assert가 스냅샷 밖 자산을 거부한다.
- 렌더는 §2.2-4. 프록시 없거나 미포함이면 사진 첫 창으로 시작.

## 4. kit UI(T005)
- `PitchExportCard`: **렌더 전**에 Highlight(기본)/Full + 음악 토글, 안내 "One MP4 per approved version — pick before you export. Highlight uses only what {name} approved, same words, shorter cut." 렌더 후에는 선택 잠금. 무료 1회 규칙 문구 유지. 파일명 `friendword-pitch-{variant}.mp4`.
- 캡션 팩에 "Add a trending sound on TikTok/Reels" 한 줄.

## 5. 테스트 계획
| 층 | 테스트 |
|---|---|
| contracts | `highlightPlan.test.ts`: 실제 40s·60s 전사 픽스처 → 15~30s, 이름 문장, 연속·순서, 병합, 스냅, 100회 결정론, 세그먼트<2 → null; 뮤테이션 red(정렬 제거). `timedCaptionWords.test.ts`: 결합·폴백 |
| DB | `38_render_variant.sql`: 컬럼·CHECK·DEFAULT 호출 호환(1-인자 호출 성공)·오버로드 부재·`get_pitch_render_state` 추가 컬럼·무료 규칙 불변·`asset_role` RLS; rpcContract |
| render | `wordCaption`(세이프존 좌표), `renderOverlay` 시그니처, `musicBed` 시드 결정론 + `astats` −18dB, `photoGrade` 상수, `endCard` QR, `encoderArgs` 변형별 인자(+bitexact), 프레임 해시+PCM 해시 4회 동일, video≥audio, 셀피 프레임 추출 해시, Full+music off = 기존 copy 경로 회귀 |
| mobile | 셀피 상태 머신(권한·거부·촬영·재촬영·삭제), `asset_role` 전달 |
| web ui/e2e | 동의 클립 토글 → 리비전 저장; kit 변형·음악·잠금·파일명 |
| 실증 | 프로덕션 실제 음성 캠페인 렌더 → ffprobe(15~30s+3s, video≥audio) + 프레임(0.5s/중간/엔드카드) + 레벨 |

## 6. 배포 순서·롤백
- 0063 push(DEFAULT로 구 번들 호환) → rpcContract/renderJobRepo 포함 웹 배포 → 앱은 다음 TestFlight(셀피는 앱 배포 전까지 자연히 비활성).
- 롤백: `RENDER_HIGHLIGHT_ENABLED=false` → 기존 경로. 컬럼은 남겨도 무해.

## 7. 예산·결정론
- 하이라이트는 프레임 수 30~40%(24s vs 60s). 최악(Full 60s + 셀피 + 음악 + 자막)을 render-bench로 실측, 480s 안 확인.
- ffmpeg-static 5.3.0 고정 바이너리 + bitexact + 정수 합성으로 재현성 확보; CI는 해시, 바이트 동일은 수동 벤치.

## 8. 태스크 계약 정정(이 문서가 권위)
- T002: "scene v3 빌더·assert 확장" → **컷 플랜·타임드 단어 계약 + migration 0063(variant/options/asset_role, RPC DEFAULT, state 컬럼) + data 계약**. 씬 스키마 무변경.
- T004: "v3 오프닝 샷" → **동의 화면 클립 포함/제외 승인 + 앱 캡처(`asset_role='selfie'`) + 워커 셀피 프레임 추출**.
- T003/T005: 위 §2·§4대로. goal.json의 "v3 스키마" 제약은 이 결정으로 대체(DECISIONS 2026-09-09).
