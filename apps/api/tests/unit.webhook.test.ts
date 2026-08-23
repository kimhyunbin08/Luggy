import { describe, expect, it, vi } from 'vitest';
import { signPayload, verifySignature } from '../src/services/webhook.service.js';

const SECRET = 'unit_test_webhook_secret';

describe('webhook.service: signPayload / verifySignature', () => {
  it('produces a signature that verifies against the exact signed body', () => {
    const payload = { eventId: 'evt_1', type: 'payment.completed', bookingId: 'b1' };
    const { body, signatureHeader } = signPayload(SECRET, payload);

    expect(verifySignature(SECRET, body, signatureHeader)).toBe(true);
  });

  it('rejects when the body is tampered with after signing', () => {
    const payload = { eventId: 'evt_2', type: 'payment.completed', bookingId: 'b1', amount: 1000 };
    const { body, signatureHeader } = signPayload(SECRET, payload);

    const tampered = body.replace('1000', '999999');
    expect(verifySignature(SECRET, tampered, signatureHeader)).toBe(false);
  });

  it('rejects when signed with a different secret', () => {
    const payload = { eventId: 'evt_3' };
    const { body, signatureHeader } = signPayload(SECRET, payload);

    expect(verifySignature('wrong_secret', body, signatureHeader)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySignature(SECRET, '{}', undefined)).toBe(false);
    expect(verifySignature(SECRET, '{}', null)).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    expect(verifySignature(SECRET, '{}', 'not-a-valid-header')).toBe(false);
    expect(verifySignature(SECRET, '{}', 't=123')).toBe(false);
  });

  it('rejects a stale signature outside the tolerance window', () => {
    const now = Date.now();
    vi.setSystemTime(new Date(now - 10 * 60 * 1000)); // sign 10 minutes in the past
    const { body, signatureHeader } = signPayload(SECRET, { eventId: 'evt_stale' });
    vi.setSystemTime(now); // verify "now"

    expect(verifySignature(SECRET, body, signatureHeader, 300)).toBe(false);
    vi.useRealTimers();
  });

  it('accepts a signature within a custom tolerance window', () => {
    const now = Date.now();
    vi.setSystemTime(new Date(now - 60 * 1000)); // signed 60s ago
    const { body, signatureHeader } = signPayload(SECRET, { eventId: 'evt_fresh' });
    vi.setSystemTime(now);

    expect(verifySignature(SECRET, body, signatureHeader, 300)).toBe(true);
    vi.useRealTimers();
  });
});
