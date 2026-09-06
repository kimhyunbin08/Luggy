# AGENTS.md

## 1) 목표
이 저장소의 구현 범위는 `prd.md`, `trd.md`, `ideation.md`에 정의된 **Web MVP 1차**로 제한한다.  
추가 기능 제안보다 문서 정합성과 MVP 완성도를 우선한다.

## 2) 문서 우선순위 (충돌 시)
1. `prd.md` (제품 정책/인수조건)
2. `trd.md` (구현 요구사항/API/테스트)
3. `ideation.md` (검증 배경/가설)

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

## 4-1) 2차 파일럿 In Scope — 동네 직거래(P2P 다이렉트 딜) 모드
2024년 배포 후 피드백을 반영해 **신규 메인 플로우**로 추가 확정. 상세 배경/정책은
`prd.md` §19, `trd.md` §16 참조. 기존 §3~§8의 플랫폼 배송/결제/검수 플로우는
**legacy로 유지**하며 즉시 제거하지 않는다(점진적 축소, §9 원칙 준수).
- 이메일/비밀번호 회원가입·로그인(직거래 채팅에 필요한 최소 실사용자 식별; 전화번호는 OTP 없는 단순 필드)
- 캐리어 지도 탐색(Kakao Map, 동 단위 좌표만 노출 — 정확한 주소 아님)
- 사진 업로드 기반 AI 브랜드/모델/사이즈/상태 추정(Azure OpenAI Vision, 사용자가 초안을 검수/수정 후 등록)
- AI 챗봇 기반 캐리어 등록 대화形(대화로 데이터 수집 → 구조화된 초안 → 사용자 최종 확인)
- Renter → Provider 요청 생성 및 1:1 채팅(다이렉트 핸드오프; 결제/배송/검수는 플랫폼을 거치지 않음)
- 이 모드의 캐리어(`deal_mode='direct'`)는 Provider가 수동으로 가격을 정한다(동적 가격 자동화 아님)

### 4-2) 2차 파일럿 Out of Scope (Deferred, TODO/플래그만 유지)
- 직거래 모드의 수수료/정산(정산 로직 없음 — 결제 자체가 플랫폼 밖에서 발생)
- 직거래 분쟁/신고 처리 자동화
- 위치 기반 반경 검색 고도화 → **3차 파일럿(§4-3)에서 In Scope로 승격**

## 4-3) 3차 파일럿 In Scope — 지도 탐색 + 실시간 채팅·약속 조율
당근마켓 벤치마킹 결과 이번 라운드는 **지도 탐색**과 **채팅/상호작용** 두 축만 고도화하고,
신뢰/안전 장치와 AI 등록 폴리싱은 다음 라운드로 미룬다. 상세 배경/정책은 `ideation.md`
§14, `prd.md` §20, `trd.md` §17 참조. §4-1의 2차 파일럿 범위는 그대로 유지되며 이 라운드는
**추가(additive)**로만 구현한다.
- 지도 반경 검색(1/3/5km 선택, 기본 3km) + 사이즈·기간·가격 필터, 거리순 정렬
- 실시간 채팅(WebSocket, 기존 4초 폴링 대체) — 재연결 시 REST 폴백으로 이력 재조회
- 약속(만남 시간·장소) 제안: 채팅 내 구조화된 메시지 서브타입, 자유 텍스트 장소 입력 + 안내
  문구(정확한 자택 주소 입력 유도 금지)
- 인앱 미읽음 표시 + 인앱 알림(푸시/이메일 제외)

### 4-4) 3차 파일럿 Out of Scope (Deferred, TODO/플래그만 유지)
- 신뢰/안전 장치 고도화(동네 인증, 매너 온도, 안전거래 장소 추천/지정 등)
- AI 등록 정확도/UX 폴리싱
- 직거래 모드 수익 모델(수수료/광고 등) — `ideation.md` Q24 참조, 이번 라운드는 무료
  브로커리지 유지
- 푸시/이메일 알림
- 안전 장소 큐레이션 리스트, 지도 핀 선택 UI(약속 장소는 자유 텍스트만)

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
- 상태 전이는 `trd.md` 정의를 따른다

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

### 7-1) 2차 파일럿 API 추가 세트 (동네 직거래)
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
- `GET /carriers/map`
- `POST /providers/carriers/ai-register/photo`, `POST /providers/carriers/ai-register/chat`
- `POST /deals`, `GET /deals`, `GET /deals/{id}`, `POST /deals/{id}/status`
- `POST /deals/{id}/messages`, `GET /deals/{id}/messages`

### 7-2) 3차 파일럿 API 추가/변경 세트 (지도 탐색 + 실시간 채팅)
- `GET /carriers/map` 파라미터 확장: `lat`, `lng`, `radiusKm`, `minPrice`, `maxPrice`,
  `startDate`, `endDate`(거리순 정렬, `distanceKm` 응답 포함)
- `POST /deals/{id}/messages` 바디 확장: `messageType`, `meetingTime`, `meetingLocation`
- `POST /deals/{id}/read` (신규 — 미읽음 처리)
- `GET /deals` 응답 확장: 호출자 기준 `unreadCount`(미읽음 메시지 수) 포함
- `GET /ws/deals/{id}` (신규 — WebSocket 실시간 채팅, `?token=` 쿼리로 인증)

## 8) 테스트 기준 (MVP 게이트)
- Unit: 가격/환불/정산/감가/상태전이
- Integration: 예약-결제-배송-취소-정산 흐름, 정책 버전 정합성
- E2E 게이트 필수 3개(변경 금지, legacy 플로우 기준):
  1. 정상 예약/결제
  2. 취소 환불 차등
  3. 배송 지연 보상 반영
- 2차 파일럿 게이트(신규): 회원가입/로그인, 직거래 요청 생성→수락→채팅, 캐리어 지도 조회
- 3차 파일럿 게이트(신규): 반경 필터 거리순 정렬, 실시간 채팅 즉시 반영(폴링 없이), 약속
  제안 메시지 UI 구분 표시

## 9) 작업 규칙
- 문서 범위를 벗어난 기능은 구현하지 않는다.
- Deferred 항목은 TODO/플래그로만 남기고 동작 경로에 강제하지 않는다.
- 변경 시 관련 문서(`prd.md`/`trd.md`) 동시 업데이트를 원칙으로 한다.
- 동네 직거래 모드는 **추가(additive)**로만 구현하며, legacy 플랫폼 배송/결제/검수 플로우의
  기존 코드/스키마/E2E 게이트를 깨뜨리지 않는다. legacy 축소는 별도 결정 없이 임의로 진행하지 않는다.
- 3차 파일럿(지도 탐색·실시간 채팅) 역시 **추가(additive)**로만 구현하며, 2차 파일럿(§4-1)
  및 legacy(§3) 플로우의 기존 코드/스키마/E2E 게이트를 깨뜨리지 않는다.
