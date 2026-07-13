# 위협 모델

## Fake 소개 시나리오

대표 공격은 Introducer가 무관한 사람 A의 사진으로 피치를 만들고 공모자 B가 Dater인 것처럼 승인하는 경우입니다. Friendword의 동의와 검증은 이 위험을 낮추는 여러 층 중 하나이며, 공모·도난 신분·합성 미디어를 완전히 제거하지 못합니다.

## 완화책

1. Dater의 selfie liveness와 공개 대표 사진 face match
2. 모든 사진에 대한 Dater의 개별 승인
3. Introducer와 Dater의 별도 전화 확인
4. 두 계정의 device/account 위험 신호와 반복 신고 감지
5. `Verified Dater`를 계정·얼굴 일치로만 정의하고 성격이나 안전 보증으로 설명하지 않음
6. Interested Person에게도 동일한 기본 얼굴·전화 확인 적용

## 구현된 서버 방어 (2026-07-13, 2차 감사 대응)

- 신고 남용: auto-pause는 신뢰 가능한 distinct reporter identity(익명은 salted IP hash)만 계산하고, 같은 대상·사유·identity의 24시간 반복 신고는 dedupe — 한 사람이 신고 2건으로 캠페인을 내릴 수 없습니다(0024).
- 성장 지표 위조: 발행·관심·결제·안전 outcome 이벤트는 DB 트리거만 기록하며 client 전송은 거부됩니다(0033).
- 비용 남용: provider 호출은 사용자별 시간당 quota·월 $200 hard cap·kill switch·AI 처리 동의를 원자적으로 검사하는 reserve를 통과해야 합니다(0031).
- 접점 위조: 신규 consent request는 verified channel+contact 바인딩이 서버 불변식이고, token 소지만으로는 claim할 수 없습니다(0029).
- 만료 불일치: `ends_at`이 지난 캠페인은 공개 read가 차단되고 재개가 거부되며 만료 잡이 상태를 수렴시킵니다(0033).
- 위 selfie liveness·face match(완화책 1·6)는 스키마·게이트만 존재하며 identity 벤더 연동 전까지 enforcement off입니다.

## 주장과 공개 경계

- “safe”, “background checked”, 사기 방지 보장처럼 검증 범위를 넘는 표현을 사용하지 않습니다.
- 친구 추천이 성격이나 사실을 증명한다고 주장하지 않습니다. 친구와 당사자가 함께 거짓말할 수 있습니다.
- 정확한 위치, 전화번호, 이메일, 법적 이름, 신원확인 원본을 public payload에 포함하지 않습니다.
- 정부 신분증은 자체 저장하지 않고 가능한 경우 검증 공급자가 처리합니다.
- 신고, 차단, 캠페인 중지, 동의 철회와 삭제는 결제 여부에 영향을 받지 않습니다.
- high-severity 신고 시 즉시 노출을 중지하고 검토하며 audit trail을 남깁니다.
