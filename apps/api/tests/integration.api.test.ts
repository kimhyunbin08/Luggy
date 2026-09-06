import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';
import { query, closePool } from '../src/db/pool.js';
import { signPayload } from '../src/services/webhook.service.js';
import { PAYMENT_WEBHOOK_SECRET } from '../src/services/payment.service.js';
import { DELIVERY_WEBHOOK_SECRET } from '../src/services/delivery.service.js';

const app = createApp();

// --- Fixture helpers -------------------------------------------------------
// There is no user-management API in the MVP scope (auth/onboarding is
// explicitly out of scope per AGENTS.md), so — exactly like a real
// deployment would need out-of-band user provisioning — tests seed `users`
// rows directly.
async function createTestUser(role: 'provider' | 'renter'): Promise<string> {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.luggy`;
  const result = await query(
    `INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, `Test ${role}`, role]
  );
  return result.rows[0].id;
}

async function createOptedInCarrier(
  providerId: string,
  size: 'carry_on' | 'medium' = 'carry_on'
): Promise<string> {
  const createRes = await request(app)
    .post('/providers/carriers')
    .send({
      providerId,
      size,
      brandModel: 'Test Carrier',
      basePrice: size === 'carry_on' ? 7900 : 11900,
    });
  const carrierId = createRes.body.id;
  const optInRes = await request(app).post(`/providers/carriers/${carrierId}/opt-in`).send({});
  if (optInRes.status !== 200) {
    throw new Error(`Fixture setup failed: opt-in returned ${optInRes.status}: ${JSON.stringify(optInRes.body)}`);
  }
  return carrierId;
}

// Bookings use DATE-only columns (a calendar day, not a specific instant), so
// day-granularity offsets are used everywhere to stay safely clear of
// hour-level tier boundaries regardless of what time of day tests run at.
function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  // Matches src/scripts/init-db.ts — ensures an active policy exists so the
  // suite is self-contained even on a fresh database.
  await query(
    `INSERT INTO policy_versions
      (version_number, daily_price_carry_on, daily_price_medium,
       deposit_carry_on, deposit_medium, round_trip_shipping,
       min_rental_days, refund_full_hours, refund_half_hours,
       platform_fee_percent, active, created_at)
     VALUES
      ('v1.0', 7900, 11900, 30000, 50000, 14000, 2, 48, 24, 80, true, CURRENT_TIMESTAMP)
     ON CONFLICT (version_number) DO NOTHING`
  );
});

afterAll(async () => {
  await closePool();
});

describe('carrier registration + opt-in (regression: bugs #2 and #3)', () => {
  it('a freshly registered carrier is excluded from search until opted in, then included', async () => {
    const providerId = await createTestUser('provider');
    const createRes = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'carry_on',
      brandModel: 'OptInRegressionTest',
      basePrice: 7900,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('intake_pending');
    expect(typeof createRes.body.basePrice).toBe('number'); // DECIMAL-cast fix
    const carrierId = createRes.body.id;

    const start = futureDateStr(60);
    const end = futureDateStr(62);
    const searchBefore = await request(app).get(
      `/renters/search?size=carry_on&start_date=${start}&end_date=${end}`
    );
    expect(searchBefore.status).toBe(200);
    expect(searchBefore.body.items.some((i: any) => i.id === carrierId)).toBe(false);

    // Bug #3: this used to be impossible because the route required
    // status === 'available' as a PRECONDITION for opt-in, but carriers are
    // always created as 'intake_pending' — a permanent deadlock.
    const optInRes = await request(app).post(`/providers/carriers/${carrierId}/opt-in`).send({});
    expect(optInRes.status).toBe(200);

    const carrierAfter = await request(app).get(`/carriers/${carrierId}`);
    // Bug #2: opt-in must flip status to 'available', not just the opt_in_rentable flag.
    expect(carrierAfter.body.status).toBe('available');
    expect(carrierAfter.body.optInRentable).toBe(true);

    const searchAfter = await request(app).get(
      `/renters/search?size=carry_on&start_date=${start}&end_date=${end}`
    );
    expect(searchAfter.body.items.some((i: any) => i.id === carrierId)).toBe(true);
  });

  it('rejects opt-in for a carrier that is mid-lifecycle (not intake_pending/available)', async () => {
    const providerId = await createTestUser('provider');
    const createRes = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'carry_on',
      brandModel: 'LockedCarrier',
      basePrice: 7900,
    });
    const carrierId = createRes.body.id;
    await query(`UPDATE carriers SET status = 'maintenance' WHERE id = $1`, [carrierId]);

    const optInRes = await request(app).post(`/providers/carriers/${carrierId}/opt-in`).send({});
    expect(optInRes.status).toBe(400);
  });
});

