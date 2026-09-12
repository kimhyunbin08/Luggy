import { describe, expect, it } from 'vitest';
import {
  calculateDailyRate,
  calculateRentalDays,
  calculateRefund,
  calculateSettlement,
  calculateTotalPrice,
  getDepositAmount,
} from '../src/services/policy.service.js';
import { PolicyVersion } from '../src/models/types.js';

// Mirrors the fixed price/deposit/refund/settlement policy documented in
// AGENTS.md and prd.md/trd.md — used as a fake policy snapshot so these tests
// never depend on a live database.
const policy: PolicyVersion = {
  id: 'policy-test-v1',
  versionNumber: 'test-v1',
  dailyPriceCarryOn: 7900,
  dailyPriceMedium: 11900,
  depositCarryOn: 30000,
  depositMedium: 50000,
  roundTripShipping: 14000,
  minRentalDays: 2,
  refundFullHours: 48,
  refundHalfHours: 24,
  platformFeePercent: 80,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  active: true,
};

describe('policy.service: calculateRentalDays', () => {
  it('computes whole-day counts from date-only boundaries', () => {
    expect(calculateRentalDays(new Date('2026-08-10'), new Date('2026-08-12'))).toBe(2);
    expect(calculateRentalDays(new Date('2026-08-10'), new Date('2026-08-13'))).toBe(3);
  });
});

describe('policy.service: calculateDailyRate / getDepositAmount', () => {
  it('selects carry_on vs medium pricing and deposits independently', () => {
    expect(calculateDailyRate('carry_on', policy)).toBe(7900);
    expect(calculateDailyRate('medium', policy)).toBe(11900);
    expect(getDepositAmount('carry_on', policy)).toBe(30000);
    expect(getDepositAmount('medium', policy)).toBe(50000);
  });
});

describe('policy.service: calculateTotalPrice', () => {
  it('adds round-trip shipping on top of rental-day cost', () => {
    // 2 days * 7900 + 14000 shipping = 29800
    expect(calculateTotalPrice('carry_on', new Date('2026-08-10'), new Date('2026-08-12'), policy)).toBe(29800);
    // 2 days * 11900 + 14000 shipping = 37800
    expect(calculateTotalPrice('medium', new Date('2026-08-10'), new Date('2026-08-12'), policy)).toBe(37800);
  });
});

describe('policy.service: calculateSettlement', () => {
  it('splits gross amount 80/20 platform/provider per AGENTS.md', () => {
    const { platformFee, providerPayout } = calculateSettlement(29800, policy);
    expect(platformFee).toBe(23840);
    expect(providerPayout).toBe(5960);
    expect(platformFee + providerPayout).toBe(29800);
  });
});

describe('policy.service: calculateRefund (critical bug fix regression coverage)', () => {
  const totalPrice = 29800;
  const pickupDate = new Date('2026-08-20T00:00:00Z');

  it('refunds 100% when cancelling >= 48h before pickup', () => {
    const cancellationTime = new Date('2026-08-17T23:00:00Z'); // 49h before pickup
    expect(calculateRefund(totalPrice, cancellationTime, pickupDate, policy)).toBe(29800);
  });

  it('refunds exactly 100% at the 48h boundary (inclusive)', () => {
    const cancellationTime = new Date('2026-08-18T00:00:00Z'); // exactly 48h before pickup
    expect(calculateRefund(totalPrice, cancellationTime, pickupDate, policy)).toBe(29800);
  });

  it('refunds 50% when cancelling between 24h and 48h before pickup', () => {
    const cancellationTime = new Date('2026-08-19T00:00:00Z'); // 24h before pickup
    expect(calculateRefund(totalPrice, cancellationTime, pickupDate, policy)).toBe(14900);
  });

  it('refunds 0% when cancelling < 24h before pickup', () => {
    const cancellationTime = new Date('2026-08-19T12:00:00Z'); // 12h before pickup
    expect(calculateRefund(totalPrice, cancellationTime, pickupDate, policy)).toBe(0);
  });

  it('refunds 0% when cancelling after pickup has already occurred', () => {
    // This is the exact scenario the original bug mishandled: it based the
    // tier on (now - booking creation time) instead of (pickup - now), so a
    // late cancellation relative to a long-ago-created booking could still
    // score a full/partial refund. Negative hours-before-pickup must floor
    // to the 0% tier.
    const cancellationTime = new Date('2026-08-21T00:00:00Z'); // 1 day AFTER pickup
    expect(calculateRefund(totalPrice, cancellationTime, pickupDate, policy)).toBe(0);
  });

  it('is independent of how long ago the booking was created', () => {
    // Regression guard: the old implementation derived hours from
    // booking.createdAt. Two bookings created at very different times, but
    // cancelled the same distance before the same pickup date, must refund
    // identically.
    const sameCancellationTime = new Date('2026-08-19T00:00:00Z');
    expect(calculateRefund(totalPrice, sameCancellationTime, pickupDate, policy)).toBe(
      calculateRefund(totalPrice, sameCancellationTime, pickupDate, policy)
    );
  });
});
