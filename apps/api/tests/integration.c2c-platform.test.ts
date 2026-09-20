import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

// Covers the C2C direct-contact platform features layered on top of the map
// search MVP: auth/login, favorites (찜하기), and post-transaction reviews.
// Payments/PG remain intentionally out of scope per prd.md.

describe('integration: auth (signup/login/me)', () => {
  const app = createApp();

  it('signs up a new user and returns a usable session token', async () => {
    const signup = await request(app).post('/auth/signup').send({ nickname: '역삼동김철수', phone: '010-1111-9999' });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toBeTruthy();
    expect(signup.body.user.phone).toBe('010-1111-9999');

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${signup.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.nickname).toBe('역삼동김철수');
  });

  it('rejects signup with an invalid phone number', async () => {
    const res = await request(app).post('/auth/signup').send({ nickname: '테스터', phone: 'not-a-phone' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate signup for the same phone number', async () => {
    await request(app).post('/auth/signup').send({ nickname: '중복테스트', phone: '010-2222-3333' });
    const dup = await request(app).post('/auth/signup').send({ nickname: '중복테스트2', phone: '010-2222-3333' });
    expect(dup.status).toBe(409);
  });

  it('logs an existing user back in by phone number and rejects unknown numbers', async () => {
    await request(app).post('/auth/signup').send({ nickname: '로그인테스트', phone: '010-3333-4444' });
    const login = await request(app).post('/auth/login').send({ phone: '010-3333-4444' });
    expect(login.status).toBe(200);
    expect(login.body.user.nickname).toBe('로그인테스트');

    const unknown = await request(app).post('/auth/login').send({ phone: '010-9999-0000' });
    expect(unknown.status).toBe(404);
  });

  it('rejects protected endpoints without a valid session', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('integration: favorites (찜하기)', () => {
  const app = createApp();

  async function signUpUser(phone: string, nickname: string) {
    const res = await request(app).post('/auth/signup').send({ nickname, phone });
    return res.body.token as string;
  }

  it('requires login to add/remove/list favorites', async () => {
    const add = await request(app).post('/favorites').send({ carrierId: 'c1' });
    expect(add.status).toBe(401);
  });

  it('adds and removes a carrier from favorites', async () => {
    const token = await signUpUser('010-4444-5555', '찜테스트유저');

    const add = await request(app).post('/favorites').set('Authorization', `Bearer ${token}`).send({ carrierId: 'c1' });
    expect(add.status).toBe(201);

    const list = await request(app).get('/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe('c1');

    const remove = await request(app).delete('/favorites/c1').set('Authorization', `Bearer ${token}`);
    expect(remove.status).toBe(200);

    const listAfter = await request(app).get('/favorites').set('Authorization', `Bearer ${token}`);
    expect(listAfter.body.items).toHaveLength(0);
  });
});

describe('integration: reviews (반납 완료 후 후기)', () => {
  const app = createApp();

  it('blocks reviews until the contact request reaches completed status, then accepts one', async () => {
    const contactRes = await request(app).post('/contact-requests').send({ carrierId: 'c2', message: '문의합니다' });
    expect(contactRes.status).toBe(201);
    const contactRequestId = contactRes.body.contactRequest.id;

    const tooEarly = await request(app)
      .post('/carriers/c2/reviews')
      .send({ contactRequestId, rating: 5, comment: '좋아요' });
    expect(tooEarly.status).toBe(400);

    await request(app).post(`/contact-requests/${contactRequestId}/status`).send({ status: 'accepted' });
    await request(app).post(`/contact-requests/${contactRequestId}/status`).send({ status: 'completed' });

    const review = await request(app)
      .post('/carriers/c2/reviews')
      .send({ contactRequestId, rating: 5, comment: '친절하고 깨끗했어요!' });
    expect(review.status).toBe(201);
    expect(review.body.carrier.reviews).toBeGreaterThan(0);

    const duplicate = await request(app)
      .post('/carriers/c2/reviews')
      .send({ contactRequestId, rating: 4, comment: '두 번째 후기' });
    expect(duplicate.status).toBe(409);

    const list = await request(app).get('/carriers/c2/reviews');
    expect(list.body.reviews).toHaveLength(1);
  });
});

describe('integration: owner-scoped carrier registration + contact requests', () => {
  const app = createApp();

  it('attaches the logged-in owner to a newly registered carrier and lets them view received requests', async () => {
    const signup = await request(app).post('/auth/signup').send({ nickname: '소유자테스트', phone: '010-5555-6666' });
    const token = signup.body.token as string;

    const carrierRes = await request(app)
      .post('/providers/carriers')
      .set('Authorization', `Bearer ${token}`)
      .send({ size: 'carry_on', brandModel: '테스트 캐리어', district: '강남구', dailyPrice: 8000 });
    expect(carrierRes.status).toBe(201);
    const carrierId = carrierRes.body.id;

    const myCarriers = await request(app).get('/providers/me/carriers').set('Authorization', `Bearer ${token}`);
    expect(myCarriers.status).toBe(200);
    expect(myCarriers.body.items.map((c: { id: string }) => c.id)).toContain(carrierId);

    await request(app).post('/contact-requests').send({ carrierId, message: '문의드려요' });

    const received = await request(app).get('/contact-requests').set('Authorization', `Bearer ${token}`);
    expect(received.status).toBe(200);
    expect(received.body.requests.some((r: { carrierId: string }) => r.carrierId === carrierId)).toBe(true);
  });
});
