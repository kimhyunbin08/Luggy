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

## 16. 로그인/찜하기/후기 API 및 데이터 (C2C 플랫폼 신규 기능)
결제(PG)를 제외한 플랫폼 전 기능 구현 지시에 따라 신규 구현된 기술 요구사항이다. `apps/api/src/server.ts` 및 `apps/api/src/domain/auth.ts`에 구현되어 있다.

### 16.1 신규 데이터 엔티티
- `User` (id, nickname, phone, createdAt) — 휴대폰 번호 기반, 비밀번호 없음
- `sessions`: `Map<token, userId>` (인메모리 세션 스토어, 오브젝트 인증에 `Authorization: Bearer <token>` 사용)
- `favorites`: (id, userId, carrierId, createdAt)
- `Review` (id, carrierId, contactRequestId, reviewerId, reviewerName, rating, comment, createdAt)
- `CarrierItem`에 `ownerId?`(등록한 User), `ContactRequest`에 `renterId?`(로그인 렌터) 필드 추가

### 16.2 신규 API
1. `POST /auth/signup` — `{ nickname, phone }` -> `{ token, user }`
2. `POST /auth/login` — `{ phone }` -> `{ token, user }` (가입 이력 없으면 404)
3. `POST /auth/logout` — 세션 토큰 무효화
4. `GET /auth/me` — 인증 헤더로 현재 로그인 사용자 조회
5. `GET /favorites` — 인증 필요, 본인 찜 목록(`favorites`)과 캐리어 상세(`items`) 반환
6. `POST /favorites` — `{ carrierId }`, 인증 필요
7. `DELETE /favorites/:carrierId` — 인증 필요
8. `GET /carriers/:id/reviews` — 캐리어별 리뷰 목록
9. `POST /carriers/:id/reviews` — `{ contactRequestId, rating, comment }`, 인증 필요. 해당 `contactRequestId`의 상태가 `completed`가 아니면 400, 중복 리뷰면 409. 성공 시 캐리어 `rating`/`reviews` 재계산.
10. `GET /providers/me/carriers` — 인증 필요, 본인이 등록한 캐리어 목록
11. 기존 `POST /providers/carriers`는 인증 시 `ownerId` 자동 첨부, 소유자 이름/연락처 기본값을 프로필에서 채움.
12. 기존 `POST /contact-requests`는 인증 시 `renterId` 자동 첨부, 이름/연락처 자동 채움(비로그인 시 종전과 동일하게 직접 입력).
13. 기존 `GET /contact-requests`는 인증 시 본인이 렌터이거나 본인 소유 캐리어에 대한 문의만 필터링, 비인증 시 종전 동작(전체 목록) 유지.

### 16.3 인증 방식
- 비밀번호/PG 본인인증 없음. 휴대폰 번호를 식별자로 사용하는 경량 세션(오파크 토큰) 방식.
- 토큰은 클라이언트 localStorage(`luggy_token`, `luggy_user`)에 저장, API 호출 시 `Authorization: Bearer <token>` 헤더로 전달.
- CORS 사전 요청(OPTIONS)에 `Authorization` 헤더를 명시적으로 허용해야 브라우저에서 인증 API 호출이 차단되지 않는다(로컬 검증 중 발견/수정됨).

### 16.4 테스트 시나리오 (신규 기능)
#### 단위 테스트
1. 휴대폰 번호 정규화(`normalizePhone`)/유효성 검증(`isValidPhone`)
2. 닉네임 유효성 검증(`isValidNickname`)
3. 세션 토큰 생성 규칙(`generateSessionToken`) — 유일성/포맷 검증

#### 통합 테스트
1. 가입 -> 로그인 -> `/auth/me` 조회 정합성
2. 찜하기 추가 -> 목록 조회 -> 삭제 흐름
3. 리뷰: 미완료 문의 건 리뷰 차단(400), 완료 후 리뷰 성공, 중복 리뷰 차단(409), 캐리어 평점/리뷰수 재계산 검증
4. 소유자 스코핑: 로그인한 Owner가 등록한 캐리어만 `/providers/me/carriers`에 노출, 해당 캐리어에 대한 문의만 `/contact-requests`에 노출

