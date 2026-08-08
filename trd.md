# TRD: Luggy Web MVP (v0.2)

## 1. 문서 목적
- `ideation.md`, `prd.md`를 구현 가능한 기술 요구사항으로 고정한다.
- Web MVP 개발/배포/테스트의 공통 기준을 정의한다.
- 기존 `architecture.md`의 시스템 구조/상태 전이/데이터/API/워커 내용을 본 문서에 통합한다.

## 2. 범위
### 2.1 In Scope (Web MVP 1차)
1. OTA 스타일 웹 퍼널(검색→결제 3단계)
2. 예약/결제/배송상태/취소·환불 정책 반영
3. Provider 보관 신청/입고/렌탈 Opt-in
4. 검수 사진 업로드/조회
5. 정책 버전 관리(`policy_versions`)
6. Azure 스테이징/프로덕션 분리 배포

### 2.2 Out of Scope (Deferred)
1. 실거래 20건 공헌이익 게이트 자동 판정
2. 연체/분실/추가청구 전면 자동화
3. 다중 창고 라우팅, 멤버십/구독

## 3. 기술 스택 (초기안)
1. **Frontend:** Next.js + TypeScript + Tailwind CSS
2. **Backend API:** Node.js (NestJS 또는 Express+Zod) + TypeScript
3. **DB:** Azure Database for PostgreSQL Flexible Server
4. **Storage:** Azure Blob Storage (검수 이미지)
5. **Queue:** Azure Service Bus
6. **Runtime:** Azure Container Apps (API/Worker), Static Web Apps(Frontend)
7. **Observability:** Application Insights + Log Analytics
8. **Secrets:** Azure Key Vault

## 4. 기능 요구사항 (기술 관점)
### 4.1 프론트엔드
1. 첫 화면(Above the fold)에 날짜/사이즈/수령지 검색 폼 고정 노출
2. 검색 결과 기본 정렬 `recommended`
3. 카드 필수 필드: 썸네일, 브랜드/모델명, 평점배지, 리뷰수, 검수배지, 희소성 문구, 원가 취소선, 총결제액, 도착예정, 남은 수량
4. 결제 플로우 3단계 고정: 옵션선택 → 정보입력 → 결제
5. 테마는 옅은 웜/쿨 그레이 배경 + 딥 네이비/딥 그린 프라이머리 + 코랄/오렌지/레드 CTA 단색 솔리드로 구성하며, 글래스모피즘/그라디언트/과도한 pill 스타일을 금지한다.

### 4.2 백엔드
1. 최소 대여기간 2일 검증
2. 총결제액 = 대여료 + 왕복배송비 계산
3. 취소/환불 정책(48시간/24시간/이후) 계산
4. 검수 사진 최소 1장 제약
5. 배송 상태 동기화(접수/이동중/도착/지연)
6. 정산 분배 계산(총결제액 기준 80/20)
7. 보증금(기내용 3만원/중형 5만원) 승인/환불 처리
8. 파손/분실 클레임 기록 및 정산 보류/재개
9. 금전 이벤트 ledger 이중기록 + idempotency 보장
10. 보증 적립 인출 트리거(클레임 확정 후 Renter 청구 실패/회수 부족분) 처리

## 5. 데이터 요구사항
### 5.1 필수 엔티티
- `users`, `carriers`, `carrier_storage_contracts`, `bookings`, `pricing_snapshots`
- `payments`, `delivery_orders`, `inspections`, `inspection_photos`, `damage_claims`
- `settlements`, `ledger_entries`, `cost_entries`, `policy_versions`
- `search_logs`, `funnel_events`, `ranking_snapshots`, `event_logs`

### 5.2 데이터 규칙
1. 예약 생성 시 `end_date >= start_date + 2 days`
2. 동일 캐리어 기간 중복 예약 금지
3. 금전 트랜잭션은 idempotency key unique
4. 검수 완료 전 사진 1장 이상 필수
5. 클레임 미해결 상태에서는 정산 실행 금지
6. 예약 생성 시점의 `policy_version_id`는 변경 불가(불변 스냅샷)

### 5.3 재고/희소성 계산 규칙
1. `남은 수량` = 선택 기간 + 사이즈 기준 `available` 상태 캐리어 수
2. 예약 생성 직전 동일 조건 재검증 후 수량 0이면 결제 차단

## 6. API 요구사항 (MVP)
1. `POST /providers/carriers`
2. `POST /providers/carriers/{id}/opt-in`
3. `GET /renters/search?sort=recommended`
4. `GET /carriers/{id}`
5. `POST /bookings`
6. `GET /bookings/{id}`
7. `POST /bookings/{id}/authorize-payment`
8. `POST /bookings/{id}/cancel`
9. `POST /inspections`
10. `POST /bookings/{id}/complete`
11. `POST /claims/{id}/resolve`
12. `POST /funnel/events`
13. `POST /webhooks/payments`
14. `POST /webhooks/delivery`

## 7. 상태 전이 요구사항
### 7.1 Booking 상태
`requested -> payment_method_saved -> payment_authorized(D-1) -> confirmed -> outbound_in_transit -> in_use -> return_in_transit -> inspection_pending -> claim_resolving(optional) -> completed`

예외:
- `cancelled`, `overdue`, `lost`, `disputed`

### 7.2 Carrier 상태
`intake_pending -> available -> reserved -> rented -> return_processing -> available`

