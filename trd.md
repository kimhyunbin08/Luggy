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
3. 다중 창고 최적 라우팅(배송 경로/창고 배정 최적화 알고리즘), 멤버십/구독
   - 단, `carriers.city` 기반 단순 일치 필터(Renter가 도시를 선택하면 해당 도시의 재고만 보여주는 것)는
     라우팅 최적화가 아니라 단순 태그 필터이므로 In Scope이다(§4.1, §6, §13 참조).

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
1. 첫 화면(Above the fold)에 날짜/사이즈/도시(수령지) 검색 폼 고정 노출
   - 도시 선택은 고정 목록이 아니라 `GET /carriers/cities`로 조회한 "현재 재고가 있는 도시" 목록을 데이터 기반으로 보여주며, 미선택 시 전체 도시를 대상으로 검색한다.
2. 검색 결과 기본 정렬 `recommended`
3. 카드 필수 필드: 썸네일, 브랜드/모델명, 평점배지, 리뷰수, 검수배지, 희소성 문구, 원가 취소선, 총결제액, 도착예정, 남은 수량
4. 결제 플로우 3단계 고정: 옵션선택 → 정보입력 → 결제
5. 프론트엔드 UI 시스템은 명확한 위계, 일관된 컴포넌트 행태, 충분한 대비와 44px 이상 터치 타깃을 보장한다.
6. 브랜드 팔레트는 Terracotta Clay `#B5543A`, Olive Accent `#6F7F5F`, Soft Limestone `#F0E6D8`, Deep Rust `#5A2E25`, Ink `#101719`를 사용한다.
7. 입력·버튼·카드·단계 표시의 토큰과 반응형 breakpoint는 `design-system.md`를 단일 기준으로 사용한다.
8. 접근성을 해치는 과도한 시각효과(과한 블러, 장식성 그라디언트, 과도한 pill 스타일)는 금지한다.

#### 4.1.1 UI 구현 패턴
1. shadcn/ui의 variant 기반 컴포넌트 구조를 참고하되 현재 Vite + TypeScript 스택에 맞춰 native semantic HTML로 구현한다.
2. Radix 패턴에서 포커스 관리, keyboard activation, disabled/invalid 상태 노출 원칙만 적용하고 신규 UI 프레임워크는 도입하지 않는다.
3. Stripe Checkout의 단계 표시·우측 주문 요약·결제 전 총액 확인 구조와 OTA의 카드 정보 밀도·가용성 문구를 결합한다.

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
- `carriers.city`(보관 도시, 자유 텍스트, 기본값 `서울`): Provider 등록 시 입력, Renter 검색 필터의 기준 컬럼

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
3. `GET /renters/search?sort=recommended`(선택: `city` 필터)
4. `GET /carriers/{id}`
5. `GET /carriers/cities?size=&start_date=&end_date=`(현재 재고가 있는 도시 목록)
6. `POST /bookings`
7. `GET /bookings/{id}`
8. `POST /bookings/{id}/authorize-payment`
9. `POST /bookings/{id}/cancel`
10. `POST /inspections`
11. `POST /bookings/{id}/complete`
12. `POST /claims/{id}/resolve`
13. `POST /funnel/events`
14. `POST /webhooks/payments`
15. `POST /webhooks/delivery`

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
8. Provider 등록 시 도시(city) 지정 및 `optInRentable` 동시 반영(원자적 생성) 검증
9. 도시 필터: 서로 다른 도시에 등록된 캐리어가 `city` 파라미터 일치/불일치/미지정에 따라 검색 결과에 포함/제외되는지 검증
10. `GET /carriers/cities`가 실제 재고 존재 도시만 distinct하게 반환하는지 검증

### 13.3 E2E 테스트
1. [게이트 필수] 정상 예약/결제 완료
2. [게이트 필수] 취소 시 환불 정책 차등 적용
3. [게이트 필수] 배송 지연 표시 및 보상 로직 반영
4. [회귀 추가] 재고 0일 때 CTA 비활성화
5. [회귀 추가] Provider 입고/Opt-in 이후 Renter 검색 노출 검증
6. [회귀 추가] 도시 선택이 실제 검색 결과를 필터링(다른 도시 등록→제외, 같은 도시 선택→노출)

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

## 16. 2차 파일럿: 동네 직거래(P2P 다이렉트 딜) 모드 (기술 요구사항)
`prd.md` §19 참조. 아래는 이 모드의 기술 구현 요구사항이며, §1~§15의 legacy 요구사항은
그대로 유지된다(변경/삭제 없음). 이 모드의 모든 변경은 스키마/API 레벨에서 **additive**로만
적용해 기존 E2E 게이트(§13.3)를 깨뜨리지 않는다.

