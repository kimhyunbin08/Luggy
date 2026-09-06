# Web MVP Gap Checklist

Baseline: `prd.md` v0.1 and `trd.md` v0.2 compared with the current API and web funnel.

## Covered in the current implementation

- [x] Search API and first-viewport date/size search flow.
- [x] Result selection and three checkout steps, including in-checkout cancellation with
      tiered refund display.
- [x] Provider registration, real intake photo upload (Azure Blob or local-disk fallback via
      `/uploads/sign`), and rental opt-in.
- [x] Booking creation and payment authorization through an in-house mock payment provider
      that drives real, signed webhook events (`payment.authorized`, `payment.completed`)
      through the same HMAC verification + ledger path a real PG's webhook would use. No
      external payment gateway is integrated - this is an intentional product decision, not
      a gap (see `AGENTS.md` scope).
- [x] Signed delivery webhooks (`X-Delivery-Signature`) drive delivery status transitions and
      outbound-delay compensation ledger entries.
- [x] Ledger entries (charge/refund/deposit hold/deposit release/damage charge) and webhook
      deliveries are persisted in Postgres with idempotency keys, so retries and duplicate
      webhook deliveries never double-charge or double-refund.
- [x] Inspection photo upload (real storage adapter), damage claim creation, and claim
      resolution, all reachable from the UI.
- [x] Booking completion with settlement calculation (80% Platform / 20% Provider), gated on
      no unresolved claims.
- [x] Funnel event logging with persisted `sessionId`, and a `/metrics/kpi` aggregation
      endpoint (funnel conversion, bookings by status, opt-in rate, completion rate, dispute
      rate, avg contribution profit per booking).
- [x] **운영(Ops) console** in the web UI: KPI dashboard, booking lookup, and full lifecycle
      controls (cancel, simulate delivery events, submit inspections with real photo upload,
      resolve claims, complete booking) - this is the operational surface for everything that
      isn't a Renter/Provider self-service action, and it is driven end-to-end through the
      browser, not left as API-only.
- [x] Responsive tokenized styling and brand palette source of truth.
- [x] Required E2E gates (see below) implemented and passing against the real Docker-composed
      stack (Postgres + API + Web), driving the actual browser UI.
- [x] **City selection (real, data-driven)**: Provider registration collects a storage city
      (free-text, defaults to `서울`); Renter search shows a `<select>` populated from
      `GET /carriers/cities` (only cities with actual available inventory for the current
      size/date range), and `GET /renters/search?city=...` genuinely filters results
      server-side. This is a simple tag-match filter, not multi-warehouse routing
      optimization (still out of scope, see below).
- [x] **Atomic carrier creation + opt-in**: `POST /providers/carriers` now accepts
      `optInRentable` and sets `status`/`opt_in_rentable` in the same INSERT, eliminating the
      two-call race that could leave a carrier stuck at `intake_pending`/non-rentable forever.
      A "렌탈 허용으로 전환" retry button in 내 캐리어 lets any previously-stuck carrier
      self-recover without a new deploy or DB fix.

## Recently fixed bugs

1. **도시 선택 불일치** (맡기기 tab had no city field at all; 렌탈 tab's "수령 지역" was a free-text
   field the backend silently ignored). Fixed by adding a real `carriers.city` column, a
   Provider city input, and a fully data-driven Renter city `<select>` with real backend
   filtering (`GET /carriers/cities`, `GET /renters/search?city=`).
2. **Opt-in 캐리어가 렌탈 검색에 안 나타남** (root cause: registration and opt-in were two
   separate HTTP calls; if the second one didn't happen, the carrier stayed permanently
   non-rentable with no recovery path). Fixed by making creation atomic and adding a
   self-service retry button.

## Required E2E gates (AGENTS.md §8) - all passing

Implemented in `apps/web/e2e/gate.spec.ts`, run with `npm run e2e` from `apps/web`:

1. **정상 예약/결제**: register+opt-in a carrier with a real uploaded photo, search, book,
   authorize payment through the UI, and confirm the booking is durably `confirmed` with a
   `charge` ledger entry server-side.
2. **취소 환불 차등**: cancel one booking far ahead of pickup (>=48h -> 100% refund) and a
   second booking closer to pickup (24-48h window -> 50% refund) via the same in-checkout
   cancel control, proving the tiered policy - not a flat rate - actually drives the refund
   amount shown to the user.
3. **배송 지연 보상 반영**: simulate an outbound delivery delay from the Ops console and
   confirm the compensation ledger entry appears in the booking's ledger table in the UI and
   is durably persisted server-side via the signed webhook path.

