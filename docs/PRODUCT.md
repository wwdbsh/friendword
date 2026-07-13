# 제품 정의

> 이 문서는 목표 제품 계약입니다. 구현 현황(2026-07-13, 2차 감사 Slice 0~~10 완주): Flow A~~C와 공개 피치·인박스·Intro Room·Creator kit은 구현·검증됐고, Dater는 문구·사진·audience·위치 정밀도·기간(7/14일)을 실제로 통제합니다. Flow D(추가 vouch)와 MP4 export는 P1 미구현입니다. 신원·얼굴 검증은 스키마·게이트만 존재하며 벤더 연동 전까지 enforcement off — 완료 상태는 `docs/SESSION_HANDOFF.md`·`docs/TASKS.md`를 따릅니다.

## Overview

Friendword는 친구의 30~60초 음성 추천을 당사자가 승인한 사진·문구와 결합해 공유 가능한 세로형 모션 피치로 만들고, 이를 본 사람이 검증된 프로필로 관심을 표현한 뒤 당사자가 수락하면 안전한 인앱 대화를 시작하는 18세 이상 대상의 friend-led dating campaign 앱입니다.

> **Dating, in your friends' words.**

Friendword는 공개 프로필 피드나 무한 스와이프가 있는 또 하나의 데이팅 마켓플레이스가 아닙니다. 발견은 친구가 기존 소셜 네트워크에 공유한 campaign URL에서 시작하며, 한 캠페인이 시청자·관심 표현자·새 소개자를 유입시키는 공유 루프를 만듭니다.

## 세 컨텍스트 역할

역할은 계정 유형이 아니라 특정 resource와의 관계입니다.

| 역할              | 책임                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Introducer        | 싱글 친구를 추천하고 사진을 제안하며 30~60초 원본 음성을 녹음합니다.                          |
| Dater             | 소개 대상자로서 신원 확인 후 사진·문구·음성·공개 범위를 수정·승인하고 캠페인을 소유합니다.    |
| Interested Person | 피치를 무가입으로 본 뒤, 본인 사진·기본 프로필·연락처·성인 확인을 완료하고 관심을 표현합니다. |

한 사람은 하나의 User로 캠페인마다 다른 역할을 수행할 수 있습니다. 회원가입에서 역할을 고정하거나 계정 모드를 전환하지 않습니다. `Creator`는 상품명일 뿐 계정이나 도메인 역할이 아닙니다.

## 핵심 원칙

- Dater의 동의 전에는 피치를 공개하지 않습니다.
- Introducer가 올린 사진은 제안이며 Dater가 개별 승인·삭제·교체합니다.
- Introducer의 실제 음성을 사용하고 얼굴 출연, AI 아바타, 음성 복제, 립싱크 딥페이크를 만들지 않습니다.
- 피치는 승인된 사진, 원본 친구 음성, 자막, 키네틱 타이포그래피, 파형과 그래픽으로 구성합니다.
- 링크 열람에는 가입이 필요 없지만 관심 표현에는 검증된 사진과 프로필이 필요합니다.
- 전화번호와 이메일을 즉시 공개하지 않고, 수락 후 인앱 Intro Room에서 먼저 대화합니다.
- 신고, 차단, 동의 철회, 캠페인 중지, 데이터 삭제와 안전 기능은 결제 여부와 무관하게 제공합니다.
- 대량 소개와 타인 대상화를 유도할 글로벌 Introducer 랭킹을 만들지 않습니다.

## 확정 흐름

### Flow A: Introducer가 피치 시작

1. `Pitch a friend` 행동으로 해당 draft의 Introducer 컨텍스트가 됩니다.
2. 친구와의 관계 유형·기간 및 동의 초대 연락처를 입력합니다. 연락처는 초대 전송에만 사용합니다.
3. 비공개 draft에서 사진을 제안하고 30~60초 음성을 녹음합니다.
4. AI가 `hook`, `relationship_context`, `three_specific_qualities`, `evidence_or_anecdote`, `good_match_for`, `hard_claims_requiring_confirmation` 구조의 editable JSON을 만듭니다.
5. Introducer가 검토하고 Dater에게 승인 요청을 보냅니다.

### Flow B: Dater가 신원 확인 및 승인