#### E2E 테스트
1. 로그인 모달 오픈 -> 가입 제출 -> 헤더 프로필 칩(닉네임) 노출 확인
2. 캐리어 카드 하트 클릭(찜) -> `❤️ 찜한 캐리어` 탭에서 확인
3. 완료 처리된 1:1 문의에서 리뷰 제출 -> 캐리어 상세/카드 평점 갱신 확인
4. (알려진 갭) 현재 `apps/web/e2e/gate.spec.ts`는 실제 앱이 아닌 `data:text/html` 정적 스텁을 검증하는 자리표시자 테스트다. 로그인/찜/리뷰 흐름을 검증하는 실제 브라우저 기반 E2E는 아직 이 저장소의 자동화된 Playwright 스위트에 포함되어 있지 않으며(수동/브라우저 캔버스로 검증됨), 후속 작업으로 추가가 필요하다.

## 17. 상단 5-tab IA 및 1:1 채팅 API/데이터 (C2C 플랫폼 신규 기능)
상단 내비게이션을 홈/대여/렌탈/채팅/설정 5개 탭으로 재구성하고, 문의(ContactRequest) 기반 1:1 채팅을 신규 구현했다. `apps/api/src/server.ts` 및 `apps/web/index.html`에 구현되어 있다.

### 17.1 신규 데이터 엔티티
- `ChatMessage`: `{ id, senderId?, senderName, senderRole: 'renter' | 'owner', text, createdAt }`
- `ContactRequest`에 `messages: ChatMessage[]` 필드 추가. 문의 생성 시 렌터의 최초 메시지(`message` 필드 값)로 스레드가 시딩된다(`senderRole: 'renter'`, 비로그인 생성 시 `senderId` 없음).

### 17.2 신규 API
1. `GET /contact-requests/:id` — 인증 선택적(optional auth). 인증된 경우 요청자가 해당 문의의 `renterId`이거나, 문의가 가리키는 캐리어의 `ownerId`인 경우에만 조회 허용(그 외 403). 비인증 조회는 기존 `GET /contact-requests` 목록과 동일하게 하위호환을 위해 허용.
2. `POST /contact-requests/:id/messages` — `{ text }`, `requireAuth` 필수. 전송자가 해당 문의의 렌터 또는 캐리어 소유자가 아니면 403. 성공 시 `ChatMessage`를 스레드에 추가하고 반환.

### 17.3 인가(Authorization) 규칙
- 채팅 스레드의 읽기/쓰기 권한은 `renterId === currentUser.id` 또는 `carrier.ownerId === currentUser.id` 중 하나를 만족해야 한다.
- 프런트엔드는 `senderId`가 있으면 `senderId === currentUser.id`로, 없으면(익명 최초 메시지) `senderRole`과 뷰어가 소유자인지 여부를 비교해 "내 메시지 / 상대 메시지" 말풍선 정렬을 판단한다.

### 17.4 프런트엔드 IA 변경
- 상단 내비게이션: `home`/`rent`/`rental`/`chat`/`settings` 5개 탭(`switchTab`).
- `대여`/`렌탈` 탭 내부에는 서브탭(`switchSubTab`)이 있다: 대여 = 지도 탐색/찜한 캐리어, 렌탈 = 매물 등록/내 캐리어 관리.
- `렌탈 > 내 캐리어 관리`는 `GET /providers/me/carriers`를 호출해 로그인한 소유자 본인의 캐리어만 표시한다(과거 버그: 전역 검색 결과를 그대로 표시하던 문제를 이번에 수정).
- `채팅` 탭은 2단 레이아웃(`.chat-layout`: 대화 목록 + 메시지 패널)이며, `fetchChatList`/`openChatThread`/`renderChatPanel`/`sendChatMessage` 함수가 각각 목록 조회/스레드 열기/패널 렌더링/메시지 전송을 담당한다.
- `설정` 탭은 프로필 카드(닉네임/전화번호/로그아웃)와 기존 퍼널 로그 디버그 뷰를 포함한다.

### 17.5 테스트 시나리오 (신규 기능)
#### 통합 테스트 (`apps/api/tests/integration.c2c-platform.test.ts`)
1. 문의 생성 시 최초 메시지가 스레드에 시딩되는지 검증
2. 렌터/소유자 간 메시지 교환 성공, 무관한 제3자의 조회(`GET /contact-requests/:id`)·전송(`POST .../messages`) 시도가 403으로 차단되는지 검증
3. 비로그인 상태의 메시지 전송이 401로 차단되는지 검증

