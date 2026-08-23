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

## Deliberately out of scope (per AGENTS.md, not gaps)

- [ ] Real external payment gateway integration (mock payment provider is intentional for
      this MVP).
- [ ] Automated 20-transaction contribution-profit gate judgment.
- [ ] Full overdue/lost/additional-charge automation.
- [ ] Multi-warehouse routing, membership/subscription, dynamic pricing automation.

## Chopped sections addressed

- [x] Search grid collapse at `1024px`.
- [x] Card media/content collapse at `640px`.
- [x] Checkout summary moving below results on tablet/mobile.
- [x] Ops console collapses to a single column below `680px`.
- [x] Typography and spacing tokens aligned to the attached palette and 4px rhythm.
