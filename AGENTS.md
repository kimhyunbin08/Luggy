# AGENTS.md

## 1) 목표
이 저장소의 구현 범위는 `prd.md`, `architecture.md`, `trd.md`, `ideation.md`에 정의된 **Web MVP 1차**로 제한한다.  
추가 기능 제안보다 문서 정합성과 MVP 완성도를 우선한다.

## 2) 문서 우선순위 (충돌 시)
1. `prd.md` (제품 정책/인수조건)
2. `trd.md` (구현 요구사항/API/테스트)
3. `architecture.md` (시스템 구조/상태 전이/데이터)
4. `ideation.md` (검증 배경/가설)

충돌 발견 시 임의 구현하지 말고 문서 정합화부터 수행한다.

## 3) MVP In Scope (반드시 구현)
- OTA 스타일 웹 퍼널: 검색 → 상세 → 3단계 결제
- Provider 등록/입고/Opt-in
- 예약/결제/취소·환불/배송 상태 조회
- 검수 사진 업로드 및 검수 상태 반영
- 정책 버전 기반 계산(가격/환불/책임)
- Azure 배포 기본 구조(스테이징/프로덕션 분리)
- 퍼널 이벤트 수집 및 핵심 KPI 대시보드

## 4) MVP Out of Scope (구현 금지)
- 실거래 20건 공헌이익 게이트 **자동 판정**
- 연체/분실/추가청구 전면 자동화
- 다중 창고 라우팅, 멤버십/구독, 동적 가격 자동화
- 문서에 없는 신규 대규모 기능

## 5) 고정 정책 (하드코딩 금지, 정책/설정 기반)
- 최소 대여기간: 2일
- 가격: 기내용 7,900원/일, 중형 11,900원/일
- 왕복 배송비: 14,000원 (Renter 부담)
- 보증금: 기내용 30,000원 / 중형 50,000원
- 환불: 48시간 전 100%, 24시간 전 50%, 이후 0%
- 정산: 총결제액 기준 Platform 80% / Provider 20%

## 6) 기술/데이터 필수 원칙
- 금전 이벤트는 idempotency key + ledger 추적
- 예약은 policy_version 스냅샷 불변
- 클레임 미해결 상태에서는 정산 금지
- 재고 희소성은 기간+사이즈 기준 가용 수량으로 계산
- 상태 전이는 `architecture.md`/`trd.md` 정의를 따른다

## 7) API 최소 세트 (MVP)
- `GET /renters/search`
- `GET /carriers/{id}`
- `POST /bookings`
- `GET /bookings/{id}`
- `POST /bookings/{id}/authorize-payment`
- `POST /bookings/{id}/cancel`
- `POST /providers/carriers`
- `POST /providers/carriers/{id}/opt-in`
- `POST /inspections`
- `POST /bookings/{id}/complete`
- `POST /claims/{id}/resolve`
- `POST /funnel/events`
- `POST /webhooks/payments`
- `POST /webhooks/delivery`

## 8) 테스트 기준 (MVP 게이트)
- Unit: 가격/환불/정산/감가/상태전이
- Integration: 예약-결제-배송-취소-정산 흐름, 정책 버전 정합성
- E2E 게이트 필수 3개:
  1. 정상 예약/결제
  2. 취소 환불 차등
  3. 배송 지연 보상 반영

## 9) 작업 규칙
- 문서 범위를 벗어난 기능은 구현하지 않는다.
- Deferred 항목은 TODO/플래그로만 남기고 동작 경로에 강제하지 않는다.
- 변경 시 관련 문서(`prd.md`/`trd.md`/`architecture.md`) 동시 업데이트를 원칙으로 한다.
