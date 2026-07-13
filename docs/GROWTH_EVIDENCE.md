# Grand Prize Growth Evidence

> 상태: **수집 시작 전**  
> 확인 날짜: **2026-07-12**  
> 현재 실제 사용자·캠페인·매출 데이터: **없음**

이 문서는 예측이나 목표를 실제 성과처럼 기록하지 않습니다. 출시 후 재현 가능한 dashboard/export와 원천 이벤트를 근거로 각 항목을 채웁니다.

**증거 원천 규칙 (2026-07-13, Slice 9):** 전환·발행·결제·수락 지표는 `analytics_events`에서 `properties.recorded_by = "server"`인 행(0033 트리거 기록)만 사용합니다. client가 보낼 수 있는 interaction 이벤트(`pitch_viewed_unique` 등)는 노출·유입 지표로만 쓰고, 조작 가능성 한계를 함께 표기합니다. 지표 정의는 `docs/ANALYTICS_PLAN.md`의 "지표 정의" 절을 따릅니다.

## 제품 퍼널

- [ ] 출시일부터 일별·주별 verified users
- [ ] published campaigns와 consent sent→published 승인율
- [ ] unique external viewers와 acquisition source
- [ ] verified interests와 view→interest 전환율
- [ ] accepted Intro Rooms와 interest→accepted 전환율
- [ ] first-message rate
- [ ] referral로 만들어진 새 캠페인 수와 campaign K-factor

## 수익

- [ ] Creator Launch와 Campaign Pass payer 수
- [ ] gross revenue와 App Store 순매출
- [ ] paywall impression→purchase conversion
- [ ] refund 수·비율, expiration과 repurchase
- [ ] paid campaign이 accepted intro에 미친 결과

## 공개 성장·스토어 증거

- [ ] 앱스토어 rating과 review 수
- [ ] BuildInPublic 포스트 URL, 게시일, impressions와 comments
- [ ] 실제 반영한 사용자·커뮤니티 feedback
- [ ] 출시 후 기능 변경과 변경 전후 지표

## 안전·품질

- [ ] fraud, report와 block 지표
- [ ] high-severity 신고 처리 시간
- [ ] moderation false positive/negative 비식별 표본
- [ ] purchase/webhook/render 실패율과 해결 기록

## 증거 품질 체크

- [ ] 수치의 절대 기간, timezone, cohort 정의가 명시됨
- [ ] 이벤트 schema와 집계 쿼리/export 버전이 재현 가능함
- [ ] 민감한 음성·사진·메시지·연락처·법적 이름·신원 자료를 포함하지 않음
- [ ] 목표와 실제값을 분리함
- [ ] 스크린샷 수치가 dashboard/export 원본과 일치함
- [ ] 상금 액수를 확정적으로 홍보하지 않음
