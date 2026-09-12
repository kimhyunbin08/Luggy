# Web MVP Gap Checklist

Baseline: `prd.md` v0.1 and `trd.md` v0.2 compared with the current API and web funnel.

## Covered in the current implementation

- [x] Search API and first-viewport date/size search flow.
- [x] Result selection and three checkout steps.
- [x] Provider registration, intake photo selection, and rental opt-in.
- [x] Booking creation and payment authorization endpoints.
- [x] Inspection, completion, claim resolution, delivery webhook, and funnel event routes.
- [x] Responsive tokenized styling and brand palette source of truth.

## Remaining implementation gaps

- [ ] Replace the mock payment authorization with the selected payment provider and signed
      webhook verification.
- [ ] Persist `sessionId` and idempotency keys for funnel/ledger reconciliation.
- [ ] Add a real inspection-photo storage adapter (Azure Blob) and signed upload URLs.
- [ ] Add server-side ranking feature flag and KPI aggregation beyond raw event counts.
- [ ] Complete the required E2E gates for normal payment, tiered cancellation refund, and
      delayed-delivery compensation.
- [ ] Keep deferred automation out of the live path: profitability gate, full overdue/lost/
      additional-charge automation, and multi-warehouse routing.

## Chopped sections addressed

- [x] Search grid collapse at `1024px`.
- [x] Card media/content collapse at `640px`.
- [x] Checkout summary moving below results on tablet/mobile.
- [x] Typography and spacing tokens aligned to the attached palette and 4px rhythm.