#### E2E 테스트 (수동/브라우저 캔버스로 검증, 자동화 스위트 후속 추가 필요)
1. 지도에서 1:1 문의 생성 -> `채팅` 탭 목록에 스레드 노출 확인
2. 스레드 열기 -> 메시지 전송 -> 렌터/소유자 양측 말풍선 정렬 확인
3. 채팅 패널 상태 변경 버튼(예약 확정/반납 완료)으로 상태 전환 -> `⭐ 후기 남기기` 버튼 노출 확인
4. `렌탈 > 내 캐리어 관리`가 로그인한 소유자 본인 매물만 표시하는지 확인

## 18. 개인화 온보딩(4단계 가입 위저드) 및 필수 약관 동의 API/데이터 (신규 기능)
`apps/api/src/domain/auth.ts`, `apps/api/src/server.ts`, `apps/web/index.html`에 구현되어 있다.

### 18.1 `User` 타입 확장
```
type User = {
  id, nickname, phone, createdAt,
  district: string,
  ownsCarrier: boolean,
  carrierModel?: string,
  carrierPurchaseYear?: number,
  carrierPhotoUrl?: string,
  travelDaysPerYear?: number,
  hasStorageIssue?: boolean,
  agreedToTermsAt: string,   // ISO timestamp, 동의 증빙
  agreedToPrivacyAt: string, // ISO timestamp, 동의 증빙
}
```

### 18.2 `POST /auth/signup` 검증 규칙
1. `isValidDistrict(district)`(`apps/api/src/domain/auth.ts`, 2~30자 trimmed 길이 검증) 통과해야 함. 실패 시 400.
2. `ownsCarrier: true`인데 `carrierModel`이 없으면 400.
3. `agreedToTerms`, `agreedToPrivacy` 중 하나라도 falsy면 400, 메시지: "이용약관 및 개인정보 수집·이용에 모두 동의해야 가입할 수 있습니다." — 이 검증은 서버 측에서 강제되며 클라이언트 조작으로 우회할 수 없다.
4. 검증을 모두 통과하면 `agreedToTermsAt`/`agreedToPrivacyAt`을 `createdAt`과 동일한 `now` 값으로 기록한다.

### 18.3 프런트엔드 위저드 구현 (`apps/web/index.html`)
- 모달 구조: `#login-step-login`(단일 로그인 폼) / `#login-step-signup`(4단계 위저드: `#signup-step-1~4`).
- 상태: `signupStep`(1~4), `signupOwnsCarrier`, `signupHasStorageIssue`.
- `signupWizardNext()`/`signupWizardBack()`: 단계별 필수값 검증 후 단계 이동, 마지막 단계에서는 `submitAuth()` 호출.
- `setOwnsCarrier(bool)`/`setHasStorageIssue(bool)`: 토글 버튼 active 상태 및 캐리어 상세 입력 필드 표시/숨김 제어.
- `onConsentChange()`/`toggleAgreeAll()`: 개별 동의 체크박스 <-> "전체 동의" 체크박스 양방향 동기화.
- `openLegalModal(kind)`/`closeLegalModal()`: `LEGAL_DOCS.terms`/`LEGAL_DOCS.privacy` 텍스트를 `#legal-modal`에 표시.
- `renderLocationBadge()`: `#location-badge`에 로그인 사용자의 `district`를 반영("📍 {동네} 근처 이웃과 거래 중"), 비로그인 시 기본 태그라인. `DOMContentLoaded`, 로그인 성공, 로그아웃 시 각각 호출된다.

### 18.4 테스트 시나리오 (신규 기능)
#### 단위 테스트 (`apps/api/src/domain/auth.ts`)
1. `isValidDistrict`: 빈 문자열/공백/2자 미만/30자 초과 거부, 정상 "구 동" 문자열 허용

#### 통합 테스트 (`apps/api/tests/integration.c2c-platform.test.ts`)
1. `agreedToTerms: false` 또는 `agreedToPrivacy: false`로 가입 시도 시 400 및 안내 메시지 확인
2. 정상 가입 시 응답에 `agreedToTermsAt`/`agreedToPrivacyAt`이 포함되는지 확인
3. (기존 8개 시그니처에 `district`/`ownsCarrier`/동의 필드 추가 반영 완료, 48/48 통과)

