# 개인정보 데이터 맵

> 상태: 초기 설계. 출시 전 공급자, 법적 근거, 정확한 보존 기간과 삭제 SLA를 확정해야 합니다.

## 확정 원칙

- 음성·사진을 외부 AI 공급자에게 보내기 전에 처리 목적과 공급자 공유를 명시하고 동의받습니다.
- AI는 친구 발언을 더 강한 사실로 변형하지 않습니다. 범죄 이력, 건강, 성생활, 재산, 직업, 학력 등 민감·객관 주장에는 Dater 확인을 요구합니다.
- AI 결과는 사람이 편집하고 Dater가 공개 전 최종 승인합니다.
- 원본 음성은 승인·렌더 완료 후 짧게 보존하고 사용자가 즉시 삭제할 수 있게 합니다. 비용 모델의 초기 lifecycle 기준은 승인 후 7일입니다.
- public pitch asset과 원본 media bucket을 분리하고 signed URL과 최소 권한을 적용합니다.
- 정확한 위치, 전화번호, 이메일, 법적 이름과 신원확인 원본은 public payload에 포함하지 않습니다.
- 정부 신분증은 자체 저장하지 않고 가능한 경우 검증 공급자가 처리합니다.
- analytics에는 민감한 음성·사진·메시지 내용을 보내지 않습니다.
- 삭제·동의 철회·신고·차단 기능은 결제 여부와 무관합니다.

## 데이터 유형별 맵

`확정 필요` 항목은 핸드오프에 구체 기간이나 공급자가 정해지지 않았음을 뜻합니다.

| 데이터 유형                                   | 수집·처리 목적                              | 보존 기준                                                    | 삭제·철회                                                       | 공급자 공유                                          |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| 계정 identity, 전화번호, 전화 확인 시각       | 계정 소유 확인, 초대 claim, abuse 방지      | 계정·법적/안전 요구에 맞춰 확정 필요                         | 계정 삭제 경로 제공; 보존 예외 확정 필요                        | Auth 및 phone verification 공급자, 구체 공급자 미정  |
| 생년월일, age assertion                       | 18+ 접근 통제                               | 확정 필요                                                    | 계정 삭제 정책에 포함                                           | Identity provider, 구체 공급자 미정                  |
| selfie liveness, face match 입력              | Dater·Interested Person 얼굴/계정 일치 확인 | 원본은 자체 저장하지 않는 것이 원칙; 공급자 보존 확인 필요   | 공급자 삭제·철회 절차 확정 필요                                 | 외부 identity provider                               |
| verification status/reference/timestamp       | 검증 상태 재사용과 위험 기반 재검증         | 유효기간·안전 요구에 맞춰 확정 필요                          | 계정 삭제 정책에 포함                                           | DB에는 결과와 provider reference만 저장              |
| 초대 연락처                                   | Dater 동의 초대 전송                        | 초대 처리 후 보존 기간 확정 필요                             | 초대 취소·계정 삭제 경로에 포함                                 | 통신 공급자                                          |
| dating profile 사진, bio, intent, 대략적 위치 | 관심 표현과 Dater 판단                      | profile lifecycle 기준 확정 필요                             | 사용자가 수정·삭제 가능                                         | Storage, identity/moderation 공급자                  |
| pitch 제안 사진·승인 상태                     | 비공개 draft, Dater 승인, 공개 pitch 생성   | 원본과 public asset을 분리; 기간 확정 필요                   | Dater가 개별 삭제·교체, 캠페인 삭제 가능                        | Storage, image moderation, face match 공급자         |
| 원본 친구 음성·전사                           | pitch 작성, 구조화, 자막·render             | 승인·render 후 초기 기준 7일                                 | 즉시 삭제 기능 제공                                             | Storage, speech-to-text, audio moderation 공급자     |
| AI structured draft                           | 편집 가능한 pitch 문구 생성                 | draft/campaign lifecycle 기준 확정 필요                      | Introducer 검토, Dater 수정·거절·삭제                           | structured-generation 공급자                         |
| 공개 pitch와 MP4 export                       | 무가입 열람과 외부 공유                     | 캠페인 만료·grace period 후 대형 export 삭제; 기간 확정 필요 | Dater pause/revoke/delete; 외부에 이미 업로드한 MP4는 회수 불가 | public hosting/CDN, media renderer                   |
| interests와 Intro Room 메시지                 | 관심 검토와 수락 후 대화                    | 안전·계정 정책에 맞춰 확정 필요                              | withdraw/block/leave/delete 경로 정의 필요                      | Supabase DB/Realtime; 메시지 내용은 analytics와 분리 |
| report, block, moderation audit               | 안전 조치, 재발 방지, appeal/audit          | 안전·법적 요구에 맞춰 확정 필요                              | 삭제 요청과 안전 보존 예외를 명시해야 함                        | moderation provider 및 내부 운영 도구                |
| purchase, entitlement, credit ledger          | 구매·복원·환불·만료와 scope 권한 검증       | 스토어·회계 요구에 맞춰 확정 필요                            | 계정 삭제와 의무 보존의 관계 확정 필요                          | RevenueCat, Apple/Google                             |
| analytics, attribution                        | 퍼널·referral·experiment 측정               | 기간 확정 필요                                               | 비식별화·삭제 절차 확정 필요                                    | PostHog 또는 동등 공급자; 콘텐츠 본문 금지           |
| provider usage, cost ledger                   | 비용 상한과 abuse 탐지                      | 재무 운영 기간 확정 필요                                     | 사용자 식별 최소화                                              | 내부 DB와 각 provider billing                        |

## 출시 전 확인 항목

- identity, phone, AI, moderation, analytics 공급자와 각 데이터 보존·삭제 조건
- privacy notice, consent copy, App Store privacy manifest와 Google Play Data Safety 응답
- 계정·캠페인·원본 media·message·safety record별 정확한 보존 기간과 삭제 SLA
- signed URL 만료, bucket policy, public projection과 service-role 노출 방지
- 공개 support contact와 child safety contact
