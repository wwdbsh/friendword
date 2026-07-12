# 비용 모델

> 공식 가격 확인 날짜: **2026-07-12**  
> 통화: USD. 세금, 환율, SMS carrier fee, 지역 차이와 향후 가격 변경은 별도입니다.

## 재무 안전 기준

무료 사용자도 전화 인증, 얼굴 liveness, media 처리, 저장과 전송 변동비를 발생시킵니다. 따라서 모든 사용자별 흑자가 아니라 다음 두 조건을 기준으로 운영합니다.

1. 캠페인당 변동비 상한을 두어 사용 증가가 통제 불가능한 손실이 되지 않게 합니다.
2. 월간 cohort에서 Creator Launch와 Campaign Pass의 혼합 매출로 무료 사용자의 변동비와 고정비를 함께 회수합니다.

안전 기능은 무료로 유지하고 비용이 큰 생성·내보내기·재렌더·보관 기간을 제한합니다.

## 공식 가격 입력값

| 항목                          |                                 공식 가격 또는 무료 구간 | Friendword 적용                    | 출처                                                                                         |
| ----------------------------- | -------------------------------------------------------: | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Apple Developer Program       |                                                   $99/년 | 월 환산 $8.25                      | [Apple](https://developer.apple.com/programs/whats-included/)                                |
| Apple Small Business Program  |                                           IAP 수수료 15% | 승인 전 30% 시나리오도 계산        | [Apple](https://developer.apple.com/app-store/small-business-program/)                       |
| RevenueCat                    |                월 tracked revenue $2,500까지 $0, 이후 1% | 해커톤 단계 $0 가정                | [RevenueCat](https://www.revenuecat.com/pricing)                                             |
| Supabase Pro                  |         $25/월, 100K MAU·100GB storage·250GB egress 포함 | production DB/Auth/Storage         | [Supabase](https://supabase.com/pricing)                                                     |
| Vercel Pro                    |                            $20/월, $20 usage credit 포함 | 상업용 public web pitch            | [Vercel](https://vercel.com/pricing)                                                         |
| PostHog                       |                                        월 1M events 무료 | 초기 $0                            | [PostHog](https://posthog.com/)                                                              |
| Twilio Verify, 미국 SMS       |      성공 인증당 $0.05 + SMS당 $0.0083, carrier fee 별도 | 성공 인증 1회 최소 $0.0583         | [Twilio](https://www.twilio.com/en-us/verify/pricing/)                                       |
| AWS Rekognition Face Liveness |                                      첫 500K회 $0.015/회 | 고의도 단계에서만 실행             | [AWS](https://aws.amazon.com/rekognition/pricing/)                                           |
| AWS Rekognition image API     |                             초기 구간 약 $0.001/API call | face compare·이미지 moderation     | [AWS](https://aws.amazon.com/rekognition/pricing/)                                           |
| OpenAI Moderation             |                                          API 사용자 무료 | 1차 필터, 운영 검토 대체 불가      | [OpenAI](https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use) |
| Cloud Run                     | us-central1 월 240K vCPU-sec·450K GiB-sec 무료 후 종량제 | FFmpeg/Remotion, max instance 제한 | [Google Cloud](https://cloud.google.com/run/pricing)                                         |

공급자 가격을 확인할 때 이 표의 날짜와 URL을 갱신하고 아래 계산, 비용 경보와 운영 결정을 함께 다시 계산합니다.

## 캠페인당 변동비

캠페인당 Interested Person 0.4명, Introducer 1명, Dater 1명을 둔 개발 전 보수적 예산 가정입니다. 공급자 청구서가 아닙니다.

| 비용 발생 지점                  |                                                    가정 |    캠페인당 추정 |
| ------------------------------- | ------------------------------------------------------: | ---------------: |
| 전화 OTP                        | Introducer 1 + Dater 1 + Interested 0.4, 성공당 $0.0583 |           $0.140 |
| Liveness                        |                   Dater 1 + Interested 0.4, 회당 $0.015 |           $0.021 |
| Face compare·이미지 moderation  |                                        약 6~7 API calls |           $0.007 |
| 음성 전사·structured generation |                                      원본 1분 이하, 1회 | $0.010 이하 목표 |
| 최종 media render               |                                             승인 후 1회 | $0.010 이하 목표 |
| Storage·egress·email·기타       |               20 views, lifecycle deletion, 포함량 우선 |           $0.020 |
| **직접비 소계**                 |                                                         |    **약 $0.208** |
| **예산 기준**                   |                         retry·실패·fraud·지역 차이 포함 |        **$0.25** |
| **스트레스 기준**               |                                 SMS 재전송·초과 traffic |        **$0.50** |

핵심 KPI는 `Cost per Published Campaign`입니다. 정상 기준은 $0.25, hard investigation threshold는 $0.50입니다. 중단된 draft의 선행 OTP·AI 비용은 `Cost per Started Campaign`에 기록합니다.

## 월 고정비

| 항목                         |                   월 환산 |
| ---------------------------- | ------------------------: |
| Supabase Pro                 |                    $25.00 |
| Vercel Pro                   |                    $20.00 |
| Apple Developer Program      |                     $8.25 |
| 도메인·DNS 예비비            |                  약 $2.00 |
| RevenueCat·PostHog·Cloud Run | 초기 무료 구간 내 $0 가정 |
| **기준 고정비**              |             **약 $55/월** |

법률 자문, 유료 디자인 자산, 광고비, 개발 노동비, 환율·세금은 포함하지 않습니다. 전문 법률 검토는 기술 운영비와 분리합니다.

## 손익분기

Small Business Program의 15% 수수료 적용 가정입니다.

```text
$4.99 Creator Launch 순매출 = $4.99 × 0.85 = $4.2415
$19.99 Campaign Pass 순매출 = $19.99 × 0.85 = $16.9915

월 손익 = creator_launch_count × $4.2415
          + campaign_pass_count × $16.9915
          - published_campaigns × $0.25
          - $55
```

월 100개 published campaigns의 고정비+변동비는 약 $80입니다.

| 상품 혼합                            | App Store 순매출 | 월 손익 |
| ------------------------------------ | ---------------: | ------: |
| 모두 무료                            |            $0.00 | -$80.00 |
| Creator Launch 5%, Pass 0%           |           $21.21 | -$58.79 |
| Creator Launch 10%, Campaign Pass 3% |           $93.39 | +$13.39 |
| Creator Launch만 20%                 |           $84.83 |  +$4.83 |

Creator Launch만으로 100개 무료 캠페인을 보전하려면 약 19% 구매가 필요합니다. 초기 혼합 목표는 Creator Launch 10%와 Campaign Pass 3%입니다. 수수료가 30%이면 손익분기가 악화되므로 Small Business Program 승인을 출시 체크리스트에 둡니다. 유료 광고는 `CAC ≤ 90-day contribution margin`이 입증되기 전 확대하지 않습니다.

## 비용 폭주 방지

1. **Render late**: preview는 client-side motion, 서버 MP4는 Dater 최종 승인 후 1회만 생성합니다.
2. **Verify late**: Dater는 승인 직전, Interested Person은 프로필 제출 직전에 liveness를 실행합니다.
3. **One free campaign**: verified Dater당 무료 활성 캠페인 1개, 기본 theme, server re-cut 없음으로 제한합니다.
4. **Finite free cohort**: 초기 무료 캠페인은 월 100개처럼 예산 슬롯을 두고 소진 후 waitlist/다음 달 발급으로 전환합니다. 기존 캠페인과 안전 기능은 유지합니다.
5. **Lifecycle deletion**: 원본 음성·실패 render는 승인 후 7일, 만료 캠페인의 대형 export는 grace period 후 삭제합니다.
6. **Rate limit**: 전화번호·device·IP·campaign 기준 OTP, AI generation, liveness와 render 횟수를 제한합니다.
7. **Provider caps**: Cloud Run max instances, Twilio usage trigger, AWS Budget, OpenAI project budget, Supabase/Vercel spend alert를 설정합니다.
8. **Kill switch**: 신규 campaign creation, render와 SMS를 각각 중지할 수 있게 하되 신고·차단·삭제·기존 채팅은 유지합니다.
9. **No automatic re-render**: Vouch Card 추가 시 MP4를 자동 재생성하지 않습니다.
10. **No paid acquisition before proof**: organic cohort의 activation, paid conversion과 cost per campaign을 확인하기 전 광고를 집행하지 않습니다.

## 재무 운영 게이트

- **매일**: provider별 spend, failed OTP/render, fraud anomaly
- **매주**: campaign cohort revenue, variable cost, gross contribution, refund 및 이 문서의 공식 가격 재검증
- **월간 hard cap**: 초기 전체 cloud/API 비용 **$200**
- **75% 도달**: 신규 무료 슬롯 축소
- **90% 도달**: 유료·기존 안전 경로를 제외한 고비용 작업 중지
- **가격 유지 조건**: Creator Launch ≥ 10%, Campaign Pass ≥ 3% 또는 동일 contribution의 독립 상품 조합
- **구조 재검토**: 2주 연속 cost per published campaign > $0.50, refund > 5%, 또는 전체 paid product conversion < 8%
- **실험 원칙**: 가격 실험은 한 번에 하나만 바꾸고 cohort별 App Store 순매출로 계산