#### E2E 테스트 (수동/브라우저 캔버스로 검증)
1. 가입 모달 오픈 -> 1단계(닉네임/전화) 미입력 시 다음 단계 진행 차단 확인
2. 2단계(동네) 미입력 시 진행 차단, 입력 후 3단계 진행 확인
3. 3단계에서 캐리어 보유 "있음" 선택 후 모델명 미입력 시 진행 차단, 입력 후 4단계 진행 확인
4. 4단계에서 동의 없이 제출 시 차단 메시지 노출 확인, "전체 동의" 체크 후 제출 성공 확인
5. 가입 성공 후 헤더 배지가 "📍 강남구 역삼동 근처 이웃과 거래 중" 형태로 갱신되는지 확인, 로그아웃 후 기본 태그라인 복귀 확인

## 19. 실명/닉네임 분리 및 지도 경로 안내 API/구현 (신규 기능)
`apps/api/src/domain/auth.ts`, `apps/api/src/server.ts`, `apps/web/index.html`에 구현되어 있다.

### 19.1 `User` 타입 확장
```
type User = {
  id, name /* 실명, 비공개 */, nickname /* 공개 유저네임 */, phone, createdAt,
  district, ownsCarrier, ...
}
```
- `isValidName(name)` (`apps/api/src/domain/auth.ts`): 2~20자 trimmed 길이 검증, `isValidNickname`과 동일한 규칙을 별도 함수로 분리해 각각 독립적으로 검증한다.

### 19.2 `POST /auth/signup` 변경
- 요청 바디에 `name` 필드 추가(필수). `isValidName` 실패 시 400: "이름은 2~20자로 입력해주세요."
- 응답 `user` 객체에 `name`과 `nickname`이 각각 별도 필드로 포함된다.

### 19.3 프런트엔드 위저드 변경 (`apps/web/index.html`)
- `#signup-step-1`에 `#s-name`(이름) 입력 필드 추가, `#s-nickname`(닉네임) 필드는 그대로 유지.
- `signupWizardNext()`의 1단계 검증이 이름/닉네임/휴대폰 번호 3개 모두를 확인하도록 갱신.
- `submitAuth()`가 `/auth/signup` 요청 바디에 `name` 필드를 포함해 전송.

### 19.4 지도 경로 안내 (`openDirectionsTo(carrierId)`)
- 카카오맵의 공개 웹 링크 스킴(`https://map.kakao.com/link/...`)을 사용하며, 별도 API 키/인증이 필요 없다.
- `navigator.geolocation.getCurrentPosition()`으로 현재 위치를 조회해 성공 시 `https://map.kakao.com/link/from/{내위치},{lat},{lng}/to/{목적지},{lat},{lng}` 링크를, 위치 조회 실패/미지원 시 `https://map.kakao.com/link/to/{목적지},{lat},{lng}` 링크를 새 탭으로 연다.
- 캐리어 카드(`renderCardsInto`), Kakao/Leaflet 지도 핀 팝업(`renderMapPins`), 1:1 문의 모달(`#contact-modal`)에 각각 "🧭 경로 안내" 버튼을 배치했다.

### 19.5 테스트 시나리오 (신규 기능)
#### 단위 테스트 (`apps/api/src/domain/auth.ts`)
1. `isValidName`: 빈 문자열/공백/2자 미만/20자 초과 거부, 정상 이름 허용

#### 통합 테스트 (`apps/api/tests/integration.c2c-platform.test.ts`)
1. 이름이 너무 짧은 경우(`'ㄱ'`) 400 차단 확인
2. 정상 가입 시 응답의 `name`/`nickname`이 서로 다른 값으로 저장되는지 확인

#### E2E 테스트 (수동/브라우저 캔버스로 검증)
1. 가입 1단계에서 이름 또는 닉네임 중 하나라도 비워두면 다음 단계 진행이 차단되는지 확인
2. 캐리어 카드의 "🧭 경로 안내" 버튼 클릭 시 `window.open`으로 카카오맵 길찾기 URL이 생성되는지 확인(위치 권한 거부 시 목적지 전용 링크로 대체되는지 포함)

## 20. 상식 범위(Common-Sense Bounds) 검증 강화 API/구현 (버그 수정)
`apps/api/src/domain/auth.ts`, `apps/api/src/server.ts`, `apps/web/index.html`에 구현되어 있다.