describe('city filter + atomic opt-in (real city-selection feature)', () => {
  it('creates a carrier already opted-in when optInRentable is sent, in a single call', async () => {
    const providerId = await createTestUser('provider');
    const createRes = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'carry_on',
      brandModel: 'AtomicOptInTest',
      basePrice: 7900,
      city: '부산',
      optInRentable: true,
    });
    expect(createRes.status).toBe(201);
    // Create + opt-in happen atomically in the same INSERT now, closing the
    // race where a dropped follow-up opt-in call left a carrier stuck.
    expect(createRes.body.status).toBe('available');
    expect(createRes.body.optInRentable).toBe(true);
    expect(createRes.body.city).toBe('부산');

    const start = futureDateStr(70);
    const end = futureDateStr(72);
    const search = await request(app).get(
      `/renters/search?size=carry_on&start_date=${start}&end_date=${end}`
    );
    expect(search.body.items.some((i: any) => i.id === createRes.body.id)).toBe(true);
  });

  it('defaults city to 서울 when omitted (backward compatible with existing callers)', async () => {
    const providerId = await createTestUser('provider');
    const createRes = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'carry_on',
      brandModel: 'DefaultCityTest',
      basePrice: 7900,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.city).toBe('서울');
  });

  it('filters search results by city, and omitting city returns all cities (legacy behavior)', async () => {
    const providerId = await createTestUser('provider');
    const start = futureDateStr(80);
    const end = futureDateStr(82);

    const seoulCreate = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'medium',
      brandModel: 'SeoulCityCarrier',
      basePrice: 11900,
      city: '서울',
      optInRentable: true,
    });
    const busanCreate = await request(app).post('/providers/carriers').send({
      providerId,
      size: 'medium',
      brandModel: 'BusanCityCarrier',
      basePrice: 11900,
      city: '부산',
      optInRentable: true,
    });
    const seoulId = seoulCreate.body.id;
    const busanId = busanCreate.body.id;

    const searchSeoul = await request(app).get(
      `/renters/search?size=medium&start_date=${start}&end_date=${end}&city=${encodeURIComponent('서울')}`
    );
    expect(searchSeoul.body.items.some((i: any) => i.id === seoulId)).toBe(true);
    expect(searchSeoul.body.items.some((i: any) => i.id === busanId)).toBe(false);
    expect(searchSeoul.body.metadata.city).toBe('서울');

    const searchBusan = await request(app).get(
      `/renters/search?size=medium&start_date=${start}&end_date=${end}&city=${encodeURIComponent('부산')}`
    );
    expect(searchBusan.body.items.some((i: any) => i.id === busanId)).toBe(true);
    expect(searchBusan.body.items.some((i: any) => i.id === seoulId)).toBe(false);

    // Omitting city must preserve legacy (pre-feature) behavior: no filtering.
    const searchAll = await request(app).get(
      `/renters/search?size=medium&start_date=${start}&end_date=${end}`
    );
    expect(searchAll.body.items.some((i: any) => i.id === seoulId)).toBe(true);
    expect(searchAll.body.items.some((i: any) => i.id === busanId)).toBe(true);
    expect(searchAll.body.metadata.city).toBe(null);
  });

  it('GET /carriers/cities returns distinct cities with current availability', async () => {
    const providerId = await createTestUser('provider');
    const start = futureDateStr(90);
    const end = futureDateStr(92);

    await request(app).post('/providers/carriers').send({
      providerId,
      size: 'carry_on',
      brandModel: 'DaeguCityCarrier',
      basePrice: 7900,
      city: '대구',
      optInRentable: true,
    });

    const citiesRes = await request(app).get(
      `/carriers/cities?size=carry_on&start_date=${start}&end_date=${end}`
    );
    expect(citiesRes.status).toBe(200);
    expect(Array.isArray(citiesRes.body.cities)).toBe(true);
    expect(citiesRes.body.cities).toContain('대구');
  });
});