예외:
- `maintenance`, `retired`

## 8. 백엔드 워커 요구사항
1. `dispatch-scheduler`: 출고/반납 배송 오더 생성
2. `delivery-reconciler`: 배송 이벤트 동기화, 지연 상태 반영
3. `settlement-worker`: 클레임 종료 후 정산 실행
4. `overdue-worker`: 연체료 부과, 3일 경과 시 lost 전환
5. `profitability-worker`(Deferred): cost_entries 기반 공헌이익 집계
## 9. 비기능 요구사항
### 9.1 성능
1. 검색 API p95 < 700ms
2. 예약 생성 API p95 < 900ms
3. 결제 승인 API p95 < 1200ms

### 9.2 가용성/운영
1. 스테이징/프로덕션 분리
2. 서비스 헬스체크 및 알람
3. 배포 롤백 절차 보유
4. 워커 실패 재시도 + DLQ 운영

### 9.3 보안
1. Key Vault 기반 시크릿 관리
2. PII at-rest 암호화
3. 웹훅 서명 검증
4. RBAC(관리자 검수/판정 액션 감사 로그)
5. Private Endpoint + VNet + WAF(웹훅 엔드포인트)

## 10. Azure 배포 요구사항
1. GitHub Actions + OIDC로 무비밀 배포
2. API/Worker는 별도 Container App으로 배포
3. Blob/DB/Queue는 환경별 리소스 분리
4. App Insights 연동 필수(요청 추적, 오류 추적)

## 11. 관측/분석 요구사항
### 11.1 퍼널 이벤트
- `landing_view`, `search_submit`, `result_view`, `detail_view`, `checkout_step1`, `checkout_step2`, `checkout_step3`, `paid`

### 11.2 KPI 대시보드
1. Landing→Search 실행률
2. Search→Detail 진입률
3. Detail→Checkout 진입률
4. Checkout→Paid 완료율
5. 검색→예약 전환율
6. Provider Opt-in 비율
7. 예약→완료율
8. 파손/분쟁률
9. 건당 공헌이익(계산 지표, 출시 게이트 자동 판정은 Deferred)

## 12. Acceptance Criteria (기술 인수조건)
1. OTA형 검색 퍼널이 첫 화면에서 동작하고 스크롤 없이 검색 가능해야 한다.
2. 결과/상세/결제의 총결제액이 항상 동일해야 한다.
3. 추천 정렬은 feature flag로 on/off 가능해야 한다.
4. 결제 3단계 이탈 이벤트가 누락 없이 저장되어야 한다.
5. 배송 상태 변경 이벤트가 예약 상세에 1분 이내 반영되어야 한다.
6. 취소/환불 계산이 정책 버전 기준으로 재현 가능해야 한다.
7. Provider 등록→Opt-in→입고 가능 상태 전이가 구현되어야 한다.
8. 클레임 미해결 시 정산이 실행되지 않아야 한다.
9. 스테이징/프로덕션 모두에서 핵심 API/워커 헬스체크가 통과해야 한다.
10. 결과 카드 1장에 최소 8개 필수 요소(썸네일, 브랜드/모델, 평점 또는 리뷰수, 검수배지, 희소성, 원가 취소선, 총결제액, 도착예정)가 노출되어야 한다.

## 13. 테스트 시나리오
### 13.1 단위 테스트
1. 가격 계산(일요금+배송비)
2. 최소 대여기간 검증(2일 미만 거절)
3. 환불 계산(48h/24h/이후)
4. 정산 계산(총결제액 80/20)
5. 감가상각 계산(월 2%, 하한 30%)
6. 정렬 스코어 계산(추천순)
7. 상태 전이 유효성 검증

### 13.2 통합 테스트
1. 검색→예약→결제승인→확정 플로우
2. 배송 이벤트 수신→상태 반영
3. 취소 호출→환불 반영
4. Provider 등록→Opt-in→재고 노출 연계
5. 반납 검수→클레임 생성→클레임 종료 후 정산 재개
6. 퍼널 이벤트 수집→대시보드 집계 정합성
7. 정책 버전 변경 전/후 예약 계산값 비교

### 13.3 E2E 테스트
1. [게이트 필수] 정상 예약/결제 완료
2. [게이트 필수] 취소 시 환불 정책 차등 적용
3. [게이트 필수] 배송 지연 표시 및 보상 로직 반영
4. [회귀 추가] 재고 0일 때 CTA 비활성화
5. [회귀 추가] Provider 입고/Opt-in 이후 Renter 검색 노출 검증

## 14. 기술 리스크와 완화
1. 추천 정렬 품질 부족 → 규칙 기반 랭킹 + A/B 플래그로 보정
2. 결제/배송 외부 연동 불안정 → 재시도/서킷브레이커/보상 트랜잭션
3. 퍼널 데이터 누락 → 서버 측 이벤트 보강(클라이언트+서버 듀얼 로깅)
4. 초기 성능 저하 → DB 인덱스/캐시/쿼리 튜닝 우선순위 운영
5. 금전 이벤트 불일치 → ledger/event 이중대사 배치 운영

## 15. 검증 결과 (3모델 반영)
1. Provider 기능/엔티티/API 누락 보완 완료
2. ledger/cost/claim/worker/상태머신 요구사항 반영 완료
3. PRD/TRD 불일치 항목(정산·검수·정책·KPI) 동기화 완료