### 16.1 기술 스택 추가
1. **인증:** 이메일/비밀번호(Node `crypto.scrypt` 해시) + HMAC 서명 세션 토큰(`Authorization: Bearer`), 기존 웹훅 서명(`webhook.service.ts`) 방식과 동일한 스타일의 자체 구현(신규 외부 인증 SaaS 미도입)
2. **지도:** Kakao Map JavaScript SDK (`VITE_KAKAO_MAP_KEY` 빌드타임 주입, 기존 `VITE_API_URL` 패턴과 동일)
3. **AI:** Azure OpenAI Service (Vision 지원 채팅 모델, 예: gpt-4o-mini) — REST 호출 직접 구현(신규 SDK 의존성 미도입), `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`/`AZURE_OPENAI_DEPLOYMENT` 환경변수로 구성, 미설정 시 503로 graceful degrade

### 16.2 데이터 요구사항 추가
- `users.password_hash`: 이메일/비밀번호 인증용(nullable — legacy 데모 유저는 비밀번호 없음)
- `carriers.brand`, `carriers.model`: 기존 `brand_model` 자유 텍스트를 대체하지 않고 병행(직거래 모드에서 AI/사용자가 분리 입력)
- `carriers.dong`, `carriers.latitude`, `carriers.longitude`: 동 단위 대표 좌표(정확한 주소 아님)
- `carriers.deal_mode`: `'platform'`(기본값, legacy) | `'direct'`(직거래 지도 노출 대상)
- `deal_requests`: Renter→Provider 요청 및 상태(`requested`/`accepted`/`declined`/`cancelled`/`completed`)
- `chat_messages`: `deal_requests`에 연결된 1:1 채팅 메시지(참여자만 조회 가능)
- 모든 컬럼/테이블은 `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`로 추가해 배포된 스테이징/프로덕션 DB와 하위 호환을 보장한다.

### 16.3 API 요구사항 추가
1. `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
2. `GET /carriers/map?size=` — opt-in된 `deal_mode='direct'` 캐리어만 반환(인증 불필요, 공개 탐색)
3. `POST /providers/carriers/ai-register/photo` (인증 필요) — 사진 URL → AI 추정 draft(JSON) 반환
4. `POST /providers/carriers/ai-register/chat` (인증 필요) — stateless 대화 1턴 처리
5. `POST /providers/carriers` — 기존 스키마에 `brand`/`model`/`dong`/`latitude`/`longitude`/`dealMode` optional 필드 추가(하위 호환). `Authorization` 헤더가 유효하면 인증된 사용자 id가 body의 `providerId`보다 우선한다(직거래 모드에서 타인 명의 등록 방지).
6. `POST /deals` (인증 필요) — 요청 생성 시 채팅방도 함께 생성(원자적)
7. `GET /deals` (인증 필요) — 내가 보냈거나 받은 요청 목록
8. `GET /deals/{id}` (인증 필요, 참여자만)
9. `POST /deals/{id}/status` (인증 필요, 참여자만 — accept/decline/complete는 캐리어 소유자만, cancel은 양측 모두 가능)
10. `POST /deals/{id}/messages`, `GET /deals/{id}/messages` (인증 필요, 참여자만)

### 16.4 상태 전이 요구사항 추가 (DealRequest)
`requested -> accepted -> completed`
`requested -> declined`
`requested|accepted -> cancelled`
- `accepted`/`declined`/`completed`는 캐리어 소유자(Provider)만 실행 가능
- `cancelled`는 요청자/소유자 양쪽 모두 실행 가능
- 위 전이 외 상태 점프는 거부한다.

### 16.5 보안/개인정보 요구사항 추가
1. 채팅 메시지/요청 상세는 참여자(요청자, 캐리어 소유자) 외 조회 불가(서버에서 매 요청마다 참여자 검증)
2. 위치는 동 단위 대표 좌표만 저장/노출(정확한 주소·상세 좌표 미노출)
3. 세션 토큰은 서버 측 시크릿(`AUTH_TOKEN_SECRET`)으로 서명하고 30일 TTL을 둔다.
4. 비밀번호는 평문 저장 금지(scrypt 해시 + salt)

### 16.6 테스트 시나리오 추가
1. **Unit:** 비밀번호 해시/검증, 세션 토큰 서명/검증(위변조 거부), DealRequest 상태 전이 유효성(소유자 전용 액션 가드)
2. **Integration:** 회원가입→로그인→요청 생성→채팅 메시지 송수신 흐름, 제3자의 채팅 조회 차단 검증, 지도 API가 `deal_mode='platform'` 캐리어를 제외하는지 검증
3. **E2E 게이트(신규, legacy 3종과 별개):**
   1. 회원가입/로그인 후 캐리어 지도 조회
   2. 요청 생성 → Provider 수락 → 채팅 메시지 교환
   3. AI 미설정 환경에서 AI 등록 엔드포인트가 503로 안전하게 저하되는지 확인(하드 장애 아님)