describe('full booking lifecycle: search -> book -> pay -> deliver -> inspect -> complete', () => {
  let renterId: string;
  let providerId: string;
  let carrierId: string;
  let bookingId: string;

  beforeAll(async () => {
    renterId = await createTestUser('renter');
    providerId = await createTestUser('provider');
    carrierId = await createOptedInCarrier(providerId, 'carry_on');
  });

  it('creates a booking with a numeric totalPrice and persists the forwarded sessionId', async () => {
    const res = await request(app)
      .post('/bookings')
      .send({
        renterId,
        carrierId,
        startDate: futureDateStr(10),
        endDate: futureDateStr(12),
        sessionId: 'sess_test_lifecycle',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requested');
    expect(typeof res.body.totalPrice).toBe('number'); // regression: was a string
    expect(res.body.totalPrice).toBe(29800); // 2 days * 7900 + 14000 shipping
    bookingId = res.body.id;

    const funnelRows = await query(
      `SELECT session_id FROM funnel_events WHERE metadata->>'bookingId' = $1`,
      [bookingId]
    );
    expect(funnelRows.rows[0].session_id).toBe('sess_test_lifecycle');
  });

  it('rejects a booking shorter than the minimum rental period', async () => {
    const res = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(30),
      endDate: futureDateStr(31),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an overlapping booking for the same carrier', async () => {
    const res = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(11),
      endDate: futureDateStr(13),
    });
    expect(res.status).toBe(409);
  });

  it('authorizes and confirms payment via the mock provider, recording charge + deposit_hold', async () => {
    const res = await request(app).post(`/bookings/${bookingId}/authorize-payment`).send({});
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('completed');
    expect(res.body.payment.provider).toBe('mock');

    const detail = await request(app).get(`/bookings/${bookingId}`);
    expect(detail.body.status).toBe('confirmed');
    const charge = detail.body.ledgerEntries.find((e: any) => e.entryType === 'charge');
    const deposit = detail.body.ledgerEntries.find((e: any) => e.entryType === 'deposit_hold');
    expect(charge.amount).toBe(29800);
    expect(deposit.amount).toBe(30000); // carry_on deposit
  });

  it('is idempotent: re-authorizing does not double charge', async () => {
    await request(app).post(`/bookings/${bookingId}/authorize-payment`).send({});
    const detail = await request(app).get(`/bookings/${bookingId}`);
    const charges = detail.body.ledgerEntries.filter((e: any) => e.entryType === 'charge');
    const deposits = detail.body.ledgerEntries.filter((e: any) => e.entryType === 'deposit_hold');
    expect(charges.length).toBe(1);
    expect(deposits.length).toBe(1);
  });

  it('simulates a delayed outbound delivery and applies exactly one shipping-fee refund even if repeated', async () => {
    const first = await request(app)
      .post('/ops/delivery-events')
      .send({ bookingId, direction: 'outbound', status: 'delayed' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post('/ops/delivery-events')
      .send({ bookingId, direction: 'outbound', status: 'delayed' });
    expect(second.status).toBe(200);

    const detail = await request(app).get(`/bookings/${bookingId}`);
    const refunds = detail.body.ledgerEntries.filter((e: any) => e.entryType === 'refund');
    expect(refunds.length).toBe(1);
    expect(refunds[0].amount).toBe(14000); // roundTripShipping, compensated in full
  });

  it('progresses outbound arrived -> return in_transit -> return arrived', async () => {
    const steps: Array<['outbound' | 'return', 'arrived' | 'in_transit']> = [
      ['outbound', 'arrived'],
      ['return', 'in_transit'],
      ['return', 'arrived'],
    ];
    for (const [direction, status] of steps) {
      const res = await request(app).post('/ops/delivery-events').send({ bookingId, direction, status });
      expect(res.status).toBe(200);
    }

    const detail = await request(app).get(`/bookings/${bookingId}`);
    expect(detail.body.status).toBe('inspection_pending');
    // 5 rows: the repeated 'delayed' simulation from the previous test is
    // intentionally NOT deduped at the delivery_orders audit-trail level
    // (only the compensation ledger entry is) + arrived + in_transit + arrived.
    expect(detail.body.deliveryTimeline.length).toBe(5);
  });

  it('blocks completion until an inspection is recorded', async () => {
    const res = await request(app).post(`/bookings/${bookingId}/complete`);
    expect(res.status).toBe(400);
  });

  it('completes after an approved return inspection: persists settlement and releases the full deposit', async () => {
    const inspectionRes = await request(app)
      .post('/inspections')
      .send({
        bookingId,
        inspectionType: 'return',
        photos: ['http://localhost:3001/uploads/files/test-1.jpg'],
        status: 'approved',
      });
    expect(inspectionRes.status).toBe(201);
    expect(inspectionRes.body.claim).toBeNull();

    const completeRes = await request(app).post(`/bookings/${bookingId}/complete`);
    expect(completeRes.status).toBe(200);
    // 80/20 platform/provider split per AGENTS.md
    expect(completeRes.body.settlement.platformFee).toBe(23840);
    expect(completeRes.body.settlement.providerPayout).toBe(5960);

    const detail = await request(app).get(`/bookings/${bookingId}`);
    expect(detail.body.status).toBe('completed');
    const release = detail.body.ledgerEntries.find((e: any) => e.entryType === 'deposit_release');
    expect(release.amount).toBe(30000); // no damage claims -> full deposit back
  });

  it('is idempotent: completing again returns the persisted settlement without error', async () => {
    const res = await request(app).post(`/bookings/${bookingId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already completed/i);
    expect(res.body.settlement.platformFee).toBe(23840);
  });
});

describe('cancellation refund tiers (E2E gate: tiered refund)', () => {
  let renterId: string;
  let carrierId: string;

  beforeAll(async () => {
    renterId = await createTestUser('renter');
    const providerId = await createTestUser('provider');
    carrierId = await createOptedInCarrier(providerId, 'carry_on');
  });

  async function bookAndCancel(startOffsetDays: number, endOffsetDays: number) {
    const createRes = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(startOffsetDays),
      endDate: futureDateStr(endOffsetDays),
    });
    expect(createRes.status).toBe(201);
    return request(app).post(`/bookings/${createRes.body.id}/cancel`);
  }

  it('refunds 100% when cancelling far (>=48h) before pickup', async () => {
    // Pickup 4 calendar days out is always >=48h away regardless of time of day.
    const res = await bookAndCancel(4, 6);
    expect(res.status).toBe(200);
    expect(res.body.refundAmount).toBe(29800);
    expect(typeof res.body.refundAmount).toBe('number'); // regression: 100%-tier used to leak a string
  });

  it('refunds 50% when cancelling 24-48h before pickup', async () => {
    // Pickup 2 calendar days out lands in [24h, 48h) for any time-of-day
    // except the instant of local midnight.
    const res = await bookAndCancel(2, 4);
    expect(res.status).toBe(200);
    expect(res.body.refundAmount).toBe(14900); // floor(29800 * 0.5)
  });

  it('refunds 0% when cancelling <24h before (or after) pickup', async () => {
    // Pickup "today" has already effectively passed by the time the request
    // executes, so hoursBeforePickup is <= 0.
    const res = await bookAndCancel(0, 2);
    expect(res.status).toBe(200);
    expect(res.body.refundAmount).toBe(0);
  });

  it('is idempotent: re-cancelling returns the original cached refund amount', async () => {
    const createRes = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(20),
      endDate: futureDateStr(22),
    });
    const bookingId = createRes.body.id;

    const first = await request(app).post(`/bookings/${bookingId}/cancel`);
    expect(first.body.refundAmount).toBe(29800);

    const second = await request(app).post(`/bookings/${bookingId}/cancel`);
    expect(second.status).toBe(200);
    expect(second.body.refundAmount).toBe(29800);
    expect(second.body.message).toMatch(/already cancelled/i);
  });

  it('rejects cancelling a completed booking', async () => {
    const renter2 = await createTestUser('renter');
    const provider2 = await createTestUser('provider');
    const carrier2 = await createOptedInCarrier(provider2, 'carry_on');
    const createRes = await request(app).post('/bookings').send({
      renterId: renter2,
      carrierId: carrier2,
      startDate: futureDateStr(5),
      endDate: futureDateStr(7),
    });
    const bookingId = createRes.body.id;
    await request(app).post(`/bookings/${bookingId}/authorize-payment`).send({});
    await request(app)
      .post('/inspections')
      .send({ bookingId, inspectionType: 'return', photos: ['http://x/test.jpg'], status: 'approved' });
    await request(app).post(`/bookings/${bookingId}/complete`);

    const cancelRes = await request(app).post(`/bookings/${bookingId}/cancel`);
    expect(cancelRes.status).toBe(409);
  });
});

describe('damage claim gates completion (TRD AC#8)', () => {
  let bookingId: string;
  let claimId: string;

  beforeAll(async () => {
    const renterId = await createTestUser('renter');
    const providerId = await createTestUser('provider');
    const carrierId = await createOptedInCarrier(providerId, 'medium');
    const createRes = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(15),
      endDate: futureDateStr(17),
    });
    bookingId = createRes.body.id;
    await request(app).post(`/bookings/${bookingId}/authorize-payment`).send({});
  });

  it('creates a pending claim on a rejected inspection and blocks /complete with 409', async () => {
    const inspectionRes = await request(app)
      .post('/inspections')
      .send({
        bookingId,
        inspectionType: 'return',
        photos: ['http://localhost:3001/uploads/files/damage.jpg'],
        status: 'rejected',
        damageClaim: { damageType: 'scratch', amount: 10000 },
      });
    expect(inspectionRes.status).toBe(201);
    expect(inspectionRes.body.claim.status).toBe('pending');
    claimId = inspectionRes.body.claim.id;

    const detail = await request(app).get(`/bookings/${bookingId}`);
    expect(detail.body.status).toBe('claim_resolving');

    const completeRes = await request(app).post(`/bookings/${bookingId}/complete`);
    expect(completeRes.status).toBe(409);
    expect(completeRes.body.pendingClaims.length).toBe(1);
  });

  it('resolving the claim as approved records a damage_charge and unblocks completion, releasing the deposit net of damage', async () => {
    const resolveRes = await request(app)
      .post(`/claims/${claimId}/resolve`)
      .send({ status: 'approved', resolutionNotes: 'Confirmed minor scratch' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.claim.status).toBe('approved');

    const completeRes = await request(app).post(`/bookings/${bookingId}/complete`);
    expect(completeRes.status).toBe(200);

    const detail = await request(app).get(`/bookings/${bookingId}`);
    const release = detail.body.ledgerEntries.find((e: any) => e.entryType === 'deposit_release');
    expect(release.amount).toBe(40000); // medium deposit 50000 - 10000 damage charge
    const damageCharge = detail.body.ledgerEntries.find((e: any) => e.entryType === 'damage_charge');
    expect(damageCharge.amount).toBe(10000);
  });

  it('resolving an already-resolved claim is a safe no-op', async () => {
    const res = await request(app)
      .post(`/claims/${claimId}/resolve`)
      .send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already resolved/i);
    expect(res.body.claim.status).toBe('approved'); // unchanged from the first resolution
  });
});

describe('webhook signature verification', () => {
  it('rejects a payment webhook with no signature header', async () => {
    const res = await request(app)
      .post('/webhooks/payments')
      .send({ eventId: 'evt_unsigned', type: 'payment.completed', bookingId: '00000000-0000-0000-0000-000000000000', paymentIntentId: 'pi_x' });
    expect(res.status).toBe(401);
  });

  it('rejects a payment webhook with a forged signature', async () => {
    const res = await request(app)
      .post('/webhooks/payments')
      .set('X-Payment-Signature', 't=9999999999,v1=deadbeef')
      .send({ eventId: 'evt_forged' });
    expect(res.status).toBe(401);
  });

  it('rejects a delivery webhook with no signature header', async () => {
    const res = await request(app).post('/webhooks/delivery').send({
      eventId: 'evt_unsigned_delivery',
      bookingId: '00000000-0000-0000-0000-000000000000',
      direction: 'outbound',
      status: 'delayed',
    });
    expect(res.status).toBe(401);
  });

  it('accepts a correctly, externally signed payment webhook and dedupes an identical retry', async () => {
    const renterId = await createTestUser('renter');
    const providerId = await createTestUser('provider');
    const carrierId = await createOptedInCarrier(providerId, 'carry_on');
    const bookingRes = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(40),
      endDate: futureDateStr(42),
    });
    const bookingId = bookingRes.body.id;

    const payload = {
      eventId: `evt_external_${bookingId}`,
      type: 'payment.authorized',
      bookingId,
      paymentIntentId: `pi_external_${bookingId}`,
    };
    const { body, signatureHeader } = signPayload(PAYMENT_WEBHOOK_SECRET, payload);

    const first = await request(app)
      .post('/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Payment-Signature', signatureHeader)
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.deduped).toBe(false);

    const second = await request(app)
      .post('/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('X-Payment-Signature', signatureHeader)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);

    const detail = await request(app).get(`/bookings/${bookingId}`);
    const charges = detail.body.ledgerEntries.filter((e: any) => e.entryType === 'charge');
    expect(charges.length).toBe(1); // no double-charge from the deduped retry
  });

  it('accepts a correctly, externally signed delivery webhook', async () => {
    const renterId = await createTestUser('renter');
    const providerId = await createTestUser('provider');
    const carrierId = await createOptedInCarrier(providerId, 'carry_on');
    const bookingRes = await request(app).post('/bookings').send({
      renterId,
      carrierId,
      startDate: futureDateStr(45),
      endDate: futureDateStr(47),
    });
    const bookingId = bookingRes.body.id;

    const payload = { eventId: `evt_ext_delivery_${bookingId}`, bookingId, direction: 'outbound', status: 'in_transit' };
    const { body, signatureHeader } = signPayload(DELIVERY_WEBHOOK_SECRET, payload);

    const res = await request(app)
      .post('/webhooks/delivery')
      .set('Content-Type', 'application/json')
      .set('X-Delivery-Signature', signatureHeader)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(false);

    const detail = await request(app).get(`/bookings/${bookingId}`);
    expect(detail.body.deliveryStatus).toBe('in_transit');
  });
});

describe('local photo upload fallback (no Azure configured)', () => {
  it('signs an upload, accepts the file, and serves it back at blobUrl', async () => {
    const signRes = await request(app).post('/uploads/sign').send({ category: 'inspection', fileName: 'test.jpg' });
    expect(signRes.status).toBe(200);
    expect(signRes.body.mode).toBe('local');
    expect(signRes.body.uploadUrl).toBeTruthy();
    expect(signRes.body.blobUrl).toBeTruthy();

    const uploadRes = await request(app)
      .post(`/uploads/local/${signRes.body.token}`)
      .attach('file', Buffer.from('fake-image-bytes'), 'test.jpg');
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.blobUrl).toBe(signRes.body.blobUrl);
  });

  it('rejects reusing an already-consumed upload token', async () => {
    const signRes = await request(app).post('/uploads/sign').send({ category: 'inspection', fileName: 'test2.jpg' });
    const token = signRes.body.token;
    const firstUse = await request(app)
      .post(`/uploads/local/${token}`)
      .attach('file', Buffer.from('bytes'), 'test2.jpg');
    expect(firstUse.status).toBe(200);

    const secondUse = await request(app)
      .post(`/uploads/local/${token}`)
      .attach('file', Buffer.from('bytes'), 'test2.jpg');
    expect(secondUse.status).toBe(400);
  });

  it('rejects an unknown upload token', async () => {
    const res = await request(app)
      .post('/uploads/local/does-not-exist')
      .attach('file', Buffer.from('bytes'), 'x.jpg');
    expect(res.status).toBe(400);
  });
});

describe('KPI metrics endpoint', () => {
  it('returns the full aggregate shape', async () => {
    const res = await request(app).get('/metrics/kpi');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('funnel.conversion');
    expect(res.body).toHaveProperty('bookingsByStatus');
    expect(typeof res.body.providerOptInRate).toBe('number');
    expect(typeof res.body.bookingCompletionRate).toBe('number');
    expect(typeof res.body.disputeRate).toBe('number');
    expect(res.body).toHaveProperty('generatedAt');
  });

  it('reflects funnel events recorded via /funnel/events', async () => {
    const sessionId = `kpi_test_${Date.now()}`;
    await request(app).post('/funnel/events').send({ eventType: 'landing_view', sessionId });
    await request(app).post('/funnel/events').send({ eventType: 'search_submit', sessionId });

    const res = await request(app).get('/metrics/kpi');
    expect(res.body.funnel.landing).toBeGreaterThanOrEqual(1);
    expect(res.body.funnel.search).toBeGreaterThanOrEqual(1);
  });
});
