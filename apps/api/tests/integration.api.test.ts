import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('integration: booking flow', () => {
  const app = createApp();

  it('supports search -> booking -> authorize -> delivery update', async () => {
    const search = await request(app).get('/renters/search?size=carry_on');
    expect(search.status).toBe(200);
    const carrierId = search.body.items[0].id;

    const bookingRes = await request(app).post('/bookings').send({
      carrierId,
      size: 'carry_on',
      startDate: '2026-08-10',
      endDate: '2026-08-12'
    });
    expect(bookingRes.status).toBe(201);

    const id = bookingRes.body.id;
    const auth = await request(app).post(`/bookings/${id}/authorize-payment`).send({});
    expect(auth.status).toBe(200);

    const delivery = await request(app).post('/webhooks/delivery').send({ bookingId: id, status: 'in_transit' });
    expect(delivery.status).toBe(200);

    const booking = await request(app).get(`/bookings/${id}`);
    expect(booking.body.deliveryStatus).toBe('in_transit');
  });

  it('applies refund tiers on cancel', async () => {
    const bookingRes = await request(app).post('/bookings').send({
      carrierId: 'c1',
      size: 'carry_on',
      startDate: '2026-08-10',
      endDate: '2026-08-12'
    });
    const id = bookingRes.body.id;

    const cancel = await request(app).post(`/bookings/${id}/cancel`).send({ hoursBeforePickup: 30 });
    expect(cancel.status).toBe(200);
    expect(cancel.body.refundAmount).toBeGreaterThan(0);
  });

  it('blocks completion without inspection photos', async () => {
    const bookingRes = await request(app).post('/bookings').send({
      carrierId: 'c1',
      size: 'carry_on',
      startDate: '2026-08-10',
      endDate: '2026-08-12'
    });
    const id = bookingRes.body.id;

    const complete = await request(app).post(`/bookings/${id}/complete`).send({});
    expect(complete.status).toBe(400);
  });
});