## Additional regression coverage (not AGENTS.md-mandated gates, but run in the same suite)

4. **도시 필터**: register carriers under two different cities, confirm the Renter city
   dropdown reflects real inventory (not a hardcoded list), and confirm selecting a city
   genuinely includes/excludes the matching/non-matching carrier from search results.

## 동네 직거래(P2P 다이렉트 딜) 파일럿 — 진행 상황 (`prd.md` §19 / `trd.md` §16)

Backend (API/DB):
- [x] 스키마: `users.password_hash`, `carriers.brand/model/dong/latitude/longitude/deal_mode`,
      `deal_requests`, `chat_messages` (모두 additive, `IF NOT EXISTS`).
- [x] `auth.service.ts`: 이메일/비밀번호 회원가입/로그인, HMAC 서명 세션 토큰.
- [x] `ai.service.ts`: Azure OpenAI 사진 분석/챗봇 등록 대화 (미설정 시 503 graceful fallback).
- [x] `deal.service.ts`: 요청 생성(+채팅방 원자적 생성), 상태 전이, 채팅 메시지(참여자 검증).
- [x] `server.ts` 라우팅: `/auth/*`, `/carriers/map`, `/providers/carriers/ai-register/*`,
      `/deals*` 전체 연결 완료. `POST /providers/carriers`는 신규 필드 optional 확장 +
      토큰 있으면 인증된 사용자 id 우선 적용.
- [x] 실제 Postgres에 대해 통합 테스트 실행 완료 (로컬 docker-compose 기동, `schema.sql`
      재적용, `apps/api` 51개 테스트 + `apps/web` E2E 게이트 4개 전부 통과 확인).

Frontend (web):
- [x] 로그인/회원가입 UI + 토큰 저장 (`apps/web/src/p2p.ts`, `localStorage` 세션 토큰).
- [x] Kakao Map 캐리어 지도 탭 (`VITE_KAKAO_MAP_KEY` 미설정 시 안내 placeholder + 목록 폴백,
      실제 브라우저에서 지도/카드/요청 폼 렌더링 확인 완료).
- [x] AI 챗봇/사진 등록 UI (초안 → 사용자 수정 폼; 사진 업로드/챗봇 탭 전환 렌더링 확인).
- [x] 요청 생성 + 채팅 UI (내 요청함, 4초 간격 폴링 기반 메시지 조회; 실제 API로 요청 생성 →
      수락 → 완료 → 채팅 메시지 왕복까지 end-to-end 확인).

Infra:
- [x] Azure OpenAI(Cognitive Services) Bicep 리소스 + 모델 배포 코드 작성 및 `az bicep build`
      검증 완료 — **실제 프로비저닝(`azd provision`)은 사용자 승인 필요, 과금 발생**.
- [x] `VITE_KAKAO_MAP_KEY` 빌드타임 env 배선 (`Dockerfile`/`azure.yaml`) 완료.
- [ ] Kakao Developers 앱/도메인 등록 (사용자가 직접 발급해야 하는 외부 키 — 미완료).
- [ ] **이미 배포된 staging/production Postgres에 이번 파일럿 스키마 마이그레이션 적용**
      (`users.password_hash`, `carriers.brand/model/dong/latitude/longitude/deal_mode`,
      `deal_requests`, `chat_messages`) — 절차는 `DEPLOYMENT.md`의 "동네 직거래(P2P) 파일럿
      스키마 마이그레이션" 절 참조. 적용 전까지는 신규 코드 배포 시 회원가입/캐리어 등록/
      직거래 요청·채팅이 전부 500 에러 (로컬에서 실제 재현·확인됨).

## Deliberately out of scope (per AGENTS.md, not gaps)

- [ ] Real external payment gateway integration (mock payment provider is intentional for
      this MVP).
- [ ] Automated 20-transaction contribution-profit gate judgment.
- [ ] Full overdue/lost/additional-charge automation.
- [ ] Multi-warehouse **routing optimization** (delivery route/warehouse assignment
      algorithms), membership/subscription, dynamic pricing automation. The simple
      city tag-match filter added above is not routing optimization and remains in scope.

## Chopped sections addressed

- [x] Search grid collapse at `1024px`.
- [x] Card media/content collapse at `640px`.
- [x] Checkout summary moving below results on tablet/mobile.
- [x] Ops console collapses to a single column below `680px`.
- [x] Typography and spacing tokens aligned to the attached palette and 4px rhythm.
