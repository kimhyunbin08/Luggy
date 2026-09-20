import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

// Covers the C2C direct-contact platform features layered on top of the map
// search MVP: auth/login, favorites (찜하기), and post-transaction reviews.
// Payments/PG remain intentionally out of scope per prd.md.

describe('integration: auth (signup/login/me)', () => {
  const app = createApp();

  it('signs up a new user and returns a usable session token', async () => {
    const signup = await request(app).post('/auth/signup').send({ nickname: '역삼동김철수', phone: '010-1111-9999', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
    expect(signup.status).toBe(201);
    expect(signup.body.token).toBeTruthy();
    expect(signup.body.user.phone).toBe('010-1111-9999');

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${signup.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.nickname).toBe('역삼동김철수');
  });

  it('rejects signup with an invalid phone number', async () => {
    const res = await request(app).post('/auth/signup').send({ nickname: '테스터', phone: 'not-a-phone', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate signup for the same phone number', async () => {
    await request(app).post('/auth/signup').send({ nickname: '중복테스트', phone: '010-2222-3333', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
    const dup = await request(app).post('/auth/signup').send({ nickname: '중복테스트2', phone: '010-2222-3333', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
    expect(dup.status).toBe(409);
  });

  it('rejects signup when the terms of service are not agreed to', async () => {
    const res = await request(app).post('/auth/signup').send({
      nickname: '약관미동의', phone: '010-4444-5555', district: '강남구 역삼동', ownsCarrier: false,
      agreedToTerms: false, agreedToPrivacy: true
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('동의');
  });

  it('rejects signup when the privacy policy is not agreed to', async () => {
    const res = await request(app).post('/auth/signup').send({
      nickname: '개인정보미동의', phone: '010-4444-6666', district: '강남구 역삼동', ownsCarrier: false,
      agreedToTerms: true, agreedToPrivacy: false
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('동의');
  });

  it('records the consent timestamps on a successful signup', async () => {
    const res = await request(app).post('/auth/signup').send({
      nickname: '동의완료', phone: '010-4444-7777', district: '강남구 역삼동', ownsCarrier: false,
      agreedToTerms: true, agreedToPrivacy: true
    });
    expect(res.status).toBe(201);
    expect(res.body.user.agreedToTermsAt).toBeTruthy();
    expect(res.body.user.agreedToPrivacyAt).toBeTruthy();
  });

  it('logs an existing user back in by phone number and rejects unknown numbers', async () => {
    await request(app).post('/auth/signup').send({ nickname: '로그인테스트', phone: '010-3333-4444', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
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
    const res = await request(app).post('/auth/signup').send({ nickname, phone, district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
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
    const signup = await request(app).post('/auth/signup').send({ nickname: '소유자테스트', phone: '010-5555-6666', district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
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

describe('integration: chat (1:1 direct chat threads on a contact request)', () => {
  const app = createApp();

  async function signUpUser(phone: string, nickname: string) {
    const res = await request(app).post('/auth/signup').send({ nickname, phone, district: '강남구 역삼동', ownsCarrier: false, agreedToTerms: true, agreedToPrivacy: true });
    return { token: res.body.token as string, user: res.body.user };
  }

  it('seeds the thread with the renter\'s initial inquiry message', async () => {
    const renter = await signUpUser('010-7000-0001', '채팅렌터1');
    const contactRes = await request(app)
      .post('/contact-requests')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ carrierId: 'c1', message: '안녕하세요, 대여 가능할까요?' });
    expect(contactRes.status).toBe(201);
    expect(contactRes.body.contactRequest.messages).toHaveLength(1);
    expect(contactRes.body.contactRequest.messages[0].text).toBe('안녕하세요, 대여 가능할까요?');
    expect(contactRes.body.contactRequest.messages[0].senderRole).toBe('renter');
  });

  it('lets the renter and the carrier owner exchange messages, but blocks unrelated users', async () => {
    const owner = await signUpUser('010-7000-0002', '채팅오너1');
    const carrierRes = await request(app)
      .post('/providers/carriers')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ size: 'carry_on', brandModel: '채팅용 캐리어', district: '강남구', dailyPrice: 8000 });
    const carrierId = carrierRes.body.id;

    const renter = await signUpUser('010-7000-0003', '채팅렌터2');
    const contactRes = await request(app)
      .post('/contact-requests')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ carrierId, message: '문의드립니다' });
    const requestId = contactRes.body.contactRequest.id;

    const ownerReply = await request(app)
      .post(`/contact-requests/${requestId}/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ text: '네, 가능합니다! 언제 필요하세요?' });
    expect(ownerReply.status).toBe(201);
    expect(ownerReply.body.message.senderRole).toBe('owner');

    const renterReply = await request(app)
      .post(`/contact-requests/${requestId}/messages`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ text: '이번 주말에 필요해요.' });
    expect(renterReply.status).toBe(201);

    const thread = await request(app).get(`/contact-requests/${requestId}`).set('Authorization', `Bearer ${owner.token}`);
    expect(thread.status).toBe(200);
    expect(thread.body.contactRequest.messages).toHaveLength(3);

    const stranger = await signUpUser('010-7000-0004', '무관한사람');
    const blocked = await request(app)
      .post(`/contact-requests/${requestId}/messages`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ text: '끼어들기' });
    expect(blocked.status).toBe(403);

    const blockedRead = await request(app)
      .get(`/contact-requests/${requestId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(blockedRead.status).toBe(403);
  });

  it('rejects sending a message without authentication', async () => {
    const contactRes = await request(app).post('/contact-requests').send({ carrierId: 'c1', message: '문의' });
    const requestId = contactRes.body.contactRequest.id;
    const res = await request(app).post(`/contact-requests/${requestId}/messages`).send({ text: '안녕하세요' });
    expect(res.status).toBe(401);
  });
});