1. Dater가 deep link로 가입하거나 기존 User로 로그인합니다.
2. 서버가 invitation contact와 로그인 identity를 확인하고 consent request와 `DATER_OWNER` membership을 연결합니다.
3. 계정 수준의 18세 이상·전화 확인을 재사용하고, 만료나 위험 신호가 있을 때 selfie liveness/face match를 다시 수행합니다.
4. 사진을 승인·교체·삭제하고 AI 문구와 원본 음성을 검토해 수정 요청 또는 승인합니다.
5. 위치 공개 정밀도, dating intent, 관심 필터와 종료일을 선택합니다.
6. 최종 승인 시 처음으로 pitch URL을 생성합니다.

### Flow C: 시청 및 관심 표현

1. 누구나 공유 링크를 가입 없이 봅니다.
2. `I'm interested`를 누르면 가입·로그인 후 해당 interest의 Interested Person 컨텍스트가 됩니다.
3. 기존 `dating_profile`을 재사용하거나 최소 2장의 현재 사진, 짧은 bio, 나이, 대략적 위치와 dating intent를 제출합니다.
4. Dater가 관심 인박스에서 수락·거절·신고합니다.
5. 수락하면 Intro Room이 열리고, 연락처는 두 사람이 별도로 선택할 때만 공유됩니다.

### Flow D: 여러 친구 추천 추가

1. Published campaign의 Dater 또는 최초 Introducer가 다른 친구에게 추천을 요청합니다.
2. 추가 친구가 짧은 음성 또는 텍스트 추천을 제출합니다.
3. Dater 승인 후 동적 웹 피치에 독립 Vouch Card로 추가합니다.
4. 기존 MP4는 자동 수정하지 않으며 Dater가 원할 때만 `Re-cut`합니다.

## 우선순위

### P0: 스토어 출시와 핵심 루프

1. 하나의 User와 컨텍스트 역할, 18+·전화 확인
2. 비공개 사진 제안·원본 음성·AI 구조화 pitch draft
3. Dater invitation claim, identity/face verification, 콘텐츠별 승인
4. 9:16, 15~60초 원본 음성 모션 피치와 자막
5. 무가입 HTTPS 링크, OG preview, noindex, pause/revoke/delete, attribution
6. 성인·전화·사진·bio·intent를 갖춘 Verified Interest
7. 수락된 두 사람의 text-only Intro Room, 신고·차단·나가기
8. Free Starter, Creator Launch credit, 30-day Campaign Pass와 RevenueCat 복원·만료
9. 업로드 전후 필터, 신고 큐, 차단, 삭제와 보존 정책
10. 전체 성장 퍼널 이벤트와 campaign attribution

### P1: 출시 직후 성장 실험

- 최대 5개 Vouch Card, Introducer 가명 프로필·완료 배지
- premium theme, social asset 재생성, MP4 export/share kit
- 캠페인 analytics와 관심 표현 필터
- 승인·관심·수락·메시지 push notification
- 익명화된 BuildInPublic 성장 snapshot

### P2: 해커톤 이후 검토

- 앱 내부 탐색 피드·추천 알고리즘, background/financial check
- 영상·사진 채팅, 오프라인 이벤트·date scheduling
- 글로벌 Introducer 랭킹
- AI 연애 코치·자동 답장·호환성 점수
- 연락처 전체 동기화

## 해결하지 않는 문제

- 완벽한 호환성 예측이나 장기 관계 성공 보장
- 범죄·사기 가능성의 완전 제거
- 모든 싱글을 위한 범용 데이팅 마켓플레이스
- 친구가 없거나 공개 소개를 원하지 않는 사용자의 발견 문제
- AI의 상대 자동 선택이나 대화 대행
- 익명 평가, 외모 점수, 공개 댓글 또는 타인 투표

## 반드시 지킬 경쟁 경계

1. Introducer의 원본 음성이 감정적 중심이어야 합니다.
2. 결과물은 프로필 추천 문구가 아니라 외부 공유 가능한 세로형 모션 피치여야 합니다.
3. Dater의 신원·얼굴 일치와 콘텐츠별 승인이 공개 전 필수여야 합니다.
4. 시청은 무가입이지만 관심 표현은 사진·기본 프로필·성인 확인을 갖춘 사용자만 할 수 있어야 합니다.
5. 앱 내부 피드보다 campaign URL과 referral attribution이 먼저 동작해야 합니다.
