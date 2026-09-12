# TRD: Luggy Web MVP (v0.3 - 지도 기반 C2C 렌탈)

## 1. 문서 목적
- `ideation.md`, `prd.md`를 구현 가능한 기술 요구사항으로 고정한다.
- 지도 기반 당근마켓 스타일 C2C 캐리어 대여 플랫폼의 기술 스택, API, 데이터 모델을 정의한다.

## 2. 범위
### 2.1 In Scope (Web MVP 1차)
1. 지도(Map) 기반 주변 캐리어 매물 검색 & 리스트 뷰
2. Owner 직접 캐리어 등록 (동네/위치, 일일 대여료, 사진, 가능 일정)
3. 1:1 직접 문의/채팅 (PG 결제 연동 없이 직거래 연결)
4. Apple HIG 기반 깔끔한 대시보드 및 지도/리스트 UI

### 2.2 Out of Scope (Deferred)
1. PG 온라인 자동 결제 & 수수료자동 정산
2. 택배 배송 연동 및 중앙 창고 보관
3. 자동 계약서 작성 및 법적 분쟁 자동 처리

## 3. 기술 스택
1. **Frontend:** HTML5 / Vite / React / Leaflet (또는 SVG/Canvas 기반 인터랙티브 지도 컴포넌트)
2. **Backend API:** Node.js (Express + Zod) + TypeScript
3. **Data/Storage:** In-memory / PostgreSQL
4. **Design System:** Apple Human Interface Guidelines (HIG)

## 4. 기능 요구사항 (기술 관점)
### 4.1 프론트엔드
1. 메인 화면에 대화형 지도(Map View)와 주변 매물 리스트(List View) 동시 제공
2. 지도상 캐리어 핀(Pin) 클릭 시 해당 캐리어 정보 팝업 및 상세 진입
3. Owner 캐리어 직접 등록 폼 (동네/위치 핀 찍기, 규격, 일일 대여료, 이미지 URL)
4. Renter의 소유자 1:1 직접 문의하기 (Direct Contact/Chat Request) 모달 및 메시지 전송
5. PG 결제 없이 직접 협의 후 예약 상태(문의중 -> 예약 확정 -> 대여중 -> 반납 완료) 전이

### 4.2 백엔드 API
1. `GET /renters/search`: 지도 위치 기반(위도, 경도, 반경, 규격, 일정) 주변 캐리어 조회
2. `GET /carriers/:id`: 특정 캐리어 상세 조회 (소유자 정보, 위치 좌표, 가격)
3. `POST /providers/carriers`: 소유자 캐리어 직접 등록 (위치, 가격, 규격, 사진)
4. `POST /contact-requests`: 1:1 직접 문의 및 직거래 예약 요청 생성
5. `GET /contact-requests`: 내 문의/거래 내역 목록 조회

## 5. 데이터 엔티티
- `users` (id, name, district, contact)
- `carriers` (id, ownerId, size, brandModel, dailyPrice, lat, lng, district, photoUrl, available)
- `contact_requests` (id, carrierId, renterId, startDate, endDate, status, message)

## 6. UI 시스템
- Apple Human Interface Guidelines (HIG) 원칙 가이드라인 준수.
- 깔끔한 라이트/그레이 배경, 명확한 지도 위젯, 딥 네이비 프라이머리, 가독성 높은 가격 폰트 사용.


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
