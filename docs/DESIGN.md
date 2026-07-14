# Friendword Design System — "Hype Mixtape"

> 결정: 2026-07-12, Advisor(Claude). 디자인 전권 위임 + 사용자 피드백("데이팅
> 앱은 액티브하고 펑키해야 한다") 반영. 초기 "촛불 스토리텔링" 방향은 폐기.
> 토큰 구현: `packages/ui-tokens`. 이 문서와 토큰이 충돌하면 문서를 먼저 고친다.

## 방향

Friendword에서 친구는 나의 **hype person**이다. UI는 절친이 나를 자랑하려고
만든 **진(zine)/믹스테이프**처럼 느껴져야 한다 — 활기차고, 펑키하고, 대담하게.

- **Cream paper**: 따뜻한 크림 캔버스(`#FFF6EA`) 위에 진한 잉크(`#221B15`)
- **팝 컬러 3인방**: 탠저린(`#FF5B2E`, 에너지·CTA) + 핫핑크(`#FF3D8A`,
  로맨스·파형) + 선샤인(`#FFC63F`, 하이프·배지). 검증/안전은 teal(`#17B89B`)
- **스티커 미학**: 두꺼운 잉크 아웃라인 + 하드 오프셋 섀도(`4px 4px 0 ink`),
  살짝 기울어진(-3°~2.5°) 배지·카드가 콜라주 에너지를 만든다
- **큰 목소리 타이포**: Unbounded(디스플레이 — 와이드하고 당당함, 큰 사이즈
  전용) + Bricolage Grotesque(본문/UI — 성격 있는 그로테스크)
- **바운시 모션**: 등장은 살짝 오버슈트(`cubic-bezier(0.34,1.56,0.64,1)`),
  스티커가 튀어 들어오고, 파형이 리듬에 맞춰 뛴다
- **파형 = 브랜드 모티프**: 친구 목소리의 파형을 장식이 아닌 주인공으로.
  재생 시 핫핑크로 살아 움직인다

## 하지 않는 것

- 무디한 다크·촛불·세리프 로맨스 (거부된 방향)
- 보라 그라데이션, 네온-온-블랙 Tinder 클론, 차가운 코퍼레이트 미니멀
- Inter/Roboto/Arial/Space Grotesk 등 범용 폰트
- 불꽃·하트 이모지 남발, 스와이프 카드 은유
- 과도한 글래스모피즘·블러

## 레이어와 표면별 표현 강도 (2026-07-13 감사 반영 — 구현은 Slice I)

Hype Mixtape는 폐기하지 않는다. 문제는 캠페인 포스터의 언어를 신원·결제·신고까지
같은 크기로 말한 것이다. 시스템을 세 레이어로 분리한다:

- **Brand Foundation**(전 표면 공통): cream/ink, Bricolage, 파형 모티프
- **Campaign Expression**(공개 피치·소셜): 스티커·틸트·하드 섀도·Unbounded 전부 허용
- **Trust Layer**(동의·신원·결제·신고·삭제): 장식보다 상태·위험·복구 가능성·명확한
  hierarchy. tilt 0, soft shadow 또는 1px border, ease-out 모션, Bricolage 중심.
  Unbounded는 wordmark/단일 heading 외 금지. teal은 신뢰 신호로만

| 표면                                         | 표현 강도 | 규칙                                                     |
| -------------------------------------------- | --------: | -------------------------------------------------------- |
| 공개 피치·social asset                       |      100% | hard shadow, tilt, sticker, bounce, Unbounded 허용       |
| Introducer 피치 제작                         |       70% | track metaphor·선택 chip 유지, form/card 반복은 절제     |
| 모바일 홈                                    |       40% | hero 1개만 강하게, 보조 탐색은 조용하게                  |
| Dater consent                                |       20% | horizontal·low motion·soft elevation, teal을 신뢰 신호로 |
| Interest / inbox / chat                      |    10~20% | 사진·텍스트·판단이 주인공, tilt 제거                     |
| identity / phone / payment / report / delete |     0~10% | 장식보다 상태·위험·복구 가능성·명확한 hierarchy 우선     |

컴포넌트 분리(Slice I): `CampaignCard` / `TrustCard` / `PrimaryAction` /
`SafetyAction` / `QuietNavAction`. "Release day", "This link doesn't play" 같은
믹스테이프 은유는 campaign surface 전용 — identity/payment/error/safety에서는
직접적인 문구를 쓴다.

### Trust Layer 시각 스펙 (확정 2026-07-14, 3차 감사 §8 acceptance 5·4)

적용 표면: consent(AI disclosure)·identity·phone·payment(paywall)·report·block·
delete — 위 표의 0~20% 대역. landing/공개 피치/hype 표면은 아래 수치를 적용하지
않고 Campaign Expression(100%)을 유지한다. 모바일·웹이 **동일 수치**를 쓴다.

| 속성                | Trust Layer 값                                                                                                    | Campaign 값(불변)              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| border 두께         | **1px** (`strokes.trust`)                                                                                         | 2px (`strokes.sticker`)        |
| border 색(중립)     | **`borderMuted` #8A7D73** — 3.73:1 cream / 3.99:1 white                                                           | `ink` #221B15                  |
| border 색(성공)     | **`borderSuccess` #0E8F76** — 3.77:1 / 4.03:1 (teal 신호)                                                         | —                              |
| border 색(위험)     | **`danger` #C63838** — 4.88:1 / 5.22:1                                                                            | —                              |
| shadow              | **soft `shadows.trust`** = `0 4px 16px rgba(34,27,21,0.08)` (RN: offset {0,4}·radius 16·opacity 0.08·elevation 2) | hard `4px 4px 0 ink` opacity 1 |
| tilt / rotation     | **0°**                                                                                                            | −3…2.5°                        |
| corner radius       | `radii.md` 20                                                                                                     | 20                             |
| display 폰트        | **Unbounded 금지** (wordmark·단일 page heading 1개 예외). title은 BricolageGrotesque Bold                         | Unbounded 허용                 |
| press 모션          | **scale ≥ 0.99**, `motion.easeOut`; reduced-motion에서 transform 제거                                             | scale 0.97 bounce              |
| 등장 모션           | opacity/translate만, `motion.easeOut`, 오버슈트 없음                                                              | bounce 오버슈트                |
| teal                | `fresh`/`borderSuccess`는 **신뢰·검증 신호 전용**                                                                 | —                              |
| 최소 터치 타깃      | **44×44 pt** (SafetyAction 48·HypeButton 52·QuietNavAction 44)                                                    | —                              |
| `textFaint` #A2958A | **placeholder/disabled fill 전용** — border·fine print 금지(non-text 2.72/2.92, 3:1 미달)                         | —                              |

**Non-text 대비 규칙(WCAG 1.4.11):** 모든 Trust Layer border/경계 토큰은 cream
(#FFF6EA)과 white(#FFFFFF) **양쪽**에서 ≥3:1을 만족한다. `fresh`(#17B89B)는
border로 쓰면 2.35/2.51로 실패하므로 성공 경계는 `borderSuccess`를 쓰고 `fresh`는
fill/아이콘에만 쓴다. 검증: `packages/ui-tokens/src/contrast.test.ts` non-text
matrix.

**웹 매핑(s7-web 소유):** `apps/web/app/theme-tokens.ts`에 CSS 변수 4개 추가 —
`--color-border-muted`, `--color-border-success`, `--shadow-trust`(`0 4px 16px
rgba(34,27,21,0.08)`), `--stroke-trust`(`1px`). 웹 trust 표면(ConsentFlow·web
report/delete/paywall)은 border 1px `var(--color-border-muted|success)` 또는
`var(--color-danger)`, `box-shadow: var(--shadow-trust)`, rotation 0,
Unbounded 금지(heading 1개 예외), `var(--motion-ease-out)`, press ≥0.99, 44px
타깃을 적용한다. 기존 `--color-text-faint`는 border/fine print에 쓰지 않는다.

### 대비 정정 (D-P0, 2026-07-13)

측정 결과 `onPop #FFF9F2` on `pop #FF5B2E`는 **2.96:1**로 아래 접근성 기준을
위반한다(`danger` 위 white 3.91:1, `textFaint` on cream 2.72:1도 위반). **결정:
saturated fill 위 기본 텍스트는 `ink #221B15`로 통일한다.** 흰색을 유지하려면
4.5:1이 실측 검증된 어두운 배경 token을 별도로 만든다. `textFaint`는
placeholder/disabled 외의 fine print에 쓰지 않는다. 자동 contrast check를
Slice I acceptance로 한다.

## 표면별 지침

### 모바일 앱 (Expo)

- 라이트 고정 (`userInterfaceStyle: 'light'`), 크림 캔버스 + 잉크 텍스트
- 주요 CTA: 탠저린 필(`pop`) + `onPop` 텍스트, 프레스 시 `popPressed` +
  스케일 0.97 바운스
- 카드: 화이트 `surface` + `radii.md(20)` + 잉크 아웃라인 2px + sticker 섀도
- 녹음 버튼: sunset 그라데이션 원형, 대기 시 가볍게 바운스, 녹음 중 실제
  오디오 레벨로 파형이 뛴다
- 관계·기간 선택은 기울어진 스티커 칩(선택 시 sunshine 필 + 잉크 아웃라인)
- 진행 표시: 단계 점이 아니라 믹스테이프 트랙 번호("Track 2 of 5") 감성
- 타이틀 Unbounded, 그 외 Bricolage Grotesque

### 공개 피치 페이지 (web, `/p/[slug]`)

- 크림 배경 + 흩어진 스티커 요소(별·스마일·squiggle SVG)로 하이프 무드
- **9:16 피치 카드만 잉크 스테이지(`stage`)** — 미디어가 주인공이 되도록
  다크. 카드에 잉크 아웃라인 + 큰 sticker 섀도
- 카드 내부: 사진 크로스페이드, 핫핑크 파형 프로그레스, 자막은 단어 단위로
  밝아짐, 상단 "{pseudonym} introduces {name}" + 기울어진 관계 스티커
- `I'm interested`: 탠저린 필 스티커 버튼, 모바일 sticky bottom
- Vouch Card: sunshine 배지 + 기울기, "+2 friends vouch" 카운터
- 종료 CTA: "Pitch a friend" / "Create my Friendword" 두 스티커 버튼
- 로드 시 스태거 리빌 1회(90ms 간격, 바운스), reduced-motion 존중

## 접근성

- 잉크 on 크림 대비 ≥ 13:1, secondary ≥ 4.5:1
- `onPop`/`onHype` 텍스트 대비 4.5:1 이상 유지 (팝 필 위 텍스트는 크게)
- 터치 타깃 44pt+, 오디오에는 항상 자막, reduced-motion 시 바운스 제거