### 20.1 신규 검증 함수 (`apps/api/src/domain/auth.ts`)
```ts
export function isValidTravelDaysPerYear(days: number): boolean {
  return Number.isInteger(days) && days >= 0 && days <= 365;
}
export function isValidCarrierPurchaseYear(year: number): boolean {
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 1990 && year <= currentYear;
}
```

### 20.2 `POST /auth/signup` 변경 (`apps/api/src/server.ts`)
- `travelDaysPerYear`가 제공된 경우 `isValidTravelDaysPerYear` 검증 실패 시 400: "연간 여행 일수는 0~365 사이의 정수로 입력해주세요."
- `ownsCarrier`가 true이고 `carrierPurchaseYear`가 제공된 경우 `isValidCarrierPurchaseYear` 검증 실패 시 400: "캐리어 구매 연도는 1990년부터 {현재연도}년 사이로 입력해주세요."

### 20.3 `POST /providers/carriers` 재작성
- 기존 `Number(req.body?.dailyPrice) || fallback` 방식(음수도 truthy라 통과되던 버그)을 제거하고, zod 스키마로 입력을 우선 파싱한 뒤 명시적 범위 검증으로 교체:
  - `dailyPrice`가 제공된 경우 `Number.isFinite(dailyPrice) && dailyPrice > 0` 검증, 1,000,000원 상한도 함께 검증. 실패 시 400.
  - `lat`/`lng`가 제공된 경우 `Number.isFinite()` 검증. 실패 시 400.

### 20.4 `POST /contact-requests` 날짜 순서 검증
- `startDate`/`endDate`가 모두 제공된 경우 `new Date(endDate) < new Date(startDate)`이면 400: "반납일은 대여 시작일보다 빠를 수 없습니다."
- 날짜 문자열이 파싱 불가능한 경우도 400으로 처리한다.

### 20.5 전역 오류 처리 미들웨어 (`createApp()`)
- `app.use((err, req, res, next) => ...)`를 `return app;` 직전에 추가.
- `err instanceof z.ZodError`인 경우 400과 함께 각 필드별 오류 목록을 반환.
- 그 외 예외는 스택 트레이스를 노출하지 않고 500 + 일반 오류 메시지만 반환.

### 20.6 프런트엔드 변경 (`apps/web/index.html`)
- `#s-travel-days`(`min="0" max="365" step="1"`), `#s-carrier-year`(`min="1990"`, `max`는 `DOMContentLoaded`에서 현재 연도로 동적 설정), `#p-price`(`min="100" max="1000000" step="100"`) 에 HTML5 제약 속성 추가.
- `signupWizardNext()` 3단계 검증에 여행 일수/구매 연도 범위 체크 추가(위반 시 다음 단계 진행 차단, 오류 메시지 표시).
- `submitContactRequest()`에 클라이언트 단 날짜 순서 검증(`endDate < startDate` 시 제출 차단) 및 서버 응답 `res.ok` 확인 로직 추가(실패 시 서버 메시지를 `alert`로 표시, 성공 화면으로 넘어가지 않음).
- `submitNewCarrier()`에 클라이언트 단 `dailyPrice > 0` 검증 및 `res.ok` 확인 로직 추가.

### 20.7 테스트 시나리오 (버그 수정)
#### 단위 테스트 (`apps/api/tests/unit.auth.test.ts`)
1. `isValidTravelDaysPerYear`: 0/30/365 허용, -1/366/1.5 거부
2. `isValidCarrierPurchaseYear`: 1990/현재연도 허용, 1989/현재연도+1/소수 거부

#### 통합 테스트 (`apps/api/tests/integration.c2c-platform.test.ts`)
1. `travelDaysPerYear`가 -1 또는 400인 경우 가입 400 차단
2. `carrierPurchaseYear`가 1899인 경우 가입 400 차단
3. `dailyPrice`가 -1000 또는 0인 경우 캐리어 등록 400 차단
4. `endDate`가 `startDate`보다 빠른 경우 문의 요청 400 차단

#### E2E 테스트 (수동/브라우저 캔버스로 검증)
1. 가입 위저드 3단계에서 여행 일수에 음수 입력 시 다음 단계로 진행되지 않는지 확인
2. 문의 모달에서 반납일을 시작일보다 이르게 설정 시 제출이 차단되고 안내 메시지가 뜨는지 확인
3. 매물 등록 폼에서 대여료를 0 이하로 입력 시 제출이 차단되는지 확인
